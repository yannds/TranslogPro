/**
 * QuaiScreen — Écran d'information quai (kiosque quai gare)
 *
 * Affiché sur un écran TV ou panneau LED au niveau du quai de départ.
 * Identifie clairement la destination et le statut de l'embarquement.
 *
 * Structure :
 *   Header      → numéro de quai + badge EMBARQUEMENT clignotant
 *   DestCard    → destination principale + heure + agence
 *   StatCards   → 4 stats : Bus / Passagers / Colis / Chauffeur
 *   StatusText  → message d'état grand format
 *   Timer       → compte à rebours jusqu'au départ
 *   Ticker      → annonces
 */

import { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type QuaiStatus =
  | 'ATTENTE'       // Bus pas encore là
  | 'EMBARQUEMENT'  // Embarquement ouvert
  | 'DERNIER_APPEL' // Dernier appel avant fermeture
  | 'PORTE_FERMEE'  // Embarquement terminé
  | 'PARTI';        // Bus parti

interface QuaiInfo {
  numero:       string;
  destination:  string;
  via?:         string;
  heureDepart:  string;    // HH:MM
  agence:       string;
  bus:          string;    // plaque
  busModele:    string;
  chauffeur:    string;
  passagersConfirmes: number;
  passagersABord:     number;
  capacite:     number;
  colisEnSoute: number;
  status:       QuaiStatus;
  departAt:     Date;      // utilisé pour le compte à rebours
}

// ─── Données de démo ─────────────────────────────────────────────────────────

const DEMO_QUAI: QuaiInfo = {
  numero:      'A3',
  destination: 'ZIGUINCHOR',
  via:         'Kaolack · Kolda · Vélingara',
  heureDepart: '08:15',
  agence:      'Senbus',
  bus:         'DK 4321 EF',
  busModele:   'King Long XMQ6130Y',
  chauffeur:   'Ousmane Faye',
  passagersConfirmes: 47,
  passagersABord:     31,
  capacite:    50,
  colisEnSoute: 18,
  status:      'EMBARQUEMENT',
  departAt:    (() => {
    const d = new Date();
    d.setHours(8, 15, 0, 0);
    return d;
  })(),
};

const TICKER_MESSAGES = [
  `Quai A3 — EMBARQUEMENT EN COURS pour ZIGUINCHOR — Présentez votre billet à l'agent.`,
  'Bagages en soute : déposez vos bagages avant de monter à bord.',
  'Rappel : Les bagages à main ne doivent pas dépasser le coffre supérieur.',
  `Départ prévu à ${DEMO_QUAI.heureDepart} — Tout retard sera annoncé par haut-parleur.`,
];

// ─── Config statut ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<QuaiStatus, {
  label: string;
  sub:   string;
  badgeCls: string;
  mainCls:  string;
  blink:    boolean;
}> = {
  ATTENTE:       { label: 'EN ATTENTE',      sub: 'Le bus n\'est pas encore arrivé.',          badgeCls: 'bg-sky-900 text-sky-300 border-sky-700',     mainCls: 'text-sky-300',    blink: false },
  EMBARQUEMENT:  { label: 'EMBARQUEMENT',    sub: 'Présentez votre billet à l\'agent du quai.', badgeCls: 'bg-amber-500 text-slate-900 border-amber-400', mainCls: 'text-amber-400',  blink: true  },
  DERNIER_APPEL: { label: 'DERNIER APPEL',   sub: 'Dernière chance d\'embarquer !',             badgeCls: 'bg-red-600 text-white border-red-500',          mainCls: 'text-red-400',    blink: true  },
  PORTE_FERMEE:  { label: 'PORTE FERMÉE',    sub: 'L\'embarquement est terminé.',               badgeCls: 'bg-slate-700 text-slate-300 border-slate-600', mainCls: 'text-slate-400',  blink: false },
  PARTI:         { label: 'PARTI',           sub: 'Le bus a quitté le quai.',                   badgeCls: 'bg-slate-800 text-slate-500 border-slate-700', mainCls: 'text-slate-600',  blink: false },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Countdown({ targetDate }: { targetDate: Date }) {
  const now  = useTime();
  const diff = Math.max(0, targetDate.getTime() - now.getTime());
  const h    = Math.floor(diff / 3_600_000);
  const m    = Math.floor((diff % 3_600_000) / 60_000);
  const s    = Math.floor((diff % 60_000) / 1_000);
  const pad  = (n: number) => String(n).padStart(2, '0');

  if (diff === 0) {
    return <span className="text-green-400">DÉPART</span>;
  }

  return (
    <span className="tabular-nums">
      {h > 0 && <>{pad(h)}<span className="text-slate-500 text-3xl">h</span></>}
      {pad(m)}<span className="text-slate-500 text-3xl">m</span>
      {pad(s)}<span className="text-slate-500 text-3xl">s</span>
    </span>
  );
}

function OccupancyBar({ value, max, cls = 'bg-teal-500' }: { value: number; max: number; cls?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mt-1">
      <div
        className={cn('h-full rounded-full transition-all', cls)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Ticker() {
  const text = TICKER_MESSAGES.join('   ·   ');
  return (
    <div className="bg-amber-500 text-slate-900 flex items-center overflow-hidden shrink-0 h-10">
      <div className="shrink-0 bg-amber-700 text-white px-3 h-full flex items-center font-bold text-xs uppercase tracking-widest">
        INFO
      </div>
      <div className="flex-1 overflow-hidden">
        <p className="whitespace-nowrap text-sm font-semibold" style={{ animation: 'ticker 20s linear infinite' }}>
          {text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{text}
        </p>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function QuaiScreen({ quai = DEMO_QUAI }: { quai?: QuaiInfo }) {
  const now = useTime();
  const cfg = STATUS_CONFIG[quai.status];

  return (
    <div
      className="flex flex-col h-screen bg-slate-950 text-white select-none overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── Header : numéro de quai ──────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-5 bg-slate-900 border-b-2 border-teal-700 shrink-0">
        <div className="flex items-center gap-6">
          {/* Giant quai number */}
          <div className="flex flex-col items-center bg-teal-700 rounded-2xl w-28 h-24 justify-center shadow-lg shadow-teal-900/60">
            <p className="text-xs font-bold uppercase tracking-widest text-teal-200">Quai</p>
            <p className="text-6xl font-black text-white leading-none">{quai.numero}</p>
          </div>

          {/* Status badge */}
          <div>
            <span className={cn(
              'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xl font-black uppercase tracking-widest border-2',
              cfg.badgeCls,
              cfg.blink && 'animate-pulse',
            )}>
              {cfg.label}
            </span>
            <p className="text-slate-400 text-sm mt-2">{cfg.sub}</p>
          </div>
        </div>

        {/* Clock + countdown */}
        <div className="text-right">
          <p className="text-4xl font-black tabular-nums">
            {now.toLocaleTimeString('fr-SN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-slate-400 text-sm mt-1">Départ dans&nbsp;
            <span className="text-5xl font-black text-amber-400">
              <Countdown targetDate={quai.departAt} />
            </span>
          </p>
        </div>
      </header>

      {/* ── Destination principale ───────────────────────────────────── */}
      <div className="px-8 py-6 bg-gradient-to-r from-teal-900/40 to-slate-950 border-b border-slate-800 shrink-0">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-teal-400 mb-1">Destination</p>
            <p className="text-6xl font-black uppercase tracking-wider text-white">{quai.destination}</p>
            {quai.via && (
              <p className="text-slate-400 text-base mt-1.5">via&nbsp;{quai.via}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Départ</p>
            <p className="text-7xl font-black text-teal-300 tabular-nums leading-none">{quai.heureDepart}</p>
          </div>
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 px-8 py-5 flex-1">
        {/* Bus */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Véhicule</p>
            <p className="text-2xl font-black text-white font-mono">{quai.bus}</p>
            <p className="text-sm text-slate-400 mt-1">{quai.busModele}</p>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-semibold">Bus en position</span>
          </div>
        </div>

        {/* Passagers */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Passagers</p>
            <div className="flex items-end gap-1">
              <p className="text-5xl font-black text-white tabular-nums">{quai.passagersABord}</p>
              <p className="text-2xl text-slate-500 mb-1">/{quai.capacite}</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{quai.passagersConfirmes} confirmés</span>
              <span>{Math.round((quai.passagersABord / quai.capacite) * 100)}%</span>
            </div>
            <OccupancyBar
              value={quai.passagersABord}
              max={quai.capacite}
              cls={quai.passagersABord / quai.capacite > 0.9 ? 'bg-red-500' : 'bg-teal-500'}
            />
          </div>
        </div>

        {/* Colis */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Colis en soute</p>
            <p className="text-5xl font-black text-white tabular-nums">{quai.colisEnSoute}</p>
            <p className="text-sm text-slate-400 mt-1">Paquets chargés</p>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <div className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-xs text-purple-400 font-semibold">Chargement en cours</span>
          </div>
        </div>

        {/* Chauffeur */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Chauffeur</p>
            <p className="text-2xl font-bold text-white leading-tight">{quai.chauffeur}</p>
            <p className="text-sm text-slate-400 mt-1">{quai.agence}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-xs text-teal-400 font-semibold">À bord</span>
          </div>
        </div>
      </div>

      {/* ── Ticker ──────────────────────────────────────────────────── */}
      <Ticker />

      <style>{`
        @keyframes ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

export default QuaiScreen;
