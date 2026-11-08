import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { spatialIndexService } from '../services/spatial.service';
import { ingestionService } from '../services/ingestion.service';
import { staticTransitService } from '../services/static-transit.service';
import { resolveDelhiRoute } from '../services/route-resolver.service';
import { EtaService } from '../services/eta.service';

const NearbyBusesBodySchema = z.object({
  lat: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  lon: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  radiusKm: z.number().min(0.1).max(50.0).default(10.0),
  limit: z.number().int().min(1).max(300).default(60),
  agency: z.enum(['DTC', 'DIMTS', 'DEVI', 'DMRC']).optional(),
  electric: z.boolean().optional(),
  ac: z.boolean().optional(),
});

const BusesOnRouteBodySchema = z.object({
  routes: z.array(z.string()).min(1, 'At least one route identifier is required'),
});

function formatFreshness(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (diffSec < 20) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  return `${mins} min${mins > 1 ? 's' : ''} ago`;
}

export async function liveRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  /**
   * POST /api/v1/live/nearby-buses
   * High-speed spatial query returning real-time bus telemetry within the specified radius.
   * Resolves routes to authentic Delhi lines (never 4-digit internal IDs).
   */
  fastify.post('/nearby-buses', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = NearbyBusesBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid request body',
      });
    }

    const { lat, lon, radiusKm, limit, agency, electric, ac } = parseResult.data;

    const buses = spatialIndexService.queryRadius(lat, lon, radiusKm, {
      agency,
      isElectric: electric,
      isAc: ac,
      limit,
    });

    const now = Math.floor(Date.now() / 1000);

    const formatted = buses.map((bus) => {
      const resolved = resolveDelhiRoute(bus.routeId, bus.id);
      const shortName = resolved.shortName;
      const destination = resolved.destination;
      const origin = resolved.origin;
      const busAgency = bus.agency;
      let agencyName = 'DTC State Fleet';
      if (busAgency === 'DIMTS') agencyName = 'DIMTS Cluster';
      else if (busAgency === 'DEVI') agencyName = 'DEVI Mohalla Bus';
      else if (busAgency === 'DMRC') agencyName = 'DMRC Metro Feeder';
      else if (bus.isElectric) agencyName = 'DTC Electric';

      return {
        id: bus.id,
        route: shortName,
        routeId: bus.routeId,
        routeShortName: shortName,
        routeDesc: resolved.desc,
        destination,
        origin,
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
        orientation: bus.bearing,
        distanceMeters: bus.distanceMeters,
        timestamp: bus.timestamp,
        freshness: formatFreshness(bus.timestamp),
      };
    });

    reply.header('Cache-Control', 'public, max-age=3, stale-while-revalidate=5');

    return reply.status(200).send({
      status: 'success',
      count: formatted.length,
      time: now,
      data: formatted,
    });
  });

  /**
   * POST /api/v1/live/buses-on-route
   * Returns all active live buses currently operating on the requested route codes.
   */
  fastify.post('/buses-on-route', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = BusesOnRouteBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid request body',
      });
    }

    const { routes } = parseResult.data;
    const allBuses: any[] = [];
    const seenBusIds = new Set<string>();
    const now = Math.floor(Date.now() / 1000);

    for (const r of routes) {
      const buses = spatialIndexService.getBusesByRoute(r.toUpperCase().trim());

      for (const bus of buses) {
        if (!bus.id || seenBusIds.has(bus.id)) {
          continue;
        }
        seenBusIds.add(bus.id);

        const resolved = resolveDelhiRoute(bus.routeId, bus.id);
        const shortName = resolved.shortName;
        const destination = resolved.destination;
        const origin = resolved.origin;
        const busAgency = bus.agency;
        let agencyName = 'DTC State Fleet';
        if (busAgency === 'DIMTS') agencyName = 'DIMTS Cluster';
        else if (busAgency === 'DEVI') agencyName = 'DEVI Mohalla Bus';
        else if (busAgency === 'DMRC') agencyName = 'DMRC Metro Feeder';
        else if (bus.isElectric) agencyName = 'DTC Electric';

        allBuses.push({
          id: bus.id,
          route: shortName,
          routeId: bus.routeId,
          routeShortName: shortName,
          routeDesc: resolved.desc,
          destination,
          origin,
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
          orientation: bus.bearing,
          timestamp: bus.timestamp,
          freshness: formatFreshness(bus.timestamp),
        });
      }
    }

    reply.header('Cache-Control', 'public, max-age=4, stale-while-revalidate=5');

    return reply.status(200).send({
      status: 'success',
      count: allBuses.length,
      time: now,
      data: allBuses,
    });
  });

  /**
   * GET /api/v1/live/radar-snapshot
   * Returns a complete radar snapshot of all buses currently tracked in Delhi.
   */
  fastify.get('/radar-snapshot', async (_request: FastifyRequest, reply: FastifyReply) => {
    const buses = spatialIndexService.getAllBuses();
    const stats = spatialIndexService.getFleetStats();

    return reply.status(200).send({
      status: 'success',
      count: buses.length,
      stats,
      data: buses.slice(0, 150).map((bus) => {
        const resolved = resolveDelhiRoute(bus.routeId, bus.id);
        const busAgency = bus.agency === 'DIMTS' ? 'DIMTS' : resolved.agency;
        return {
          id: bus.id,
          route: resolved.shortName,
          routeId: bus.routeId,
          agency: busAgency,
          isElectric: bus.isElectric,
          lat: bus.lat,
          lon: bus.lon,
          speedKmph: bus.speedKmph,
          bearing: bus.bearing,
        };
      }),
    });
  });
}
