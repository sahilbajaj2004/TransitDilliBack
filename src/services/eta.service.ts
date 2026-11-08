import { EnrichedBus, AgencyType } from './normalizer.service';
import { RouteStopDetail, staticTransitService } from './static-transit.service';
import { spatialIndexService } from './spatial.service';

export type CrowdLevel = 'low' | 'medium' | 'high';

export interface StopEtaPrediction {
  stopId: string;
  stopName: string;
  stopSequence: number;
  stopsRemaining: number;
  distanceKm: number;
  etaMinutes: number;
  predictedArrivalTime: string;
  crowdLevel: CrowdLevel;
}

export interface IncomingBusArrival {
  vehicleId: string;
  routeId: string;
  routeShortName: string;
  destination: string;
  agency: AgencyType;
  themeColor: string;
  secondaryColor: string;
  isElectric: boolean;
  isAc: boolean;
  speedKmph: number;
  etaMinutes: number;
  distanceMeters: number;
  stopsRemaining: number;
  crowdLevel: CrowdLevel;
}

export class EtaService {
  /**
   * Calculates downstream stop ETAs along a bus route using live vehicle velocity and dwell penalties.
   */
  public static calculateRouteEtas(bus: EnrichedBus, stops: RouteStopDetail[]): StopEtaPrediction[] {
    if (!stops || stops.length === 0) return [];

    // Find the closest stop to current bus position to determine progression
    let closestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < stops.length; i++) {
      const d = this.haversine(bus.lat, bus.lon, stops[i].lat, stops[i].lon);
      if (d < minDistance) {
        minDistance = d;
        closestIndex = i;
      }
    }

    // Determine if bus has passed closestIndex or is approaching it:
    // If closestIndex is not the last stop, check if bus is closer to the next stop
    let startIndex = closestIndex;
    if (closestIndex < stops.length - 1) {
      const distToNext = this.haversine(bus.lat, bus.lon, stops[closestIndex + 1].lat, stops[closestIndex + 1].lon);
      const segmentDist = this.haversine(
        stops[closestIndex].lat,
        stops[closestIndex].lon,
        stops[closestIndex + 1].lat,
        stops[closestIndex + 1].lon
      );
      // If bus has already travelled more than 60% of the segment toward next stop, advance
      if (distToNext < segmentDist * 0.4) {
        startIndex = closestIndex + 1;
      }
    }

    const remainingStops = stops.slice(startIndex);
    let accumulatedDistanceKm = 0;
    let prevLat = bus.lat;
    let prevLon = bus.lon;

    // Minimum effective travel speed in congested Delhi corridors: 16 km/h
    const effectiveSpeed = Math.max(bus.speedKmph, 16);
    const crowdLevel = this.estimateCrowdLevel(bus.speedKmph);

    return remainingStops.map((stop, idx) => {
      const legDist = this.haversine(prevLat, prevLon, stop.lat, stop.lon);
      accumulatedDistanceKm += legDist;
      prevLat = stop.lat;
      prevLon = stop.lon;

      const travelTimeMinutes = (accumulatedDistanceKm / effectiveSpeed) * 60;
      const dwellTimeMinutes = idx * 0.75; // 45 seconds average stop dwell time
      const totalEta = Math.max(0, Math.round(travelTimeMinutes + dwellTimeMinutes));

      const arrivalDate = new Date(Date.now() + totalEta * 60000);
      const arrivalTimeString = arrivalDate.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      return {
        stopId: stop.stopId,
        stopName: stop.stopName,
        stopSequence: stop.sequence,
        stopsRemaining: idx,
        distanceKm: Math.round(accumulatedDistanceKm * 10) / 10,
        etaMinutes: totalEta,
        predictedArrivalTime: arrivalTimeString,
        crowdLevel,
      };
    });
  }

  /**
   * Computes real-time arrival board for a specific bus stop across all approaching lines.
   */
  public static getArrivalsForStop(targetStopId: string): IncomingBusArrival[] {
    const allRoutes = staticTransitService.getAllRoutes();
    const arrivals: IncomingBusArrival[] = [];

    for (const route of allRoutes) {
      const stopIndex = route.stops.findIndex((s) => s.stopId === targetStopId);
      if (stopIndex === -1) continue; // Route does not serve this stop

      // Look up all active buses running on this route code
      const activeBuses = spatialIndexService.getBusesByRoute(route.id);

      for (const bus of activeBuses) {
        const etas = this.calculateRouteEtas(bus, route.stops);
        const targetPrediction = etas.find((e) => e.stopId === targetStopId);

        if (targetPrediction) {
          arrivals.push({
            vehicleId: bus.id,
            routeId: route.id,
            routeShortName: route.shortName,
            destination: route.stops[route.stops.length - 1]?.stopName || route.longName,
            agency: bus.agency,
            themeColor: bus.themeColor,
            secondaryColor: bus.secondaryColor,
            isElectric: bus.isElectric,
            isAc: bus.isAc,
            speedKmph: bus.speedKmph,
            etaMinutes: targetPrediction.etaMinutes,
            distanceMeters: Math.round(targetPrediction.distanceKm * 1000),
            stopsRemaining: targetPrediction.stopsRemaining,
            crowdLevel: targetPrediction.crowdLevel,
          });
        }
      }
    }

    // Sort by ETA: next arriving bus first
    arrivals.sort((a, b) => a.etaMinutes - b.etaMinutes);
    return arrivals;
  }

  /**
   * Heuristic crowd density estimation based on speed and peak traffic hours.
   */
  private static estimateCrowdLevel(speedKmph: number): CrowdLevel {
    const now = new Date();
    const hours = now.getHours();
    const isPeakHour = (hours >= 8 && hours <= 11) || (hours >= 17 && hours <= 21);

    if (isPeakHour && speedKmph < 14) {
      return 'high';
    }
    if (speedKmph < 22) {
      return 'medium';
    }
    return 'low';
  }

  private static haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
