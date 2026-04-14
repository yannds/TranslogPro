/**
 * QuaiAgentApp — Application Agent de Quai (mobile/tablette)
 *
 * Interface pour l'agent positionné au quai d'embarquement.
 * Gère la vérification des billets, le manifeste passagers,
 * le chargement des colis et le scan.
 *
 * Structure :
 *   Header   → quai + trajet + statut embarquement
 *   Tabs     → Manifeste | Chargement | Scanner
 *
 *   [Manifeste]
 *     SeatMap  → grille de sièges (libre/occupé/confirmé/absent)
 *     Legend   → légende couleurs
 *
 *   [Chargement]
 *     ColisList → colis à charger avec statut (en attente/chargé/manquant)
 *
 *   [Scanner]
 *     ScanInput → saisie manuelle ou scan QR en temps réel
 */

import { useState } from 'react';
import { cn } from '../../lib/utils';
import { ROLE_PERMISSIONS } from '../../lib/hooks/useNavigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabQ = 'manifeste' | 'chargement' | 'scanner';

/** Permissions pertinentes pour cet écran */
const P_MANIFEST_SIGN    = 'data.manifest.sign.agency';
const P_MANIFEST_GENERATE = 'data.manifest.generate.agency';
const P_PARCEL_SCAN      = 'data.parcel.scan.agency';
const P_TICKET_SCAN      = 'data.ticket.scan.agency';
const P_TRIP_UPDATE      = 'data.trip.update.agency';

interface TabQDef {
  id:    TabQ;
  label: string;
  icon:  string;
  badge?: number;
  anyOf: string[];
}

type DemoRoleKeyQ = keyof typeof ROLE_PERMISSIONS;

const DEMO_ROLES_Q: DemoRoleKeyQ[] = ['QUAI_AGENT', 'SUPERVISOR', 'STATION_AGENT'];

function filterTabsQ(permissions: string[], badges: Record<TabQ, number | undefined>): TabQDef[] {
  const perms = new Set(permissions);
  const all: TabQDef[] = [
    { id: 'manifeste',  label: 'Manifeste',  icon: '💺', badge: badges.manifeste,  anyOf: [P_MANIFEST_SIGN, P_MANIFEST_GENERATE, P_TRIP_UPDATE] },
    { id: 'chargement', label: 'Chargement', icon: '📦', badge: badges.chargement, anyOf: [P_PARCEL_SCAN] },
    { id: 'scanner',    label: 'Scanner',    icon: '📷', anyOf: [P_TICKET_SCAN, P_PARCEL_SCAN] },
  ];
  return all.filter(t => t.anyOf.some(p => perms.has(p)));
}

type SeatStatus = 'LIBRE' | 'CONFIRME' | 'BORDE' | 'ABSENT' | 'BLOQUE';

interface Seat {
  numero:  string;   // ex. "1A"
  status:  SeatStatus;
  passager?: string;
}

interface Colis {
  id:       string;
  code:     string;
  expediteur:   string;
  destinataire: string;
  description:  string;
  poidsKg:  number;
  status:   'EN_ATTENTE' | 'CHARGE' | 'MANQUANT';
}

// ─── Données de démo ─────────────────────────────────────────────────────────

function generateSeats(): Seat[] {
  const seats: Seat[] = [];
  const rows = 10;
  const cols = ['A', 'B', 'C', 'D', 'E'];
  const statuses: SeatStatus[] = ['CONFIRME', 'CONFIRME', 'CONFIRME', 'BORDE', 'LIBRE', 'ABSENT', 'BLOQUE'];

  for (let r = 1; r <= rows; r++) {
    for (const col of cols) {
      const num = `${r}${col}`;
      // deterministic fake status
      const hash = (r * 7 + col.charCodeAt(0)) % statuses.length;
      const status = statuses[hash];
      seats.push({
        numero: num,
        status,
        passager: status === 'CONFIRME' || status === 'BORDE'
          ? `Passager ${r}${col}`
          : undefined,
      });
    }
  }
  return seats;
}

