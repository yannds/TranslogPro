/**
 * DriverSpace — Espace Chauffeur (application mobile)
 *
 * Interface dédiée au chauffeur : trajet en cours, programme du jour,
 * checklists pré-départ et rapport d'incidents.
 *
 * Structure :
 *   Header      → nom chauffeur + statut + bouton SOS
 *   TripBanner  → trajet en cours avec barre de progression kilométrique
 *   Tabs        → Mes Trajets | Checklists | Incidents
 *
 *   [Mes Trajets]
 *     TripCard  → carte trajet avec heure, destination, statut, passagers
 *
 *   [Checklists]
 *     ChecklistGroup → groupe de points de vérification (véhicule / sécurité / documents)
 *
 *   [Incidents]
 *     IncidentForm → signalement : type, description, coordonnées GPS
 */

import { useState } from 'react';
import { cn } from '../../lib/utils';
import { ROLE_PERMISSIONS } from '../../lib/hooks/useNavigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type DriverTab = 'trajets' | 'checklists' | 'incidents';

/** Permissions pertinentes pour cet écran */
const P_TRIP_READ_OWN      = 'data.trip.read.own';
const P_TRIP_CHECK_OWN     = 'data.trip.check.own';
const P_TRIP_REPORT_OWN    = 'data.trip.report.own';
const P_MAINTENANCE_UPDATE = 'data.maintenance.update.own';

interface DriverTabDef {
  id:    DriverTab;
  label: string;
  icon:  string;
  anyOf: string[];
}

const ALL_DRIVER_TABS: DriverTabDef[] = [
  { id: 'trajets',    label: 'Mes Trajets',  icon: '🗺️', anyOf: [P_TRIP_READ_OWN] },
  { id: 'checklists', label: 'Checklists',   icon: '✅', anyOf: [P_TRIP_CHECK_OWN] },
  { id: 'incidents',  label: 'Incidents',    icon: '⚠️', anyOf: [P_TRIP_REPORT_OWN, P_MAINTENANCE_UPDATE] },
];

function filterDriverTabs(permissions: string[]): DriverTabDef[] {
  const perms = new Set(permissions);
  return ALL_DRIVER_TABS.filter(t => t.anyOf.some(p => perms.has(p)));
}

type DemoRoleKeyD = keyof typeof ROLE_PERMISSIONS;
const DEMO_ROLES_D: DemoRoleKeyD[] = ['DRIVER', 'SUPERVISOR'];

type TripDriverStatus = 'EN_COURS' | 'PREVU' | 'TERMINE';

interface DriverTrip {
  id:           string;
  heureDepart:  string;
  heureArrivee: string;
  depart:       string;
  arrivee:      string;
  passagers:    number;
  capacite:     number;
  statut:       TripDriverStatus;
  distanceKm:   number;
  parcouru:     number;    // km parcourus
}

interface CheckItem {
  id:      string;
  label:   string;
  checked: boolean;
}

interface CheckGroup {
  id:    string;
  title: string;
  icon:  string;
  items: CheckItem[];
}

// ─── Données de démo ─────────────────────────────────────────────────────────

const DRIVER_TRIPS: DriverTrip[] = [
  {
    id: 'tr1', heureDepart: '07:00', heureArrivee: '12:30',
    depart: 'Dakar', arrivee: 'Saint-Louis',
    passagers: 38, capacite: 50, statut: 'TERMINE',
    distanceKm: 450, parcouru: 450,
  },
  {
    id: 'tr2', heureDepart: '14:00', heureArrivee: '16:30',
    depart: 'Saint-Louis', arrivee: 'Louga',
    passagers: 31, capacite: 50, statut: 'EN_COURS',
    distanceKm: 130, parcouru: 74,
  },
  {
    id: 'tr3', heureDepart: '18:00', heureArrivee: '23:45',
    depart: 'Louga', arrivee: 'Dakar',
    passagers: 0, capacite: 50, statut: 'PREVU',
    distanceKm: 200, parcouru: 0,
  },
];

