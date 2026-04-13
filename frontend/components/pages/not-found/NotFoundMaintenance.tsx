/**
 * NotFoundMaintenance — 404 "Panne sèche"
 *
 * Thème : mécanique — bus en panne sous le capot ouvert.
 * Illustration : bus immobilisé, mécanicien en dessous, fumée.
 */
import { cn } from '../../../lib/utils';

interface Props {
  onNextBus?: () => void;
  className?: string;
}

// ─── Illustration SVG ────────────────────────────────────────────────────────

function BreakdownSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Fond route */}
      <rect x="0" y="178" width="320" height="10" rx="3" fill="#e2e8f0" />
      <rect x="30"  y="181" width="28" height="4" rx="2" fill="#cbd5e1" />
      <rect x="100" y="181" width="28" height="4" rx="2" fill="#cbd5e1" />
      <rect x="170" y="181" width="28" height="4" rx="2" fill="#cbd5e1" />
      <rect x="240" y="181" width="28" height="4" rx="2" fill="#cbd5e1" />

      {/* Bus en panne */}
      <g transform="translate(60, 95)">
        {/* Carrosserie */}
        <rect x="0" y="0" width="175" height="72" rx="9" fill="#64748b" />
        {/* Toit */}
        <rect x="6" y="-10" width="163" height="16" rx="7" fill="#475569" />
        {/* Fenêtres — toutes éteintes / vides */}
        <rect x="12" y="10" width="28" height="20" rx="3" fill="#334155" />
        <rect x="48" y="10" width="28" height="20" rx="3" fill="#334155" />
        <rect x="84" y="10" width="28" height="20" rx="3" fill="#334155" />
        <rect x="120" y="10" width="28" height="20" rx="3" fill="#334155" />
        {/* Porte */}
        <rect x="10" y="40" width="22" height="26" rx="3" fill="#334155" />
        {/* Ligne décorative */}
        <rect x="0" y="36" width="175" height="3" fill="#475569" />
        {/* Roues à plat (ellipses aplaties) */}
        <ellipse cx="35"  cy="76" rx="18" ry="10" fill="#1e293b" />
        <ellipse cx="35"  cy="76" rx="9"  ry="5"  fill="#334155" />
        <ellipse cx="140" cy="76" rx="18" ry="10" fill="#1e293b" />
        <ellipse cx="140" cy="76" rx="9"  ry="5"  fill="#334155" />
        {/* Capot avant ouvert */}
        <path d="M155 0 L175 0 L175 -10 L165 -24 L145 -18 Z" fill="#94a3b8" stroke="#64748b" strokeWidth="1.5" />
        {/* Ressort cassé visible */}
        <path d="M168 -10 Q172 -16 168 -20" stroke="#ef4444" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* Triangle de signalisation */}
        <g transform="translate(-20, 45)">
          <path d="M10 0 L20 17 L0 17 Z" fill="#ef4444" />
          <text x="10" y="13" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">!</text>
        </g>
        {/* Numéro de ligne éteint */}
        <rect x="130" y="42" width="34" height="18" rx="3" fill="#1e293b" />
        <text x="147" y="55" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">---</text>
      </g>

      {/* Fumée sortant du capot */}
      <g opacity="0.75">
        <ellipse cx="232" cy="88" rx="12" ry="9"  fill="#cbd5e1" />
        <ellipse cx="224" cy="76" rx="10" ry="8"  fill="#e2e8f0" />
        <ellipse cx="234" cy="65" rx="14" ry="10" fill="#f1f5f9" />
        <ellipse cx="226" cy="54" rx="10" ry="8"  fill="#e2e8f0" opacity="0.7" />
        <ellipse cx="238" cy="44" rx="8"  ry="7"  fill="#f8fafc"  opacity="0.5" />
      </g>

      {/* Mécanicien sous le bus */}
      <g transform="translate(90, 165)">
        {/* Corps allongé */}
        <ellipse cx="32" cy="8" rx="32" ry="7" fill="#fbbf24" />
        {/* Tête */}
        <circle cx="5" cy="5" r="8" fill="#fde68a" />
        {/* Casquette mécanicien */}
        <path d="M-2 3 Q5 -4 12 3" fill="#1e293b" />
        <rect x="-4" y="2" width="18" height="3" rx="1" fill="#0f172a" />
        {/* Yeux concentrés */}
        <line x1="2" y1="5" x2="5" y2="5" stroke="#92400e" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="7" y1="5" x2="10" y2="5" stroke="#92400e" strokeWidth="1.2" strokeLinecap="round" />
        {/* Bras avec clé à molette */}
        <line x1="55" y1="8" x2="72" y2="3" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" />
        {/* Clé à molette */}
        <ellipse cx="76" cy="2" rx="7" ry="4" fill="#94a3b8" />
        <rect x="70" y="1" width="12" height="2" rx="1" fill="#64748b" />
        <rect x="83" y="0" width="8" height="4" rx="1" fill="#94a3b8" />
        {/* Jambes dépassant */}
        <line x1="60" y1="10" x2="70" y2="20" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" />
        <line x1="50" y1="11" x2="58" y2="22" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" />
      </g>

      {/* Boîte à outils */}
      <g transform="translate(20, 165)">
        <rect x="0" y="0" width="28" height="18" rx="3" fill="#dc2626" />
        <rect x="6" y="-5" width="16" height="7" rx="2" fill="#b91c1c" />
        {/* Outils */}
        <rect x="4"  y="4"  width="6"  height="2" rx="1" fill="#fca5a5" />
        <rect x="12" y="4"  width="10" height="2" rx="1" fill="#fca5a5" />
        <rect x="4"  y="9"  width="14" height="2" rx="1" fill="#fca5a5" />
        <rect x="20" y="9"  width="4"  height="2" rx="1" fill="#fca5a5" />
      </g>

      {/* Panneau de déviation */}
      <g transform="translate(270, 100)">
        <rect x="8" y="40" width="4" height="55" rx="2" fill="#94a3b8" />
        <rect x="0" y="20" width="28" height="22" rx="3" fill="#f59e0b" />
        <text x="14" y="28" textAnchor="middle" fill="#78350f" fontSize="7" fontWeight="bold" fontFamily="sans-serif">DÉVIA-</text>
        <text x="14" y="37" textAnchor="middle" fill="#78350f" fontSize="7" fontWeight="bold" fontFamily="sans-serif">TION</text>
        <path d="M6 10 L14 0 L22 10 Z" fill="#f59e0b" />
      </g>

      {/* Étoiles / étincelles */}
      <text x="238" y="103" fill="#fbbf24" fontSize="12" opacity="0.8">✦</text>
      <text x="252" y="96"  fill="#fbbf24" fontSize="8"  opacity="0.6">✦</text>
      <text x="244" y="115" fill="#fbbf24" fontSize="6"  opacity="0.5">✦</text>
    </svg>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NotFoundMaintenance({ onNextBus, className }: Props) {
  return (
    <div
      className={cn(
        'min-h-screen flex flex-col items-center justify-center gap-8 px-6 py-16',
        'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100',
        className,
      )}
    >
      <BreakdownSvg className="w-72 h-auto max-w-full" />

      <div className="text-center max-w-lg space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs font-mono font-semibold tracking-widest uppercase">
          Erreur 404
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Panne sèche sur{' '}
          <span className="text-red-600 dark:text-red-400">
            l&apos;autoroute du Web.
          </span>
        </h1>

        <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed">
          Le moteur a calé juste avant d&apos;afficher cette destination. Nos
          mécaniciens sont déjà sous le capot pour vérifier le circuit. En
          attendant, on vous propose de changer de véhicule.
        </p>
      </div>

      <button
        onClick={onNextBus}
        className={cn(
          'inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm',
          'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white',
          'transition-colors focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-red-500 focus-visible:ring-offset-2',
        )}
      >
        {/* Icône bus */}
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
          <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1v-1h3.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1v-4a1 1 0 00-.293-.707l-3-3A1 1 0 0016 5h-1V4a1 1 0 00-1-1H3zm11 4h-1V6h1l2 2h-2z" />
        </svg>
        Prendre le prochain bus
      </button>

      <p className="text-xs text-slate-400 dark:text-slate-600 font-mono">
        404 · Panne détectée · TranslogPro
      </p>
    </div>
  );
}

export default NotFoundMaintenance;
