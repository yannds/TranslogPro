/**
 * PageModules — Gestion des modules & extensions du tenant
 *
 * Lit et écrit l'état via l'API (source de vérité : `installed_modules`).
 *   GET   /api/v1/tenants/:tenantId/modules
 *   PATCH /api/v1/tenants/:tenantId/modules/:moduleKey          { isActive }
 *   PATCH /api/v1/tenants/:tenantId/modules/:moduleKey/config   { config }
 *
 * Après un toggle, `refresh()` du AuthContext est appelé pour ré-évaluer la
 * navigation (un module désactivé disparaît du menu).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Puzzle, Check, X, Info, AlertTriangle, Lock, Loader2, Settings } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { apiFetch } from '../../lib/api';
import { cn }     from '../../lib/utils';
import { useI18n, tm } from '../../lib/i18n/useI18n';
import type { TranslationMap } from '../../lib/i18n/types';

// ─── Catalogue statique des modules ──────────────────────────────────────────
//
// Les `id` correspondent aux `moduleKey` backend (UPPERCASE_SNAKE_CASE).
// Le backend stocke l'état d'activation dans `installed_modules`.

type ModuleStatus = 'active' | 'inactive';

interface ModuleDef {
  id:          string;          // == moduleKey backend
  name:        TranslationMap;
  description: TranslationMap;
  category:    TranslationMap;
  icon:        string;
  core:        boolean;         // core = toujours actif, toggle désactivé
  requires?:   string[];        // dépendances (moduleKey)
  tags:        string[];
}

const CAT_CORE         = tm('Cœur', 'Core');
const CAT_OPERATIONS   = tm('Opérations', 'Operations');
const CAT_FINANCE      = tm('Finance', 'Finance');
const CAT_QUALITY      = tm('Qualité', 'Quality');
const CAT_INTELLIGENCE = tm('Intelligence', 'Intelligence');
const CAT_PLATFORM     = tm('Plateforme', 'Platform');

const MODULE_CATALOG: ModuleDef[] = [
  // ── Cœur (seed onboarding) ─────────────────────────────────────────────
  {
    id: 'TICKETING',       name: tm('Billetterie', 'Ticketing'),
    description: tm('Vente, annulation, impression et scan de billets.', 'Sale, cancellation, printing and scanning of tickets.'),
    category: CAT_CORE, icon: '🎫', core: true, tags: ['tickets'],
  },
  {
    id: 'PARCEL',          name: tm('Transport de colis', 'Parcel Transport'),
    description: tm('Enregistrement, suivi et expédition groupée des colis.', 'Registration, tracking and bulk shipment of parcels.'),
    category: CAT_CORE, icon: '📦', core: true, tags: ['parcels', 'logistics'],
  },
  {
    id: 'FLEET',           name: tm('Gestion de flotte', 'Fleet Management'),
    description: tm('Parc de véhicules, plans de sièges et alertes techniques.', 'Vehicle fleet, seat maps and technical alerts.'),
    category: CAT_CORE, icon: '🚌', core: true, tags: ['fleet', 'vehicles'],
  },
  {
    id: 'CASHIER',         name: tm('Caisse & Finance', 'Cashier & Finance'),
    description: tm('Gestion des caisses, sessions, transactions et clôture.', 'Cash register management, sessions, transactions and closing.'),
    category: CAT_CORE, icon: '💰', core: true, tags: ['cashier', 'finance'],
  },
  {
    id: 'TRACKING',        name: tm('Suivi temps réel', 'Live Tracking'),
    description: tm('Géolocalisation flotte, ETA, alertes position.', 'Fleet geolocation, ETA, position alerts.'),
    category: CAT_CORE, icon: '📍', core: true, tags: ['tracking'],
  },
  {
    id: 'NOTIFICATIONS',   name: tm('Notifications', 'Notifications'),
    description: tm('SMS, WhatsApp, push, email aux voyageurs et au personnel.', 'SMS, WhatsApp, push, email to passengers and staff.'),
    category: CAT_CORE, icon: '🔔', core: true, tags: ['notifications'],
  },

  // ── Opérations ────────────────────────────────────────────────────────
  {
    id: 'GARAGE_PRO',      name: tm('Garage Pro', 'Garage Pro'),
    description: tm('Fiches de maintenance préventive, planning garage, alertes.', 'Preventive maintenance sheets, garage planning, alerts.'),
    category: CAT_OPERATIONS, icon: '🔧', core: false, tags: ['maintenance', 'garage'],
  },
  {
    id: 'FLEET_DOCS',      name: tm('Documents flotte', 'Fleet Documents'),
    description: tm('Documents véhicules, consommables, échéances et alertes.', 'Vehicle documents, consumables, deadlines and alerts.'),
    category: CAT_OPERATIONS, icon: '📄', core: false, tags: ['fleet', 'docs'],
  },
  {
    id: 'DRIVER_PROFILE',  name: tm('Profils Chauffeurs', 'Driver Profiles'),
    description: tm('Permis, habilitations, formations, temps de repos.', 'Licenses, certifications, training, rest time.'),
    category: CAT_OPERATIONS, icon: '👨‍✈️', core: false, tags: ['drivers'],
  },
  {
    id: 'CREW_BRIEFING',   name: tm('Briefings Équipage', 'Crew Briefings'),
    description: tm('Planning équipages, briefings pré-départ, check-lists.', 'Crew planning, pre-departure briefings, checklists.'),
    category: CAT_OPERATIONS, icon: '📋', core: false, tags: ['crew'],
  },
  {
    id: 'SCHEDULING_GUARD', name: tm('Scheduling Guard', 'Scheduling Guard'),
    description: tm('Garde-fou planning — détection des conflits et sur-booking.', 'Schedule safeguard — conflict detection and overbooking.'),
    category: CAT_OPERATIONS, icon: '🛡️', core: false, tags: ['scheduling'],
  },

  // ── Finance & Pricing ──────────────────────────────────────────────────
  {
    id: 'YIELD_ENGINE',    name: tm('Yield Management', 'Yield Management'),
    description: tm('Tarifs dynamiques, optimisation du rendement, saisons.', 'Dynamic pricing, yield optimization, seasons.'),
    category: CAT_FINANCE, icon: '📈', core: false,
    requires: ['CASHIER'], tags: ['pricing', 'yield'],
  },
  {
    id: 'PROFITABILITY',   name: tm('Rentabilité & BI', 'Profitability & BI'),
    description: tm('Tableaux de bord avancés, KPIs, rentabilité par ligne.', 'Advanced dashboards, KPIs, profitability per route.'),
    category: CAT_FINANCE, icon: '💹', core: false, tags: ['analytics', 'bi'],
  },

  // ── Qualité & SAV ─────────────────────────────────────────────────────
  {
    id: 'SAV_MODULE',      name: tm('SAV & Réclamations', 'After-Sales & Claims'),
    description: tm('Gestion des réclamations passagers, remboursements et SAV.', 'Passenger claims management, refunds and after-sales.'),
    category: CAT_QUALITY, icon: '🎗️', core: false, tags: ['sav', 'claims'],
  },
  {
    id: 'QHSE',            name: tm('QHSE & Sécurité', 'QHSE & Safety'),
    description: tm("Rapports d'accidents, procédures qualité, suivi incidents.", 'Accident reports, quality procedures, incident tracking.'),
    category: CAT_QUALITY, icon: '⛑️', core: false, tags: ['qhse', 'safety'],
  },

  // ── Intelligence ──────────────────────────────────────────────────────
  {
    id: 'CRM',             name: tm('CRM & Clients', 'CRM & Customers'),
    description: tm('Base clients, fidélisation, campagnes marketing.', 'Customer database, loyalty, marketing campaigns.'),
    category: CAT_INTELLIGENCE, icon: '👥', core: false, tags: ['crm', 'loyalty'],
  },

  // ── Plateforme ────────────────────────────────────────────────────────
  {
    id: 'WORKFLOW_STUDIO', name: tm('Workflow Studio', 'Workflow Studio'),
    description: tm('Éditeur visuel de workflows, marketplace de blueprints, simulation.', 'Visual workflow editor, blueprint marketplace, simulation.'),
    category: CAT_PLATFORM, icon: '⚙️', core: false, tags: ['workflow', 'automation'],
  },
  {
    id: 'WHITE_LABEL',     name: tm('White-label & Thème', 'White-label & Theme'),
    description: tm('Personnalisation de la marque, couleurs, logo et domaine.', 'Brand customization, colors, logo and domain.'),
    category: CAT_PLATFORM, icon: '🎨', core: false, tags: ['branding', 'theme'],
  },
  {
    id: 'ROUTING_ENGINE',  name: tm('Distance routière', 'Road Distance'),
    description: tm(
      "Calcul automatique des distances réelles entre gares via Google Maps ou Mapbox. Remplace l'estimation à vol d'oiseau dans les formulaires de lignes.",
      'Automatic real road-distance calculation between stations via Google Maps or Mapbox. Replaces straight-line estimation in route forms.',
    ),
    category: CAT_PLATFORM, icon: '🗺️', core: false, tags: ['routing', 'maps', 'distance'],
  },
];

// Deduplicate categories by fr key (stable identity)
const CATEGORIES = MODULE_CATALOG.reduce<TranslationMap[]>((acc, m) => {
  if (!acc.some(c => c.fr === m.category.fr)) acc.push(m.category);
  return acc;
}, []);

// ─── DTO API ─────────────────────────────────────────────────────────────────

interface TenantModuleDto {
  moduleKey: string;
  isActive:  boolean;
  config:    Record<string, unknown>;
}

interface TenantModulesResponse {
  modules:       TenantModuleDto[];
  /** moduleKey[] verrouillés par la plateforme — toggle grisé, badge "Bientôt disponible" */
  platformGated: string[];
}

