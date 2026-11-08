import { staticTransitService } from './static-transit.service';
import { resolveDelhiRoute } from './route-resolver.service';

export type AgencyType = 'DTC' | 'DIMTS';
export type FuelType = 'electric' | 'cng' | 'diesel';

export interface RawTelemetryVehicle {
  id: string;
  tripId: string;
  routeId: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number; // in m/s
  timestamp: number;
}

export interface EnrichedBus {
  id: string;
  tripId: string;
  routeId: string;
  lat: number;
  lon: number;
  bearing: number;
  speedKmph: number;
  agency: AgencyType;
  themeColor: string; // DTC Royal Blue (#1D4ED8) or DIMTS Cluster Orange (#EA580C)
  secondaryColor: string;
  isAc: boolean;
  fuelType: FuelType;
  isElectric: boolean;
  timestamp: number;
}

export class NormalizerService {
  /**
   * Enriches raw GTFS-RT vehicle telemetry with agency branding and fleet classification.
   * Recognizes DTC (Royal Blue), DIMTS Cluster (Orange), and Electric DTC.
   */
  public static enrich(raw: RawTelemetryVehicle): EnrichedBus {
    const reg = (raw.id || '').toUpperCase().replace(/\s+/g, '');

    // Electric fleet detection: DL51EV, DL1EV, or containing EV
    const isElectric = reg.includes('EV') || reg.startsWith('DL51EV') || reg.startsWith('DL1EV');

    // DIMTS Cluster concessionaire fleet indicators:
    // Registration prefix or route agency check
    let isDimts =
      reg.startsWith('DL1PB') ||
      reg.startsWith('DL1PC') ||
      reg.startsWith('DL51GD') ||
      reg.startsWith('DL51G') ||
      (raw.routeId && raw.routeId.toUpperCase().startsWith('D-'));

    if (!isDimts && raw.routeId) {
      const resolved = resolveDelhiRoute(raw.routeId, reg);
      if (resolved.agency === 'DIMTS') {
        isDimts = true;
      }
    }

    // Air conditioned detection: electric buses are 100% AC; CNG low-floor AC series
    const isAc = isElectric || reg.includes('AC') || reg.startsWith('DL1PD');

    const agency: AgencyType = isDimts ? 'DIMTS' : 'DTC';
    const fuelType: FuelType = isElectric ? 'electric' : 'cng';

    // UI Branding Color Tokens as requested:
    // DTC: Royal Blue (#1D4ED8)
    // DIMTS Cluster: Orange (#EA580C)
    // DTC Electric: Electric Blue (#0284C7)
    const themeColor = agency === 'DIMTS' ? '#EA580C' : isElectric ? '#0284C7' : '#1D4ED8';
    const secondaryColor = agency === 'DIMTS' ? '#C2410C' : isElectric ? '#0369A1' : '#1E40AF';

    // Convert speed from m/s to km/h, rounded to 1 decimal place
    const speedKmph = raw.speed > 0 ? Math.round(raw.speed * 3.6 * 10) / 10 : 0;

    return {
      id: raw.id || 'UNKNOWN',
      tripId: raw.tripId || '',
      routeId: raw.routeId || '',
      lat: Number(raw.latitude.toFixed(6)),
      lon: Number(raw.longitude.toFixed(6)),
      bearing: Math.round(raw.bearing || 0),
      speedKmph,
      agency,
      themeColor,
      secondaryColor,
      isAc,
      fuelType,
      isElectric,
      timestamp: raw.timestamp || Math.floor(Date.now() / 1000),
    };
  }
}
