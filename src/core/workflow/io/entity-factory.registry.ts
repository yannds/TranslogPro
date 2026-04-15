/**
 * EntityFactoryRegistry
 *
 * Produit des entités sandbox jetables pour la simulation.
 *
 * Chaque factory retourne un objet conforme à WorkflowEntity enrichi de champs
 * métier typiques — utile pour que les guards évaluent des cas réalistes.
 *
 * Le sandbox ne touche JAMAIS la DB : c'est un plain object. Les factories
 * fournissent un "prefill" que l'utilisateur peut override par étape depuis
 * le panneau Simulation (ex: `balance: 0` pour tester un blocage).
 */
import { WorkflowEntity } from '../interfaces/workflow-entity.interface';

export interface SandboxEntity extends WorkflowEntity {
  /** Champs métier prévisibles — lisibles par les guards. */
  [key: string]: unknown;
}

export type EntityFactory = (params: {
  tenantId:     string;
  initialState: string;
  overrides?:   Record<string, unknown>;
}) => SandboxEntity;

/**
 * Helper commun : génère l'id sandbox et fusionne les overrides.
 */
function sandboxId(prefix: string): string {
  return `sandbox-${prefix}-${Date.now().toString(36)}`;
}

// ─── Factories par entityType ────────────────────────────────────────────────

const factories: Record<string, EntityFactory> = {
  Ticket: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('ticket'),
    tenantId,
    status:   initialState,
    version:  1,
    // Champs métier typiques lus par les guards de Ticket
    scanned:          false,
    paymentConfirmed: true,
    refundable:       true,
    amount:           10000,
    ...overrides,
  }),

  Trip: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('trip'),
    tenantId,
    status:   initialState,
    version:  1,
    departed:        false,
    availableSeats:  40,
    driverAssigned:  true,
    busOperational:  true,
    manifestSigned:  false,
    ...overrides,
  }),

  Parcel: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('parcel'),
    tenantId,
    status:   initialState,
    version:  1,
    delivered:       false,
    weightKg:        5,
    senderVerified:  true,
    ...overrides,
  }),

  Bus: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('bus'),
    tenantId,
    status:   initialState,
    version:  1,
    operational:     true,
    lastInspection:  new Date().toISOString(),
    mileageKm:       120000,
    ...overrides,
  }),

  Maintenance: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('maint'),
    tenantId,
    status:   initialState,
    version:  1,
    assignedMechanic: 'mecanicien-test',
    partsAvailable:   true,
    ...overrides,
  }),

  Manifest: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('manifest'),
    tenantId,
    status:   initialState,
    version:  1,
    signed:       false,
    passengerCount: 35,
    ...overrides,
  }),

  Crew: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('crew'),
    tenantId,
    status:   initialState,
    version:  1,
    briefingDone: false,
    restHoursSinceLastShift: 10,
    ...overrides,
  }),

  Claim: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('claim'),
    tenantId,
    status:   initialState,
    version:  1,
    withinDeadline:  true,
    severity:        'medium',
    ...overrides,
  }),

  Checklist: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('checklist'),
    tenantId,
    status:   initialState,
    version:  1,
    techPassed:   true,
    safetyPassed: true,
    docsPresent:  true,
    ...overrides,
  }),

  Driver: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('driver'),
    tenantId,
    status:   initialState,
    version:  1,
    licenseValid:      true,
    restHoursComplete: true,
    assignedTrip:      null,
    ...overrides,
  }),

  Traveler: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('traveler'),
    tenantId,
    status:   initialState,
    version:  1,
    identityVerified: true,
    hasTicket:        true,
    scanned:          false,
    ...overrides,
  }),

  Shipment: ({ tenantId, initialState, overrides }) => ({
    id:       sandboxId('shipment'),
    tenantId,
    status:   initialState,
    version:  1,
    parcelCount:  5,
    totalWeight:  50,
    sealed:       false,
    ...overrides,
  }),
};

// ─── API ──────────────────────────────────────────────────────────────────────

export class EntityFactoryRegistry {
  /** Liste des entityTypes supportés. */
  static supportedTypes(): string[] {
    return Object.keys(factories);
  }

  static supports(entityType: string): boolean {
    return entityType in factories;
  }

  /**
   * Construit une entité sandbox. Lance une erreur si le type n'a pas de factory.
   * Les overrides remplacent les valeurs par défaut champ par champ.
   */
  static create(params: {
    entityType:   string;
    tenantId:     string;
    initialState: string;
    overrides?:   Record<string, unknown>;
  }): SandboxEntity {
    const factory = factories[params.entityType];
    if (!factory) {
      throw new Error(
        `Aucune factory sandbox pour entityType="${params.entityType}". ` +
        `Types supportés: ${EntityFactoryRegistry.supportedTypes().join(', ')}`,
      );
    }
    return factory({
      tenantId:     params.tenantId,
      initialState: params.initialState,
      overrides:    params.overrides,
    });
  }
}
