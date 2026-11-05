import { OAuth2Client } from 'google-auth-library';
import { pino } from 'pino';
import { prisma } from '../db/prisma';
import { UpdateProfileInput } from '../schemas/auth.schema';

const logger = pino({ name: 'AuthService' });

export interface VerifiedGoogleUser {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export class AuthService {
  private googleClient: OAuth2Client;
  private clientId: string;
  private isDevBypass: boolean;

  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID || '';
    this.googleClient = new OAuth2Client(this.clientId);
    this.isDevBypass = process.env.DEV_AUTH_BYPASS === 'true';
  }

  /**
   * Cryptographically verifies Google ID Token or extracts mock payload in dev mode.
   */
  public async verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleUser> {
    // 1. Support development & automated testing mock tokens
    if (this.isDevBypass && idToken.startsWith('mock-')) {
      logger.warn({ token: idToken }, 'Dev Auth Bypass: Simulating verified Google token');
      const email = idToken.replace('mock-google-token-', '').trim() || 'delhicommuter@transitdilli.in';
      const cleanEmail = email.includes('@') ? email : `${email}@transitdilli.in`;
      const sanitizedName = cleanEmail.split('@')[0].replace(/[._-]/g, ' ');
      const name = sanitizedName.charAt(0).toUpperCase() + sanitizedName.slice(1);

      return {
        googleId: `mock_google_id_${cleanEmail}`,
        email: cleanEmail,
        name: name || 'Delhi Commuter',
        avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=10B981&color=fff`,
      };
    }

    // 2. Production cryptographic verification against Google's public certs
    if (!this.clientId) {
      throw new Error('GOOGLE_CLIENT_ID is not configured in server environment');
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email || !payload.sub) {
        throw new Error('Malformed Google ID token payload');
      }

      return {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name || payload.given_name || 'Delhi Commuter',
        avatarUrl: payload.picture || null,
      };
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to verify Google ID token');
      throw new Error(`Invalid Google ID Token: ${err.message}`);
    }
  }

  /**
   * Upserts the user record based on Google ID or verified Email.
   */
  public async findOrCreateUser(profile: VerifiedGoogleUser) {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ googleId: profile.googleId }, { email: profile.email }],
      },
    });

    if (existing) {
      // Keep avatar and googleId up to date
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          googleId: profile.googleId,
          avatarUrl: profile.avatarUrl || existing.avatarUrl,
        },
      });
      return updated;
    }

    // Create new user
    const newUser = await prisma.user.create({
      data: {
        googleId: profile.googleId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        isVerified: true,
      },
    });

    logger.info({ userId: newUser.id, email: newUser.email }, 'New commuter registered via Google OAuth');
    return newUser;
  }

  /**
   * Retrieves a user by their internal UUID.
   */
  public async getUserById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Updates profile details (Name, Phone number).
   */
  public async updateProfile(userId: string, input: UpdateProfileInput) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        phone: input.phone,
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    logger.info({ userId: user.id, phone: user.phone }, 'Commuter profile updated successfully');
    return user;
  }
}

export const authService = new AuthService();
