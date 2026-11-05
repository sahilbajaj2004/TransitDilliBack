import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { NormalizerService } from '../src/services/normalizer.service';
import { spatialIndexService } from '../src/services/spatial.service';
import { staticTransitService } from '../src/services/static-transit.service';
import { EtaService } from '../src/services/eta.service';

describe('TransitDilli Backend - Phase 3: ETA Engine & Stop Arrival Boards', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = 'true';
    process.env.JWT_SECRET = 'test-jwt-secret-key-1234567890';
    app = await buildApp();
    await app.ready();
    await staticTransitService.initialize();

    // Setup an active bus on Route 534 near Saket Metro (approaching Chirag Dilli & Nehru Place)
    const testBuses = [
      NormalizerService.enrich({
        id: 'DL1PC4821',
        tripId: '534_UP_1',
        routeId: '534UP',
        latitude: 28.5204, // Saket Metro
        longitude: 77.2014,
        bearing: 85,
        speed: 8.33, // 30 km/h
        timestamp: Math.floor(Date.now() / 1000),
      }),
      NormalizerService.enrich({
        id: 'DL51EV3196',
        tripId: 'TMS_UP_1',
        routeId: 'TMS+UP',
        latitude: 28.5681, // Safdarjung Hospital approaching AIIMS
        longitude: 77.2024,
        bearing: 90,
        speed: 5.55, // 20 km/h
        timestamp: Math.floor(Date.now() / 1000),
      }),
    ];

    spatialIndexService.rebuildIndex(testBuses);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Dynamic ETA & Progression Engine', () => {
    it('Should compute stop-by-stop ETAs along Route 534 with distance and arrival time', () => {
      const bus = spatialIndexService.getBusById('DL1PC4821')!;
      const route = staticTransitService.getRouteById('534UP')!;

      const etas = EtaService.calculateRouteEtas(bus, route.stops);

      expect(etas.length).toBeGreaterThan(0);
      // Downstream stops from Saket should include Pushp Vihar, Sheikh Sarai, Chirag Dilli, GK, Nehru Place
      const stopNames = etas.map((e) => e.stopName);
      expect(stopNames).toContain('Nehru Place Terminal');

      // Check first remaining stop
      const firstStop = etas[0];
      expect(firstStop.etaMinutes).toBeGreaterThanOrEqual(0);
      expect(firstStop.predictedArrivalTime).toMatch(/^\d{2}:\d{2}$/);
      expect(firstStop.crowdLevel).toBeDefined();

      // Check terminal stop has larger ETA than first remaining stop
      const lastStop = etas[etas.length - 1];
      expect(lastStop.etaMinutes).toBeGreaterThanOrEqual(firstStop.etaMinutes);
      expect(lastStop.distanceKm).toBeGreaterThan(firstStop.distanceKm);
    });

    it('Should calculate real-time countdown arrivals for terminal stop (Nehru Place Terminal)', () => {
      const arrivals = EtaService.getArrivalsForStop('ST_NEHRU_PLACE');

      expect(arrivals.length).toBeGreaterThan(0);
      const incoming534 = arrivals.find((a) => a.vehicleId === 'DL1PC4821');
      expect(incoming534).toBeDefined();
      expect(incoming534?.routeShortName).toBe('534');
      expect(incoming534?.agency).toBe('DIMTS');
      expect(incoming534?.themeColor).toBe('#2563EB');
      expect(incoming534?.etaMinutes).toBeGreaterThan(0);
    });
  });

  describe('2. Stop Arrival Board & Single Bus REST Endpoints', () => {
    it('GET /api/v1/transit/stops/ST_AIIMS/arrivals - Should return countdown board for AIIMS Hospital', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/transit/stops/ST_AIIMS/arrivals',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('success');
      expect(body.stop.name).toBe('AIIMS Hospital Ring Road');
      expect(body.arrivals).toBeDefined();

      // Bus DL51EV3196 (TMS+) is approaching AIIMS
      const tmsArrival = body.arrivals.find((a: any) => a.vehicleId === 'DL51EV3196');
      expect(tmsArrival).toBeDefined();
      expect(tmsArrival.routeShortName).toBe('TMS+');
      expect(tmsArrival.isElectric).toBe(true);
      expect(tmsArrival.etaMinutes).toBeDefined();
    });

    it('GET /api/v1/buses/:vehicleId - Should return vehicle position and populated etas array', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/buses/DL1PC4821',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('success');
      expect(body.data.id).toBe('DL1PC4821');
      expect(body.data.etas).toBeDefined();
      expect(body.data.etas.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/buses/:vehicleId/stream - Should return 404 for non-existent vehicle', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/buses/NONEXISTENT9999/stream',
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