const INITIAL_CHECKLISTS: CheckGroup[] = [
  {
    id: 'vehicule', title: 'État du véhicule', icon: '🚌',
    items: [
      { id: 'v1', label: 'Niveau carburant vérifié', checked: true },
      { id: 'v2', label: 'Pression des pneus OK',    checked: true },
      { id: 'v3', label: 'Freins testés',            checked: true },
      { id: 'v4', label: 'Éclairages fonctionnels',  checked: false },
      { id: 'v5', label: 'Rétroviseurs ajustés',     checked: false },
      { id: 'v6', label: 'AdBlue niveau suffisant',  checked: true },
    ],
  },
  {
    id: 'securite', title: 'Sécurité passagers', icon: '🦺',
    items: [
      { id: 's1', label: 'Ceintures de sécurité vérifiées',    checked: true },
      { id: 's2', label: 'Issues de secours dégagées',         checked: true },
      { id: 's3', label: 'Extincteur à bord et accessible',    checked: false },
      { id: 's4', label: 'Trousse de premiers secours OK',     checked: true },
      { id: 's5', label: 'Bagages correctement arrimés',       checked: false },
    ],
  },
  {
    id: 'documents', title: 'Documents et autorisations', icon: '📄',
    items: [
      { id: 'd1', label: 'Permis de conduire valide',     checked: true },
      { id: 'd2', label: 'Carte grise du véhicule',       checked: true },
      { id: 'd3', label: 'Assurance en cours de validité', checked: true },
      { id: 'd4', label: 'Manifeste passagers imprimé',   checked: true },
    ],
  },
];

// ─── Trip status config ───────────────────────────────────────────────────────

const TRIP_STATUS: Record<TripDriverStatus, { cls: string; label: string }> = {
  EN_COURS: { cls: 'bg-teal-900/60 text-teal-300 border-teal-700',    label: 'En cours' },
  PREVU:    { cls: 'bg-sky-900/60 text-sky-300 border-sky-700',       label: 'Prévu' },
  TERMINE:  { cls: 'bg-slate-800 text-slate-500 border-slate-700',    label: 'Terminé' },
};

// ─── Onglet Trajets ───────────────────────────────────────────────────────────

