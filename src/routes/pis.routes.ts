import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { spatialIndexService } from '../services/spatial.service';
import { staticTransitService } from '../services/static-transit.service';
import { EtaService } from '../services/eta.service';

const GetBusesEtaBodySchema = z.object({
  stopId: z.string().min(1, 'stopId is required'),
  userLat: z.number().optional(),
  userLon: z.number().optional(),
  deviceId: z.string().optional(),
});

function formatFreshness(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (diffSec < 20) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  return `${mins} min${mins > 1 ? 's' : ''} ago`;
}

export async function pisRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  /**
   * POST /api/v1/pis/get_buses_eta
   * Stop-centric Passenger Information System arrival board.
   * Returns incoming buses on all routes serving this stop with computed arrival ETAs.
   */
  fastify.post('/get_buses_eta', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = GetBusesEtaBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid request body',
      });
    }

    const { stopId } = parseResult.data;
    const stop = staticTransitService.getStopById(stopId);

    if (!stop) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Stop ID '${stopId}' not found in static transit directory`,
      });
    }

    const routes = staticTransitService.getRoutesServingStop(stopId);
    const nowTimeStr = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const routeResults: any[] = [];

    for (const route of routes) {
      const activeBuses = spatialIndexService.getBusesByRoute(route.id);
      if (activeBuses.length === 0) continue;

      const incomingBuses: any[] = [];

      for (const bus of activeBuses) {
        // Calculate ETAs for all remaining stops along the route
        const stopEtas = EtaService.calculateRouteEtas(bus, route.stops);
        // Find if this specific stop is downstream in the bus's journey
        const targetStopEta = stopEtas.find((s) => s.stopId === stopId);

        if (targetStopEta) {
          incomingBuses.push({
            vehicleId: bus.id,
            routeId: route.id,
            etaMinutes: targetStopEta.etaMinutes,
            predictedArrivalTime: targetStopEta.predictedArrivalTime,
            stopsRemaining: targetStopEta.stopsRemaining,
            distanceKm: Math.round(targetStopEta.distanceKm * 10) / 10,
            speedKmph: bus.speedKmph,
            isElectric: bus.isElectric,
            isAc: bus.isAc,
            agency: bus.agency,
            color: bus.themeColor,
            fuelType: bus.fuelType,
            crowdLevel: targetStopEta.crowdLevel,
            freshness: formatFreshness(bus.timestamp),
          });
        }
      }

      // Sort incoming buses by arrival ETA (closest first)
      incomingBuses.sort((a, b) => a.etaMinutes - b.etaMinutes);

      // Keep up to 2 closest buses per route to minimize client clutter
      if (incomingBuses.length > 0) {
        routeResults.push({
          routeId: route.id,
          shortName: route.shortName,
          longName: route.longName,
          agency: route.agency,
          buses: incomingBuses.slice(0, 2),
        });
      }
    }

    reply.header('Cache-Control', 'public, max-age=5, stale-while-revalidate=10');

    return reply.status(200).send({
      status: 'success',
      message: 'success',
      stop: {
        id: stop.id,
        name: stop.name,
        code: stop.code,
        updatedAt: nowTimeStr,
        refreshIntervalMs: 30000,
        maxBusCount: 2,
      },
      routes: routeResults,
    });
  });

  /**
   * GET /api/v1/pis/get_bus_eta?vehicleId=...
   * Vehicle-centric downstream progression along its active route.
   */
  fastify.get('/get_bus_eta', async (request: FastifyRequest<{ Querystring: { vehicleId: string; withStops?: string } }>, reply: FastifyReply) => {
    const { vehicleId } = request.query;
    if (!vehicleId) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Querystring parameter vehicleId is required',
      });
    }

    const cleanId = vehicleId.toUpperCase().replace(/\s+/g, '');
    const bus = spatialIndexService.getBusById(cleanId);

    if (!bus) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Vehicle ${vehicleId} is not currently active`,
      });
    }

    const routeInfo = staticTransitService.getRouteById(bus.routeId);
    if (!routeInfo) {
      return reply.status(200).send({
        status: 'success',
        message: 'success',
        data: [],
      });
    }

    const etas = EtaService.calculateRouteEtas(bus, routeInfo.stops);

    const data = etas.map((s, idx) => ({
      vehicleId: bus.id,
      routeId: bus.routeId,
      routeLongName: routeInfo.longName,
      upcomingStopId: s.stopId,
      upcomingStopIdx: s.stopSequence,
      upcomingStopName: s.stopName,
      stopsInBtw: idx,
      etaMinutes: s.etaMinutes,
      predictedArrivalTime: s.predictedArrivalTime,
      crowdLevel: s.crowdLevel,
    }));

    return reply.status(200).send({
      status: 'success',
      message: 'success',
      data,
    });
  });
}
