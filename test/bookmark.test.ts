import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { staticTransitService } from '../src/services/static-transit.service';
import { prisma } from '../src/db/prisma';

describe('TransitDilli Backend - Phase 4: Bookmarks & Favorites API', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = 'true';
    process.env.JWT_SECRET = 'test-jwt-secret-key-1234567890';
    app = await buildApp();
    await app.ready();
    await staticTransitService.initialize();

    // Authenticate a test commuter
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {
        idToken: 'mock-google-token-bookmarktester@transitdilli.in',
      },
    });
    const authBody = JSON.parse(authRes.body);
    authToken = authBody.token;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { contains: 'bookmarktester' } },
    });
    await app.close();
  });

  it('GET /api/v1/bookmarks/stops - Should reject unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bookmarks/stops',
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/bookmarks/stops - Should save favorite stop for authenticated commuter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookmarks/stops',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        stopId: 'ST_AIIMS',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.data.stopId).toBe('ST_AIIMS');
    expect(body.data.stopName).toBe('AIIMS Hospital Ring Road');
  });

  it('GET /api/v1/bookmarks/stops - Should list saved favorite stops', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bookmarks/stops',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.count).toBe(1);
    expect(body.data[0].stopId).toBe('ST_AIIMS');
  });

  it('DELETE /api/v1/bookmarks/stops/:stopId - Should remove stop from favorites', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/bookmarks/stops/ST_AIIMS',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(res.statusCode).toBe(200);

    // Verify list is now empty
    const checkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/bookmarks/stops',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
    const checkBody = JSON.parse(checkRes.body);
    expect(checkBody.count).toBe(0);
  });

  it('POST /api/v1/bookmarks/routes - Should save favorite transit line', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bookmarks/routes',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        routeId: '534UP',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.data.routeId).toBe('534UP');
    expect(body.data.routeName).toContain('Mehrauli');
  });

  it('GET /api/v1/bookmarks/routes - Should list saved favorite transit lines', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bookmarks/routes',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.count).toBe(1);
    expect(body.data[0].routeId).toBe('534UP');
  });

  it('DELETE /api/v1/bookmarks/routes/:routeId - Should remove route from favorites', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/bookmarks/routes/534UP',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