function TabTrajets() {
  return (
    <div className="p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Programme du jour — 14 avril 2026</p>
      {DRIVER_TRIPS.map(trip => {
        const cfg      = TRIP_STATUS[trip.statut];
        const progress = trip.distanceKm > 0 ? (trip.parcouru / trip.distanceKm) * 100 : 0;

        return (
          <div
            key={trip.id}
            className={cn(
              'rounded-2xl border p-4 space-y-3',
              trip.statut === 'EN_COURS'
                ? 'bg-teal-950 border-teal-800'
                : trip.statut === 'TERMINE'
                  ? 'bg-slate-900 border-slate-800 opacity-60'
                  : 'bg-slate-900 border-slate-800',
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg font-black text-white tabular-nums">{trip.heureDepart}</span>
                  <span className="text-slate-500">→</span>
                  <span className="text-lg font-black text-white tabular-nums">{trip.heureArrivee}</span>
                </div>
                <p className="text-base font-bold text-white">
                  {trip.depart} → {trip.arrivee}
                </p>
              </div>
              <span className={cn('text-xs font-bold px-2.5 py-1 rounded-lg border uppercase', cfg.cls)}>
                {cfg.label}
              </span>
            </div>

            {/* Progress (uniquement si en cours) */}
            {trip.statut === 'EN_COURS' && (
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{trip.parcouru} km parcourus</span>
                  <span>{trip.distanceKm - trip.parcouru} km restants</span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-500 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Footer stats */}
            <div className="flex items-center gap-4 text-sm">
              <span className="text-slate-400">
                👥 {trip.statut === 'PREVU' ? '-' : trip.passagers}/{trip.capacite} passagers
              </span>
              <span className="text-slate-400">
                📏 {trip.distanceKm} km
              </span>
            </div>

            {/* Actions */}
            {trip.statut === 'EN_COURS' && (
              <div className="flex gap-2">
                <button className="flex-1 py-2 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700">
                  Signaler un arrêt
                </button>
                <button className="flex-1 py-2 bg-slate-700 text-white rounded-xl text-sm font-semibold hover:bg-slate-600">
                  Navigation
                </button>
              </div>
            )}
            {trip.statut === 'PREVU' && (
              <button className="w-full py-2 border border-teal-700 text-teal-300 rounded-xl text-sm font-semibold hover:bg-teal-900/40">
                Voir le manifeste
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Onglet Checklists ────────────────────────────────────────────────────────

function TabChecklists() {
  const [groups, setGroups] = useState(INITIAL_CHECKLISTS);

  function toggleItem(groupId: string, itemId: string) {
    setGroups(prev => prev.map(g =>
      g.id === groupId
        ? { ...g, items: g.items.map(i => i.id === itemId ? { ...i, checked: !i.checked } : i) }
        : g,
    ));
  }

  const totalItems   = groups.flatMap(g => g.items).length;
  const checkedItems = groups.flatMap(g => g.items).filter(i => i.checked).length;
  const allDone      = checkedItems === totalItems;

  return (
    <div className="p-4 space-y-4">
      {/* Progress */}
      <div className={cn(
        'rounded-xl border p-4',
        allDone ? 'bg-emerald-900/40 border-emerald-700' : 'bg-slate-900 border-slate-800',
      )}>
        <div className="flex justify-between text-sm mb-2">
          <span className={allDone ? 'text-emerald-300 font-semibold' : 'text-slate-400'}>
            {allDone ? 'Checklist complète !' : 'Checklist pré-départ'}
          </span>
          <span className={allDone ? 'text-emerald-300 font-bold' : 'text-white font-bold'}>
            {checkedItems}/{totalItems}
          </span>
        </div>
        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', allDone ? 'bg-emerald-500' : 'bg-teal-500')}
            style={{ width: `${(checkedItems / totalItems) * 100}%` }}
          />
        </div>
      </div>

      {/* Groups */}
      {groups.map(group => {
        const groupDone = group.items.every(i => i.checked);
        return (
          <div key={group.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className={cn(
              'flex items-center justify-between px-4 py-3 border-b border-slate-800',
              groupDone && 'bg-emerald-900/20',
            )}>
              <div className="flex items-center gap-2">
                <span>{group.icon}</span>
                <span className="font-semibold text-white text-sm">{group.title}</span>
              </div>
              <span className="text-xs text-slate-400">
                {group.items.filter(i => i.checked).length}/{group.items.length}
              </span>
            </div>
            <div className="divide-y divide-slate-800/50">
              {group.items.map(item => (
                <button
                  key={item.id}
                  onClick={() => toggleItem(group.id, item.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors text-left"
                >
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all',
                    item.checked
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-slate-600 bg-transparent',
                  )}>
                    {item.checked && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className={cn(
                    'text-sm',
                    item.checked ? 'text-slate-400 line-through' : 'text-white',
                  )}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Onglet Incidents ─────────────────────────────────────────────────────────

function TabIncidents() {
  const [form, setForm] = useState({
    type: 'PANNE_MECANIQUE', description: '', localisation: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [incidentId] = useState(() => `INC-${Date.now().toString(36).toUpperCase()}`);

  const TYPES = [
    { id: 'PANNE_MECANIQUE',   label: 'Panne mécanique',    icon: '🔧' },
    { id: 'ACCIDENT',          label: 'Accident',           icon: '⚠️' },
    { id: 'URGENCE_MEDICALE',  label: 'Urgence médicale',   icon: '🏥' },
    { id: 'INCIDENT_SECURITE', label: 'Incident sécurité',  icon: '🚨' },
    { id: 'RETARD_ROUTE',      label: 'Retard / Route',     icon: '🛣️' },
    { id: 'AUTRE',             label: 'Autre',              icon: '📋' },
  ];

  if (submitted) {
    return (
      <div className="p-4 flex flex-col items-center gap-4 py-10">
        <div className="w-14 h-14 bg-amber-500 rounded-full flex items-center justify-center text-2xl">📤</div>
        <div className="text-center">
          <p className="text-xl font-bold text-white">Incident signalé</p>
          <p className="text-sm text-slate-400 mt-1">Le dispatcher et la direction ont été notifiés.</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 w-full">
          <p className="text-xs text-slate-400 uppercase tracking-widest text-center mb-1">Référence incident</p>
          <p className="text-2xl font-mono font-black text-amber-300 text-center">{incidentId}</p>
        </div>
        <button
          onClick={() => { setSubmitted(false); setForm({ type: 'PANNE_MECANIQUE', description: '', localisation: '' }); }}
          className="py-2.5 px-8 bg-slate-700 text-white rounded-xl font-semibold text-sm"
        >
          Signaler un autre incident
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Type */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Type d'incident</p>
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => setForm(f => ({ ...f, type: t.id }))}
              className={cn(
                'flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-semibold transition-all',
                form.type === t.id
                  ? 'border-amber-500 bg-amber-900/40 text-amber-300'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600',
              )}
            >
              <span className="text-xl">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Description
        </label>
        <textarea
          className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
          rows={4}
          placeholder="Décrivez l'incident en détail..."
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </div>

      {/* Localisation */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Localisation
        </label>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            placeholder="Ex: RN1 km 180, Louga"
            value={form.localisation}
            onChange={e => setForm(f => ({ ...f, localisation: e.target.value }))}
          />
          <button
            className="px-3 py-2.5 bg-slate-700 text-slate-300 rounded-xl hover:bg-slate-600 text-sm"
            title="Utiliser ma position GPS"
          >
            📍
          </button>
        </div>
      </div>

      <button
        onClick={() => setSubmitted(true)}
        disabled={!form.description.trim()}
        className="w-full py-3 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 disabled:opacity-40 text-sm"
      >
        Envoyer le signalement
      </button>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function DriverSpace() {
  const [roleIdx, setRoleIdx] = useState(0);
  const roleKey               = DEMO_ROLES_D[roleIdx] as DemoRoleKeyD;
  const permissions           = ROLE_PERMISSIONS[roleKey] ?? [];
  const TABS                  = filterDriverTabs(permissions);

  const [tab, setTab] = useState<DriverTab>('trajets');
  const [sos, setSos]  = useState(false);

  const visibleIds = TABS.map(t => t.id);
  const effectiveTab: DriverTab = visibleIds.includes(tab) ? tab : (visibleIds[0] ?? 'trajets');

  return (
    <div
      className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-teal-700 flex items-center justify-center font-black text-sm">
              CM
            </div>
            <div>
              <p className="font-bold text-white text-sm">Christophe Mabou</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                <p className="text-xs text-emerald-400 font-semibold">En service</p>
              </div>
            </div>
          </div>
          {/* Role switcher démo */}
          <select
            value={roleIdx}
            onChange={e => { const idx = Number(e.target.value); setRoleIdx(idx); const tabs = filterDriverTabs(ROLE_PERMISSIONS[DEMO_ROLES_D[idx]!] ?? []); setTab(tabs[0]?.id ?? 'trajets'); }}
            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1 focus:outline-none"
          >
            {DEMO_ROLES_D.map((r, i) => <option key={r} value={i}>{r}</option>)}
          </select>

          {/* SOS button */}
          <button
            onClick={() => setSos(v => !v)}
            className={cn(
              'px-4 py-2 rounded-xl font-black text-sm uppercase tracking-widest border-2 transition-all',
              sos
                ? 'bg-red-600 border-red-500 text-white animate-pulse scale-110 shadow-lg shadow-red-900/60'
                : 'bg-red-900/40 border-red-700 text-red-300 hover:bg-red-800/60',
            )}
          >
            SOS
          </button>
        </div>

        {/* SOS alert */}
        {sos && (
          <div className="mt-3 bg-red-900/60 border border-red-700 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <span className="text-red-300 text-sm font-bold animate-pulse">🚨 Alerte SOS envoyée au dispatcher !</span>
            <button onClick={() => setSos(false)} className="ml-auto text-xs text-red-400 underline">Annuler</button>
          </div>
        )}
      </header>

      {/* ── Active trip banner ───────────────────────────────────────── */}
      {(() => {
        const active = DRIVER_TRIPS.find(t => t.statut === 'EN_COURS');
        if (!active) return null;
        const pct = Math.round((active.parcouru / active.distanceKm) * 100);
        return (
          <div className="px-4 py-3 bg-teal-900/40 border-b border-teal-800 shrink-0">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="font-bold text-teal-300">
                {active.depart} → {active.arrivee}
              </span>
              <span className="text-teal-400 font-semibold tabular-nums">{pct}%</span>
            </div>
            <div className="w-full h-1.5 bg-teal-950 rounded-full overflow-hidden">
              <div className="h-full bg-teal-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-teal-500 mt-1">
              {active.parcouru} km parcourus · {active.distanceKm - active.parcouru} km restants · Arrivée {active.heureArrivee}
            </p>
          </div>
        );
      })()}

      {/* ── Tabs — filtrés par permissions ───────────────────────── */}
      <div className="flex border-b border-slate-800 shrink-0 bg-slate-900">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors',
              effectiveTab === t.id
                ? 'text-teal-400 border-b-2 border-teal-500 bg-slate-800'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            <span className="text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {effectiveTab === 'trajets'    && <TabTrajets />}
        {effectiveTab === 'checklists' && <TabChecklists />}
        {effectiveTab === 'incidents'  && <TabIncidents />}
      </div>
    </div>
  );
}

export default DriverSpace;
