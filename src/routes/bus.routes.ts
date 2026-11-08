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
   * GET /api/v1/buses/search
   * Real-time search across ALL live buses operating in Delhi (4,500+ active fleet).
   * Supports searching by:
   * - Route line code (e.g. 33, 502, TMS, OMS, 227A, 913, 729, D5507, ML403)
   * - Vehicle plate / registration (e.g. DL1PD9227, DL1PD, DL51, 9227)
   * - Destination or Origin terminal (e.g. Bhajanpura, Noida, Anand Vihar, Kashmere Gate)
   * - Transit agency (DTC, DIMTS, DEVI, DMRC)
   */
  fastify.get('/search', async (request: FastifyRequest<{ Querystring: { q?: string; agency?: string; limit?: string } }>, reply: FastifyReply) => {
    const rawQ = request.query.q;
    const query = (rawQ || '').trim();
    if (!query) {
      return reply.status(200).send({
        status: 'success',
        count: 0,
        directions: [],
        data: [],
      });
    }

    const qLower = query.toLowerCase();
    const qUpper = query.toUpperCase().replace(/\s+/g, '');
    const limit = Math.min(Math.max(Number(request.query.limit) || 120, 20), 300);
    const agencyFilter = request.query.agency?.toUpperCase();

    const allBuses = spatialIndexService.getAllBuses();
    const now = Math.floor(Date.now() / 1000);
    const seenBusIds = new Set<string>();

    // Check for directional corridor options if query matches a known route code (e.g. "33", "502")
    const directions = staticTransitService.getRouteDirections(query);

    // Collect matching vehicles with score for ranking
    const matches: Array<{ bus: any; score: number }> = [];

    for (let i = 0; i < allBuses.length; i++) {
      const bus = allBuses[i];
      if (agencyFilter && agencyFilter !== 'ALL' && bus.agency !== agencyFilter) {
        continue;
      }
      if (seenBusIds.has(bus.id)) {
        continue;
      }

      const regUpper = (bus.id || '').toUpperCase();
      const resolved = resolveDelhiRoute(bus.routeId, bus.id, bus.lat, bus.lon, bus.bearing);
      const shortUpper = (resolved.shortName || '').toUpperCase();
      const destLower = (resolved.destination || '').toLowerCase();
      const origLower = (resolved.origin || '').toLowerCase();
      const descLower = (resolved.desc || '').toLowerCase();
      const routeId = String(bus.routeId || '');

      let score = 0;

      // 1. Exact registration match (e.g. "DL1PD9227")
      if (regUpper === qUpper) {
        score = 100;
      }
      // 2. Exact route code match (e.g. "33", "502", "TMS", "227A", "D5507")
      else if (shortUpper === qUpper || routeId === query) {
        score = 90;
      }
      // 3. Registration prefix (e.g. "DL1PD", "DL51GD")
      else if (regUpper.startsWith(qUpper)) {
        score = 80;
      }
      // 4. Route code prefix (e.g. "227" matches 227A, "91" matches 913)
      else if (shortUpper.startsWith(qUpper)) {
        score = 75;
      }
      // 5. Registration 4-digit substring (e.g. "9227", "6939")
      else if (regUpper.includes(qUpper)) {
        score = 70;
      }
      // 6. Route code substring (e.g. "5507" in "D5507", "403" in "ML403")
      else if (shortUpper.includes(qUpper)) {
        score = 65;
      }
      // 7. Destination / origin starts with query (e.g. "Bhajanpura", "Noida", "Anand Vihar")
      else if (destLower.startsWith(qLower) || origLower.startsWith(qLower)) {
        score = 60;
      }
      // 8. Destination / origin contains query
      else if (destLower.includes(qLower) || origLower.includes(qLower)) {
        score = 50;
      }
      // 9. Route description contains query
      else if (descLower.includes(qLower)) {
        score = 40;
      }
      // 10. Agency exact match (e.g. "DEVI", "DMRC", "DIMTS", "DTC")
      else if (bus.agency.toLowerCase() === qLower) {
        score = 30;
      }

      if (score > 0) {
        seenBusIds.add(bus.id);
        const busAgency = bus.agency;
        let agencyName = 'DTC State Fleet';
        if (busAgency === 'DIMTS') agencyName = 'DIMTS Cluster';
        else if (busAgency === 'DEVI') agencyName = 'DEVI Mohalla Bus';
        else if (busAgency === 'DMRC') agencyName = 'DMRC Metro Feeder';
        else if (bus.isElectric) agencyName = 'DTC Electric';

        matches.push({
          score,
          bus: {
            id: bus.id,
            registration: bus.id,
            route: resolved.shortName,
            routeId: bus.routeId,
            routeShortName: resolved.shortName,
            routeDesc: resolved.desc,
            destination: resolved.destination,
            origin: resolved.origin,
            agency: busAgency,
            agencyName,
            fuelType: bus.fuelType,
            isElectric: bus.isElectric,
            isAc: bus.isAc,
            ac: bus.isAc ? 'ac' : 'nac',
            themeColor: bus.themeColor,
            secondaryColor: bus.secondaryColor,
            lat: bus.lat,
            lon: bus.lon,
            speedKmph: bus.speedKmph,
            bearing: bus.bearing,
            timestamp: bus.timestamp,
            freshness: `${Math.max(0, now - bus.timestamp)}s ago`,
          },
        });
      }
    }

    // Sort by relevance score descending
    matches.sort((a, b) => b.score - a.score);
    const finalResults = matches.slice(0, limit).map((m) => m.bus);

    return reply.status(200).send({
      status: 'success',
      count: finalResults.length,
      query,
      directions,
      data: finalResults,
    });
  });

  /**
   * GET /api/v1/buses/suggest-routes
   * Dynamic route prefix and corridor suggestions as commuter types.
   * e.g. "9" -> 901, 905, 913, 971, 971A; "33" -> 33, 33A, 334; "971" -> 971, 971A.
   * Includes Origin ➔ Destination and live vehicle counts.
   */
  fastify.get('/suggest-routes', async (request: FastifyRequest<{ Querystring: { q?: string; limit?: string } }>, reply: FastifyReply) => {
    const rawQ = request.query.q;
    const query = (rawQ || '').trim();
    const limit = Math.min(Math.max(Number(request.query.limit) || 12, 1), 30);
    const suggestions = staticTransitService.getRouteSuggestions(query, limit);

    return reply.status(200).send({
      status: 'success',
      count: suggestions.length,
      query,
      data: suggestions,
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

    const resolved = resolveDelhiRoute(bus.routeId, bus.id, bus.lat, bus.lon, bus.bearing);
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
