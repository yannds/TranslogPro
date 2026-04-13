/**
 * BusScreen — Écran d'information à bord du bus
 *
 * Affiché sur un petit écran TV à l'intérieur du véhicule.
 * Montré aux passagers pendant le trajet.
 *
 * Structure :
 *   Header       → logo + n° trajet + heure
 *   ItineraryBar → liste d'arrêts avec statuts (passé/actuel/futur)
 *   InfoCards    → passagers à bord, colis, prochain arrêt, ETA
 *   BusInfo      → modèle bus + chauffeur + plaque
 *   Ticker       → annonces
 */

import { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type StopStatus = 'PASSED' | 'CURRENT' | 'UPCOMING';

interface RouteStop {
  id:       string;
  ville:    string;
  heure:    string;   // heure prévue
  km:       number;   // depuis départ
  status:   StopStatus;
}

// ─── Données de démo ─────────────────────────────────────────────────────────

const ROUTE_STOPS: RouteStop[] = [
  { id: 's1', ville: 'Dakar',       heure: '07:00', km: 0,   status: 'PASSED' },
  { id: 's2', ville: 'Thiès',       heure: '08:10', km: 70,  status: 'PASSED' },
  { id: 's3', ville: 'Tivaouane',   heure: '08:45', km: 110, status: 'PASSED' },
  { id: 's4', ville: 'Louga',       heure: '10:00', km: 200, status: 'CURRENT' },
  { id: 's5', ville: 'Linguère',    heure: '11:15', km: 280, status: 'UPCOMING' },
  { id: 's6', ville: 'Saint-Louis', heure: '12:30', km: 450, status: 'UPCOMING' },
];

const TICKER_ANNONCES = [
  'Prochain arrêt : Louga dans quelques minutes — Ceintures de sécurité obligatoires.',
  'Durée restante estimée : 2h30 — Arrivée à Saint-Louis prévue à 12h30.',
  'Il est interdit de fumer à bord. En cas d\'urgence, contactez le chauffeur.',
  'Bagages en soute : récupération à l\'arrivée à la soute numéro de votre billet.',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const STOP_STYLE: Record<StopStatus, { dot: string; label: string; line: string }> = {
  PASSED:   { dot: 'bg-emerald-500 border-emerald-500',   label: 'text-slate-500 line-through', line: 'bg-emerald-700' },
  CURRENT:  { dot: 'bg-orange-500 border-orange-400 ring-4 ring-orange-500/30 animate-pulse', label: 'text-orange-300 font-bold', line: 'bg-slate-700' },
  UPCOMING: { dot: 'bg-slate-700 border-slate-600',       label: 'text-slate-400', line: 'bg-slate-700' },
};

// ─── Ticker ───────────────────────────────────────────────────────────────────

function BusTicker() {
  const text = TICKER_ANNONCES.join('   ·   ');
  return (
    <div className="bg-teal-700 text-white flex items-center overflow-hidden shrink-0 h-9">
      <div className="shrink-0 bg-teal-900 px-3 h-full flex items-center font-bold text-xs uppercase tracking-widest">
        INFO
      </div>
      <div className="flex-1 overflow-hidden">
        <p className="whitespace-nowrap text-sm font-medium" style={{ animation: 'ticker 25s linear infinite' }}>
          {text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{text}
        </p>
      </div>
    </div>
  );
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function BusScreen() {
  const now     = useTime();
  const current = ROUTE_STOPS.find(s => s.status === 'CURRENT');
  const next    = ROUTE_STOPS.find(s => s.status === 'UPCOMING');
  const passed  = ROUTE_STOPS.filter(s => s.status === 'PASSED').length;

  return (
    <div
      className="flex flex-col h-screen bg-slate-950 text-white select-none overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-900 border-b border-teal-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center font-black text-sm">T</div>
          <div>
            <p className="text-sm font-bold text-white">Dakar → Saint-Louis</p>
            <p className="text-xs text-slate-400">Trajet #TRP-20260413 · DK 4321 EF</p>
          </div>
        </div>
        <div className="text-right tabular-nums">
          <p className="text-2xl font-black text-white">
            {now.toLocaleTimeString('fr-SN', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-xs text-slate-400">
            {now.toLocaleDateString('fr-SN', { day: 'numeric', month: 'short' })}
          </p>
        </div>
      </header>

      {/* ── Corps ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Itinerary sidebar */}
        <aside className="w-56 shrink-0 bg-slate-900 border-r border-slate-800 overflow-y-auto px-4 py-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Itinéraire</p>
          <div className="space-y-0">
            {ROUTE_STOPS.map((stop, i) => {
              const cfg = STOP_STYLE[stop.status];
              const isLast = i === ROUTE_STOPS.length - 1;
              return (
                <div key={stop.id} className="flex gap-3">
                  {/* Line + dot */}
                  <div className="flex flex-col items-center">
                    <div className={cn('w-3 h-3 rounded-full border-2 shrink-0 mt-1', cfg.dot)} />
                    {!isLast && <div className={cn('w-0.5 flex-1 my-1 min-h-[1.5rem]', cfg.line)} />}
                  </div>
                  {/* Info */}
                  <div className="pb-4">
                    <p className={cn('text-sm font-semibold', cfg.label)}>{stop.ville}</p>
                    <p className={cn('text-xs tabular-nums', stop.status === 'CURRENT' ? 'text-orange-400' : 'text-slate-600')}>
                      {stop.heure}
                      {stop.status === 'CURRENT' && ' · EN COURS'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col gap-4 p-6 overflow-y-auto">
          {/* Current stop card */}
          {current && (
            <div className="bg-gradient-to-br from-orange-900/60 to-orange-950 rounded-2xl border border-orange-700 p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-orange-400 mb-1">Arrêt actuel</p>
              <p className="text-4xl font-black text-white">{current.ville}</p>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                  <span className="text-sm text-orange-300 font-semibold">Arrivée en cours</span>
                </div>
                <span className="text-sm text-slate-400">{current.km} km depuis Dakar</span>
              </div>
            </div>
          )}

          {/* Next stop */}
          {next && (
            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-teal-400 mb-1">Prochain arrêt</p>
              <div className="flex items-end justify-between">
                <p className="text-3xl font-bold text-white">{next.ville}</p>
                <div className="text-right">
                  <p className="text-2xl font-black text-teal-300 tabular-nums">{next.heure}</p>
                  <p className="text-xs text-slate-500">{next.km - (current?.km ?? 0)} km restants</p>
                </div>
              </div>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon="👥" label="Passagers" value="38" sub="/ 50 places" accent="teal" />
            <StatCard icon="📦" label="Colis" value="12" sub="en soute" accent="purple" />
            <StatCard icon="✅" label="Arrêts passés" value={String(passed)} sub={`/ ${ROUTE_STOPS.length}`} accent="emerald" />
            <StatCard icon="⏱" label="ETA arrivée" value="12:30" sub="Saint-Louis" accent="amber" />
          </div>

          {/* Bus info */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Informations véhicule</p>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-slate-500 text-xs">Chauffeur</p>
                <p className="text-white font-semibold mt-0.5">Mamadou Diallo</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Modèle</p>
                <p className="text-white font-semibold mt-0.5">Mercedes Actros</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Immatriculation</p>
                <p className="text-white font-mono font-semibold mt-0.5">DK 4321 EF</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Agence</p>
                <p className="text-white font-semibold mt-0.5">Dakar Dem Dikk</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Capacité</p>
                <p className="text-white font-semibold mt-0.5">50 sièges</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs">Trajet n°</p>
                <p className="text-white font-mono font-semibold mt-0.5">TRP-20260413</p>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ── Ticker ──────────────────────────────────────────────────── */}
      <BusTicker />

      <style>{`
        @keyframes ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

function StatCard({
  icon, label, value, sub, accent,
}: { icon: string; label: string; value: string; sub: string; accent: string }) {
  const colors: Record<string, string> = {
    teal:    'text-teal-400 bg-teal-900/40 border-teal-800',
    purple:  'text-purple-400 bg-purple-900/40 border-purple-800',
    emerald: 'text-emerald-400 bg-emerald-900/40 border-emerald-800',
    amber:   'text-amber-400 bg-amber-900/40 border-amber-800',
  };
  return (
    <div className={cn('rounded-xl border p-4', colors[accent] || colors['teal'])}>
      <p className="text-lg mb-1">{icon}</p>
      <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-2xl font-black text-white tabular-nums">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

export default BusScreen;
