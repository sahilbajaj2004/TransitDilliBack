import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '../src/db/prisma';

describe('TransitDilli Backend - Phase 1: Auth & Profile API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = 'true';
    process.env.JWT_SECRET = 'test-jwt-secret-key-1234567890';
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    // Cleanup test users from DB
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: 'testcommuter',
        },
      },
    });
    await app.close();
  });

  it('GET /health - Should return healthy status and system metrics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('TransitDilli Backend Engine');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('POST /api/v1/auth/google - Should reject empty body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Bad Request');
  });

  it('POST /api/v1/auth/google - Should register new user and issue JWT token using dev mock token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {
        idToken: 'mock-google-token-testcommuter1@transitdilli.in',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('success');
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
    expect(body.isProfileComplete).toBe(false); // Phone not yet provided
    expect(body.user.email).toBe('testcommuter1@transitdilli.in');
    expect(body.user.name).toBe('Testcommuter1');
  });

  it('GET /api/v1/auth/me - Should reject unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unauthorized');
  });

  it('GET /api/v1/auth/me - Should return commuter profile when valid JWT provided', async () => {
    // 1. Authenticate first to get token
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {
        idToken: 'mock-google-token-testcommuter2@transitdilli.in',
      },
    });
    const { token, user } = JSON.parse(authRes.body);

    // 2. Query /me
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = JSON.parse(meRes.body);
    expect(meBody.status).toBe('success');
    expect(meBody.user.id).toBe(user.id);
    expect(meBody.user.email).toBe('testcommuter2@transitdilli.in');
    expect(meBody.isProfileComplete).toBe(false);
  });

  it('PUT /api/v1/auth/profile - Should reject invalid Indian mobile numbers with 400', async () => {
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {
        idToken: 'mock-google-token-testcommuter3@transitdilli.in',
      },
    });
    const { token } = JSON.parse(authRes.body);

    // Test with invalid 5-digit number
    const resInvalidShort = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/profile',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'Test Commuter',
        phone: '12345',
      },
    });
    expect(resInvalidShort.statusCode).toBe(400);

    // Test with number starting with 1 (Indian mobile numbers start with 6,7,8,9)
    const resInvalidPrefix = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/profile',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'Test Commuter',
        phone: '1234567890',
      },
    });
    expect(resInvalidPrefix.statusCode).toBe(400);
  });

  it('PUT /api/v1/auth/profile - Should successfully update Name and Phone and set isProfileComplete to true', async () => {
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {
        idToken: 'mock-google-token-testcommuter4@transitdilli.in',
      },
    });
    const { token } = JSON.parse(authRes.body);

    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/profile',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'Sahil Bajaj',
        phone: '9811223344',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const body = JSON.parse(updateRes.body);
    expect(body.status).toBe('success');
    expect(body.isProfileComplete).toBe(true);
    expect(body.user.name).toBe('Sahil Bajaj');
    expect(body.user.phone).toBe('9811223344');

    // Verify subsequent /me call reflects the updated profile
    const verifyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const verifyBody = JSON.parse(verifyRes.body);
    expect(verifyBody.isProfileComplete).toBe(true);
    expect(verifyBody.user.phone).toBe('9811223344');
  });

  it('POST /api/v1/auth/logout - Should acknowledge logout', async () => {
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {
        idToken: 'mock-google-token-testcommuter5@transitdilli.in',
      },
    });
    const { token } = JSON.parse(authRes.body);

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(logoutRes.statusCode).toBe(200);
    const body = JSON.parse(logoutRes.body);
    expect(body.status).toBe('success');
    expect(body.message).toContain('logged out');
  });
});
