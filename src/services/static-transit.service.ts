import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import KDBush from 'kdbush';
import { pino } from 'pino';
import { prisma } from '../db/prisma';

const logger = pino({ name: 'StaticTransitService' });
const KDBushConstructor = (KDBush as any).default || KDBush;

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
  routeId: number;
  shortName: string;
  longName: string;
  startingStop: string;
  terminalStop: string;
  agency: 'DTC' | 'DIMTS';
  direction?: number;
  isAc: boolean;
  isElectric: boolean;
  polyline: string | null;
  stops: RouteStopDetail[];
}

export class StaticTransitService {
  private routeMap = new Map<string, TransitRoute>();
  private uniqueRoutes: TransitRoute[] = [];
  private stopMap = new Map<string, TransitStop>();
  private stopToRoutesMap = new Map<string, TransitRoute[]>();
  private stopSpatialIndex: any = null;
  private stopsList: TransitStop[] = [];
  private isLoaded = false;

  /**
   * Initializes static transit routes and stops from SQLite or seeds baseline Delhi corridors.
   */
  public async initialize(): Promise<void> {
    if (this.isLoaded) return;

    const sqlitePath = path.resolve(__dirname, '../../data/static_delhi.db');
    if (fs.existsSync(sqlitePath)) {
      try {
        this.loadFromSqlite(sqlitePath);
        this.isLoaded = true;
        return;
      } catch (err) {
        logger.error({ err }, 'Failed to load static_delhi.db, falling back to database/seeding');
      }
    }

    await this.loadFromPrismaOrSeed();
    this.isLoaded = true;
  }

