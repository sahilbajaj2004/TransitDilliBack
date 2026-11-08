import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { staticTransitService } from '../services/static-transit.service';

export async function staticRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  /**
   * GET /api/v1/static/status
   * Metadata about the static GTFS transit dataset.
   */
  fastify.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const routes = staticTransitService.getAllRoutes();
    const stops = staticTransitService.getAllStops();

    return reply.status(200).send({
      status: 'success',
      version: '1.0.0-delhi-gtfs',
      totalRoutes: routes.length,
      totalStops: stops.length,
      coverageArea: 'Delhi National Capital Territory (NCT)',
      agencies: ['DTC', 'DIMTS'],
      lastUpdated: new Date().toISOString(),
    });
  });

  /**
   * GET /api/v1/static/bundle
   * Complete static transit catalog for client offline caching.
   * Cached heavily at the edge and browser.
   */
  fastify.get('/bundle', async (_request: FastifyRequest, reply: FastifyReply) => {
    const routes = staticTransitService.getAllRoutes();
    const stops = staticTransitService.getAllStops();

    // Cache for 24 hours at client, revalidate stale
    reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

    return reply.status(200).send({
      status: 'success',
      version: '1.0.0',
      timestamp: Math.floor(Date.now() / 1000),
      routes,
      stops,
    });
  });

  /**
   * GET /api/v1/static/routes
   * Returns all transit corridors with stop sequences and polyline geometries.
   */
  fastify.get('/routes', async (_request: FastifyRequest, reply: FastifyReply) => {
    const routes = staticTransitService.getAllRoutes();
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.status(200).send({
      status: 'success',
      count: routes.length,
      data: routes,
    });
  });

  /**
   * GET /api/v1/static/stops
   * Returns transit stops, optionally filtered by proximity (lat, lon, radius, limit) or search.
   */
  fastify.get('/stops', async (request: FastifyRequest<{ Querystring: { lat?: string; lon?: string; radius?: string; limit?: string; search?: string } }>, reply: FastifyReply) => {
    const { lat, lon, radius, limit, search } = request.query;

    if (lat && lon) {
      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);
      const radNum = radius ? parseFloat(radius) : 5.0;
      const limitNum = limit ? parseInt(limit, 10) : 50;

      const stops = staticTransitService.getNearbyStops(latNum, lonNum, radNum);
      const sliced = limitNum > 0 ? stops.slice(0, limitNum) : stops;

      reply.header('Cache-Control', 'public, max-age=60');
      return reply.status(200).send({
        status: 'success',
        count: sliced.length,
        data: sliced,
      });
    }

    let stops = staticTransitService.getAllStops();
    if (search) {
      const q = search.trim().toLowerCase();
      stops = stops.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    }

    const limitNum = limit ? parseInt(limit, 10) : stops.length;
    const sliced = limitNum > 0 ? stops.slice(0, limitNum) : stops;

    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.status(200).send({
      status: 'success',
      count: sliced.length,
      data: sliced,
    });
  });
}
