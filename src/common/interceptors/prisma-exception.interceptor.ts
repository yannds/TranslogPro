/**
 * PrismaExceptionInterceptor — Convertit les erreurs Prisma en HttpException lisibles.
 *
 * Sans cet interceptor, une erreur Prisma (unique constraint, foreign key, record
 * not found…) remonte comme un 500 générique "An unexpected error occurred".
 * Avec cet interceptor, le client reçoit :
 *   - P2002 (unique constraint) → 409 Conflict + champ en doublon
 *   - P2003 (foreign key)       → 400 Bad Request + relation manquante
 *   - P2025 (record not found)  → 404 Not Found
 *   - P2014 (required relation) → 400 Bad Request
 *   - P2021/P2022 (table/column missing) → 500 + BANNIÈRE dev avec remédiation
 *                                         (drift schema Prisma vs DB)
 *   - Validation error          → 400 Bad Request + détails
 *   - Autres PrismaKnown        → 500 avec code + message réel (pas "unexpected")
 *
 * Enregistré globalement dans main.ts via useGlobalInterceptors().
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import { Prisma } from '@prisma/client';

@Injectable()
export class PrismaExceptionInterceptor implements NestInterceptor {
  private readonly logger = new Logger('PrismaError');

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          return throwError(() => this.handleKnownError(error));
        }

        if (error instanceof Prisma.PrismaClientValidationError) {
          this.logger.warn(`Prisma validation: ${error.message.slice(0, 300)}`);
          return throwError(() => new BadRequestException(
            `Données invalides : ${this.extractValidationHint(error.message)}`,
          ));
        }

        // Pas une erreur Prisma → laisser passer (le filter global gère)
        return throwError(() => error);
      }),
    );
  }

  private handleKnownError(error: Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as Record<string, unknown> | undefined;
    // En prod, on masque les détails de schéma DB pour éviter l'énumération
    // et le leak de structure interne. En dev, on garde les infos pour le debug.
    const isProd = process.env.NODE_ENV === 'production';

    switch (error.code) {
      // ── Unique constraint violation ────────────────────────────────
      case 'P2002': {
        if (isProd) {
          // Message générique : empêche l'énumération (ex: tester un email
          // pour savoir s'il est déjà inscrit en observant 409 vs 400).
          return new ConflictException('Cette valeur existe déjà.');
        }
        const fields = (meta?.target as string[])?.join(', ') ?? 'champ inconnu';
        return new ConflictException(
          `Doublon détecté sur : ${fields}. Cette valeur existe déjà.`,
        );
      }

      // ── Foreign key constraint violation ───────────────────────────
      case 'P2003': {
        if (isProd) {
          return new BadRequestException('Référence invalide.');
        }
        const field = (meta?.field_name as string) ?? 'relation inconnue';
        return new BadRequestException(
          `Référence invalide : ${field}. L'enregistrement lié n'existe pas.`,
        );
      }

      // ── Record not found (update/delete on missing row) ───────────
      case 'P2025': {
        const cause = (meta?.cause as string) ?? 'Enregistrement introuvable';
        return new NotFoundException(cause);
      }

      // ── Required relation missing ─────────────────────────────────
      case 'P2014': {
        const relation = (meta?.relation_name as string) ?? 'relation';
        return new BadRequestException(
          `Relation obligatoire manquante : ${relation}.`,
        );
      }

      // ── Value too long for column ─────────────────────────────────
      case 'P2000': {
        const column = (meta?.column_name as string) ?? 'colonne';
        return new BadRequestException(
          `Valeur trop longue pour le champ : ${column}.`,
        );
      }

      // ── Null constraint violation ─────────────────────────────────
      case 'P2011': {
        const constraint = (meta?.constraint as string) ?? 'champ';
        return new BadRequestException(
          `Champ obligatoire manquant : ${constraint}.`,
        );
      }

      // ── Drift schema Prisma vs DB (table ou colonne manquante) ───
      // En dev : bannière ROUGE actionnable qui pointe vers db:check/db:sync.
      // En prod : 500 générique (ne jamais leak la structure DB).
      // Cas P2021 = table manquante, P2022 = colonne manquante.
      case 'P2021':
      case 'P2022': {
        const table  = (meta?.table  as string) ?? 'inconnue';
        const column = (meta?.column as string) ?? null;
        const what = error.code === 'P2022'
          ? `colonne "${column ?? '?'}" manquante sur table "${table}"`
          : `table "${table}" manquante`;
        if (!isProd) {
          // eslint-disable-next-line no-console
          console.error(
            '\n\x1b[31m\x1b[1m┌─ SCHEMA DRIFT DÉTECTÉ AU RUNTIME ───────────────────────┐\x1b[0m\n' +
            `\x1b[31m\x1b[1m│\x1b[0m Prisma ${error.code} : ${what}\n` +
            '\x1b[31m\x1b[1m│\x1b[0m Le schema.prisma a été modifié mais la DB n\'a pas été synchronisée.\n' +
            '\x1b[31m\x1b[1m│\x1b[0m \n' +
            '\x1b[31m\x1b[1m│\x1b[0m Remédiation (non destructive, préserve les données de test) :\n' +
            '\x1b[31m\x1b[1m│\x1b[0m   1. \x1b[33mnpm run db:check\x1b[0m    # voir la liste des changements\n' +
            '\x1b[31m\x1b[1m│\x1b[0m   2. \x1b[33mnpm run db:sync\x1b[0m     # appliquer (refuse toute perte de données)\n' +
            '\x1b[31m\x1b[1m│\x1b[0m   3. Redémarrer le backend (Prisma Client rechargé)\n' +
            '\x1b[31m\x1b[1m└──────────────────────────────────────────────────────────┘\x1b[0m\n',
          );
        }
        return new InternalServerErrorException(
          isProd
            ? 'Erreur base de données interne.'
            : `Drift schema Prisma ↔ DB : ${what}. Voir les logs backend pour la commande de remédiation.`,
        );
      }

      // ── Tous les autres codes Prisma ──────────────────────────────
      default: {
        this.logger.error(
          `Prisma error ${error.code}: ${error.message}`,
          error.stack,
        );
        return new InternalServerErrorException(
          `Erreur base de données (${error.code}). ${(meta?.cause as string) ?? error.message}`,
        );
      }
    }
  }

  /** Extrait un indice lisible d'une PrismaClientValidationError. */
  private extractValidationHint(message: string): string {
    // Le message Prisma est long — chercher la dernière ligne utile
    const lines = message.split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1]?.trim();
    if (lastLine && lastLine.length < 200) return lastLine;
    return 'vérifiez les types et champs requis';
  }
}
