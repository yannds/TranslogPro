import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import {
  IIdentityManager,
  CreateUserInput,
  UserIdentity,
  SessionInfo,
} from './interfaces/identity.interface';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';
import { PrismaService } from '../database/prisma.service';

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
    const user = await this.prisma.user.create({
      data: {
        email:    input.email,
        name:     input.name,
        tenantId: input.tenantId,
        roleId:   input.roleId ?? null,
        agencyId: input.agencyId ?? null,
        userType: input.userType ?? 'STAFF',
      },
    });

    this.logger.log(`User created: ${user.id} (tenant: ${input.tenantId})`);
    return {
      id:       user.id,
      email:    user.email,
      name:     user.name,
      tenantId: user.tenantId,
      roleId:   user.roleId,
      agencyId: user.agencyId ?? undefined,
      userType: user.userType,
    };
  }

  async verifySession(token: string): Promise<SessionInfo | null> {
    const session = await this.prisma.session.findFirst({
      where:   { token, expiresAt: { gt: new Date() } },
      include: { user: { include: { role: true } } },
    });

    if (!session) return null;
    const { user } = session;

    return {
      userId:   session.userId,
      tenantId: user.tenantId,
      roleId:   user.roleId   ?? '',
      role:     user.role?.name ?? '',
      agencyId: user.agencyId ?? undefined,
      userType: user.userType,
      expiresAt: session.expiresAt,
    };
  }

  async revokeSession(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { token } });
  }

  async changePassword(_userId: string, _newPassword: string): Promise<void> {
    this.logger.warn('changePassword — delegate to Better Auth admin API');
    throw new Error('Not implemented: use Better Auth admin API endpoint');
  }
}
