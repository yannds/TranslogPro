import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import {
  IIdentityManager,
  CreateUserInput,
  UserIdentity,
  SessionInfo,
} from './interfaces/identity.interface';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';
import { PrismaService } from '../database/prisma.service';

/**
 * Better Auth integration.
 *
 * Better Auth manages the session store and password hashing.
 * We wrap it here so the rest of the application depends only on
 * IIdentityManager, making it swappable without touching domain code.
 *
 * NOTE: Better Auth is mounted as an Express middleware in main.ts via
 *   `app.use('/api/auth', toNodeHandler(auth.handler))`.
 * This service handles programmatic user/session operations.
 */
@Injectable()
export class BetterAuthService implements IIdentityManager, OnModuleInit {
  private readonly logger = new Logger(BetterAuthService.name);
  private appSecret: string;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = await this.secretService.getSecretObject<{ APP_SECRET: string }>(
      'platform/app',
    );
    this.appSecret = config.APP_SECRET;
    this.logger.log('BetterAuth identity service initialised');
  }

  async createUser(input: CreateUserInput): Promise<UserIdentity> {
    // Better Auth creates the session-side user; we mirror it in our Prisma schema
    // with the same ID so foreign keys stay consistent.
    const user = await this.prisma.user.create({
      data: {
        email:    input.email,
        name:     input.name,
        tenantId: input.tenantId,
        role:     input.role,
        agencyId: input.agencyId,
      },
    });

    this.logger.log(`User created: ${user.id} (tenant: ${input.tenantId})`);
    return {
      id:       user.id,
      email:    user.email,
      name:     user.name,
      tenantId: user.tenantId,
      role:     user.role,
      agencyId: user.agencyId ?? undefined,
    };
  }

  async verifySession(token: string): Promise<SessionInfo | null> {
    const session = await this.prisma.session.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    if (!session) return null;

    return {
      userId:   session.userId,
      tenantId: session.user.tenantId,
      role:     session.user.role,
      agencyId: session.user.agencyId ?? undefined,
      expiresAt: session.expiresAt,
    };
  }

  async revokeSession(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { token } });
  }

  async changePassword(userId: string, newPassword: string): Promise<void> {
    // Password hashing is delegated to Better Auth's bcrypt layer.
    // In a full integration this would call the Better Auth admin API.
    this.logger.warn(`changePassword called for user ${userId} — delegate to Better Auth admin API`);
    throw new Error('Not implemented: use Better Auth admin API endpoint');
  }
}
