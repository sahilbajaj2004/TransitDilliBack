import KDBush from 'kdbush';
import { pino } from 'pino';
import { EnrichedBus } from './normalizer.service';
import { staticTransitService } from './static-transit.service';

const logger = pino({ name: 'SpatialIndexService' });

// Accommodate CommonJS / ESM default export variation for kdbush
const KDBushConstructor = (KDBush as any).default || KDBush;

export interface NearbyBusResult extends EnrichedBus {
  distanceMeters: number;
}

export interface SpatialQueryOptions {
  agency?: 'DTC' | 'DIMTS';
  isElectric?: boolean;
  isAc?: boolean;
  limit?: number;
}

export interface FleetStats {
  totalBuses: number;
  dtcBuses: number;
  dimtsBuses: number;
  electricBuses: number;
  acBuses: number;
  lastUpdated: number;
}

export class SpatialIndexService {
  private index: any = null;
  private buses: EnrichedBus[] = [];
  private busMap = new Map<string, EnrichedBus>();
  private routeBusesMap = new Map<string, EnrichedBus[]>();
  private lastRebuiltAt: number = 0;

  /**
   * Rebuilds the in-memory 2D KD-Tree spatial index from a normalized fleet snapshot.
   * Execution time is typically 1.5ms - 3ms for ~5,000 buses.
   */
  public rebuildIndex(buses: EnrichedBus[]): void {
    const startTime = performance.now();

    this.buses = buses;
    this.busMap.clear();
    this.routeBusesMap.clear();

    const points: [number, number][] = [];

    for (let i = 0; i < buses.length; i++) {
      const bus = buses[i];
      this.busMap.set(bus.id, bus);

      // Group by route ID and human route short name
      if (bus.routeId) {
        const routeBuses = this.routeBusesMap.get(bus.routeId) || [];
        routeBuses.push(bus);
        this.routeBusesMap.set(bus.routeId, routeBuses);

        // Also index under human short name (e.g. 505, TMS, 729)
        const staticRoute = staticTransitService.getRouteById(bus.routeId);
        if (staticRoute && staticRoute.shortName && staticRoute.shortName !== bus.routeId) {
          const shortKey = staticRoute.shortName.toUpperCase().trim();
          const shortList = this.routeBusesMap.get(shortKey) || [];
          shortList.push(bus);
          this.routeBusesMap.set(shortKey, shortList);
        }
      }

      points.push([bus.lon, bus.lat]);
    }

    if (points.length > 0) {
      const newIndex = new KDBushConstructor(points.length);
      for (const [x, y] of points) {
        newIndex.add(x, y);
      }
      newIndex.finish();
      this.index = newIndex;
    } else {
      this.index = null;
    }

    this.lastRebuiltAt = Math.floor(Date.now() / 1000);
    const elapsed = (performance.now() - startTime).toFixed(2);
    logger.debug({ count: buses.length, elapsedMs: elapsed }, 'Spatial KD-Tree rebuilt');
  }

  /**
   * Queries buses within a radius (in kilometers) from a coordinate, with sub-millisecond execution.
   */
  public queryRadius(
    userLat: number,
    userLon: number,
    radiusKm: number = 2.0,
    options: SpatialQueryOptions = {}
  ): NearbyBusResult[] {
    if (!this.index || this.buses.length === 0) {
      return [];
    }

    // Latitude 1 degree ≈ 111.0 km
    // Longitude 1 degree ≈ 111.0 * cos(lat) ≈ 97.4 km at Delhi (28.6° N)
    const latDelta = radiusKm / 111.0;
    const lonDelta = radiusKm / (111.0 * Math.cos((userLat * Math.PI) / 180));

    const minX = userLon - lonDelta;
    const minY = userLat - latDelta;
    const maxX = userLon + lonDelta;
    const maxY = userLat + latDelta;

    // Fast O(log N) bounding box query in KD-Tree
    const candidateIndices: number[] = this.index.range(minX, minY, maxX, maxY);
    const results: NearbyBusResult[] = [];

    for (const idx of candidateIndices) {
      const bus = this.buses[idx];
      if (!bus) continue;

      // Filter options
      if (options.agency && bus.agency !== options.agency) continue;
      if (options.isElectric !== undefined && bus.isElectric !== options.isElectric) continue;
      if (options.isAc !== undefined && bus.isAc !== options.isAc) continue;

      // Exact spherical distance check using Haversine formula
      const distKm = this.haversine(userLat, userLon, bus.lat, bus.lon);
      if (distKm <= radiusKm) {
        results.push({
          ...bus,
          distanceMeters: Math.round(distKm * 1000),
        });
      }
    }

    // Sort by distance (closest first)
    results.sort((a, b) => a.distanceMeters - b.distanceMeters);

    if (options.limit && options.limit > 0) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * O(1) lookup of a single bus by its registration ID.
   */
  public getBusById(id: string): EnrichedBus | undefined {
    return this.busMap.get(id);
  }

  /**
   * O(1) lookup of all active buses running on a specific route code.
   */
  public getBusesByRoute(routeId: string): EnrichedBus[] {
    return this.routeBusesMap.get(routeId) || [];
  }

  /**
   * Returns all active buses currently in the spatial index.
   */
  public getAllBuses(): EnrichedBus[] {
    return this.buses;
  }

  /**
   * Real-time fleet metrics and health counters.
   */
  public getFleetStats(): FleetStats {
    let dtcBuses = 0;
    let dimtsBuses = 0;
    let electricBuses = 0;
    let acBuses = 0;

    for (const bus of this.buses) {
      if (bus.agency === 'DTC') dtcBuses++;
      if (bus.agency === 'DIMTS') dimtsBuses++;
      if (bus.isElectric) electricBuses++;
      if (bus.isAc) acBuses++;
    }

    return {
      totalBuses: this.buses.length,
      dtcBuses,
      dimtsBuses,
      electricBuses,
      acBuses,
      lastUpdated: this.lastRebuiltAt,
    };
  }

  /**
   * Haversine formula for geodesic distance between two latitude/longitude points in kilometers.
   */
  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export const spatialIndexService = new SpatialIndexService();
