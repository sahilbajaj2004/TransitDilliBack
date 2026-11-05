import { pino } from 'pino';
import { prisma } from '../db/prisma';

const logger = pino({ name: 'StaticTransitService' });

export interface TransitStop {
  id: string;
  name: string;
  code: string | null;
  lat: number;
  lon: number;
}

export interface RouteStopDetail {
  stopId: string;
  stopName: string;
  sequence: number;
  lat: number;
  lon: number;
}

export interface TransitRoute {
  id: string;
  shortName: string;
  longName: string;
  agency: 'DTC' | 'DIMTS';
  isAc: boolean;
  isElectric: boolean;
  polyline: string | null;
  stops: RouteStopDetail[];
}

export class StaticTransitService {
  private routeMap = new Map<string, TransitRoute>();
  private stopMap = new Map<string, TransitStop>();
  private isLoaded = false;

  /**
   * Initializes static transit routes and stops from SQLite or seeds baseline Delhi corridors.
   */
  public async initialize(): Promise<void> {
    if (this.isLoaded) return;

    logger.info('Initializing Static GTFS Transit Registry...');

    const existingRoutes = await prisma.route.findMany({
      include: {
        stops: {
          include: { stop: true },
          orderBy: { sequence: 'asc' },
        },
      },
    });

    if (existingRoutes.length === 0) {
      logger.info('No routes found in database. Seeding baseline Delhi arterial corridors...');
      await this.seedBaselineNetwork();
      return this.initialize();
    }

    // Populate in-memory lookup maps
    this.routeMap.clear();
    this.stopMap.clear();

    for (const r of existingRoutes) {
      const stops: RouteStopDetail[] = r.stops.map((rs) => {
        this.stopMap.set(rs.stop.id, {
          id: rs.stop.id,
          name: rs.stop.name,
          code: rs.stop.code,
          lat: rs.stop.lat,
          lon: rs.stop.lon,
        });

        return {
          stopId: rs.stop.id,
          stopName: rs.stop.name,
          sequence: rs.sequence,
          lat: rs.stop.lat,
          lon: rs.stop.lon,
        };
      });

      this.routeMap.set(r.id, {
        id: r.id,
        shortName: r.shortName,
        longName: r.longName,
        agency: r.agency as 'DTC' | 'DIMTS',
        isAc: r.isAc,
        isElectric: r.isElectric,
        polyline: r.polyline,
        stops,
      });
    }

    this.isLoaded = true;
    logger.info(
      { routes: this.routeMap.size, stops: this.stopMap.size },
      'Static GTFS Transit Network loaded into memory'
    );
  }

  public getAllRoutes(): TransitRoute[] {
    return Array.from(this.routeMap.values());
  }

  public getRouteById(id: string): TransitRoute | undefined {
    return this.routeMap.get(id) || this.routeMap.get(id.toUpperCase());
  }

  public searchRoutes(query: string): TransitRoute[] {
    const q = query.trim().toUpperCase();
    if (!q) return this.getAllRoutes();

    return Array.from(this.routeMap.values()).filter(
      (r) =>
        r.shortName.toUpperCase().includes(q) ||
        r.longName.toUpperCase().includes(q) ||
        r.id.toUpperCase().includes(q)
    );
  }

  public getAllStops(): TransitStop[] {
    return Array.from(this.stopMap.values());
  }

  public getStopById(id: string): TransitStop | undefined {
    return this.stopMap.get(id);
  }

  public getNearbyStops(userLat: number, userLon: number, radiusKm: number = 1.0) {
    const results: (TransitStop & { distanceMeters: number })[] = [];

    for (const stop of this.stopMap.values()) {
      const distKm = this.haversine(userLat, userLon, stop.lat, stop.lon);
      if (distKm <= radiusKm) {
        results.push({
          ...stop,
          distanceMeters: Math.round(distKm * 1000),
        });
      }
    }

    results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return results;
  }

