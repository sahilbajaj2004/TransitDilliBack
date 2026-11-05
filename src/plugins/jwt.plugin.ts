import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

async function jwtPlugin(fastify: FastifyInstance) {
  const secret = process.env.JWT_SECRET || 'transitdilli-super-secret-jwt-token-key-change-in-prod-2026';

  await fastify.register(fastifyJwt, {
    secret,
    sign: {
      expiresIn: '15d', // 15 days commuter token persistence
    },
  });

  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (err: any) {
        reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired Authorization token. Please sign in with Google.',
        });
      }
    }
  );
}

export default fp(jwtPlugin);