const SEATS = generateSeats();

const COLIS_LIST: Colis[] = [
  { id: 'c1', code: 'COL-A1B2C3', expediteur: 'Alioune Diop',   destinataire: 'Rokhaya Gueye',  description: 'Vêtements',       poidsKg: 8,  status: 'CHARGE' },
  { id: 'c2', code: 'COL-D4E5F6', expediteur: 'Fatou Sow',      destinataire: 'Ibou Camara',    description: 'Alimentation',    poidsKg: 12, status: 'CHARGE' },
  { id: 'c3', code: 'COL-G7H8I9', expediteur: 'Mamadou Ndiaye', destinataire: 'Awa Mbaye',      description: 'Fragile — Verre', poidsKg: 4,  status: 'EN_ATTENTE' },
  { id: 'c4', code: 'COL-J1K2L3', expediteur: 'Seydou Fall',    destinataire: 'Mame Diarra Ba', description: 'Électronique',    poidsKg: 3,  status: 'EN_ATTENTE' },
  { id: 'c5', code: 'COL-M4N5O6', expediteur: 'Coumba Dione',   destinataire: 'Sokhna Thiam',   description: 'Médicaments',     poidsKg: 2,  status: 'MANQUANT' },
];

// ─── Config ───────────────────────────────────────────────────────────────────

const SEAT_CONFIG: Record<SeatStatus, { bg: string; text: string; label: string }> = {
  LIBRE:    { bg: 'bg-slate-800 border-slate-700',           text: 'text-slate-500', label: 'Libre' },
  CONFIRME: { bg: 'bg-teal-700 border-teal-600',             text: 'text-white',     label: 'Confirmé' },
  BORDE:    { bg: 'bg-emerald-600 border-emerald-500',       text: 'text-white',     label: 'À bord' },
  ABSENT:   { bg: 'bg-amber-700/60 border-amber-600',        text: 'text-amber-200', label: 'Absent' },
  BLOQUE:   { bg: 'bg-slate-900 border-slate-800',           text: 'text-slate-700', label: 'Bloqué' },
};

