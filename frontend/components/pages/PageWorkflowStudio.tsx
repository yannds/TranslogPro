/**
 * PageWorkflowStudio — Éditeur visuel de workflows TranslogPro
 *
 * Interface principale du Workflow Studio :
 *   - Sélecteur de type d'entité (chargé depuis l'API)
 *   - WorkflowDesigner avec canvas React Flow (états + transitions)
 *   - SimulationPanel et BlueprintPanel intégrés dans le designer
 *
 * Données :
 *   - GET  /tenants/:tid/workflow-studio/entity-types → liste des types configurés
 *   - GET  /tenants/:tid/workflow-studio/graph/:entityType → charger un graphe
 *   - PUT  /tenants/:tid/workflow-studio/graph             → sauvegarder
 *   - POST /tenants/:tid/workflow-studio/simulate          → simulation
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, rôles, focus visible
 * Dark mode : classes Tailwind dark: — automatique via ThemeProvider
 */

import { useState } from 'react';
import { GitFork, Ticket, Bus, Package, MapPin, AlertCircle, Plus, Wrench, ClipboardList, Users, FileText, AlertTriangle, X, Wallet, Siren, Ship, RotateCcw, UserCheck } from 'lucide-react';
import { WorkflowDesigner } from '../workflow/WorkflowDesigner';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { Skeleton } from '../ui/Skeleton';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

// ─── Catalogue de tous les types d'entités supportés ─────────────────────────

const ENTITY_TYPE_I18N: Record<string, { label: string; desc: string }> = {
  Ticket:       { label: 'workflowStudio.etTicket',       desc: 'workflowStudio.edTicket' },
  Trip:         { label: 'workflowStudio.etTrip',         desc: 'workflowStudio.edTrip' },
  Parcel:       { label: 'workflowStudio.etParcel',       desc: 'workflowStudio.edParcel' },
  Bus:          { label: 'workflowStudio.etBus',          desc: 'workflowStudio.edBus' },
  Maintenance:  { label: 'workflowStudio.etMaintenance',  desc: 'workflowStudio.edMaintenance' },
  Manifest:     { label: 'workflowStudio.etManifest',     desc: 'workflowStudio.edManifest' },
  Crew:         { label: 'workflowStudio.etCrew',         desc: 'workflowStudio.edCrew' },
  Claim:        { label: 'workflowStudio.etClaim',        desc: 'workflowStudio.edClaim' },
  Checklist:    { label: 'workflowStudio.etChecklist',    desc: 'workflowStudio.edChecklist' },
  Driver:       { label: 'workflowStudio.etDriver',       desc: 'workflowStudio.edDriver' },
  Traveler:     { label: 'workflowStudio.etTraveler',     desc: 'workflowStudio.edTraveler' },
  Shipment:     { label: 'workflowStudio.etShipment',     desc: 'workflowStudio.edShipment' },
  Refund:       { label: 'workflowStudio.etRefund',       desc: 'workflowStudio.edRefund' },
  CashRegister: { label: 'workflowStudio.etCashRegister', desc: 'workflowStudio.edCashRegister' },
  Incident:     { label: 'workflowStudio.etIncident',     desc: 'workflowStudio.edIncident' },
};

const ALL_ENTITY_TYPES = [
  'Ticket', 'Trip', 'Parcel', 'Traveler', 'Bus', 'Shipment',
  'Maintenance', 'Manifest', 'Crew', 'Claim', 'Checklist',
  'Driver', 'Refund', 'CashRegister', 'Incident',
];

// ─── Icônes par défaut pour les types connus ──────────────────────────────────

const ENTITY_ICONS: Record<string, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
  Ticket:       Ticket,
  Trip:         MapPin,
  Parcel:       Package,
  Bus:          Bus,
  Maintenance:  Wrench,
  Manifest:     ClipboardList,
  Crew:         Users,
  Claim:        AlertTriangle,
  Checklist:    FileText,
  Driver:       Users,
  Traveler:     UserCheck,
  Shipment:     Ship,
  Refund:       RotateCcw,
  CashRegister: Wallet,
  Incident:     Siren,
};

function getEntityIcon(key: string) {
  return ENTITY_ICONS[key] ?? GitFork;
}

// ─── Onglet sélecteur d'entité ────────────────────────────────────────────────