  /**
   * High-speed load of the complete GTFS transit network from SQLite.
   * Loads 6,600+ stops and 2,600+ routes in ~15 milliseconds.
   */
  private loadFromSqlite(dbPath: string): void {
    const startTime = performance.now();
    logger.info({ dbPath }, 'Loading Delhi Transit Network from static SQLite database...');

    const db = new Database(dbPath, { readonly: true });

    // 1. Load Bus Stops
    const busStopRows = db
      .prepare('SELECT stop_id, name, lat, lon FROM BusStops')
      .all() as { stop_id: number; name: string; lat: number; lon: number }[];

    this.stopMap.clear();
    this.stopsList = [];

    for (const row of busStopRows) {
      const stop: TransitStop = {
        id: String(row.stop_id),
        name: row.name,
        code: String(row.stop_id),
        lat: row.lat,
        lon: row.lon,
      };
      this.stopMap.set(stop.id, stop);
      this.stopsList.push(stop);
    }

    // 2. Load Metro Stops
    try {
      const metroStopRows = db
        .prepare('SELECT stop_id, name, lat, lon FROM MetroStops')
        .all() as { stop_id: number; name: string; lat: number; lon: number }[];

      for (const row of metroStopRows) {
        const id = `METRO_${row.stop_id}`;
        const stop: TransitStop = {
          id,
          name: row.name,
          code: 'METRO',
          lat: row.lat,
          lon: row.lon,
        };
        this.stopMap.set(id, stop);
        this.stopsList.push(stop);
      }
    } catch {
      // Metro stops table optional
    }

    // 3. Build Spatial Index for Fast Radius Lookups
    if (this.stopsList.length > 0) {
      const stopIndex = new KDBushConstructor(this.stopsList.length);
      for (const s of this.stopsList) {
        stopIndex.add(s.lon, s.lat);
      }
      stopIndex.finish();
      this.stopSpatialIndex = stopIndex;
    }

    // 4. Load Route Details (Polylines + Stop Sequences)
    const routeDetailsRows = db
      .prepare('SELECT route_id, geometry, stops FROM RouteDetails')
      .all() as { route_id: number; geometry: string | null; stops: string | null }[];

    const detailsMap = new Map<number, { geometry: string | null; stops: number[] }>();
    for (const rd of routeDetailsRows) {
      let stopsArr: number[] = [];
      if (rd.stops) {
        try {
          stopsArr = JSON.parse(rd.stops);
        } catch {
          stopsArr = [];
        }
      }
      detailsMap.set(rd.route_id, {
        geometry: rd.geometry,
        stops: stopsArr,
      });
    }

    // 5. Load Routes
    const routeRows = db
      .prepare(
        'SELECT route_id, agency, long_name, short_name, starting_stop, terminal_stop, display_name, direction FROM Routes'
      )
      .all() as {
      route_id: number;
      agency: string;
      long_name: string;
      short_name: string;
      starting_stop: string;
      terminal_stop: string;
      display_name: string;
      direction: number;
    }[];

    this.routeMap.clear();
    this.uniqueRoutes = [];
    this.stopToRoutesMap.clear();

    for (const r of routeRows) {
      const detail = detailsMap.get(r.route_id);
      const stopIds = detail?.stops || [];

      const routeStops: RouteStopDetail[] = [];
      for (let i = 0; i < stopIds.length; i++) {
        const sid = String(stopIds[i]);
        const stopObj = this.stopMap.get(sid);
        if (stopObj) {
          routeStops.push({
            stopId: sid,
            stopName: stopObj.name,
            sequence: i + 1,
            lat: stopObj.lat,
            lon: stopObj.lon,
          });
        }
      }

      let shortName =
        r.display_name && r.display_name !== 'nan'
          ? r.display_name.trim()
          : r.short_name && r.short_name !== 'nan'
          ? r.short_name.trim()
          : '';

      // If shortName is missing or a raw 4-digit ID, extract the clean Delhi route from long_name (e.g. "780DOWN" -> "780", "511AUP" -> "511A")
      if (!shortName || /^\d{4,}$/.test(shortName)) {
        if (r.long_name) {
          const cleaned = r.long_name.replace(/(UP\d*|DOWN\d*|STLUP|STLDOWN|LNKSTLUP|LSTLUP|\(NS\).*)$/i, '').trim();
          if (cleaned && cleaned.length >= 2 && cleaned.length <= 8 && !/^\d{4,}$/.test(cleaned)) {
            shortName = cleaned;
          }
        }
      }
      if (!shortName) {
        shortName = String(r.route_id);
      }

      const agency: 'DTC' | 'DIMTS' = r.agency === 'DIMTS' ? 'DIMTS' : 'DTC';
      const isElectric = shortName.toUpperCase().includes('EV') || r.long_name.toUpperCase().includes('EV');

      const routeObj: TransitRoute = {
        id: String(r.route_id),
        routeId: r.route_id,
        shortName,
        longName: r.long_name || shortName,
        startingStop: r.starting_stop || '',
        terminalStop: r.terminal_stop || '',
        agency,
        direction: r.direction,
        isAc: true,
        isElectric,
        polyline: detail?.geometry || null,
        stops: routeStops,
      };

      this.uniqueRoutes.push(routeObj);
      this.routeMap.set(String(r.route_id), routeObj);

      // Also map by shortName uppercase
      if (shortName) {
        this.routeMap.set(shortName.toUpperCase(), routeObj);
      }

      // Populate stopToRoutes reverse index
      for (const s of routeStops) {
        const existing = this.stopToRoutesMap.get(s.stopId) || [];
        existing.push(routeObj);
        this.stopToRoutesMap.set(s.stopId, existing);
      }
    }

    db.close();

    const elapsed = (performance.now() - startTime).toFixed(1);
    logger.info(
      {
        stops: this.stopMap.size,
        routes: this.uniqueRoutes.length,
        elapsedMs: elapsed,
      },
      'Delhi GTFS Transit Network loaded into memory from SQLite'
    );
  }

  private async loadFromPrismaOrSeed(): Promise<void> {
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
      return this.loadFromPrismaOrSeed();
    }

    this.routeMap.clear();
    this.uniqueRoutes = [];
    this.stopMap.clear();
    this.stopsList = [];
    this.stopToRoutesMap.clear();

