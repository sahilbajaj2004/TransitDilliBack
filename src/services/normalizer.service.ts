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
  themeColor: string; // DTC Emerald Green (#10B981) or DIMTS Royal Blue (#2563EB)
  secondaryColor: string;
  isAc: boolean;
  fuelType: FuelType;
  isElectric: boolean;
  timestamp: number;
}

export class NormalizerService {
  /**
   * Enriches raw GTFS-RT vehicle telemetry with agency branding and fleet classification.
   */
  public static enrich(raw: RawTelemetryVehicle): EnrichedBus {
    const reg = (raw.id || '').toUpperCase().replace(/\s+/g, '');

    // Electric fleet detection: DL51EV, DL1EV, or containing EV
    const isElectric = reg.includes('EV') || reg.startsWith('DL51EV') || reg.startsWith('DL1EV');

    // DIMTS Cluster concessionaire fleet indicators: DL1PB, DL1PC, or cluster route prefix
    const isDimts =
      reg.startsWith('DL1PB') ||
      reg.startsWith('DL1PC') ||
      (raw.routeId && raw.routeId.toUpperCase().startsWith('D-'));

    // Air conditioned detection: electric buses are 100% AC; CNG low-floor AC series
    const isAc = isElectric || reg.includes('AC') || reg.startsWith('DL1PD');

    const agency: AgencyType = isDimts ? 'DIMTS' : 'DTC';
    const fuelType: FuelType = isElectric ? 'electric' : 'cng';

    // UI Branding Color Tokens:
    // DTC: Emerald Green (#10B981)
    // DIMTS: Royal Blue (#2563EB)
    const themeColor = agency === 'DTC' ? '#10B981' : '#2563EB';
    const secondaryColor = agency === 'DTC' ? '#059669' : '#1D4ED8';

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