  /**
   * Seeds arterial Delhi bus routes and stops.
   */
  private async seedBaselineNetwork(): Promise<void> {
    const baselineStops = [
      { id: 'ST_MEHRAULI', name: 'Mehrauli Terminal', lat: 28.5186, lon: 77.1812 },
      { id: 'ST_QUTUB', name: 'Qutub Minar Metro', lat: 28.5133, lon: 77.1856 },
      { id: 'ST_SAKET', name: 'Saket Metro Station', lat: 28.5204, lon: 77.2014 },
      { id: 'ST_PUSHP_VIHAR', name: 'Pushp Vihar Sector 4', lat: 28.5258, lon: 77.2184 },
      { id: 'ST_SHEIKH_SARAI', name: 'Sheikh Sarai Phase 2', lat: 28.5342, lon: 77.2285 },
      { id: 'ST_CHIRAG_DILLI', name: 'Chirag Dilli Metro', lat: 28.5412, lon: 77.2341 },
      { id: 'ST_GK_METRO', name: 'Greater Kailash Metro', lat: 28.5489, lon: 77.2435 },
      { id: 'ST_NEHRU_PLACE', name: 'Nehru Place Terminal', lat: 28.5524, lon: 77.2514 },
      { id: 'ST_AIIMS', name: 'AIIMS Hospital Ring Road', lat: 28.5694, lon: 77.2085 },
      { id: 'ST_SAFDARJUNG', name: 'Safdarjung Hospital', lat: 28.5681, lon: 77.2024 },
      { id: 'ST_SOUTH_EXTN', name: 'South Extension Metro', lat: 28.5724, lon: 77.2185 },
      { id: 'ST_LAJPAT_NAGAR', name: 'Lajpat Nagar Ring Road', lat: 28.5701, lon: 77.2410 },
      { id: 'ST_ASHRAM', name: 'Ashram Chowk Flyover', lat: 28.5742, lon: 77.2612 },
      { id: 'ST_KASHMERE_GATE', name: 'Kashmere Gate ISBT', lat: 28.6675, lon: 77.2285 },
      { id: 'ST_RED_FORT', name: 'Red Fort Lal Qila', lat: 28.6562, lon: 77.2410 },
      { id: 'ST_DELHI_GATE', name: 'Delhi Gate Metro', lat: 28.6415, lon: 77.2405 },
      { id: 'ST_ITO', name: 'ITO Ring Road / Vikas Marg', lat: 28.6294, lon: 77.2435 },
      { id: 'ST_CP', name: 'Connaught Place Super Bazar', lat: 28.6315, lon: 77.2195 },
      { id: 'ST_DHAULA_KUAN', name: 'Dhaula Kuan Interchange', lat: 28.5925, lon: 77.1610 },
      { id: 'ST_ANAND_VIHAR', name: 'Anand Vihar ISBT', lat: 28.6468, lon: 77.3155 },
    ];

    for (const s of baselineStops) {
      await prisma.stop.upsert({
        where: { id: s.id },
        update: {},
        create: { id: s.id, name: s.name, lat: s.lat, lon: s.lon },
      });
    }

    // Seed Route 534 (Mehrauli ➔ Nehru Place)
    await prisma.route.upsert({
      where: { id: '534UP' },
      update: {},
      create: {
        id: '534UP',
        shortName: '534',
        longName: 'Mehrauli Terminal to Nehru Place Terminal',
        agency: 'DTC',
        isAc: true,
        isElectric: true,
      },
    });

    const route534Stops = [
      'ST_MEHRAULI',
      'ST_QUTUB',
      'ST_SAKET',
      'ST_PUSHP_VIHAR',
      'ST_SHEIKH_SARAI',
      'ST_CHIRAG_DILLI',
      'ST_GK_METRO',
      'ST_NEHRU_PLACE',
    ];

    for (let i = 0; i < route534Stops.length; i++) {
      await prisma.routeStop.upsert({
        where: {
          routeId_sequence: {
            routeId: '534UP',
            sequence: i + 1,
          },
        },
        update: {},
        create: {
          routeId: '534UP',
          stopId: route534Stops[i],
          sequence: i + 1,
        },
      });
    }

    // Seed Route TMS+ (Teevra Mudrika Express)
    await prisma.route.upsert({
      where: { id: 'TMS+UP' },
      update: {},
      create: {
        id: 'TMS+UP',
        shortName: 'TMS+',
        longName: 'Teevra Mudrika Super Express Ring Road',
        agency: 'DTC',
        isAc: true,
        isElectric: true,
      },
    });

    const routeTmsStops = [
      'ST_KASHMERE_GATE',
      'ST_ITO',
      'ST_ASHRAM',
      'ST_LAJPAT_NAGAR',
      'ST_SOUTH_EXTN',
      'ST_AIIMS',
      'ST_DHAULA_KUAN',
    ];

    for (let i = 0; i < routeTmsStops.length; i++) {
      await prisma.routeStop.upsert({
        where: {
          routeId_sequence: {
            routeId: 'TMS+UP',
            sequence: i + 1,
          },
        },
        update: {},
        create: {
          routeId: 'TMS+UP',
          stopId: routeTmsStops[i],
          sequence: i + 1,
        },
      });
    }

    // Seed Route 729 (Kashmiri Gate ➔ Kapashera Border - DIMTS)
    await prisma.route.upsert({
      where: { id: '729UP' },
      update: {},
      create: {
        id: '729UP',
        shortName: '729',
        longName: 'Kashmere Gate ISBT to Kapashera Border',
        agency: 'DIMTS',
        isAc: false,
        isElectric: false,
      },
    });

    const route729Stops = [
      'ST_KASHMERE_GATE',
      'ST_RED_FORT',
      'ST_DELHI_GATE',
      'ST_ITO',
      'ST_CP',
      'ST_DHAULA_KUAN',
    ];

    for (let i = 0; i < route729Stops.length; i++) {
      await prisma.routeStop.upsert({
        where: {
          routeId_sequence: {
            routeId: '729UP',
            sequence: i + 1,
          },
        },
        update: {},
        create: {
          routeId: '729UP',
          stopId: route729Stops[i],
          sequence: i + 1,
        },
      });
    }

    logger.info('Baseline Delhi Transit Network successfully seeded in SQLite');
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

export const staticTransitService = new StaticTransitService();
