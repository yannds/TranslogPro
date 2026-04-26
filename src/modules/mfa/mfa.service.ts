/**
 * MfaService — TOTP (RFC 6238) + codes de secours
 *
 * Scaffold prêt à l'emploi, **non branché** dans AuthService.signIn à ce stade.
 * L'activation se fait :
 *   1. par utilisateur (il complète setup → enable)
 *   2. par tenant (feature flag futur : `tenant.mfaPolicy = required|optional|off`)
 *
 * Quand on activera la vérification à la connexion, AuthService.signIn devra,
 * si user.mfaEnabled, renvoyer un jeton temporaire `mfa_required` au lieu
 * du cookie de session, et exposer POST /auth/mfa/verify pour finaliser.
 *
 * Sécurité :
 *   - Secret stocké base32 (format TOTP standard, compatible Authenticator/1Password).
 *   - En prod : chiffrer `mfaSecret` via KMS (AWS KMS / GCP KMS). Ici stocké en clair
 *     pour simplicité du scaffold — TODO à résoudre avant d'activer.
 *   - Codes de secours : 10 codes 8-char, stockés hashés bcrypt, single-use.
 *   - Window TOTP : 1 (±30s) pour tolérer les horloges légèrement désynchronisées.
 */
import {
  Injectable, BadRequestException, ConflictException,
  NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import * as bcrypt from 'bcryptjs';
import * as qrcode from 'qrcode';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';

// window: 2 = tolère ±60 s de drift entre serveur et téléphone client.
// Standard de l'industrie (Google Authenticator côté serveur tolère 1-2 steps).
// Avec window: 1 (±30 s), un VPS mal-NTP ou un téléphone légèrement décalé
// rejette des codes pourtant corrects, sans message clair pour l'utilisateur.
authenticator.options = { window: 2 };

const BACKUP_CODE_COUNT  = 10;
const BACKUP_CODE_LENGTH = 8;
const ISSUER_NAME        = 'TranslogPro';

export interface MfaSetupResult {
  secret:     string;   // base32 — à afficher en "mode manuel"
  otpauthUrl: string;   // URI otpauth:// à mettre dans un QR
  qrDataUrl:  string;   // QR en data URL PNG (pour <img src=...>)
  /**
   * Alias de `qrDataUrl` — exposé pour les anciens bundles frontend qui lisent
   * cette clé (cache PWA / service worker non-mis-à-jour). À supprimer une
   * fois que tous les clients sont sur le bundle qui lit `qrDataUrl`.
   */
  qrCodeDataUrl: string;
}

export interface MfaEnableResult {
  backupCodes: string[]; // codes en clair — affichés UNE FOIS à l'utilisateur
}

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Étape 1 : génère un secret + QR code, persiste le secret en attente
   * (mfaSecret rempli, mfaEnabled reste false tant qu'on n'a pas vérifié).
   *
   * Idempotence : si l'utilisateur a déjà initié un setup non-finalisé
   * (mfaSecret rempli, mfaEnabled false), on **réutilise** le secret stocké
   * au lieu d'en regénérer. Ça évite le scénario classique :
   *   1. user clique "Activer" → secret S1 stocké, QR S1 scanné par téléphone
   *   2. user re-clique "Activer" (ex: rafraîchit l'écran) → ancien code écrasé
   *   3. user saisit le code S1 généré par son téléphone → 401 "Code invalide"
   * Pour forcer une rotation explicite (sécurité après leak), il faut d'abord
   * `disable()` — chemin documenté dans l'UI.
   */
  async setup(userId: string): Promise<MfaSetupResult> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, mfaEnabled: true, mfaSecret: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.mfaEnabled) throw new ConflictException('MFA déjà activé');

    // Réutilise le secret en attente s'il existe déjà — sinon en génère un.
    const secret = user.mfaSecret ?? authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, ISSUER_NAME, secret);
    const qrDataUrl  = await qrcode.toDataURL(otpauthUrl);

    if (!user.mfaSecret) {
      await this.prisma.user.update({
        where: { id: userId },
        data:  { mfaSecret: secret },
      });
    }

    return { secret, otpauthUrl, qrDataUrl, qrCodeDataUrl: qrDataUrl };
  }

  /**
   * Étape 2 : l'utilisateur entre le code généré par son app ;
   * si valide, on active MFA et on génère les codes de secours.
   */
  async enable(userId: string, code: string): Promise<MfaEnableResult> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, mfaSecret: true, mfaEnabled: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.mfaEnabled) throw new ConflictException('MFA déjà activé');
    if (!user.mfaSecret) throw new BadRequestException('Setup non initialisé — appelez POST /mfa/setup d\'abord');

    const valid = authenticator.check(code.trim(), user.mfaSecret);
    if (!valid) throw new UnauthorizedException('Code invalide');

    // Génère et hash les codes de secours
    const plainCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(BACKUP_CODE_LENGTH).toString('hex').slice(0, BACKUP_CODE_LENGTH).toUpperCase(),
    );
    const hashedCodes = await Promise.all(plainCodes.map(c => bcrypt.hash(c, 10)));

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled:     true,
        mfaVerifiedAt:  new Date(),
        mfaBackupCodes: hashedCodes,
      },
    });

    return { backupCodes: plainCodes };
  }

  /**
   * Désactive MFA. Requiert un code TOTP ou backup code valide.
   * (Le password check est fait en amont par le controller si nécessaire.)
   */
  async disable(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, mfaSecret: true, mfaEnabled: true, mfaBackupCodes: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (!user.mfaEnabled) throw new BadRequestException('MFA non activé');

    const ok = await this.verifyCode(user, code);
    if (!ok) throw new UnauthorizedException('Code invalide');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled:     false,
        mfaSecret:      null,
        mfaVerifiedAt:  null,
        mfaBackupCodes: [],
      },
    });
  }

  /**
   * Statut MFA self-service — pour la page /account.
   * Retourne uniquement des données non-sensibles (jamais le secret).
   */
  async getStatus(userId: string): Promise<{
    enabled:           boolean;
    verifiedAt:        Date | null;
    backupCodesRemaining: number;
    pendingSetup:      boolean;
  }> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { mfaEnabled: true, mfaSecret: true, mfaVerifiedAt: true, mfaBackupCodes: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return {
      enabled:              user.mfaEnabled,
      verifiedAt:           user.mfaVerifiedAt,
      backupCodesRemaining: user.mfaBackupCodes.length,
      pendingSetup:         !user.mfaEnabled && !!user.mfaSecret,
    };
  }

  /**
   * Régénère les 10 codes de secours. Exige un code TOTP valide pour bloquer
   * un attaquant qui aurait volé le cookie de session — sans le second
   * facteur, la rotation des backup codes est refusée.
   */
  async regenerateBackupCodes(userId: string, code: string): Promise<MfaEnableResult> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, mfaEnabled: true, mfaSecret: true, mfaBackupCodes: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (!user.mfaEnabled) throw new BadRequestException('MFA non activé');

    const ok = await this.verifyCode(user, code);
    if (!ok) throw new UnauthorizedException('Code invalide');

    const plainCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      randomBytes(BACKUP_CODE_LENGTH).toString('hex').slice(0, BACKUP_CODE_LENGTH).toUpperCase(),
    );
    const hashedCodes = await Promise.all(plainCodes.map(c => bcrypt.hash(c, 10)));

    await this.prisma.user.update({
      where: { id: userId },
      data:  { mfaBackupCodes: hashedCodes },
    });
    return { backupCodes: plainCodes };
  }

  /**
   * Vérifie un code TOTP OU un backup code. Utilisé par AuthService.signIn
   * quand on activera le flow MFA en production.
   * Consomme le backup code si match (single-use).
   */
  async verifyLoginCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, mfaSecret: true, mfaEnabled: true, mfaBackupCodes: true },
    });
    if (!user || !user.mfaEnabled) return false;
    return this.verifyCode(user, code, { consume: true });
  }

  // ─── privé ────────────────────────────────────────────────────────────────

  private async verifyCode(
    user: { id: string; mfaSecret: string | null; mfaBackupCodes: string[] },
    code: string,
    opts: { consume?: boolean } = {},
  ): Promise<boolean> {
    const trimmed = code.trim();

    // 1. Tentative TOTP
    if (user.mfaSecret && authenticator.check(trimmed, user.mfaSecret)) {
      return true;
    }

    // 2. Tentative backup code
    for (let i = 0; i < user.mfaBackupCodes.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(trimmed.toUpperCase(), user.mfaBackupCodes[i])) {
        if (opts.consume) {
          const remaining = [...user.mfaBackupCodes];
          remaining.splice(i, 1);
          await this.prisma.user.update({
            where: { id: user.id },
            data:  { mfaBackupCodes: remaining },
          });
        }
        return true;
      }
    }
    return false;
  }
}
