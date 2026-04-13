/**
 * DepartureBoard — Tableau de départs gare (écran TV/kiosque)
 *
 * Conçu pour être affiché sur un grand écran TV dans une gare routière.
 * Mise à jour en temps réel via WebSocket (simulée ici par un timer).
 *
 * Structure :
 *   Header     → logo gare + horloge temps réel + date
 *   Table      → liste des départs (heure, destination, bus, agence, quai, statut, remarque)
 *   Ticker     → bandeau défilant d'annonces en bas
 *
 * Couleurs statut :
 *   PRÉVU         → bleu/teal
 *   EN EMBARQUEMENT → amber clignotant
 *   EMBARQUEMENT TERMINÉ → violet
 *   PARTI         → vert atténué
 *   RETARD        → orange
 *   ANNULÉ        → rouge
 */

import { useState, useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type TripStatus =
  | 'PREVU'
  | 'EMBARQUEMENT'
  | 'EMBARQUEMENT_TERMINE'
  | 'PARTI'
  | 'RETARD'
  | 'ANNULE';

interface DepartureRow {
  id:          string;
  heure:       string;
  destination: string;
  via?:        string;       // Villes intermédiaires
  bus:         string;       // Plaque
  agence:      string;
  quai:        string;
  status:      TripStatus;
  retardMin?:  number;       // Minutes de retard
  remarque?:   string;
}

// ─── Données de démo ─────────────────────────────────────────────────────────

const DEMO_ROWS: DepartureRow[] = [
  { id: 'd1', heure: '07:00', destination: 'SAINT-LOUIS', via: 'Thiès, Tivaouane', bus: 'DK 1234 AB', agence: 'Dakar Dem Dikk', quai: 'A1', status: 'PARTI' },
  { id: 'd2', heure: '07:30', destination: 'THIÈS', bus: 'DK 5678 BC', agence: 'Mouride Express', quai: 'B2', status: 'PARTI' },
  { id: 'd3', heure: '08:00', destination: 'KAOLACK', via: 'Fatick', bus: 'TH 0011 CD', agence: 'Ndiaga Ndiaye', quai: 'C1', status: 'EMBARQUEMENT_TERMINE' },
  { id: 'd4', heure: '08:15', destination: 'ZIGUINCHOR', via: 'Kaolack, Kolda', bus: 'DK 4321 EF', agence: 'Senbus', quai: 'A3', status: 'EMBARQUEMENT', },
  { id: 'd5', heure: '08:45', destination: 'SAINT-LOUIS', bus: 'SL 9900 GH', agence: 'DDD Express', quai: 'B1', status: 'RETARD', retardMin: 20, remarque: 'Bus en maintenance' },
  { id: 'd6', heure: '09:00', destination: 'TAMBACOUNDA', via: 'Koungheul, Kaffrine', bus: 'DK 7722 IJ', agence: 'Dakar Dem Dikk', quai: 'D2', status: 'PREVU' },
  { id: 'd7', heure: '09:15', destination: 'DIOURBEL', bus: 'DB 5544 KL', agence: 'Mouride Express', quai: 'B3', status: 'PREVU' },
  { id: 'd8', heure: '09:30', destination: 'MBOUR', bus: 'DK 3388 MN', agence: 'Ocean Express', quai: 'C2', status: 'PREVU' },
  { id: 'd9', heure: '09:45', destination: 'TOUBA', via: 'Diourbel', bus: 'TB 1155 OP', agence: 'Touba Travel', quai: 'A2', status: 'PREVU' },
  { id: 'd10', heure: '10:00', destination: 'KAOLACK', bus: 'KL 6600 QR', agence: 'Ndiaga Ndiaye', quai: 'D1', status: 'ANNULE', remarque: 'Incident technique' },
  { id: 'd11', heure: '10:30', destination: 'SAINT-LOUIS', bus: 'DK 2211 ST', agence: 'DDD Express', quai: 'B2', status: 'PREVU' },
  { id: 'd12', heure: '11:00', destination: 'THIÈS', bus: 'TH 8877 UV', agence: 'Dakar Dem Dikk', quai: 'C3', status: 'PREVU' },
];

const TICKER_MESSAGES = [
  'Bienvenue à la Gare Routière de Dakar — Bonne route !',
  'Annonce : Le bus DK 4321 EF vers Ziguinchor embarque au quai A3 — Présentez votre billet.',
  'Rappel : Pas d\'animaux dans les bus. Les bagages en soute sont limités à 20 kg.',
  'Retard : Le départ 08:45 vers Saint-Louis est retardé de 20 minutes.',
  'Sécurité : Ne laissez pas vos bagages sans surveillance.',
  'Information : Des reçus de paiement sont disponibles au guichet 3.',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TripStatus, { label: string; cls: string; blink?: boolean }> = {
  PREVU:                { label: 'PRÉVU',          cls: 'bg-sky-950 text-sky-300 border-sky-800' },
  EMBARQUEMENT:         { label: 'EMBARQUEMENT',   cls: 'bg-amber-950 text-amber-300 border-amber-700', blink: true },
  EMBARQUEMENT_TERMINE: { label: 'TERMINÉ',        cls: 'bg-purple-950 text-purple-300 border-purple-800' },
  PARTI:                { label: 'PARTI',          cls: 'bg-slate-900 text-slate-500 border-slate-800' },
  RETARD:               { label: 'RETARD',         cls: 'bg-orange-950 text-orange-300 border-orange-800' },
  ANNULE:               { label: 'ANNULÉ',         cls: 'bg-red-950 text-red-400 border-red-800' },
};

function useTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Clock() {
  const now = useTime();
  return (
    <div className="text-right tabular-nums">
      <p className="text-5xl font-black text-white tracking-tight leading-none">
        {now.toLocaleTimeString('fr-SN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="text-base text-slate-400 mt-1 capitalize">
        {now.toLocaleDateString('fr-SN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </div>
  );
}

// ─── Ticker ───────────────────────────────────────────────────────────────────

function Ticker() {
  const [msgIndex, setMsgIndex] = useState(0);
  const text = TICKER_MESSAGES.join('   ·   ');

  return (
    <div className="bg-amber-500 text-slate-900 flex items-center overflow-hidden shrink-0 h-10">
      <div className="shrink-0 bg-amber-700 text-white px-3 h-full flex items-center font-bold text-xs uppercase tracking-widest">
        INFO
      </div>
      <div className="flex-1 overflow-hidden">
        <p
          key={msgIndex}
          className="whitespace-nowrap text-sm font-semibold animate-[ticker_30s_linear_infinite]"
          style={{ animation: 'ticker 30s linear infinite' }}
          onAnimationIteration={() => setMsgIndex(i => (i + 1) % TICKER_MESSAGES.length)}
        >
          {text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{text}
        </p>
      </div>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function DepartureRowItem({ row }: { row: DepartureRow }) {
  const cfg = STATUS_CONFIG[row.status];
  const isParti = row.status === 'PARTI';
  const rowCls = cn(
    'grid items-center text-lg transition-colors',
    isParti
      ? 'opacity-40'
      : row.status === 'ANNULE'
        ? 'opacity-60 line-through decoration-red-600'
        : '',
  );

  return (
    <div
      className={cn(
        'grid gap-x-4 px-6 py-3 border-b border-slate-800',
        'grid-cols-[5rem_1fr_8rem_8rem_4rem_10rem_1fr]',
        row.status === 'EMBARQUEMENT' && 'bg-amber-950/30',
      )}
      style={{ minHeight: '3.75rem' }}
    >
      {/* Heure */}
      <div className="flex flex-col">
        <span className={cn('text-2xl font-black tabular-nums', isParti ? 'text-slate-600' : 'text-white')}>
          {row.heure}
        </span>
        {row.retardMin && (
          <span className="text-xs text-orange-400 font-semibold">+{row.retardMin} min</span>
        )}
      </div>

      {/* Destination */}
      <div>
        <p className={cn('text-xl font-extrabold uppercase tracking-wide', isParti ? 'text-slate-600' : 'text-white')}>
          {row.destination}
        </p>
        {row.via && (
          <p className="text-xs text-slate-500 mt-0.5 truncate">via {row.via}</p>
        )}
      </div>

      {/* Bus (plaque) */}
      <div className="flex items-center">
        <span className={cn('text-sm font-mono font-semibold', isParti ? 'text-slate-600' : 'text-slate-300')}>
          {row.bus}
        </span>
      </div>

      {/* Agence */}
      <div className="flex items-center">
        <span className={cn('text-sm font-medium truncate', isParti ? 'text-slate-600' : 'text-slate-300')}>
          {row.agence}
        </span>
      </div>

      {/* Quai */}
      <div className="flex items-center justify-center">
        <span className={cn(
          'text-xl font-black tabular-nums',
          isParti ? 'text-slate-700' : 'text-teal-400',
        )}>
          {row.quai}
        </span>
      </div>

      {/* Statut */}
      <div className="flex items-center">
        <span className={cn(
          'inline-flex items-center justify-center rounded px-2 py-1 text-xs font-bold uppercase tracking-wider border w-full',
          cfg.cls,
          cfg.blink && 'animate-pulse',
        )}>
          {cfg.label}
        </span>
      </div>

      {/* Remarque */}
      <div className="flex items-center">
        {row.remarque && (
          <span className="text-xs text-orange-400 italic truncate">{row.remarque}</span>
        )}
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function DepartureBoard({ gareName = 'Gare Routière de Dakar' }: { gareName?: string }) {
  return (
    <div
      className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden select-none"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-4 bg-slate-900 border-b-2 border-teal-700 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-teal-600 rounded-xl flex items-center justify-center text-white font-black text-xl">
            T
          </div>
          <div>
            <p className="text-2xl font-black text-white uppercase tracking-widest">{gareName}</p>
            <p className="text-sm text-teal-400 font-semibold uppercase tracking-wider">Tableau des départs</p>
          </div>
        </div>
        <Clock />
      </header>

      {/* ── Column headers ─────────────────────────────────────────────── */}
      <div
        className="grid gap-x-4 px-6 py-2 bg-teal-900/60 border-b border-teal-800 shrink-0 text-teal-300 text-xs font-bold uppercase tracking-widest"
        style={{ gridTemplateColumns: '5rem 1fr 8rem 8rem 4rem 10rem 1fr' }}
      >
        <span>Heure</span>
        <span>Destination</span>
        <span>Bus</span>
        <span>Agence</span>
        <span className="text-center">Quai</span>
        <span>Statut</span>
        <span>Remarque</span>
      </div>

      {/* ── Rows ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          {DEMO_ROWS.map(row => (
            <DepartureRowItem key={row.id} row={row} />
          ))}
        </div>
      </div>

      {/* ── Ticker ──────────────────────────────────────────────────────── */}
      <Ticker />

      {/* Inline keyframe for ticker animation */}
      <style>{`
        @keyframes ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

export default DepartureBoard;