function getStatus(m: ModuleDef, active: Set<string>): ModuleStatus {
  if (m.core) return 'active';
  return active.has(m.id) ? 'active' : 'inactive';
}

// ─── YieldConfigDialog ───────────────────────────────────────────────────────

const YIELD_FIELDS: { key: string; labelKey: string; min: number; max: number; step: number }[] = [
  { key: 'goldenDayMultiplier', labelKey: 'modules.yieldGoldenDayMultiplier', min: 0,   max: 2,  step: 0.01 },
  { key: 'lowFillThreshold',    labelKey: 'modules.yieldLowFillThreshold',    min: 0,   max: 1,  step: 0.01 },
  { key: 'lowFillDiscount',     labelKey: 'modules.yieldLowFillDiscount',     min: 0,   max: 1,  step: 0.01 },
  { key: 'highFillThreshold',   labelKey: 'modules.yieldHighFillThreshold',   min: 0,   max: 1,  step: 0.01 },
  { key: 'highFillPremium',     labelKey: 'modules.yieldHighFillPremium',     min: 0,   max: 1,  step: 0.01 },
  { key: 'priceFloorRate',      labelKey: 'modules.yieldPriceFloorRate',      min: 0.1, max: 1,  step: 0.01 },
  { key: 'priceCeilingRate',    labelKey: 'modules.yieldPriceCeilingRate',    min: 1,   max: 5,  step: 0.01 },
];

