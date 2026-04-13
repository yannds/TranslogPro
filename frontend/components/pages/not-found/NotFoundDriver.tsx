/**
 * NotFoundDriver — 404 "Erreur d'itinéraire"
 *
 * Thème : chauffeur — GPS perdu, route non répertoriée.
 * Illustration : bus sur une route qui disparaît, GPS affolé.
 */
import { cn } from '../../../lib/utils';

interface Props {
  onRecalculate?: () => void;
  className?: string;
}

// ─── Illustration SVG ────────────────────────────────────────────────────────

function GpsLostSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Ciel nuageux */}
      <ellipse cx="60"  cy="40" rx="45" ry="28" fill="#f1f5f9" />
      <ellipse cx="95"  cy="30" rx="38" ry="24" fill="#e2e8f0" />
      <ellipse cx="240" cy="45" rx="50" ry="30" fill="#f1f5f9" />
      <ellipse cx="275" cy="35" rx="35" ry="22" fill="#e2e8f0" />

      {/* Route qui tourne et disparaît */}
      {/* Tronçon droit */}
      <rect x="0" y="170" width="180" height="12" rx="2" fill="#94a3b8" />
      {/* Ligne blanche centrale */}
      <rect x="20"  y="175" width="25" height="3" rx="1" fill="#fff" opacity="0.7" />
      <rect x="65"  y="175" width="25" height="3" rx="1" fill="#fff" opacity="0.7" />
      <rect x="110" y="175" width="25" height="3" rx="1" fill="#fff" opacity="0.7" />
      <rect x="155" y="175" width="20" height="3" rx="1" fill="#fff" opacity="0.7" />
      {/* Virage */}
      <path
        d="M180 176 Q210 176 230 155 Q250 134 250 110"
        stroke="#94a3b8" strokeWidth="12" fill="none" strokeLinecap="round"
      />
      {/* La route s'efface (pointillés qui disparaissent) */}
      <path
        d="M250 110 Q252 90 255 75"
        stroke="#94a3b8" strokeWidth="8" fill="none"
        strokeDasharray="8 6" strokeLinecap="round" opacity="0.6"
      />
      <path
        d="M255 75 Q258 62 260 55"
        stroke="#94a3b8" strokeWidth="5" fill="none"
        strokeDasharray="5 5" strokeLinecap="round" opacity="0.3"
      />

      {/* Bus sur la route */}
      <g transform="translate(30, 130)">
        {/* Carrosserie */}
        <rect x="0" y="0" width="90" height="52" rx="7" fill="#16a34a" />
        {/* Toit */}
        <rect x="4" y="-7" width="82" height="12" rx="5" fill="#15803d" />
        {/* Fenêtres */}
        <rect x="8"  y="8" width="18" height="13" rx="2" fill="#bbf7d0" />
        <rect x="32" y="8" width="18" height="13" rx="2" fill="#bbf7d0" />
        <rect x="56" y="8" width="18" height="13" rx="2" fill="#bbf7d0" />
        {/* Porte */}
        <rect x="6" y="27" width="14" height="18" rx="2" fill="#166534" />
        {/* Bande décorative */}
        <rect x="0" y="23" width="90" height="3" fill="#15803d" />
        {/* Roues */}
        <circle cx="18" cy="54" r="10" fill="#1e293b" />
        <circle cx="18" cy="54" r="5"  fill="#475569" />
        <circle cx="72" cy="54" r="10" fill="#1e293b" />
        <circle cx="72" cy="54" r="5"  fill="#475569" />
        {/* Phares allumés */}
        <rect x="74" y="10" width="10" height="6" rx="2" fill="#fef08a" />
        <path d="M84 13 L100 8 L100 18 Z" fill="#fef08a" opacity="0.4" />
      </g>

      {/* GPS sur le tableau de bord (dans le bus) */}
      <g transform="translate(60, 138)">
        <rect x="0" y="0" width="22" height="16" rx="3" fill="#0f172a" />
        <rect x="2" y="2" width="18" height="10" rx="2" fill="#dc2626" />
        {/* Écran qui bugue — lignes de signal */}
        <line x1="4"  y1="5"  x2="8"  y2="5"  stroke="#fff" strokeWidth="1" />
        <line x1="10" y1="5"  x2="18" y2="5"  stroke="#fff" strokeWidth="1" opacity="0.4" />
        <line x1="4"  y1="8"  x2="14" y2="8"  stroke="#fff" strokeWidth="1" opacity="0.6" />
        <line x1="16" y1="8"  x2="18" y2="8"  stroke="#fff" strokeWidth="1" />
        <text x="11" y="10" textAnchor="middle" fill="#fef2f2" fontSize="5" fontFamily="monospace">GPS?</text>
        <rect x="8" y="13" width="6" height="3" rx="1" fill="#1e293b" />
      </g>

      {/* Icône GPS perdu / satellite */}
      <g transform="translate(248, 28)">
        {/* Satellite */}
        <rect x="14" y="8" width="20" height="12" rx="2" fill="#475569" />
        <rect x="2"  y="11" width="12" height="6" rx="2" fill="#60a5fa" />
        <rect x="34" y="11" width="12" height="6" rx="2" fill="#60a5fa" />
        <circle cx="24" cy="14" r="4" fill="#94a3b8" />
        {/* Signal coupé */}
        <line x1="18" y1="26" x2="24" y2="38" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 2" />
        <line x1="30" y1="26" x2="24" y2="38" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 2" />
        {/* X rouge */}
        <circle cx="24" cy="44" r="8" fill="#fee2e2" />
        <line x1="20" y1="40" x2="28" y2="48" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <line x1="28" y1="40" x2="20" y2="48" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Panneau "Route inconnue" */}
      <g transform="translate(195, 120)">
        {/* Poteau */}
        <rect x="14" y="28" width="4" height="40" rx="2" fill="#94a3b8" />
        {/* Panneau triangulaire danger */}
        <path d="M16 0 L32 28 L0 28 Z" fill="#fef08a" stroke="#ca8a04" strokeWidth="2" />
        <text x="16" y="22" textAnchor="middle" fill="#92400e" fontSize="14" fontWeight="bold" fontFamily="sans-serif">?</text>
      </g>

      {/* Points d'interrogation flottants */}
      <text x="155" y="85"  fill="#94a3b8" fontSize="18" fontFamily="sans-serif" opacity="0.6">?</text>
      <text x="175" y="110" fill="#94a3b8" fontSize="13" fontFamily="sans-serif" opacity="0.4">?</text>
      <text x="140" y="108" fill="#94a3b8" fontSize="10" fontFamily="sans-serif" opacity="0.3">?</text>
    </svg>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NotFoundDriver({ onRecalculate, className }: Props) {
  return (
    <div
      className={cn(
        'min-h-screen flex flex-col items-center justify-center gap-8 px-6 py-16',
        'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100',
        className,
      )}
    >
      <GpsLostSvg className="w-72 h-auto max-w-full" />

      <div className="text-center max-w-lg space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 text-xs font-mono font-semibold tracking-widest uppercase">
          Erreur 404
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Faites demi-tour{' '}
          <span className="text-green-600 dark:text-green-400">
            dès que possible&nbsp;!
          </span>
        </h1>

        <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed">
          Notre GPS interne vient de perdre le signal. Vous vous trouvez
          actuellement sur une route non répertoriée. Inutile d&apos;appeler la
          dépanneuse, on vous aide à retrouver l&apos;autoroute principale.
        </p>
      </div>

      <button
        onClick={onRecalculate}
        className={cn(
          'inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm',
          'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white',
          'transition-colors focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-green-500 focus-visible:ring-offset-2',
        )}
      >
        {/* Icône recalcul / refresh */}
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
        </svg>
        Recalculer l&apos;itinéraire
      </button>

      <p className="text-xs text-slate-400 dark:text-slate-600 font-mono">
        404 · Route inconnue · TranslogPro
      </p>
    </div>
  );
}

export default NotFoundDriver;
