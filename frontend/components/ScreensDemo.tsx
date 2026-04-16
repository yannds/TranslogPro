/**
 * ScreensDemo — Navigateur de démonstration des 8 écrans TranslogPro
 *
 * Permet de basculer entre tous les prototypes d'interface depuis une
 * barre de sélection. Usage : dev / présentation client.
 */

import { useState } from 'react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n/useI18n';

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

/* Labels/desc are i18n keys resolved at render time — see screensDemo namespace */

export function ScreensDemo() {
  const { t } = useI18n();
  const [active, setActive] = useState<ScreenId>('portail');
  const [menuOpen, setMenuOpen] = useState(false);

  const SCREENS: { id: ScreenId; label: string; icon: string; desc: string; device: string }[] = [
    { id: 'portail',        label: t('screensDemo.portail'),        icon: '🌐', desc: t('screensDemo.portailDesc'),        device: t('screensDemo.deviceWeb') },
    { id: 'departure-board',label: t('screensDemo.departureBoard'), icon: '📺', desc: t('screensDemo.departureBoardDesc'), device: t('screensDemo.deviceTv') },
    { id: 'bus-screen',     label: t('screensDemo.busScreen'),      icon: '🚌', desc: t('screensDemo.busScreenDesc'),      device: t('screensDemo.deviceOnboard') },
    { id: 'quai-screen',    label: t('screensDemo.quaiScreen'),     icon: '🚏', desc: t('screensDemo.quaiScreenDesc'),     device: t('screensDemo.deviceLed') },
    { id: 'station-agent',  label: t('screensDemo.stationAgent'),   icon: '🎫', desc: t('screensDemo.stationAgentDesc'),   device: t('screensDemo.deviceTablet') },
    { id: 'quai-agent',     label: t('screensDemo.quaiAgent'),      icon: '📋', desc: t('screensDemo.quaiAgentDesc'),      device: t('screensDemo.deviceMobileTablet') },
    { id: 'driver',         label: t('screensDemo.driver'),         icon: '🧑‍✈️', desc: t('screensDemo.driverDesc'),      device: t('screensDemo.deviceMobile') },
    { id: 'admin',          label: t('screensDemo.admin'),          icon: '⚙️', desc: t('screensDemo.adminDesc'),          device: t('screensDemo.deviceDesktop') },
  ];

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
              {t('screensDemo.toolbarTitle')}
            </span>
          </div>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="text-xs text-slate-400 hover:text-teal-400 transition-colors lg:hidden"
          >
            {menuOpen ? `✕ ${t('screensDemo.close')}` : `≡ ${t('screensDemo.screens')}`}
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
