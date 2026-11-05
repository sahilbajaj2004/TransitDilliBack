import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { staticTransitService } from '../services/static-transit.service';

const SaveStopSchema = z.object({
  stopId: z.string().min(1, 'stopId is required'),
});

const SaveRouteSchema = z.object({
  routeId: z.string().min(1, 'routeId is required'),
});

export async function bookmarkRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  // Enforce JWT authentication on all bookmark endpoints
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * GET /api/v1/bookmarks/stops
   * List all saved favorite stops for current commuter.
   */
  fastify.get('/stops', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user.sub;
    const stops = await prisma.savedStop.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.status(200).send({
      status: 'success',
      count: stops.length,
      data: stops,
    });
  });

  /**
   * POST /api/v1/bookmarks/stops
   * Save a bus stop to commuter favorites.
   */
  fastify.post('/stops', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = SaveStopSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid stopId',
      });
    }

    const { stopId } = parseResult.data;
    const stop = staticTransitService.getStopById(stopId);
    if (!stop) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Bus stop ${stopId} not found in transit registry`,
      });
    }

    const userId = request.user.sub;
    const saved = await prisma.savedStop.upsert({
      where: {
        userId_stopId: { userId, stopId: stop.id },
      },
      update: {
        stopName: stop.name,
      },
      create: {
        userId,
        stopId: stop.id,
        stopName: stop.name,
      },
    });

    return reply.status(201).send({
      status: 'success',
      message: 'Stop saved to favorites',
      data: saved,
    });
  });

  /**
   * DELETE /api/v1/bookmarks/stops/:stopId
   * Remove a stop from favorites.
   */
  fastify.delete(
    '/stops/:stopId',
    async (request: FastifyRequest<{ Params: { stopId: string } }>, reply: FastifyReply) => {
      const { stopId } = request.params;
      const userId = request.user.sub;

      await prisma.savedStop.deleteMany({
        where: { userId, stopId },
      });

      return reply.status(200).send({
        status: 'success',
        message: 'Stop removed from favorites',
      });
    }
  );

  /**
   * GET /api/v1/bookmarks/routes
   * List all saved favorite routes for current commuter.
   */
  fastify.get('/routes', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user.sub;
    const routes = await prisma.savedRoute.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.status(200).send({
      status: 'success',
      count: routes.length,
      data: routes,
    });
  });

  /**
   * POST /api/v1/bookmarks/routes
   * Save a transit line to commuter favorites.
   */
  fastify.post('/routes', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = SaveRouteSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid routeId',
      });
    }

    const { routeId } = parseResult.data;
    const route = staticTransitService.getRouteById(routeId);
    if (!route) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Transit line ${routeId} not found in transit registry`,
      });
    }

    const userId = request.user.sub;
    const saved = await prisma.savedRoute.upsert({
      where: {
        userId_routeId: { userId, routeId: route.id },
      },
      update: {
        routeName: route.longName,
      },
      create: {
        userId,
        routeId: route.id,
        routeName: route.longName,
      },
    });

    return reply.status(201).send({
      status: 'success',
      message: 'Route saved to favorites',
      data: saved,
    });
  });

  /**
   * DELETE /api/v1/bookmarks/routes/:routeId
   * Remove a route from favorites.
   */
  fastify.delete(
    '/routes/:routeId',
    async (request: FastifyRequest<{ Params: { routeId: string } }>, reply: FastifyReply) => {
      const { routeId } = request.params;
      const userId = request.user.sub;

      await prisma.savedRoute.deleteMany({
        where: { userId, routeId },
      });

      return reply.status(200).send({
        status: 'success',
        message: 'Route removed from favorites',
      });
    }
  );
}