function EntityTypeTab({
  entityType,
  isActive,
  onSelect,
}: {
  entityType: string;
  isActive:   boolean;
  onSelect:   (key: string) => void;
}) {
  const { t } = useI18n();
  const Icon = getEntityIcon(entityType);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`workflow-panel-${entityType}`}
      id={`workflow-tab-${entityType}`}
      onClick={() => onSelect(entityType)}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        isActive
          ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600',
      )}
    >
      <Icon className="w-4 h-4" aria-hidden />
      {ENTITY_TYPE_I18N[entityType] ? t(ENTITY_TYPE_I18N[entityType].label) : entityType}
    </button>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageWorkflowStudio() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const [rev, setRev] = useState(0);
  const { data: entityTypes, loading, error } = useFetch<string[]>(
    tenantId ? `/api/tenants/${tenantId}/workflow-studio/entity-types` : null,
    [tenantId, rev],
  );

  const types = entityTypes && entityTypes.length > 0 ? entityTypes : [];
  const [activeEntityType, setActiveEntityType] = useState<string | null>(null);
  const [showNewDialog,    setShowNewDialog]    = useState(false);

  // Pick first available type once loaded
  const active = activeEntityType ?? types[0] ?? null;

  // Types already configured — exclude them from the "new" dialog
  const availableToCreate = ALL_ENTITY_TYPES.filter(id => !types.includes(id));

  const handleSelectNewType = (id: string) => {
    setShowNewDialog(false);
    setActiveEntityType(id);
    setRev(r => r + 1); // force reload after save
  };

  if (!user) return null;

  return (
    <div className="flex flex-col h-full t-app">

      {/* ── En-tête ── */}
      <header className="flex items-center gap-3 px-6 py-4 t-card border-b t-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/10 dark:bg-blue-500/20">
          <GitFork className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold t-text leading-none">{t('workflowStudio.workflowStudio')}</h1>
          <p className="text-xs t-text-2 mt-0.5">{t('workflowStudio.visualDesign')}</p>
        </div>
      </header>

      {/* ── Onglets sélecteur d'entité ── */}
      <div
        role="tablist"
        aria-label={t('workflowStudio.entityType')}
        className="flex items-end gap-1 px-6 t-card border-b t-border min-h-[44px] overflow-x-auto"
      >
        {loading ? (
          <div className="flex gap-2 items-center pb-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-24" />)}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" aria-hidden />
            {t('workflowStudio.cannotLoadTypes')}
          </div>
        ) : (
          <>
            {types.map(entityType => (
              <EntityTypeTab
                key={entityType}
                entityType={entityType}
                isActive={entityType === active}
                onSelect={setActiveEntityType}
              />
            ))}
            {/* Bouton + Nouveau type */}
            {availableToCreate.length > 0 && (
              <button
                type="button"
                onClick={() => setShowNewDialog(true)}
                className="flex items-center gap-1.5 px-3 py-2 mb-1 text-xs font-medium rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title={t('workflowStudio.createNewWf')}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
                {t('workflowStudio.new')}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Description de l'entité active ── */}
      {active && (
        <div className="flex items-center gap-2 px-6 py-2 t-surface border-b t-border">
          {(() => {
            const Icon = getEntityIcon(active);
            return <Icon className="w-3.5 h-3.5 t-text-3" aria-hidden />;
          })()}
          <p className="text-xs t-text-2">
            {t('workflowStudio.workflowLabel')} <span className="font-mono font-semibold t-text">{active}</span>
            {!types.includes(active) && (
              <span className="ml-2 text-amber-600 dark:text-amber-400 text-[10px]">({t('workflowStudio.newSaveToActivate')})</span>
            )}
          </p>
        </div>
      )}

      {/* ── Canvas WorkflowDesigner ── */}
      {active && (
        <div
          id={`workflow-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`workflow-tab-${active}`}
          className="flex-1 min-h-0"
        >
          <WorkflowDesigner
            tenantId={tenantId}
            entityType={active}
            key={active}
          />
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && types.length === 0 && !active && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-sm">
            <div className="flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-900/30">
                <GitFork className="w-8 h-8 text-blue-600 dark:text-blue-400" aria-hidden />
              </div>
            </div>
            <h2 className="text-lg font-semibold t-text">{t('workflowStudio.noWfConfigured')}</h2>
            <p className="text-sm t-text-2">
              {t('workflowStudio.installBpHint')}
            </p>
            <Button onClick={() => setShowNewDialog(true)}>
              <Plus className="w-4 h-4 mr-2" /> {t('workflowStudio.createWorkflow')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Dialog sélection du nouveau type ── */}
      <Dialog
        open={showNewDialog}
        onOpenChange={o => { if (!o) setShowNewDialog(false); }}
        title={t('workflowStudio.createWfDialog')}
        description={t('workflowStudio.createWfDesc')}
        size="xl"
        footer={
          <Button variant="ghost" onClick={() => setShowNewDialog(false)}>
            <X className="w-4 h-4 mr-1.5" /> {t('common.cancel')}
          </Button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {availableToCreate.map(etId => {
            const Icon = getEntityIcon(etId);
            const i18n = ENTITY_TYPE_I18N[etId];
            return (
              <button
                key={etId}
                type="button"
                onClick={() => handleSelectNewType(etId)}
                className="flex items-start gap-3 p-4 rounded-xl border t-border t-nav-hover transition-colors text-left group"
              >
                <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0 group-hover:bg-blue-200 dark:group-hover:bg-blue-800/40 transition-colors">
                  <Icon className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" aria-hidden />
                </div>
                <div>
                  <p className="font-medium text-sm t-text">{i18n ? t(i18n.label) : etId}</p>
                  <p className="text-xs t-text-2 mt-0.5 leading-snug">{i18n ? t(i18n.desc) : ''}</p>
                </div>
              </button>
            );
          })}
          {availableToCreate.length === 0 && (
            <p className="sm:col-span-2 text-sm t-text-2 py-4 text-center">
              {t('workflowStudio.allTypesConfigured')}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
