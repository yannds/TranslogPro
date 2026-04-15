import {
  Injectable, UnauthorizedException, Logger,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/** Durée de validité d'une session (30 jours). */
const SESSION_TTL_MS = 30 * 24 * 3600 * 1_000;

/**
 * Longueur du token de session en octets → 256 bits d'entropie.
 * Supérieur au minimum OWASP (128 bits) pour résister aux attaques par
 * force brute sur l'espace de tokens.
 */
const SESSION_TOKEN_BYTES = 32;

export interface AuthUserDto {
  id:       string;
  email:    string;
  name:     string | null;
  tenantId: string;
  roleId:   string | null;
  roleName: string | null;
  userType: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Sign-in ───────────────────────────────────────────────────────────────

  async signIn(
    email:     string,
    password:  string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ token: string; user: AuthUserDto }> {

    // 1. Recherche du compte credential
    //    On fait systématiquement le bcrypt compare même si l'account est introuvable
    //    (timing-safe : évite l'énumération d'emails par mesure du temps de réponse)
    const account = await this.prisma.account.findUnique({
      where:   { providerId_accountId: { providerId: 'credential', accountId: email } },
      include: { user: { include: { role: true } } },
    });

    const dummyHash = '$2a$12$Wz1q2FAKEHASHJUSTFORTIMINGPROTECTION.padding.padding';
    const hashToCheck = account?.password ?? dummyHash;
    const valid = await bcrypt.compare(password, hashToCheck);

    if (!account || !account.password || !valid) {
      // Audit log tentative échouée
      await this.auditSignIn({
        userId:    account?.userId ?? null,
        tenantId:  account?.user.tenantId ?? '00000000-0000-0000-0000-000000000000',
        success:   false,
        ipAddress,
        userAgent,
        email,
      });
      throw new UnauthorizedException('Identifiants invalides');
    }

    const { user } = account;

    // 2. Invalidation préventive des sessions expirées du même user (housekeeping)
    await this.prisma.session.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });

    // 3. Création session avec token 256 bits
    const token     = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.prisma.session.create({
      data: {
        userId:    user.id,
        tenantId:  user.tenantId,
        token,
        expiresAt,
        ipAddress,
        userAgent,
      },
    });

    // 4. Audit log succès
    await this.auditSignIn({
      userId:   user.id,
      tenantId: user.tenantId,
      success:  true,
      ipAddress,
      userAgent,
      email,
    });

    this.logger.log(`[AUTH] sign-in: ${email} tenant=${user.tenantId} ip=${ipAddress}`);

    return {
      token,
      user: this.toDto(user),
    };
  }

  // ─── Me ───────────────────────────────────────────────────────────────────

  async me(
    token:     string,
    ipAddress: string,
  ): Promise<AuthUserDto> {
    const session = await this.prisma.session.findUnique({
      where:   { token },
      include: { user: { include: { role: true } } },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expirée ou invalide');
    }

    // IP binding : si l'IP change, on invalide la session (session hijacking)
    // Exception : localhost (dev) et adresses privées RFC 1918
    if (!this.isPrivateOrLocal(ipAddress) && session.ipAddress &&
        session.ipAddress !== ipAddress) {
      await this.prisma.session.delete({ where: { token } });
      this.logger.warn(
        `[AUTH] session IP mismatch — invalidated. ` +
        `stored=${session.ipAddress} current=${ipAddress}`,
      );
      throw new ForbiddenException('Session invalidée (IP modifiée)');
    }

    return this.toDto(session.user);
  }

  // ─── Sign-out ─────────────────────────────────────────────────────────────

  async signOut(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { token } });
  }

  // ─── Création compte credential (utilisé par le seed dev) ─────────────────

  async createCredentialAccount(
    userId:   string,
    email:    string,
    password: string,
  ): Promise<void> {
    const hash = await bcrypt.hash(password, 12);
    await this.prisma.account.upsert({
      where:  { providerId_accountId: { providerId: 'credential', accountId: email } },
      update: { password: hash },
      create: {
        userId,
        providerId: 'credential',
        accountId:  email,
        password:   hash,
      },
    });
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────

  private toDto(user: {
    id: string; email: string; name: string | null;
    tenantId: string; roleId: string | null; userType: string;
    role?: { name: string } | null;
  }): AuthUserDto {
    return {
      id:       user.id,
      email:    user.email,
      name:     user.name,
      tenantId: user.tenantId,
      roleId:   user.roleId,
      roleName: user.role?.name ?? null,
      userType: user.userType,
    };
  }

  private isPrivateOrLocal(ip: string): boolean {
    return (
      ip === '127.0.0.1'      ||
      ip === '::1'            ||
      ip === '::ffff:127.0.0.1' ||
      ip.startsWith('10.')    ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    );
  }

  private async auditSignIn(params: {
    userId:    string | null;
    tenantId:  string;
    success:   boolean;
    ipAddress: string;
    userAgent: string;
    email:     string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId:  params.tenantId,
          userId:    params.userId,
          plane:     'control',
          level:     params.success ? 'info' : 'warn',
          action:    params.success ? 'auth.sign_in.success' : 'auth.sign_in.failure',
          resource:  `User:${params.email}`,
          ipAddress: params.ipAddress,
          newValue:  { userAgent: params.userAgent },
        },
      });
    } catch (err) {
      // Ne jamais bloquer l'auth sur un échec d'audit log
      this.logger.error('[AUTH] audit log write failed', err);
    }
  }
}