function YieldConfigDialog({
  tenantId,
  initialConfig,
  onClose,
  onSaved,
}: {
  tenantId:      string;
  initialConfig: Record<string, unknown>;
  onClose:       () => void;
  onSaved:       (config: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      YIELD_FIELDS.map(f => [f.key, initialConfig[f.key] != null ? String(initialConfig[f.key]) : '']),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleSave() {
    setSaving(true);
    setError('');
    const patch: Record<string, number | null> = {};
    for (const f of YIELD_FIELDS) {
      const raw = values[f.key].trim();
      if (raw === '') { patch[f.key] = null; continue; }
      const num = parseFloat(raw);
      if (isNaN(num) || num < f.min || num > f.max) {
        setError(`${t(f.labelKey)}: valeur invalide (${f.min}–${f.max})`);
        setSaving(false);
        return;
      }
      patch[f.key] = num;
    }
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== null),
    ) as Record<string, unknown>;

    try {
      await apiFetch(`/api/v1/tenants/${tenantId}/modules/YIELD_ENGINE/config`, {
        method: 'PATCH',
        body: { config: cleanPatch },
      });
      onSaved(cleanPatch);
    } catch {
      setError(t('modules.configFailed'));
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setValues(Object.fromEntries(YIELD_FIELDS.map(f => [f.key, ''])));
  }

  const inputClass = 'w-full rounded-lg border t-border t-input px-3 py-1.5 text-sm t-text bg-transparent focus:outline-none focus:ring-2 focus:ring-teal-500';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('modules.yieldConfigTitle')}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="t-card-bordered rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-lg t-text">{t('modules.yieldConfigTitle')}</h2>
              <p className="text-xs t-text-2 mt-0.5">{t('modules.yieldConfigDesc')}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Fermer"
              className="p-1.5 rounded-lg t-nav-hover t-text-2"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {YIELD_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium t-text-2 mb-1">{t(f.labelKey)}</label>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={values[f.key]}
                  onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={`${f.min}–${f.max}`}
                  className={inputClass}
                />
              </div>
            ))}
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleReset}
              className="text-xs t-text-2 underline underline-offset-2 hover:t-text transition-colors"
            >
              {t('modules.yieldReset')}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm t-surface t-text-2 t-nav-hover border t-border"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-60 flex items-center gap-1.5"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {saving ? t('modules.yieldSaving') : t('modules.yieldSave')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ModuleCard ───────────────────────────────────────────────────────────────

function ModuleCard({
  mod,
  status,
  onToggle,
  onConfigure,
  depsMissing,
  busy,
  platformLocked,
}: {
  mod:            ModuleDef;
  status:         ModuleStatus;
  onToggle:       (id: string) => void;
  onConfigure?:   (id: string) => void;
  depsMissing:    boolean;
  busy:           boolean;
  platformLocked: boolean;
}) {
  const { t } = useI18n();
  const isActive   = status === 'active';
  const isCore     = mod.core;
  const isDisabled = isCore || busy || platformLocked || (depsMissing && !isActive);
  const name = t(mod.name);

  return (
    <div className={cn(
      't-card-bordered rounded-2xl p-5 flex flex-col gap-3 transition-colors',
      isActive  ? 'ring-2 ring-teal-500/30' : '',
      isDisabled && !isCore && !busy ? 'opacity-60' : '',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" role="img" aria-label={name}>{mod.icon}</span>
          <div>
            <p className="font-semibold text-sm t-text leading-tight">{name}</p>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {isCore && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
                  <Lock size={8} /> {t('modules.coreBadge')}
                </span>
              )}
              {isActive && !isCore && !platformLocked && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                  <Check size={8} /> {t('modules.activeBadge')}
                </span>
              )}
              {platformLocked && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                  <Lock size={8} /> {t('modules.comingSoon')}
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
            aria-label={isActive ? `${t('modules.disable')} ${name}` : `${t('modules.enable')} ${name}`}
            title={depsMissing && !isActive ? `${t('modules.requires')} : ${mod.requires?.join(', ')}` : undefined}
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
      <p className="text-xs t-text-2 leading-relaxed">{t(mod.description)}</p>

      {/* Deps warning */}
      {depsMissing && !isActive && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2.5 py-1.5">
          <AlertTriangle size={11} className="shrink-0" />
          {t('modules.requires')} : {mod.requires?.join(', ')}
        </div>
      )}

      {/* Configure button (YIELD_ENGINE only, when active) */}
      {onConfigure && isActive && (
        <button
          type="button"
          onClick={() => onConfigure(mod.id)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg t-surface border t-border t-text-2 t-nav-hover w-full justify-center"
          aria-label={`${t('modules.configure')} ${name}`}
        >
          <Settings size={12} />
          {t('modules.configure')}
        </button>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mt-auto pt-1">
        {mod.tags.map(tag => (
          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full t-surface t-text-3">{tag}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageModules() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId;

  const [active,        setActive]        = useState<Set<string>>(new Set());
  const [moduleConfigs, setModuleConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [platformGated, setPlatformGated] = useState<Set<string>>(new Set());
  const [loading,       setLoading]       = useState(true);
  const [busyKey,       setBusyKey]       = useState<string | null>(null);
  const [filterCat,     setFilterCat]     = useState('');
  const [showActive,    setShowActive]    = useState<'all' | 'active' | 'inactive'>('all');
  const [toast,         setToast]         = useState<{ msg: string; ok: boolean } | null>(null);
  const [yieldDialog,   setYieldDialog]   = useState(false);

  // ── Chargement initial depuis l'API ──
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    apiFetch<TenantModulesResponse>(`/api/v1/tenants/${tenantId}/modules`)
      .then(res => {
        if (cancelled) return;
        setActive(new Set(res.modules.filter(r => r.isActive).map(r => r.moduleKey)));
        setPlatformGated(new Set(res.platformGated ?? []));
        const configs: Record<string, Record<string, unknown>> = {};
        for (const m of res.modules) configs[m.moduleKey] = m.config ?? {};
        setModuleConfigs(configs);
      })
      .catch(() => {
        if (cancelled) return;
        setToast({ msg: t('modules.loadFailed'), ok: false });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleToggle = useCallback(async (id: string) => {
    if (!tenantId || busyKey) return;
    const mod = MODULE_CATALOG.find(m => m.id === id);
    if (!mod) return;

    const willActivate = !active.has(id);
    const name = t(mod.name);

    // Vérifier qu'aucun module actif ne dépend de celui-ci avant de désactiver
    if (!willActivate) {
      const blockers = MODULE_CATALOG.filter(m => active.has(m.id) && m.requires?.includes(id));
      if (blockers.length > 0) {
        setToast({ msg: `${t('modules.disableFirst')} : ${blockers.map(b => t(b.name)).join(', ')}`, ok: false });
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
      setToast({ msg: `${name} ${willActivate ? t('modules.enabled') : t('modules.disabled')}`, ok: willActivate });

      // Recharge le user pour mettre à jour enabledModules → nav filtrée
      refresh().catch(() => { /* silencieux */ });
    } catch {
      setToast({ msg: `${t('modules.toggleFail')} ${name}`, ok: false });
    } finally {
      setBusyKey(null);
    }
  }, [tenantId, busyKey, active, refresh, t]);

  const handleConfigSaved = useCallback((config: Record<string, unknown>) => {
    setModuleConfigs(prev => ({ ...prev, YIELD_ENGINE: config }));
    setYieldDialog(false);
    setToast({ msg: t('modules.configSaved'), ok: true });
  }, [t]);

  // Filtered list
  const visible = MODULE_CATALOG.filter(m => {
    if (filterCat && m.category.fr !== filterCat) return false;
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
            <h1 className="text-2xl font-bold t-text">{t('modules.pageTitle')}</h1>
            <p className="t-text-2 text-sm mt-0.5">
              {activeCount} {t('modules.filterActive').toLowerCase()} · {inactiveCount} {t('modules.filterInactive').toLowerCase()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs t-text-3">
          <Info size={13} />
          {t('modules.coreNotice')}
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
          >{t('modules.filterAll')}</button>
          {CATEGORIES.map(cat => (
            <button
              key={cat.fr}
              onClick={() => setFilterCat(cat.fr === filterCat ? '' : cat.fr)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                filterCat === cat.fr ? 'bg-teal-500 text-white' : 't-surface t-text-2 t-nav-hover',
              )}
            >{t(cat)}</button>
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
              {v === 'all' ? t('modules.filterAll') : v === 'active' ? t('modules.filterActive') : t('modules.filterInactive')}
            </button>
          ))}
        </div>
      </div>

      {/* Grille */}
      {loading ? (
        <div className="py-16 flex items-center justify-center gap-2 t-text-2 text-sm">
          <Loader2 size={16} className="animate-spin" />
          {t('modules.loading')}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center t-text-2 text-sm">{t('modules.noMatch')}</div>
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
                onConfigure={mod.id === 'YIELD_ENGINE' ? () => setYieldDialog(true) : undefined}
                depsMissing={depsMissing}
                busy={busyKey === mod.id}
                platformLocked={platformGated.has(mod.id)}
              />
            );
          })}
        </div>
      )}

      {/* Yield config dialog */}
      {yieldDialog && tenantId && (
        <YieldConfigDialog
          tenantId={tenantId}
          initialConfig={moduleConfigs['YIELD_ENGINE'] ?? {}}
          onClose={() => setYieldDialog(false)}
          onSaved={handleConfigSaved}
        />
      )}
    </div>
  );
}
