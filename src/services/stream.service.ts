import { EventEmitter } from 'events';
import { pino } from 'pino';
import { EnrichedBus } from './normalizer.service';
import { EtaService, StopEtaPrediction } from './eta.service';
import { staticTransitService } from './static-transit.service';

const logger = pino({ name: 'StreamService' });

export interface VehicleStreamPayload {
  vehicle: EnrichedBus;
  routeTitle: string;
  etas: StopEtaPrediction[];
  timestamp: number;
}

export class VehicleStreamService extends EventEmitter {
  private activeStreamsCount: number = 0;

  constructor() {
    super();
    // Allow up to 1,000 concurrent listeners per vehicle channel
    this.setMaxListeners(1000);
  }

  /**
   * Broadcasts a new telemetry frame to all commuters tracking this vehicle.
   */
  public broadcastVehicleUpdate(bus: EnrichedBus): void {
    const route = staticTransitService.getRouteById(bus.routeId);
    const etas = route ? EtaService.calculateRouteEtas(bus, route.stops) : [];

    const payload: VehicleStreamPayload = {
      vehicle: bus,
      routeTitle: route ? route.longName : 'Delhi Transit Corridor',
      etas,
      timestamp: Math.floor(Date.now() / 1000),
    };

    this.emit(`vehicle:${bus.id}`, payload);
  }

  public incrementActiveStreams(): void {
    this.activeStreamsCount++;
    logger.debug({ activeStreams: this.activeStreamsCount }, 'SSE client connected');
  }

  public decrementActiveStreams(): void {
    this.activeStreamsCount = Math.max(0, this.activeStreamsCount - 1);
    logger.debug({ activeStreams: this.activeStreamsCount }, 'SSE client disconnected');
  }

  public getActiveStreamsCount(): number {
    return this.activeStreamsCount;
  }
}

export const vehicleStreamService = new VehicleStreamService();
