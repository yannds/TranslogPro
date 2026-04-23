/**
 * IWorkflowIO / IWorkflowTxIO
 *
 * Abstraction des opérations I/O du WorkflowEngine.
 *
 * Deux implémentations prévues :
 *   - LiveWorkflowIO        : déléguation 1:1 à PrismaService + AuditService (prod/tests existants)
 *   - SimulationWorkflowIO  : en mémoire avec capture des side-effects (Sprint 2+)
 *
 * L'engine ne connaît plus Prisma/Audit directement — il consomme cette interface.
 * Cela permet de simuler un scénario fidèlement en remplaçant uniquement l'I/O,
 * sans dupliquer la logique de permissions, guards, locking, idempotence, etc.
 */
import { WorkflowEntity } from '../interfaces/workflow-entity.interface';
import { TransitionInput } from '../interfaces/transition-input.interface';
import { SideEffectDefinition } from '../types/side-effect-definition.type';
import { AuditEntry } from '../audit.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

/** Résumé d'une transition existante (idempotence). */
export interface IdempotentTransitionSummary {
  toState:   string;
  fromState: string;
}

/** Résumé d'une WorkflowConfig résolue. */
export interface ResolvedWorkflowConfig {
  toState:      string;
  requiredPerm: string;
  /**
   * Noms de side-effects déclarés dans le blueprint (colonne `sideEffects: Json`).
   * Résolus via `SideEffectRegistry.resolve()` par l'engine au runtime.
   * Array vide si la config n'en déclare aucun.
   */
  sideEffectNames: string[];
}

/**
 * Callback de persistance d'une entité — identique au contrat actuel
 * de `WorkflowTransitionConfig.persist` (inchangé pour ne pas casser les services existants).
 */
export type PersistFn<E extends WorkflowEntity> =
  (entity: E, toState: string, prisma: PrismaService) => Promise<E>;

/**
 * Opérations I/O transactionnelles — passées en callback à `runInTransaction`.
 * Dans `LiveWorkflowIO` : délègue au tx Prisma de la transaction en cours.
 * Dans `SimulationWorkflowIO` : opère sur des structures mémoire.
 */
export interface IWorkflowTxIO {
  /** Retourne la transition déjà commitée pour cette clé, ou null. */
  findIdempotentTransition(
    idempotencyKey: string,
  ): Promise<IdempotentTransitionSummary | null>;

  /**
   * Acquiert un lock pessimiste (SELECT FOR UPDATE NOWAIT en mode live)
   * et retourne la version courante de l'entité, ou null si introuvable.
   */
  lockEntity(
    aggregateType: string,
    entityId:      string,
  ): Promise<{ version: number } | null>;

  /**
   * Exécute le callback de persistance dans le contexte transactionnel.
   * La signature conserve `PrismaService` pour ne rien casser côté services appelants.
   */
  persist<E extends WorkflowEntity>(
    entity:    E,
    toState:   string,
    persistFn: PersistFn<E>,
  ): Promise<E>;

  /**
   * Enregistre la ligne WorkflowTransition (idempotence + historique).
   * Doit propager P2002 tel quel — l'engine gère la race condition.
   */
  recordTransition(data: {
    tenantId:       string;
    entityType:     string;
    entityId:       string;
    fromState:      string;
    action:         string;
    toState:        string;
    userId:         string;
    idempotencyKey: string;
  }): Promise<void>;

  /** Écrit une entrée audit (dans la transaction ou capturée). */
  recordAudit(entry: AuditEntry): Promise<void>;

  /** Exécute (ou capture) un side-effect synchrone critique. */
  runSideEffect<E extends WorkflowEntity>(
    sideEffect: SideEffectDefinition<E>,
    entity:     E,
    input:      TransitionInput,
    context:    Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Interface racine — opérations hors transaction + wrapper de transaction.
 */
export interface IWorkflowIO {
  /**
   * Pré-validation que l'IO sait gérer ce type d'agrégat (whitelist en live,
   * factory registry en simulation). Permet au moteur d'échouer vite sur input invalide,
   * avant toute requête DB — conserve le comportement d'origine.
   */
  supportsAggregateType(aggregateType: string): boolean;

  /**
   * Pré-check idempotent hors transaction — court-circuite si la clé est connue.
   * Renvoie null si inconnue ou non fournie.
   */
  findIdempotentTransition(
    idempotencyKey: string,
  ): Promise<IdempotentTransitionSummary | null>;

  /**
   * Résout la WorkflowConfig active pour (tenantId, entityType, fromState, action).
   * Renvoie null si aucune config n'autorise cette transition.
   */
  loadConfig(
    tenantId:   string,
    entityType: string,
    fromState:  string,
    action:     string,
  ): Promise<ResolvedWorkflowConfig | null>;

  /** Vérifie qu'un rôle détient la permission requise. */
  hasPermission(
    roleId:     string,
    permission: string,
  ): Promise<boolean>;

  /**
   * Exécute le callback atomiquement. Le callback reçoit l'IO transactionnelle.
   * Toute exception propage normalement — le live rollback, le sim nettoie.
   */
  runInTransaction<T>(
    fn: (txIO: IWorkflowTxIO) => Promise<T>,
  ): Promise<T>;
}
