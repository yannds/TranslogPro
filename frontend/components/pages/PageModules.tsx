/**
 * PageModules — Gestion des modules & extensions du tenant
 *
 * Lit et écrit l'état via l'API (source de vérité : `installed_modules`).
 *   GET   /api/v1/tenants/:tenantId/modules
 *   PATCH /api/v1/tenants/:tenantId/modules/:moduleKey   { isActive }
 *
 * Après un toggle, `refresh()` du AuthContext est appelé pour ré-évaluer la
 * navigation (un module désactivé disparaît du menu).
 */

import { useState, useEffect, useCallback } from 'react';
import { Puzzle, Check, X, Info, AlertTriangle, Lock, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { apiFetch } from '../../lib/api';
import { cn }     from '../../lib/utils';

// ─── Catalogue statique des modules ──────────────────────────────────────────
//
// Les `id` correspondent aux `moduleKey` backend (UPPERCASE_SNAKE_CASE).
// Le backend stocke l'état d'activation dans `installed_modules`.

type ModuleStatus = 'active' | 'inactive';

interface ModuleDef {
  id:          string;          // == moduleKey backend
  name:        string;
  description: string;
  category:    string;
  icon:        string;
  core:        boolean;         // core = toujours actif, toggle désactivé
  requires?:   string[];        // dépendances (moduleKey)
  tags:        string[];
}

const MODULE_CATALOG: ModuleDef[] = [
  // ── Cœur (seed onboarding) ─────────────────────────────────────────────
  {
    id: 'TICKETING',       name: 'Billetterie',
    description: 'Vente, annulation, impression et scan de billets.',
    category: 'Cœur', icon: '🎫', core: true, tags: ['tickets'],
  },
  {
    id: 'PARCEL',          name: 'Transport de colis',
    description: 'Enregistrement, suivi et expédition groupée des colis.',
    category: 'Cœur', icon: '📦', core: true, tags: ['parcels', 'logistics'],
  },
  {
    id: 'FLEET',           name: 'Gestion de flotte',
    description: 'Parc de véhicules, plans de sièges et alertes techniques.',
    category: 'Cœur', icon: '🚌', core: true, tags: ['fleet', 'vehicles'],
  },
  {
    id: 'CASHIER',         name: 'Caisse & Finance',
    description: 'Gestion des caisses, sessions, transactions et clôture.',
    category: 'Cœur', icon: '💰', core: true, tags: ['cashier', 'finance'],
  },
  {
    id: 'TRACKING',        name: 'Suivi temps réel',
    description: 'Géolocalisation flotte, ETA, alertes position.',
    category: 'Cœur', icon: '📍', core: true, tags: ['tracking'],
  },
  {
    id: 'NOTIFICATIONS',   name: 'Notifications',
    description: 'SMS, WhatsApp, push, email aux voyageurs et au personnel.',
    category: 'Cœur', icon: '🔔', core: true, tags: ['notifications'],
  },

  // ── Opérations ────────────────────────────────────────────────────────
  {
    id: 'GARAGE_PRO',      name: 'Garage Pro',
    description: 'Fiches de maintenance préventive, planning garage, alertes.',
    category: 'Opérations', icon: '🔧', core: false, tags: ['maintenance', 'garage'],
  },
  {
    id: 'FLEET_DOCS',      name: 'Documents flotte',
    description: 'Documents véhicules, consommables, échéances et alertes.',
    category: 'Opérations', icon: '📄', core: false, tags: ['fleet', 'docs'],
  },
  {
    id: 'DRIVER_PROFILE',  name: 'Profils Chauffeurs',
    description: 'Permis, habilitations, formations, temps de repos.',
    category: 'Opérations', icon: '👨‍✈️', core: false, tags: ['drivers'],
  },
  {
    id: 'CREW_BRIEFING',   name: 'Briefings Équipage',
    description: 'Planning équipages, briefings pré-départ, check-lists.',
    category: 'Opérations', icon: '📋', core: false, tags: ['crew'],
  },
  {
    id: 'SCHEDULING_GUARD', name: 'Scheduling Guard',
    description: 'Garde-fou planning — détection des conflits et sur-booking.',
    category: 'Opérations', icon: '🛡️', core: false, tags: ['scheduling'],
  },

  // ── Finance & Pricing ──────────────────────────────────────────────────
  {
    id: 'YIELD_ENGINE',    name: 'Yield Management',
    description: 'Tarifs dynamiques, optimisation du rendement, saisons.',
    category: 'Finance', icon: '📈', core: false,
    requires: ['CASHIER'], tags: ['pricing', 'yield'],
  },
  {
    id: 'PROFITABILITY',   name: 'Rentabilité & BI',
    description: 'Tableaux de bord avancés, KPIs, rentabilité par ligne.',
    category: 'Finance', icon: '💹', core: false, tags: ['analytics', 'bi'],
  },

  // ── Qualité & SAV ─────────────────────────────────────────────────────
  {
    id: 'SAV_MODULE',      name: 'SAV & Réclamations',
    description: 'Gestion des réclamations passagers, remboursements et SAV.',
    category: 'Qualité', icon: '🎗️', core: false, tags: ['sav', 'claims'],
  },
  {
    id: 'QHSE',            name: 'QHSE & Sécurité',
    description: "Rapports d'accidents, procédures qualité, suivi incidents.",
    category: 'Qualité', icon: '⛑️', core: false, tags: ['qhse', 'safety'],
  },

  // ── Intelligence ──────────────────────────────────────────────────────
  {
    id: 'CRM',             name: 'CRM & Clients',
    description: 'Base clients, fidélisation, campagnes marketing.',
    category: 'Intelligence', icon: '👥', core: false, tags: ['crm', 'loyalty'],
  },

  // ── Plateforme ────────────────────────────────────────────────────────
  {
    id: 'WORKFLOW_STUDIO', name: 'Workflow Studio',
    description: 'Éditeur visuel de workflows, marketplace de blueprints, simulation.',
    category: 'Plateforme', icon: '⚙️', core: false, tags: ['workflow', 'automation'],
  },
  {
    id: 'WHITE_LABEL',     name: 'White-label & Thème',
    description: 'Personnalisation de la marque, couleurs, logo et domaine.',
    category: 'Plateforme', icon: '🎨', core: false, tags: ['branding', 'theme'],
  },
];

const CATEGORIES = [...new Set(MODULE_CATALOG.map(m => m.category))];

// ─── DTO API ─────────────────────────────────────────────────────────────────

interface TenantModuleDto {
  moduleKey: string;
  isActive:  boolean;
  config:    Record<string, unknown>;
}

function getStatus(m: ModuleDef, active: Set<string>): ModuleStatus {
  if (m.core) return 'active';
  return active.has(m.id) ? 'active' : 'inactive';
}

// ─── ModuleCard ───────────────────────────────────────────────────────────────

function ModuleCard({
  mod,
  status,
  onToggle,
  depsMissing,
  busy,
}: {
  mod:         ModuleDef;
  status:      ModuleStatus;
  onToggle:    (id: string) => void;
  depsMissing: boolean;
  busy:        boolean;
}) {
  const isActive   = status === 'active';
  const isCore     = mod.core;
  const isDisabled = isCore || busy || (depsMissing && !isActive);

  return (
    <div className={cn(
      't-card-bordered rounded-2xl p-5 flex flex-col gap-3 transition-colors',
      isActive  ? 'ring-2 ring-teal-500/30' : '',
      isDisabled && !isCore && !busy ? 'opacity-60' : '',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" role="img" aria-label={mod.name}>{mod.icon}</span>
          <div>
            <p className="font-semibold text-sm t-text leading-tight">{mod.name}</p>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {isCore && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                  <Lock size={8} /> CŒUR
                </span>
              )}
              {isActive && !isCore && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                  <Check size={8} /> ACTIF
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Toggle */}
        {!isCore && (
          <button
            type="button"
            onClick={() => !isDisabled && onToggle(mod.id)}
            disabled={isDisabled}
            aria-pressed={isActive}
            aria-label={isActive ? `Désactiver ${mod.name}` : `Activer ${mod.name}`}
            title={depsMissing && !isActive ? `Requiert : ${mod.requires?.join(', ')}` : undefined}
            className={cn(
              'relative shrink-0 w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
              isActive ? 'bg-teal-500' : 'bg-gray-300 dark:bg-slate-600',
              isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
            )}
          >
            <span className={cn(
              'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
              isActive ? 'translate-x-5' : 'translate-x-0',
            )} />
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={12} className="animate-spin text-white" />
              </span>
            )}
          </button>
        )}
      </div>

      {/* Description */}
      <p className="text-xs t-text-2 leading-relaxed">{mod.description}</p>

      {/* Deps warning */}
      {depsMissing && !isActive && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2.5 py-1.5">
          <AlertTriangle size={11} className="shrink-0" />
          Requiert : {mod.requires?.join(', ')}
        </div>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mt-auto pt-1">
        {mod.tags.map(t => (
          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full t-surface t-text-3">{t}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageModules() {
  const { user, refresh } = useAuth();
  const tenantId = user?.tenantId;

  const [active,     setActive]     = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);
  const [busyKey,    setBusyKey]    = useState<string | null>(null);
  const [filterCat,  setFilterCat]  = useState('');
  const [showActive, setShowActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Chargement initial depuis l'API ──
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    apiFetch<TenantModuleDto[]>(`/api/v1/tenants/${tenantId}/modules`)
      .then(rows => {
        if (cancelled) return;
        setActive(new Set(rows.filter(r => r.isActive).map(r => r.moduleKey)));
      })
      .catch(() => {
        if (cancelled) return;
        setToast({ msg: 'Impossible de charger les modules', ok: false });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleToggle = useCallback(async (id: string) => {
    if (!tenantId || busyKey) return;
    const mod = MODULE_CATALOG.find(m => m.id === id);
    if (!mod) return;

    const willActivate = !active.has(id);

    // Vérifier qu'aucun module actif ne dépend de celui-ci avant de désactiver
    if (!willActivate) {
      const blockers = MODULE_CATALOG.filter(m => active.has(m.id) && m.requires?.includes(id));
      if (blockers.length > 0) {
        setToast({ msg: `Désactivez d'abord : ${blockers.map(b => b.name).join(', ')}`, ok: false });
        return;
      }
    }

    setBusyKey(id);
    try {
      await apiFetch<TenantModuleDto>(`/api/v1/tenants/${tenantId}/modules/${id}`, {
        method: 'PATCH',
        body:   { isActive: willActivate },
      });

      setActive(prev => {
        const next = new Set(prev);
        if (willActivate) next.add(id); else next.delete(id);
        return next;
      });
      setToast({ msg: `${mod.name} ${willActivate ? 'activé' : 'désactivé'}`, ok: willActivate });

      // Recharge le user pour mettre à jour enabledModules → nav filtrée
      refresh().catch(() => { /* silencieux */ });
    } catch {
      setToast({ msg: `Échec du changement sur ${mod.name}`, ok: false });
    } finally {
      setBusyKey(null);
    }
  }, [tenantId, busyKey, active, refresh]);

  // Filtered list
  const visible = MODULE_CATALOG.filter(m => {
    if (filterCat && m.category !== filterCat) return false;
    const status = getStatus(m, active);
    if (showActive === 'active'   && status !== 'active')   return false;
    if (showActive === 'inactive' && status === 'active')   return false;
    return true;
  });

  const activeCount   = MODULE_CATALOG.filter(m => getStatus(m, active) === 'active').length;
  const inactiveCount = MODULE_CATALOG.length - activeCount;

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
            <Puzzle className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">Modules & Extensions</h1>
            <p className="t-text-2 text-sm mt-0.5">
              {activeCount} actif{activeCount !== 1 ? 's' : ''} · {inactiveCount} inactif{inactiveCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs t-text-3">
          <Info size={13} />
          Les modules cœur ne peuvent pas être désactivés
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={cn(
          'flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all',
          toast.ok
            ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
            : 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
        )}>
          {toast.ok ? <Check size={14} /> : <X size={14} />}
          {toast.msg}
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilterCat('')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              !filterCat ? 'bg-teal-500 text-white' : 't-surface t-text-2 t-nav-hover',
            )}
          >Tous</button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat === filterCat ? '' : cat)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                filterCat === cat ? 'bg-teal-500 text-white' : 't-surface t-text-2 t-nav-hover',
              )}
            >{cat}</button>
          ))}
        </div>

        <div className="flex gap-1 ml-auto">
          {(['all', 'active', 'inactive'] as const).map(v => (
            <button
              key={v}
              onClick={() => setShowActive(v)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                showActive === v ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900' : 't-surface t-text-2 t-nav-hover',
              )}
            >
              {v === 'all' ? 'Tous' : v === 'active' ? 'Actifs' : 'Inactifs'}
            </button>
          ))}
        </div>
      </div>

      {/* Grille */}
      {loading ? (
        <div className="py-16 flex items-center justify-center gap-2 t-text-2 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Chargement des modules…
        </div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center t-text-2 text-sm">Aucun module ne correspond aux filtres.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visible.map(mod => {
            const depsMissing = (mod.requires ?? []).some(dep => !active.has(dep));
            return (
              <ModuleCard
                key={mod.id}
                mod={mod}
                status={getStatus(mod, active)}
                onToggle={handleToggle}
                depsMissing={depsMissing}
                busy={busyKey === mod.id}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
