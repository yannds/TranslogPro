/**
 * PageWorkflowStudio — Éditeur visuel de workflows TranslogPro
 *
 * Interface principale du Workflow Studio :
 *   - Sélecteur de type d'entité (Ticket, Trip, Parcel, Bus)
 *   - WorkflowDesigner avec canvas React Flow (états + transitions)
 *   - SimulationPanel et BlueprintPanel intégrés dans le designer
 *
 * Données :
 *   - GET  /tenants/:tid/workflow-studio/graph/:entityType → charger un graphe
 *   - PUT  /tenants/:tid/workflow-studio/graph             → sauvegarder
 *   - POST /tenants/:tid/workflow-studio/simulate          → simulation
 *   - GET  /tenants/:tid/workflow-studio/blueprints        → marketplace
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, rôles, focus visible
 * Dark mode : classes Tailwind dark: — automatique via ThemeProvider
 */

import { useState } from 'react';
import { GitFork, Ticket, Bus, Package, MapPin } from 'lucide-react';
import { WorkflowDesigner } from '../workflow/WorkflowDesigner';
import { cn } from '../../lib/utils';

// ─── Tenant context (DEMO jusqu'à l'auth réelle) ──────────────────────────────

const DEMO_TENANT_ID = 'demo-tenant';

// ─── Types d'entités disponibles ─────────────────────────────────────────────

interface EntityTypeOption {
  key:         string;
  label:       string;
  description: string;
  icon:        React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

const ENTITY_TYPES: EntityTypeOption[] = [
  {
    key:         'Ticket',
    label:       'Billet',
    description: 'Cycle de vie des billets (vente → validation → voyage)',
    icon:        Ticket,
  },
  {
    key:         'Trip',
    label:       'Trajet',
    description: 'Statuts de trajet (planifié → en cours → terminé)',
    icon:        MapPin,
  },
  {
    key:         'Parcel',
    label:       'Colis',
    description: 'Suivi de colis (réceptionné → en transit → livré)',
    icon:        Package,
  },
  {
    key:         'Bus',
    label:       'Véhicule',
    description: "État des véhicules (opérationnel → maintenance → hors service)",
    icon:        Bus,
  },
];

// ─── Onglet sélecteur d'entité ────────────────────────────────────────────────

function EntityTypeTab({
  option,
  isActive,
  onSelect,
}: {
  option:   EntityTypeOption;
  isActive: boolean;
  onSelect: (key: string) => void;
}) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`workflow-panel-${option.key}`}
      id={`workflow-tab-${option.key}`}
      onClick={() => onSelect(option.key)}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        isActive
          ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600',
      )}
    >
      <Icon className="w-4 h-4" aria-hidden />
      {option.label}
    </button>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageWorkflowStudio() {
  const [activeEntityType, setActiveEntityType] = useState<string>(ENTITY_TYPES[0].key);

  const activeOption = ENTITY_TYPES.find(e => e.key === activeEntityType) ?? ENTITY_TYPES[0];
  const ActiveIcon   = activeOption.icon;

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
        className="flex items-end gap-1 px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800"
      >
        {ENTITY_TYPES.map(option => (
          <EntityTypeTab
            key={option.key}
            option={option}
            isActive={option.key === activeEntityType}
            onSelect={setActiveEntityType}
          />
        ))}
      </div>

      {/* ── Description de l'entité active ── */}
      <div className="flex items-center gap-2 px-6 py-2 bg-slate-100 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
        <ActiveIcon className="w-3.5 h-3.5 text-slate-400" aria-hidden />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {activeOption.description}
        </p>
      </div>

      {/* ── Canvas WorkflowDesigner ── */}
      <div
        id={`workflow-panel-${activeEntityType}`}
        role="tabpanel"
        aria-labelledby={`workflow-tab-${activeEntityType}`}
        className="flex-1 min-h-0"
      >
        <WorkflowDesigner
          tenantId={DEMO_TENANT_ID}
          entityType={activeEntityType}
        />
      </div>

    </div>
  );
}
