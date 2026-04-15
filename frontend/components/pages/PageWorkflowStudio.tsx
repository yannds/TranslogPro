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
import { GitFork, Ticket, Bus, Package, MapPin, AlertCircle, Plus } from 'lucide-react';
import { WorkflowDesigner } from '../workflow/WorkflowDesigner';
import { useAuth } from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../../lib/utils';

// ─── Icônes par défaut pour les types connus ──────────────────────────────────

const ENTITY_ICONS: Record<string, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
  Ticket:  Ticket,
  Trip:    MapPin,
  Parcel:  Package,
  Bus:     Bus,
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
      {entityType}
    </button>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageWorkflowStudio() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const { data: entityTypes, loading, error } = useFetch<string[]>(
    tenantId ? `/api/tenants/${tenantId}/workflow-studio/entity-types` : null,
    [tenantId],
  );

  const types = entityTypes && entityTypes.length > 0 ? entityTypes : [];
  const [activeEntityType, setActiveEntityType] = useState<string | null>(null);

  // Pick first available type once loaded
  const active = activeEntityType ?? types[0] ?? null;

  if (!user) return null;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">

      {/* ── En-tête ── */}
      <header className="flex items-center gap-3 px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/10 dark:bg-blue-500/20">
          <GitFork className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50 leading-none">
            Workflow Studio
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Conception visuelle des processus métier
          </p>
        </div>
      </header>

      {/* ── Onglets sélecteur d'entité ── */}
      <div
        role="tablist"
        aria-label="Type d'entité"
        className="flex items-end gap-1 px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 min-h-[44px]"
      >
        {loading ? (
          <div className="flex gap-2 items-center pb-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-24" />)}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4" aria-hidden />
            Impossible de charger les types d'entités
          </div>
        ) : types.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-slate-500 dark:text-slate-400">
            <Plus className="w-4 h-4" aria-hidden />
            Aucun workflow configuré — créez votre premier workflow depuis les Blueprints
          </div>
        ) : (
          types.map(entityType => (
            <EntityTypeTab
              key={entityType}
              entityType={entityType}
              isActive={entityType === active}
              onSelect={setActiveEntityType}
            />
          ))
        )}
      </div>

      {/* ── Description de l'entité active ── */}
      {active && (
        <div className="flex items-center gap-2 px-6 py-2 bg-slate-100 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
          {(() => {
            const Icon = getEntityIcon(active);
            return <Icon className="w-3.5 h-3.5 text-slate-400" aria-hidden />;
          })()}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Workflow <span className="font-mono font-semibold">{active}</span>
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
          />
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && types.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3 max-w-sm">
            <div className="flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-900/30">
                <GitFork className="w-8 h-8 text-blue-600 dark:text-blue-400" aria-hidden />
              </div>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Aucun workflow configuré</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Installez un Blueprint depuis le Marketplace pour démarrer rapidement,
              ou créez un workflow personnalisé depuis la section Blueprints.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
