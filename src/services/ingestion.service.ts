import axios, { AxiosInstance } from 'axios';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { pino } from 'pino';
import { NormalizerService, RawTelemetryVehicle } from './normalizer.service';
import { spatialIndexService } from './spatial.service';
import { vehicleStreamService } from './stream.service';

const logger = pino({ name: 'IngestionService' });

export class IngestionService {
  private client: AxiosInstance;
  private endpoint: string;
  private pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private consecutiveFailures: number = 0;
  private isCircuitOpen: boolean = false;
  private lastSuccessfulFetch: Date | null = null;
  private lastEntityCount: number = 0;

  constructor() {
    const otdKey = process.env.OTD_API_KEY;
    if (!otdKey) {
      throw new Error('OTD_API_KEY environment variable is required');
    }
    this.endpoint = `https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb?key=${otdKey}`;
    this.pollIntervalMs = Number(process.env.OTD_POLL_INTERVAL_MS) || 9000;

    this.client = axios.create({
      timeout: 8000,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'TransitDilli/1.0.0 (Server Ingestion Engine)',
      },
    });
  }

  /**
   * Starts the background OTD telemetry ingestion worker loop.
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Ingestion worker is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ intervalMs: this.pollIntervalMs }, 'Starting OTD Delhi Real-time Ingestion Worker...');

    const runLoop = async () => {
      if (!this.isRunning) return;

      await this.pollOnce();

      // Schedule next poll
      const delay = this.isCircuitOpen ? Math.min(this.pollIntervalMs * 2, 30000) : this.pollIntervalMs;
      this.timer = setTimeout(runLoop, delay);
    };

    // Immediate initial poll
    runLoop();
  }

  /**
   * Stops the background ingestion worker.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Ingestion worker stopped');
  }

  /**
   * Performs a single fetch, decode, normalization, and index rebuild pass.
   */
  public async pollOnce(): Promise<number> {
    const startTime = performance.now();

    try {
      if (this.isCircuitOpen) {
        logger.warn('Circuit breaker open. Attempting recovery ping to OTD Delhi...');
      }

      const response = await this.client.get(this.endpoint);
      const buffer = new Uint8Array(response.data);
      const feed = transit_realtime.FeedMessage.decode(buffer);

      const rawVehicles: RawTelemetryVehicle[] = [];

      for (const entity of feed.entity || []) {
        if (!entity.vehicle || !entity.vehicle.position) continue;

        const v = entity.vehicle;
        if (!v.position) continue;
        const pos = v.position;

        const lat = pos.latitude;
        const lon = pos.longitude;

        // Discard invalid / zero coordinates or points far outside Delhi NCR
        if (!lat || !lon || lat === 0 || lon === 0) continue;
        if (lat < 27.5 || lat > 30.0 || lon < 76.0 || lon > 78.5) continue;

        const vehicleId = v.vehicle?.id || v.vehicle?.label || entity.id || 'UNKNOWN';
        const tripId = v.trip?.tripId || '';
        const routeId = v.trip?.routeId || '';

        rawVehicles.push({
          id: vehicleId,
          tripId,
          routeId,
          latitude: lat,
          longitude: lon,
          bearing: pos.bearing || 0,
          speed: pos.speed || 0,
          timestamp: Number(v.timestamp) || Math.floor(Date.now() / 1000),
        });
      }

      // Normalize all vehicles with UI tokens & agency classification
      const enriched = rawVehicles.map(NormalizerService.enrich);

      // Rebuild in-memory KD-Tree
      spatialIndexService.rebuildIndex(enriched);

      // Broadcast real-time position updates to any active SSE subscribers
      for (const bus of enriched) {
        if (vehicleStreamService.listenerCount(`vehicle:${bus.id}`) > 0) {
          vehicleStreamService.broadcastVehicleUpdate(bus);
        }
      }

      this.consecutiveFailures = 0;
      this.isCircuitOpen = false;
      this.lastSuccessfulFetch = new Date();
      this.lastEntityCount = enriched.length;

      const elapsed = (performance.now() - startTime).toFixed(1);
      logger.info(
        { vehiclesTracked: enriched.length, elapsedMs: elapsed },
        'OTD Delhi telemetry updated successfully'
      );

      return enriched.length;
    } catch (err: any) {
      this.consecutiveFailures++;
      logger.error(
        { err: err.message, failures: this.consecutiveFailures },
        'Failed to poll OTD Delhi Real-time feed'
      );

      // Trip circuit breaker if 5 consecutive errors occur
      if (this.consecutiveFailures >= 5) {
        this.isCircuitOpen = true;
        logger.warn('Circuit breaker tripped. Backing off ingestion rate.');
      }

      return 0;
    }
  }

  /**
   * Returns current health and diagnostic status of the ingestion pipeline.
   */
  public getStatus() {
    return {
      isRunning: this.isRunning,
      isCircuitOpen: this.isCircuitOpen,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessfulFetch: this.lastSuccessfulFetch?.toISOString() || null,
      lastEntityCount: this.lastEntityCount,
    };
  }
}

export const ingestionService = new IngestionService();
