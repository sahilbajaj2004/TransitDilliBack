import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../services/auth.service';
import { GoogleAuthSchema, UpdateProfileSchema } from '../schemas/auth.schema';

export async function authRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions) {
  /**
   * POST /api/v1/auth/google
   * Authenticates with Google ID token, upserts user, issues TransitDilli JWT token.
   */
  fastify.post('/google', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = GoogleAuthSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: parseResult.error.errors[0]?.message || 'Invalid request body',
      });
    }

    try {
      const verifiedPayload = await authService.verifyGoogleIdToken(parseResult.data.idToken);
      const user = await authService.findOrCreateUser(verifiedPayload);

      // Sign JWT session token
      const token = fastify.jwt.sign({
        sub: user.id,
        email: user.email,
      });

      return reply.status(200).send({
        status: 'success',
        token,
        isProfileComplete: Boolean(user.phone),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          avatarUrl: user.avatarUrl,
          isVerified: user.isVerified,
          createdAt: user.createdAt,
        },
      });
    } catch (err: any) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: err.message || 'Google authentication failed',
      });
    }
  });

  /**
   * GET /api/v1/auth/me
   * Retrieves profile of current authenticated commuter.
   */
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.sub;
      const user = await authService.getUserById(userId);

      if (!user) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'User account not found',
        });
      }

      return reply.status(200).send({
        status: 'success',
        isProfileComplete: Boolean(user.phone),
        user,
      });
    }
  );

  /**
   * PUT /api/v1/auth/profile
   * Sets or updates commuter's Name and Phone number.
   */
  fastify.put(
    '/profile',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = UpdateProfileSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: parseResult.error.errors[0]?.message || 'Invalid profile data',
          details: parseResult.error.errors,
        });
      }

      try {
        const userId = request.user.sub;
        const updated = await authService.updateProfile(userId, parseResult.data);

        return reply.status(200).send({
          status: 'success',
          message: 'Profile updated successfully',
          isProfileComplete: true,
          user: updated,
        });
      } catch (err: any) {
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: err.message || 'Failed to update profile',
        });
      }
    }
  );

  /**
   * POST /api/v1/auth/logout
   * Commuter logout acknowledgment.
   */
  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        status: 'success',
        message: 'Successfully logged out',
      });
    }
  );
}
