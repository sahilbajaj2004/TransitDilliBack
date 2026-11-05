import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { NormalizerService, RawTelemetryVehicle } from '../src/services/normalizer.service';
import { spatialIndexService } from '../src/services/spatial.service';
import { staticTransitService } from '../src/services/static-transit.service';

describe('TransitDilli Backend - Phase 2: Ingestion, Spatial Radar & Transit Network', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = 'true';
    process.env.JWT_SECRET = 'test-jwt-secret-key-1234567890';
    app = await buildApp();
    await app.ready();
    await staticTransitService.initialize();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Normalizer & Agency Classifier', () => {
    it('Should classify standard DTC state buses with Emerald Green #10B981', () => {
      const raw: RawTelemetryVehicle = {
        id: 'DL1P9988',
        tripId: '534_UP_1',
        routeId: '534UP',
        latitude: 28.5694,
        longitude: 77.2085,
        bearing: 90,
        speed: 8.5, // 8.5 m/s ≈ 30.6 km/h
        timestamp: 1793894000,
      };

      const enriched = NormalizerService.enrich(raw);
      expect(enriched.agency).toBe('DTC');
      expect(enriched.themeColor).toBe('#10B981');
      expect(enriched.secondaryColor).toBe('#059669');
      expect(enriched.speedKmph).toBe(30.6);
      expect(enriched.isElectric).toBe(false);
    });

    it('Should classify DIMTS cluster concessionaire buses with Royal Blue #2563EB', () => {
      const raw: RawTelemetryVehicle = {
        id: 'DL1PB4586',
        tripId: '729_DN_2',
        routeId: '729UP',
        latitude: 28.6315,
        longitude: 77.2195,
        bearing: 180,
        speed: 5.0, // 18 km/h
        timestamp: 1793894000,
      };

      const enriched = NormalizerService.enrich(raw);
      expect(enriched.agency).toBe('DIMTS');
      expect(enriched.themeColor).toBe('#2563EB');
      expect(enriched.secondaryColor).toBe('#1D4ED8');
      expect(enriched.speedKmph).toBe(18.0);
    });

    it('Should identify Electric zero-emission buses (DL51EV) with electric flags and AC enabled', () => {
      const raw: RawTelemetryVehicle = {
        id: 'DL51EV3196',
        tripId: 'TMS_UP_4',
        routeId: 'TMS+UP',
        latitude: 28.5701,
        longitude: 77.2410,
        bearing: 270,
        speed: 10.0,
        timestamp: 1793894000,
      };

      const enriched = NormalizerService.enrich(raw);
      expect(enriched.isElectric).toBe(true);
      expect(enriched.fuelType).toBe('electric');
      expect(enriched.isAc).toBe(true);
    });
  });

  describe('2. In-Memory 2D Spatial Indexing (KDBush)', () => {
    beforeAll(() => {
      // Seed test fleet snapshot across key Delhi localities
      const testBuses = [
        // AIIMS Hospital area (~28.5694, 77.2085)
        NormalizerService.enrich({
          id: 'DL1PC4821',
          tripId: '534_UP_1',
          routeId: '534UP',
          latitude: 28.5694,
          longitude: 77.2085,
          bearing: 85,
          speed: 6.5,
          timestamp: 1793894000,
        }),
        // Safdarjung (0.6 km from AIIMS)
        NormalizerService.enrich({
          id: 'DL1PB7744',
          tripId: '729_UP_1',
          routeId: '729UP',
          latitude: 28.5681,
          longitude: 77.2024,
          bearing: 120,
          speed: 7.2,
          timestamp: 1793894000,
        }),
        // South Extn (1.0 km from AIIMS)
        NormalizerService.enrich({
          id: 'DL51EV9900',
          tripId: 'TMS_UP_1',
          routeId: 'TMS+UP',
          latitude: 28.5724,
          longitude: 77.2185,
          bearing: 45,
          speed: 9.0,
          timestamp: 1793894000,
        }),
        // Kashmere Gate ISBT (~12 km north of AIIMS)
        NormalizerService.enrich({
          id: 'DL1PD1001',
          tripId: '729_UP_2',
          routeId: '729UP',
          latitude: 28.6675,
          longitude: 77.2285,
          bearing: 10,
          speed: 5.5,
          timestamp: 1793894000,
        }),
      ];

      spatialIndexService.rebuildIndex(testBuses);
    });

    it('Should query buses within 2.0km radius and exclude far vehicles (Kashmere Gate)', () => {
      // Query from AIIMS (28.5694, 77.2085) with 2km radius
      const nearby = spatialIndexService.queryRadius(28.5694, 77.2085, 2.0);

      expect(nearby.length).toBe(3);
      const ids = nearby.map((b) => b.id);
      expect(ids).toContain('DL1PC4821'); // At AIIMS (0m)
      expect(ids).toContain('DL1PB7744'); // At Safdarjung (~600m)
      expect(ids).toContain('DL51EV9900'); // At South Extn (~1000m)
      expect(ids).not.toContain('DL1PD1001'); // 12km away

      // Sorted by distance: closest first
      expect(nearby[0].distanceMeters).toBeLessThanOrEqual(nearby[1].distanceMeters);
    });

    it('Should filter nearby query by agency (DTC only)', () => {
      const dtcOnly = spatialIndexService.queryRadius(28.5694, 77.2085, 2.0, { agency: 'DTC' });
      for (const bus of dtcOnly) {
        expect(bus.agency).toBe('DTC');
      }
    });

    it('Should filter nearby query by Electric propulsion only', () => {
      const electricOnly = spatialIndexService.queryRadius(28.5694, 77.2085, 2.0, { isElectric: true });
      expect(electricOnly.length).toBe(1);
      expect(electricOnly[0].id).toBe('DL51EV9900');
    });

    it('Should retrieve a single bus by ID in O(1)', () => {
      const bus = spatialIndexService.getBusById('DL1PC4821');
      expect(bus).toBeDefined();
      expect(bus?.routeId).toBe('534UP');
    });

    it('Should retrieve all active buses on a route in O(1)', () => {
      const routeBuses = spatialIndexService.getBusesByRoute('729UP');
      expect(routeBuses.length).toBe(2);
    });
  });

  describe('3. REST API Endpoints', () => {
    it('GET /api/v1/buses/nearby - Should reject request without lat/lon with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/buses/nearby',
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Bad Request');
    });

    it('GET /api/v1/buses/nearby - Should return nearby buses and Cache-Control headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/buses/nearby?lat=28.5694&lon=77.2085&radius=2.0',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toContain('public, max-age=4');

      const body = JSON.parse(res.body);
      expect(body.status).toBe('success');
      expect(body.count).toBeGreaterThanOrEqual(3);
      expect(body.data[0].distanceMeters).toBeDefined();
    });

    it('GET /api/v1/buses/:vehicleId - Should return single bus details', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/buses/DL1PC4821',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('success');
      expect(body.data.id).toBe('DL1PC4821');
      expect(body.data.routeDetails).toBeDefined();
      expect(body.data.routeDetails.shortName).toBe('534');
    });

    it('GET /api/v1/buses/stats - Should return real-time fleet counters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/buses/stats',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('success');
      expect(body.fleet.totalBuses).toBeGreaterThanOrEqual(4);
    });

    it('GET /api/v1/transit/routes - Should return transit lines with active bus counts', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/transit/routes',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('success');
      expect(body.data.length).toBeGreaterThan(0);

      const route534 = body.data.find((r: any) => r.shortName === '534');
      expect(route534).toBeDefined();
      expect(route534.totalStops).toBe(8);
      expect(route534.activeBusesCount).toBe(1);
    });

    it('GET /api/v1/transit/534UP - Should return detailed route with ordered stops', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/transit/534UP',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('success');
      expect(body.data.shortName).toBe('534');
      expect(body.data.stops.length).toBe(8);
      expect(body.data.stops[0].stopName).toBe('Mehrauli Terminal');
      expect(body.data.stops[7].stopName).toBe('Nehru Place Terminal');
    });

    it('GET /api/v1/transit/stops/nearby - Should return nearby bus stops', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/transit/stops/nearby?lat=28.5694&lon=77.2085&radius=2.0',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('success');
      expect(body.data.length).toBeGreaterThan(0);

      const stopNames = body.data.map((s: any) => s.name);
      expect(stopNames).toContain('AIIMS Hospital Ring Road');
    });
  });
});
