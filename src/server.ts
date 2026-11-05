import dotenv from 'dotenv';
dotenv.config();

import { buildApp } from './app';
import { ingestionService } from './services/ingestion.service';

async function start() {
  try {
    const app = await buildApp();
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`TransitDilli Backend Engine listening on http://${host}:${port}`);
    app.log.info(`Health check at http://${host}:${port}/health`);
    app.log.info(`Nearby Buses Radar at http://${host}:${port}/api/v1/buses/nearby`);
    app.log.info(`Transit Lines Explorer at http://${host}:${port}/api/v1/transit/routes`);

    // Start background OTD Delhi real-time telemetry worker
    ingestionService.start();

    // Graceful shutdown
    const signals = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.on(signal, async () => {
        app.log.info(`Received ${signal}, gracefully shutting down...`);
        ingestionService.stop();
        await app.close();
        process.exit(0);
      });
    }
  } catch (err) {
    console.error('Fatal error starting TransitDilli server:', err);
    process.exit(1);
  }
}

start();