const COLIS_STATUS_CONFIG = {
  CHARGE:     { cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700', label: 'Chargé' },
  EN_ATTENTE: { cls: 'bg-amber-900/40 text-amber-300 border-amber-700',       label: 'En attente' },
  MANQUANT:   { cls: 'bg-red-900/40 text-red-300 border-red-700',             label: 'Manquant' },
};

// ─── Manifeste ────────────────────────────────────────────────────────────────

function TabManifeste() {
  const [hoveredSeat, setHoveredSeat] = useState<Seat | null>(null);
  const counts = {
    CONFIRME: SEATS.filter(s => s.status === 'CONFIRME').length,
    BORDE:    SEATS.filter(s => s.status === 'BORDE').length,
    ABSENT:   SEATS.filter(s => s.status === 'ABSENT').length,
    LIBRE:    SEATS.filter(s => s.status === 'LIBRE').length,
  };

  return (
    <div className="p-4 space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {Object.entries(counts).map(([status, count]) => (
          <div key={status} className={cn('rounded-lg border p-2 text-center', SEAT_CONFIG[status as SeatStatus].bg)}>
            <p className={cn('text-lg font-black', SEAT_CONFIG[status as SeatStatus].text)}>{count}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">{SEAT_CONFIG[status as SeatStatus].label}</p>
          </div>
        ))}
      </div>

      {/* Hover info */}
      {hoveredSeat && hoveredSeat.passager && (
        <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm">
          <span className="text-slate-400">Siège {hoveredSeat.numero} :</span>{' '}
          <span className="text-white font-medium">{hoveredSeat.passager}</span>
        </div>
      )}

      {/* Seat map */}
      <div>
        <div className="flex justify-center gap-1 mb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          {'ABCDE'.split('').map(c => (
            <div key={c} className="w-9 text-center">{c}</div>
          ))}
        </div>
        <div className="space-y-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(row => (
            <div key={row} className="flex items-center gap-1">
              <span className="text-[10px] text-slate-600 w-4 text-right shrink-0">{row}</span>
              {'ABCDE'.split('').map(col => {
                const seat = SEATS.find(s => s.numero === `${row}${col}`)!;
                const cfg  = SEAT_CONFIG[seat.status];
                return (
                  <button
                    key={col}
                    className={cn(
                      'w-9 h-7 rounded text-[10px] font-bold border transition-all',
                      cfg.bg, cfg.text,
                      'hover:brightness-110',
                      col === 'C' && 'mr-2', // Aisle after C
                    )}
                    onMouseEnter={() => setHoveredSeat(seat)}
                    onMouseLeave={() => setHoveredSeat(null)}
                    title={seat.passager}
                  >
                    {seat.numero}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-2 border-t border-slate-800">
        {Object.entries(SEAT_CONFIG).filter(([s]) => s !== 'BLOQUE').map(([status, cfg]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={cn('w-3 h-3 rounded border', cfg.bg)} />
            <span className="text-[10px] text-slate-400">{cfg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chargement ───────────────────────────────────────────────────────────────

function TabChargement() {
  const [colis, setColis] = useState(COLIS_LIST);
  const charged = colis.filter(c => c.status === 'CHARGE').length;

  function markLoaded(id: string) {
    setColis(prev => prev.map(c => c.id === id ? { ...c, status: 'CHARGE' as const } : c));
  }

  return (
    <div className="p-4 space-y-4">
      {/* Progress */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-400 font-medium">Progression chargement</span>
          <span className="text-white font-bold">{charged} / {colis.length}</span>
        </div>
        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${(charged / colis.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Colis list */}
      <div className="space-y-2">
        {colis.map(c => {
          const cfg = COLIS_STATUS_CONFIG[c.status];
          return (
            <div key={c.id} className={cn('rounded-xl border p-4', cfg.cls)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold">{c.code}</span>
                    <span className={cn(
                      'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border',
                      cfg.cls,
                    )}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white truncate">
                    {c.expediteur} → {c.destinataire}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {c.description} · {c.poidsKg} kg
                  </p>
                </div>
                {c.status === 'EN_ATTENTE' && (
                  <button
                    onClick={() => markLoaded(c.id)}
                    className="shrink-0 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700"
                  >
                    Charger
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

function TabScanner() {
  const [code, setCode]         = useState('');
  const [scanned, setScanned]   = useState<string[]>([]);
  const [lastResult, setResult] = useState<'OK' | 'INVALID' | null>(null);

  function handleScan() {
    if (!code.trim()) return;
    const valid = code.startsWith('TLP-') || code.startsWith('COL-');
    setResult(valid ? 'OK' : 'INVALID');
    if (valid) setScanned(prev => [code.toUpperCase(), ...prev].slice(0, 20));
    setCode('');
  }

  return (
    <div className="p-4 space-y-4">
      {/* Input */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Scanner billet ou colis</p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleScan()}
            placeholder="TLP-XXXXXX ou COL-XXXXXX"
            className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm font-mono uppercase placeholder:normal-case placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
            autoFocus
          />
          <button
            onClick={handleScan}
            className="px-4 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 text-sm"
          >
            Scan
          </button>
        </div>
      </div>

      {/* Feedback */}
      {lastResult && (
        <div className={cn(
          'rounded-xl border p-4 flex items-center gap-3',
          lastResult === 'OK'
            ? 'bg-emerald-900/60 border-emerald-700 text-emerald-300'
            : 'bg-red-900/60 border-red-700 text-red-300',
        )}>
          <span className="text-3xl">{lastResult === 'OK' ? '✓' : '✕'}</span>
          <div>
            <p className="font-bold">{lastResult === 'OK' ? 'Scan validé' : 'Code invalide'}</p>
            <p className="text-xs opacity-70 mt-0.5">
              {lastResult === 'OK' ? 'Passager/colis enregistré' : 'Format non reconnu — TLP-XXXXXX ou COL-XXXXXX'}
            </p>
          </div>
        </div>
      )}

      {/* History */}
      {scanned.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Historique ({scanned.length})
          </p>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {scanned.map((s, i) => (
              <div key={i} className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-sm font-mono text-slate-200">{s}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {new Date().toLocaleTimeString('fr-SN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hint */}
      <p className="text-xs text-slate-600">
        Essayez : TLP-A1B2C3 ou COL-D4E5F6 (codes valides de démonstration)
      </p>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function QuaiAgentApp() {
  const [roleIdx, setRoleIdx] = useState(0);
  const roleKey               = DEMO_ROLES_Q[roleIdx] as DemoRoleKeyQ;
  const permissions           = ROLE_PERMISSIONS[roleKey] ?? [];

  const badges: Record<TabQ, number | undefined> = {
    manifeste:  SEATS.filter(s => s.status === 'ABSENT').length,
    chargement: COLIS_LIST.filter(c => c.status === 'EN_ATTENTE').length,
    scanner:    undefined,
  };

  const TABS = filterTabsQ(permissions, badges);
  const [tab, setTab] = useState<TabQ>(() => filterTabsQ(ROLE_PERMISSIONS[DEMO_ROLES_Q[0]!] ?? [], badges)[0]?.id ?? 'manifeste');

  const visibleIds = TABS.map(t => t.id);
  const effectiveTab: TabQ = visibleIds.includes(tab) ? tab : (visibleIds[0] ?? 'manifeste');

  const boarded  = SEATS.filter(s => s.status === 'BORDE').length;
  const capacity = SEATS.length;

  return (
    <div
      className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <header className="px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="font-bold text-white">Quai A2 — Pointe-Noire</p>
            <p className="text-xs text-slate-400">Départ 10:00 · Congo Express · KA-1876-D</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Role switcher démo */}
            <select
              value={roleIdx}
              onChange={e => { const idx = Number(e.target.value); setRoleIdx(idx); const tabs = filterTabsQ(ROLE_PERMISSIONS[DEMO_ROLES_Q[idx]!] ?? [], badges); setTab(tabs[0]?.id ?? 'manifeste'); }}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1 focus:outline-none"
            >
              {DEMO_ROLES_Q.map((r, i) => <option key={r} value={i}>{r}</option>)}
            </select>
            <span className="inline-flex items-center gap-1.5 bg-amber-900/60 text-amber-300 border border-amber-700 px-2.5 py-1 rounded-lg text-xs font-bold uppercase animate-pulse">
              Embarquement
            </span>
          </div>
        </div>
        {/* Occupancy mini-bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all"
              style={{ width: `${(boarded / capacity) * 100}%` }}
            />
          </div>
          <span className="text-xs text-slate-400 tabular-nums shrink-0">
            {boarded}/{capacity} à bord
          </span>
        </div>
      </header>

      {/* Tabs — filtrés par permissions */}
      <div className="flex border-b border-slate-800 shrink-0 bg-slate-900">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors relative',
              effectiveTab === t.id
                ? 'text-teal-400 border-b-2 border-teal-500 bg-slate-800'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            <span className="text-base">{t.icon}</span>
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="absolute top-1.5 right-3 w-4 h-4 bg-amber-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {effectiveTab === 'manifeste'  && <TabManifeste />}
        {effectiveTab === 'chargement' && <TabChargement />}
        {effectiveTab === 'scanner'    && <TabScanner />}
      </div>
    </div>
  );
}

export default QuaiAgentApp;
