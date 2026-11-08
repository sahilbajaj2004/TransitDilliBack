import { staticTransitService } from './static-transit.service';
import { resolveDelhiRoute } from './route-resolver.service';

export type AgencyType = 'DTC' | 'DIMTS' | 'DEVI' | 'DMRC';
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
  themeColor: string; // DTC (#1D4ED8), DIMTS (#EA580C), DEVI (#8B5CF6), DMRC (#06B6D4)
  secondaryColor: string;
  isAc: boolean;
  fuelType: FuelType;
  isElectric: boolean;
  timestamp: number;
}

export class NormalizerService {
  /**
   * Enriches raw GTFS-RT vehicle telemetry with 4 authentic Delhi transit services:
   * 1. DTC (Delhi Transport Corporation): Royal Blue (#1D4ED8)
   * 2. DIMTS (Orange Cluster Buses): Cluster Orange (#EA580C)
   * 3. DEVI (Delhi EV Interconnector / Mohalla Buses): Signature Purple (#8B5CF6)
   * 4. DMRC (Delhi Metro Feeder / Metro Link): Signature Teal (#06B6D4)
   */
  public static enrich(raw: RawTelemetryVehicle): EnrichedBus {
    const reg = (raw.id || '').toUpperCase().replace(/\s+/g, '');
    const resolved = resolveDelhiRoute(raw.routeId || '', reg, raw.latitude, raw.longitude, raw.bearing);
    const shortNameUpper = (resolved.shortName || '').toUpperCase();

    // 1. DEVI (Delhi EV Interconnector / Mohalla Buses):
    // Identified by route prefix D- (e.g. D-5506, D-5507, D-018, D-9917) or D followed by digits
    const isDevi =
      shortNameUpper.startsWith('D-') ||
      /^D\d{3,}/.test(shortNameUpper) ||
      shortNameUpper.includes('DEVI') ||
      (raw.routeId || '').toUpperCase().startsWith('D-');

    // 2. DMRC (Delhi Metro Feeder / Metro Link):
    // Identified by route prefix ML (Metro Link), MS (Metro Shuttle), MC (Metro Circular)
    const isDmrc =
      shortNameUpper.startsWith('ML') ||
      shortNameUpper.startsWith('MS') ||
      shortNameUpper.startsWith('MC') ||
      shortNameUpper.includes('DMRC') ||
      (raw.routeId || '').toUpperCase().startsWith('ML');

    // 3. DIMTS Cluster concessionaire fleet indicators:
    let isDimts =
      !isDevi &&
      !isDmrc &&
      (resolved.agency === 'DIMTS' ||
        reg.startsWith('DL1PB') ||
        reg.startsWith('DL1PC') ||
        reg.startsWith('DL51GD') ||
        reg.startsWith('DL51G'));

    // Determine final agency classification among the 4 Delhi services
    let agency: AgencyType = 'DTC';
    let themeColor = '#1D4ED8';
    let secondaryColor = '#1E40AF';

    if (isDevi) {
      agency = 'DEVI';
      themeColor = '#8B5CF6'; // Signature Purple for DEVI Mohalla Bus
      secondaryColor = '#7C3AED';
    } else if (isDmrc) {
      agency = 'DMRC';
      themeColor = '#06B6D4'; // Signature Teal/Cyan for Metro Feeder
      secondaryColor = '#0891B2';
    } else if (isDimts) {
      agency = 'DIMTS';
      themeColor = '#EA580C'; // Vibrant Orange for Cluster Buses
      secondaryColor = '#C2410C';
    }

    // Electric fleet detection: DEVI is 100% electric; or registration contains EV
    const isElectric = isDevi || reg.includes('EV') || reg.startsWith('DL51EV') || reg.startsWith('DL1EV');
    const fuelType: FuelType = isElectric ? 'electric' : 'cng';
    const isAc = isElectric || reg.includes('AC') || reg.startsWith('DL1PD');

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
