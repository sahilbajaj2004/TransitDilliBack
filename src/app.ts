import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwtPlugin from './plugins/jwt.plugin';
import { authRoutes } from './routes/auth.routes';
import { busRoutes } from './routes/bus.routes';
import { transitRoutes } from './routes/transit.routes';
import { bookmarkRoutes } from './routes/bookmark.routes';
import { spatialIndexService } from './services/spatial.service';
import { ingestionService } from './services/ingestion.service';
import { staticTransitService } from './services/static-transit.service';

export async function buildApp(): Promise<FastifyInstance> {
  const isDev = process.env.NODE_ENV === 'development';

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  });

  // Security Headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Cross-Origin Resource Sharing
  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global Rate Limiter: 120 req/minute per IP
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please throttle your requests.',
    }),
  });

  // JWT Security Plugin
  await app.register(jwtPlugin);

  // Initialize Static GTFS Transit Network into memory
  await staticTransitService.initialize();

  // Health check endpoint enriched with real-time fleet telemetry diagnostics
  app.get('/health', async () => {
    const fleet = spatialIndexService.getFleetStats();
    const ingestion = ingestionService.getStatus();

    return {
      status: 'healthy',
      service: 'TransitDilli Backend Engine',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      fleet: {
        totalBusesTracked: fleet.totalBuses,
        dtcBuses: fleet.dtcBuses,
        dimtsBuses: fleet.dimtsBuses,
        electricBuses: fleet.electricBuses,
        acBuses: fleet.acBuses,
        lastUpdated: fleet.lastUpdated,
      },
      ingestion: {
        isRunning: ingestion.isRunning,
        circuitOpen: ingestion.isCircuitOpen,
        consecutiveFailures: ingestion.consecutiveFailures,
        lastSuccessfulFetch: ingestion.lastSuccessfulFetch,
      },
    };
  });

  // Register API Routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(busRoutes, { prefix: '/api/v1/buses' });
  await app.register(transitRoutes, { prefix: '/api/v1/transit' });
  await app.register(bookmarkRoutes, { prefix: '/api/v1/bookmarks' });

  return app;
}