    for (const r of existingRoutes) {
      const stops: RouteStopDetail[] = r.stops.map((rs) => {
        const stopItem: TransitStop = {
          id: rs.stop.id,
          name: rs.stop.name,
          code: rs.stop.code,
          lat: rs.stop.lat,
          lon: rs.stop.lon,
        };
        this.stopMap.set(rs.stop.id, stopItem);
        this.stopsList.push(stopItem);

        return {
          stopId: rs.stop.id,
          stopName: rs.stop.name,
          sequence: rs.sequence,
          lat: rs.stop.lat,
          lon: rs.stop.lon,
        };
      });

      const routeObj: TransitRoute = {
        id: r.id,
        routeId: parseInt(r.id.replace(/\D/g, ''), 10) || 0,
        shortName: r.shortName,
        longName: r.longName,
        startingStop: r.longName?.split(' to ')[0] || '',
        terminalStop: r.longName?.split(' to ')[1] || '',
        agency: r.agency as 'DTC' | 'DIMTS',
        isAc: r.isAc,
        isElectric: r.isElectric,
        polyline: r.polyline,
        stops,
      };

      this.uniqueRoutes.push(routeObj);
      this.routeMap.set(r.id, routeObj);
      this.routeMap.set(r.shortName.toUpperCase(), routeObj);

      for (const s of stops) {
        const existing = this.stopToRoutesMap.get(s.stopId) || [];
        existing.push(routeObj);
        this.stopToRoutesMap.set(s.stopId, existing);
      }
    }
  }

  public getAllRoutes(): TransitRoute[] {
    return this.uniqueRoutes.length > 0 ? this.uniqueRoutes : Array.from(this.routeMap.values());
  }

  public getRouteById(id: string | number): TransitRoute | undefined {
    const key = String(id).trim();
    return this.routeMap.get(key) || this.routeMap.get(key.toUpperCase());
  }

  /**
   * Geodesic bearing calculation between two lat/lon coordinates (in degrees 0-360)
   */
  public calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const deltaLambda = (lon2 - lon1) * toRad;

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

    let b = Math.atan2(y, x) * toDeg;
    return (Math.round(b) + 360) % 360;
  }

  /**
   * Estimates the corridor travel heading (bearing) for a bus at (lat, lon) on a given route.
   * Finds the closest sequential stop pair along the route to determine the exact street vector.
   */
  public estimateCorridorBearing(routeKey: string, lat: number, lon: number): number {
    if (!lat || !lon) return 0;

    let route = this.getRouteById(routeKey);
    if (!route && routeKey) {
      const clean = routeKey.replace(/(UP\d*|DOWN\d*|STLUP|STLDOWN|\(NS\).*)$/i, '').trim().toUpperCase();
      route = this.getRouteById(clean);
    }

    if (route && route.stops && route.stops.length >= 2) {
      const stops = route.stops;
      let closestIdx = 0;
      let minDistanceSq = Infinity;

      for (let i = 0; i < stops.length; i++) {
        const dLat = stops[i].lat - lat;
        const dLon = stops[i].lon - lon;
        const distSq = dLat * dLat + dLon * dLon;
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          closestIdx = i;
        }
      }

      // Forward vector along route direction:
      let p1 = stops[closestIdx];
      let p2 = closestIdx < stops.length - 1 ? stops[closestIdx + 1] : stops[closestIdx];
      if (closestIdx === stops.length - 1 && closestIdx > 0) {
        p1 = stops[closestIdx - 1];
        p2 = stops[closestIdx];
      }

      const b = this.calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
      if (b > 0) return b;
    }

    // Fallback: Check nearby transit network stops in Delhi to find the road orientation!
    if (this.stopSpatialIndex) {
      try {
        const delta = 0.006; // ~600m
        const nearbyStopIndices = this.stopSpatialIndex.range(
          lon - delta,
          lat - delta,
          lon + delta,
          lat + delta
        );
        if (nearbyStopIndices && nearbyStopIndices.length >= 2) {
          const s1 = this.stopsList[nearbyStopIndices[0]];
          const s2 = this.stopsList[nearbyStopIndices[1]];
          if (s1 && s2) {
            const b = this.calculateBearing(s1.lat, s1.lon, s2.lat, s2.lon);
            if (b > 0) return b;
          }
        }
      } catch {
        // Continue if spatial query fails
      }
    }

    return 0;
  }

  public searchRoutes(query: string): TransitRoute[] {
    const q = query.trim().toUpperCase();
    if (!q) return this.getAllRoutes();

    const routes = this.getAllRoutes();
    return routes.filter(
      (r) =>
        r.shortName.toUpperCase().includes(q) ||
        r.longName.toUpperCase().includes(q) ||
        r.id.toUpperCase().includes(q) ||
        r.terminalStop.toUpperCase().includes(q) ||
        r.startingStop.toUpperCase().includes(q)
    );
  }

  /**
   * Retrieves both directional corridors for a given route (e.g. for Route 33: Bhajanpura -> Noida vs Noida -> Bhajanpura).
   */
  public getRouteDirections(routeCode: string): Array<{
    routeId: string;
    direction: number;
    agency: string;
    longName: string;
    origin: string;
    destination: string;
    label: string;
    stopsCount: number;
  }> {
    const clean = routeCode.trim().toUpperCase();
    const matches: TransitRoute[] = [];

    for (const r of this.uniqueRoutes) {
      const sName = r.shortName.toUpperCase().trim();
      const lName = r.longName.toUpperCase().trim();
      if (
        sName === clean ||
        lName === clean ||
        lName.startsWith(`${clean}UP`) ||
        lName.startsWith(`${clean}DOWN`) ||
        lName.startsWith(`${clean} `) ||
        lName.startsWith(`${clean}STL`)
      ) {
        matches.push(r);
      }
    }

    // Sort: direction 1 (UP) first, then direction 0 (DOWN)
    matches.sort((a, b) => (b.direction ?? 0) - (a.direction ?? 0));

    const seen = new Set<string>();
    const results: Array<{
      routeId: string;
      direction: number;
      agency: string;
      longName: string;
      origin: string;
      destination: string;
      label: string;
      stopsCount: number;
    }> = [];

    for (const m of matches) {
      const orig = m.startingStop || 'Delhi Terminal';
      const dest = m.terminalStop || 'Destination';
      const key = `${orig}->${dest}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        routeId: m.id,
        direction: m.direction ?? 1,
        agency: m.agency,
        longName: m.longName,
        origin: orig,
        destination: dest,
        label: `${orig} ➔ ${dest}`,
        stopsCount: m.stops.length,
      });
    }

    return results;
  }

  /**
   * Dynamic prefix & corridor route auto-complete (e.g. "9" -> 901, 913, 971, 971A; "33" -> 33, 33A, 334).
   * Groups by shortName and provides human-readable Origin ➔ Destination.
   */
  public getRouteSuggestions(query: string, limit = 12): Array<{
    shortName: string;
    longName: string;
    origin: string;
    destination: string;
    agency: string;
    directionCount: number;
    label: string;
  }> {
    const q = (query || '').trim().toUpperCase();
    if (!q) {
      // Default top Delhi popular routes when query is empty
      const popular = ['33', '502', 'TMS', 'OMS', '227A', '971', '913', '729', '419', '534', '100A', '73'];
      const results: any[] = [];
      const seen = new Set<string>();
      for (const code of popular) {
        const found = this.uniqueRoutes.find((r) => r.shortName.toUpperCase() === code);
        if (found && !seen.has(found.shortName)) {
          seen.add(found.shortName);
          results.push({
            shortName: found.shortName,
            longName: found.longName,
            origin: found.startingStop || 'Terminal',
            destination: found.terminalStop || 'Corridor',
            agency: found.agency || 'DTC',
            directionCount: 2,
            label: `${found.shortName} (${found.startingStop} ➔ ${found.terminalStop})`,
          });
        }
      }
      return results.slice(0, limit);
    }

    // Map to group by shortName
    const candidateMap = new Map<string, { route: TransitRoute; score: number; count: number }>();

    for (const r of this.uniqueRoutes) {
      const s = r.shortName.toUpperCase().trim();
      const orig = (r.startingStop || '').toUpperCase();
      const dest = (r.terminalStop || '').toUpperCase();

      let score = -1;
      if (s === q) {
        score = 100; // Exact match
      } else if (s.startsWith(q)) {
        score = 80 - s.length; // Starts with query (shorter is higher priority)
      } else if (s.includes(q)) {
        score = 60 - s.length;
      } else if (orig.includes(q) || dest.includes(q)) {
        score = 40;
      }

      if (score > 0) {
        const existing = candidateMap.get(s);
        if (!existing) {
          candidateMap.set(s, { route: r, score, count: 1 });
        } else {
          existing.count += 1;
          if (score > existing.score) {
            existing.score = score;
            existing.route = r;
          }
        }
      }
    }

    const sorted = Array.from(candidateMap.values())
      .sort((a, b) => b.score - a.score || a.route.shortName.length - b.route.shortName.length)
      .slice(0, limit);

    return sorted.map(({ route, count }) => ({
      shortName: route.shortName,
      longName: route.longName,
      origin: route.startingStop,
      destination: route.terminalStop,
      agency: route.agency,
      directionCount: Math.max(1, count),
      label: `${route.shortName} (${route.startingStop} ➔ ${route.terminalStop})`,
    }));
  }

  public getAllStops(): TransitStop[] {
    return this.stopsList.length > 0 ? this.stopsList : Array.from(this.stopMap.values());
  }

  public getStopById(id: string | number): TransitStop | undefined {
    return this.stopMap.get(String(id));
  }

  public getRoutesServingStop(stopId: string | number): TransitRoute[] {
    return this.stopToRoutesMap.get(String(stopId)) || [];
  }

  public getNearbyStops(userLat: number, userLon: number, radiusKm: number = 1.0) {
    if (this.stopSpatialIndex && this.stopsList.length > 0) {
      const latDelta = radiusKm / 111.0;
      const lonDelta = radiusKm / (111.0 * Math.cos((userLat * Math.PI) / 180));

      const minX = userLon - lonDelta;
      const minY = userLat - latDelta;
      const maxX = userLon + lonDelta;
      const maxY = userLat + latDelta;

      const indices = this.stopSpatialIndex.range(minX, minY, maxX, maxY);
      const results: (TransitStop & { distanceMeters: number })[] = [];

      for (let i = 0; i < indices.length; i++) {
        const stop = this.stopsList[indices[i]];
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
   * Baseline seeds for fallback mode.
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
      { id: 'ST_LAJPAT_NAGAR', name: 'Lajpat Nagar Ring Road', lat: 28.5701, lon: 77.241 },
      { id: 'ST_ASHRAM', name: 'Ashram Chowk Flyover', lat: 28.5742, lon: 77.2612 },
      { id: 'ST_KASHMERE_GATE', name: 'Kashmere Gate ISBT', lat: 28.6675, lon: 77.2285 },
      { id: 'ST_RED_FORT', name: 'Red Fort Lal Qila', lat: 28.6562, lon: 77.241 },
      { id: 'ST_DELHI_GATE', name: 'Delhi Gate Metro', lat: 28.6415, lon: 77.2405 },
      { id: 'ST_ITO', name: 'ITO Ring Road / Vikas Marg', lat: 28.6294, lon: 77.2435 },
      { id: 'ST_CP', name: 'Connaught Place Super Bazar', lat: 28.6315, lon: 77.2195 },
      { id: 'ST_DHAULA_KUAN', name: 'Dhaula Kuan Interchange', lat: 28.5925, lon: 77.161 },
      { id: 'ST_ANAND_VIHAR', name: 'Anand Vihar ISBT', lat: 28.6468, lon: 77.3155 },
    ];

    for (const s of baselineStops) {
      await prisma.stop.upsert({
        where: { id: s.id },
        update: {},
        create: { id: s.id, name: s.name, lat: s.lat, lon: s.lon },
      });
    }

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
