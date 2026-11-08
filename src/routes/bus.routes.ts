import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { spatialIndexService } from '../services/spatial.service';
import { ingestionService } from '../services/ingestion.service';
import { staticTransitService } from '../services/static-transit.service';
import { resolveDelhiRoute } from '../services/route-resolver.service';
import { EtaService } from '../services/eta.service';
import { vehicleStreamService } from '../services/stream.service';

const NearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  lon: z.coerce.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  radius: z.coerce.number().min(0.1).max(50.0, 'Radius must be between 0.1 and 50 km').default(10.0),
  agency: z.enum(['DTC', 'DIMTS', 'DEVI', 'DMRC']).optional(),
  electric: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val !== undefined ? val === 'true' : undefined)),
  ac: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val !== undefined ? val === 'true' : undefined)),
  limit: z.coerce.number().int().min(1).max(300).default(50),
});

export async function busRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  /**
   * GET /api/v1/buses/nearby
   * Sub-millisecond 2D KD-Tree spatial query for buses within radius of commuter.
   */
  fastify.get('/nearby', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = NearbyQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid query parameters',
        details: parseResult.error.errors,
      });
    }

    const { lat, lon, radius, agency, electric, ac, limit } = parseResult.data;

    const buses = spatialIndexService.queryRadius(lat, lon, radius, {
      agency,
      isElectric: electric,
      isAc: ac,
      limit,
    });

    // HTTP Cache-Control: Cache for 4s, allow stale for 5s
    reply.header('Cache-Control', 'public, max-age=4, stale-while-revalidate=5');

    return reply.status(200).send({
      status: 'success',
      timestamp: Math.floor(Date.now() / 1000),
      count: buses.length,
      radiusKm: radius,
      queryCenter: { lat, lon },
      data: buses,
    });
  });

  /**
   * GET /api/v1/buses/stats
   * Real-time fleet metrics (DTC, DIMTS, EV counts, and telemetry ingestion health).
   */
  fastify.get('/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    const stats = spatialIndexService.getFleetStats();
    const ingestionStatus = ingestionService.getStatus();

    return reply.status(200).send({
      status: 'success',
      fleet: stats,
      ingestion: ingestionStatus,
    });
  });

  /**
   * GET /api/v1/buses/:vehicleId
   * Retrieves real-time GPS telemetry, route details, and computed stop-by-stop ETAs for a vehicle.
   */
  fastify.get('/:vehicleId', async (request: FastifyRequest<{ Params: { vehicleId: string } }>, reply: FastifyReply) => {
    const { vehicleId } = request.params;
    const bus = spatialIndexService.getBusById(vehicleId.toUpperCase().replace(/\s+/g, ''));

    if (!bus) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Vehicle ${vehicleId} is not currently active in Delhi live telemetry`,
      });
    }

    const resolved = resolveDelhiRoute(bus.routeId, bus.id);
    const routeInfo = staticTransitService.getRouteById(bus.routeId);
    const etas = routeInfo ? EtaService.calculateRouteEtas(bus, routeInfo.stops) : [];

    return reply.status(200).send({
      status: 'success',
      data: {
        ...bus,
        routeShortName: resolved.shortName,
        origin: resolved.origin,
        destination: resolved.destination,
        routeDesc: resolved.desc,
        agency: bus.agency,
        themeColor: bus.themeColor,
        routeDetails: {
          shortName: resolved.shortName,
          longName: resolved.longName,
          totalStops: routeInfo ? routeInfo.stops.length : 0,
        },
        etas,
      },
    });
  });

  /**
   * GET /api/v1/buses/:vehicleId/stream
   * Real-time Server-Sent Events (SSE) live position stream.
   * Emits live updates whenever upstream OTD telemetry refreshes.
   */
  fastify.get('/:vehicleId/stream', async (request: FastifyRequest<{ Params: { vehicleId: string } }>, reply: FastifyReply) => {
    const { vehicleId } = request.params;
    const cleanId = vehicleId.toUpperCase().replace(/\s+/g, '');
    const bus = spatialIndexService.getBusById(cleanId);

    if (!bus) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Vehicle ${vehicleId} is not currently active in Delhi live telemetry`,
      });
    }

    // Set SSE HTTP response headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    vehicleStreamService.incrementActiveStreams();

    // 1. Send immediate initial state
    const routeInfo = staticTransitService.getRouteById(bus.routeId);
    const initialEtas = routeInfo ? EtaService.calculateRouteEtas(bus, routeInfo.stops) : [];

    reply.raw.write(
      `event: initial\ndata: ${JSON.stringify({
        vehicle: bus,
        routeTitle: routeInfo ? routeInfo.longName : 'Delhi Transit Corridor',
        etas: initialEtas,
        timestamp: Math.floor(Date.now() / 1000),
      })}\n\n`
    );

    // 2. Setup channel listener for subsequent OTD position updates
    const channel = `vehicle:${cleanId}`;
    const onPositionUpdate = (payload: any) => {
      reply.raw.write(`event: position\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    vehicleStreamService.on(channel, onPositionUpdate);

    // 3. Keep-alive comment every 15s to keep cellular connection open
    const heartbeatTimer = setInterval(() => {
      reply.raw.write(':keep-alive\n\n');
    }, 15000);

    // 4. Clean up listener on client socket disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeatTimer);
      vehicleStreamService.off(channel, onPositionUpdate);
      vehicleStreamService.decrementActiveStreams();
    });
  });

  /**
   * POST /api/v1/buses/refresh
   * Manual trigger to force immediate poll of OTD Delhi feed.
   */
  fastify.post('/refresh', async (_request: FastifyRequest, reply: FastifyReply) => {
    const count = await ingestionService.pollOnce();
    return reply.status(200).send({
      status: 'success',
      message: 'OTD feed refreshed',
      vehiclesUpdated: count,
    });
  });
}
