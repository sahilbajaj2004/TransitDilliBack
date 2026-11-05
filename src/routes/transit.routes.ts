import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { staticTransitService } from '../services/static-transit.service';
import { spatialIndexService } from '../services/spatial.service';
import { EtaService } from '../services/eta.service';

const NearbyStopsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(0.1).max(10.0).default(1.5),
});

export async function transitRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  /**
   * GET /api/v1/routes
   * Returns all transit lines or searches by route code/name, annotated with active bus counts.
   */
  fastify.get('/routes', async (request: FastifyRequest<{ Querystring: { search?: string } }>, reply: FastifyReply) => {
    const { search } = request.query;
    const routes = search
      ? staticTransitService.searchRoutes(search)
      : staticTransitService.getAllRoutes();

    const annotated = routes.map((r) => {
      const activeBuses = spatialIndexService.getBusesByRoute(r.id);
      return {
        id: r.id,
        shortName: r.shortName,
        longName: r.longName,
        agency: r.agency,
        isAc: r.isAc,
        isElectric: r.isElectric,
        totalStops: r.stops.length,
        activeBusesCount: activeBuses.length,
      };
    });

    return reply.status(200).send({
      status: 'success',
      count: annotated.length,
      data: annotated,
    });
  });

  /**
   * GET /api/v1/routes/:routeId
   * Detailed route information: full ordered stop sequence and real-time active buses on that line.
   */
  fastify.get('/:routeId', async (request: FastifyRequest<{ Params: { routeId: string } }>, reply: FastifyReply) => {
    const { routeId } = request.params;
    const route = staticTransitService.getRouteById(routeId);

    if (!route) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Transit route ${routeId} not found`,
      });
    }

    const activeBuses = spatialIndexService.getBusesByRoute(route.id);

    return reply.status(200).send({
      status: 'success',
      data: {
        ...route,
        activeBusesCount: activeBuses.length,
        activeBuses,
      },
    });
  });

  /**
   * GET /api/v1/stops/nearby
   * Stops within walking distance (<1.5km) of commuter coordinates.
   */
  fastify.get('/stops/nearby', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = NearbyStopsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid coordinates',
      });
    }

    const { lat, lon, radius } = parseResult.data;
    const stops = staticTransitService.getNearbyStops(lat, lon, radius);

    return reply.status(200).send({
      status: 'success',
      count: stops.length,
      radiusKm: radius,
      data: stops,
    });
  });

  /**
   * GET /api/v1/stops/:stopId
   * Stop details.
   */
  fastify.get('/stops/:stopId', async (request: FastifyRequest<{ Params: { stopId: string } }>, reply: FastifyReply) => {
    const { stopId } = request.params;
    const stop = staticTransitService.getStopById(stopId);

    if (!stop) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Bus stop ${stopId} not found`,
      });
    }

    return reply.status(200).send({
      status: 'success',
      data: stop,
    });
  });

  /**
   * GET /api/v1/transit/stops/:stopId/arrivals
   * Real-time countdown arrival board for a specific bus stop across all approaching lines.
   */
  fastify.get('/stops/:stopId/arrivals', async (request: FastifyRequest<{ Params: { stopId: string } }>, reply: FastifyReply) => {
    const { stopId } = request.params;
    const stop = staticTransitService.getStopById(stopId);

    if (!stop) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Bus stop ${stopId} not found`,
      });
    }

    const arrivals = EtaService.getArrivalsForStop(stopId);

    return reply.status(200).send({
      status: 'success',
      stop: {
        id: stop.id,
        name: stop.name,
        code: stop.code,
        lat: stop.lat,
        lon: stop.lon,
      },
      timestamp: Math.floor(Date.now() / 1000),
      count: arrivals.length,
      arrivals,
    });
  });
}
