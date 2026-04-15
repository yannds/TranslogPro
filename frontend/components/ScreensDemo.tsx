/**
 * ScreensDemo — Navigateur de démonstration des 8 écrans TranslogPro
 *
 * Permet de basculer entre tous les prototypes d'interface depuis une
 * barre de sélection. Usage : dev / présentation client.
 */

import { useState } from 'react';
import { cn } from '../lib/utils';

import { PortailVoyageur }  from './portail-voyageur';
import { DepartureBoard, BusScreen, QuaiScreen } from './display';
import { StationAgentApp, QuaiAgentApp }         from './agent';
import { DriverSpace }      from './driver';
import { AdminDashboard }   from './admin';

type ScreenId =
  | 'portail'
  | 'departure-board'
  | 'bus-screen'
  | 'quai-screen'
  | 'station-agent'
  | 'quai-agent'
  | 'driver'
  | 'admin';

const SCREENS: { id: ScreenId; label: string; icon: string; desc: string; device: string }[] = [
  { id: 'portail',        label: 'Portail Client',      icon: '🌐', desc: 'Site public de réservation',         device: 'Web (responsive)' },
  { id: 'departure-board',label: 'Tableau Départs',     icon: '📺', desc: 'Écran TV gare routière',             device: 'TV / Kiosque' },
  { id: 'bus-screen',     label: 'Écran Bus',           icon: '🚌', desc: 'Affichage à bord du véhicule',       device: 'Écran embarqué' },
  { id: 'quai-screen',    label: 'Écran Quai',          icon: '🚏', desc: 'Panneau informatif au quai',         device: 'TV / LED Quai' },
  { id: 'station-agent',  label: 'Agent de Gare',       icon: '🎫', desc: 'App vente & check-in (tablette)',    device: 'Tablette' },
  { id: 'quai-agent',     label: 'Agent de Quai',       icon: '📋', desc: 'App manifeste & scanner (mobile)',   device: 'Mobile / Tablette' },
  { id: 'driver',         label: 'Espace Chauffeur',    icon: '🧑‍✈️', desc: 'App chauffeur avec SOS (mobile)', device: 'Mobile' },
  { id: 'admin',          label: 'Admin Panel',         icon: '⚙️', desc: 'Dashboard administrateur',          device: 'Desktop' },
];

export function ScreensDemo() {
  const [active, setActive] = useState<ScreenId>('portail');
  const [menuOpen, setMenuOpen] = useState(false);

  const current = SCREENS.find(s => s.id === active)!;

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* ── Demo toolbar ──────────────────────────────────────────────── */}
      <div className="shrink-0 bg-slate-900 border-b border-slate-700 z-50">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <div className="flex-1 text-center">
            <span className="text-xs text-slate-500 font-medium">
              TranslogPro — Démonstration interfaces
            </span>
          </div>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="text-xs text-slate-400 hover:text-teal-400 transition-colors lg:hidden"
          >
            {menuOpen ? '✕ Fermer' : '≡ Écrans'}
          </button>
        </div>

        {/* Screen selector (desktop: always visible, mobile: toggle) */}
        <div className={cn(
          'flex items-center gap-1 px-3 py-2 overflow-x-auto',
          menuOpen ? 'flex' : 'hidden lg:flex',
        )}>
          {SCREENS.map(s => (
            <button
              key={s.id}
              onClick={() => { setActive(s.id); setMenuOpen(false); }}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all shrink-0',
                active === s.id
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
              )}
            >
              <span>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Device info bar ───────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-1.5 bg-slate-950 border-b border-slate-800/50">
        <span className="text-[11px] font-bold text-teal-400">{current.icon} {current.label}</span>
        <span className="text-[11px] text-slate-600">{current.desc}</span>
        <span className="ml-auto text-[11px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
          {current.device}
        </span>
      </div>

      {/* ── Screen render ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {active === 'portail'         && <div className="h-full overflow-y-auto"><PortailVoyageur /></div>}
        {active === 'departure-board' && <DepartureBoard />}
        {active === 'bus-screen'      && <BusScreen />}
        {active === 'quai-screen'     && <QuaiScreen />}
        {active === 'station-agent'   && <StationAgentApp />}
        {active === 'quai-agent'      && <QuaiAgentApp />}
        {active === 'driver'          && <DriverSpace />}
        {active === 'admin'           && <AdminDashboard />}
      </div>
    </div>
  );
}

export default ScreensDemo;
