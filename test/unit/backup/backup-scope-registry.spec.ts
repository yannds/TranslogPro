import { BackupScopeRegistry } from '../../../src/modules/backup/backup-scope.registry';

describe('BackupScopeRegistry', () => {
  let registry: BackupScopeRegistry;

  beforeEach(() => {
    registry = new BackupScopeRegistry();
  });

  describe('getAll', () => {
    it('exposes 4 scopes (billetterie, colis, operations, full)', () => {
      const ids = registry.getAll().map(s => s.id).sort();
      expect(ids).toEqual(['billetterie', 'colis', 'full', 'operations']);
    });

    it('each scope has a root table count > 0 (except full which is dynamic)', () => {
      for (const s of registry.getAll()) {
        if (s.id === 'full') {
          expect(s.rootTables).toHaveLength(0); // résolu dynamiquement
        } else {
          expect(s.rootTables.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('resolveTablesOrdered', () => {
    it('throws on unknown scope', () => {
      expect(() => registry.resolveTablesOrdered('inexistant')).toThrow(/Scope inconnu/);
    });

    it('resolves billetterie tables in dependency order (stations avant routes avant trips avant tickets)', () => {
      const ordered = registry.resolveTablesOrdered('billetterie');
      const idx = (t: string) => ordered.indexOf(t);
      expect(idx('stations')).toBeLessThan(idx('routes'));
      expect(idx('routes')).toBeLessThan(idx('trips'));
      expect(idx('trips')).toBeLessThan(idx('tickets'));
      expect(idx('tariffs')).toBeLessThan(idx('tickets'));
      expect(idx('fare_classes')).toBeLessThan(idx('tariffs'));
    });

    it('resolves colis tables : stations + customers avant parcels', () => {
      const ordered = registry.resolveTablesOrdered('colis');
      const idx = (t: string) => ordered.indexOf(t);
      expect(idx('customers')).toBeLessThan(idx('parcels'));
      expect(idx('stations')).toBeLessThan(idx('parcels'));
      expect(idx('parcels')).toBeLessThan(idx('parcel_items'));
      expect(idx('parcels')).toBeLessThan(idx('parcel_hub_events'));
    });

    it('resolves operations as union of billetterie + colis + operations roots', () => {
      const ordered = registry.resolveTablesOrdered('operations');
      // Racines operations
      expect(ordered).toContain('buses');
      expect(ordered).toContain('drivers');
      expect(ordered).toContain('manifests');
      expect(ordered).toContain('incidents');
      expect(ordered).toContain('vouchers');
      // Via inclusion de billetterie
      expect(ordered).toContain('trips');
      expect(ordered).toContain('tickets');
      expect(ordered).toContain('routes');
      // Via inclusion de colis
      expect(ordered).toContain('parcels');
    });

    it('operations respects FK : buses avant manifests (manifests dépend de buses)', () => {
      const ordered = registry.resolveTablesOrdered('operations');
      const idx = (t: string) => ordered.indexOf(t);
      expect(idx('buses')).toBeLessThan(idx('manifests'));
      expect(idx('manifests')).toBeLessThan(idx('checklist_items'));
      expect(idx('drivers')).toBeLessThan(idx('driver_trainings'));
      expect(idx('drivers')).toBeLessThan(idx('crew_assignments'));
      expect(idx('incidents')).toBeLessThan(idx('compensation_items'));
      expect(idx('compensation_items')).toBeLessThan(idx('vouchers'));
    });

    it('produces deterministic order on repeated calls', () => {
      const a = registry.resolveTablesOrdered('billetterie');
      const b = registry.resolveTablesOrdered('billetterie');
      expect(a).toEqual(b);
    });

    it('full scope resolves to the union of sub-scopes (via includes)', () => {
      const ordered = registry.resolveTablesOrdered('full');
      // Les root tables propres sont vides — mais les sous-scopes apportent
      // leurs tables. BackupService ajoutera ensuite les autres tables tenant
      // via pg_catalog au runtime.
      expect(ordered).toContain('trips');
      expect(ordered).toContain('parcels');
      expect(ordered).toContain('buses');
      expect(ordered).toContain('vouchers');
    });
  });

  describe('resolveMinioEntityTypes', () => {
    it('billetterie : ticket + issued_ticket + customer_document', () => {
      const types = registry.resolveMinioEntityTypes('billetterie');
      expect(types).toContain('ticket');
      expect(types).toContain('issued_ticket');
      expect(types).toContain('customer_document');
    });

    it('operations includes types from billetterie + colis + its own', () => {
      const types = registry.resolveMinioEntityTypes('operations');
      // Propres
      expect(types).toContain('manifest');
      expect(types).toContain('driver_document');
      expect(types).toContain('incident_photo');
      // Via inclusion
      expect(types).toContain('ticket');
      expect(types).toContain('parcel');
    });

    it('full returns null (= tout le bucket tenant)', () => {
      expect(registry.resolveMinioEntityTypes('full')).toBeNull();
    });

    it('returns null for unknown scope', () => {
      expect(registry.resolveMinioEntityTypes('unknown')).toBeNull();
    });
  });
});
