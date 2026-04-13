/**
 * NotFoundPassenger — 404 "Bus manqué"
 *
 * Thème : voyageur qui a raté son arrêt.
 * Illustration : bus qui s'éloigne, passager sur le quai.
 */
import { cn } from '../../../lib/utils';

interface Props {
  onHome?: () => void;
  className?: string;
}

// ─── Illustration SVG ────────────────────────────────────────────────────────

function BusMissedSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Route */}
      <rect x="0" y="175" width="320" height="8" rx="4" fill="#e2e8f0" />
      <rect x="60" y="177" width="30" height="4" rx="2" fill="#cbd5e1" />
      <rect x="140" y="177" width="30" height="4" rx="2" fill="#cbd5e1" />
      <rect x="220" y="177" width="30" height="4" rx="2" fill="#cbd5e1" />

      {/* Bus (qui s'éloigne à droite) */}
      <g transform="translate(170, 100)">
        {/* Carrosserie */}
        <rect x="0" y="0" width="110" height="65" rx="8" fill="#2563eb" />
        {/* Toit arrondi */}
        <rect x="5" y="-8" width="100" height="15" rx="6" fill="#1d4ed8" />
        {/* Fenêtres */}
        <rect x="10" y="10" width="22" height="16" rx="3" fill="#bfdbfe" />
        <rect x="40" y="10" width="22" height="16" rx="3" fill="#bfdbfe" />
        <rect x="70" y="10" width="22" height="16" rx="3" fill="#bfdbfe" />
        {/* Porte */}
        <rect x="8" y="35" width="18" height="22" rx="2" fill="#1e40af" />
        {/* Ligne décorative */}
        <rect x="0" y="28" width="110" height="3" fill="#1e40af" />
        {/* Roues */}
        <circle cx="22" cy="68" r="12" fill="#1e293b" />
        <circle cx="22" cy="68" r="6" fill="#475569" />
        <circle cx="88" cy="68" r="12" fill="#1e293b" />
        <circle cx="88" cy="68" r="6" fill="#475569" />
        {/* Numéro de ligne */}
        <rect x="75" y="35" width="28" height="15" rx="3" fill="#1e40af" />
        <text x="89" y="46" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="monospace">404</text>
        {/* Traînée de vitesse */}
        <rect x="-40" y="20" width="35" height="3" rx="2" fill="#bfdbfe" opacity="0.5" />
        <rect x="-50" y="30" width="45" height="2" rx="2" fill="#bfdbfe" opacity="0.35" />
        <rect x="-30" y="40" width="25" height="2" rx="2" fill="#bfdbfe" opacity="0.25" />
      </g>

      {/* Arrêt de bus */}
      <rect x="30" y="115" width="4" height="60" rx="2" fill="#94a3b8" />
      <rect x="22" y="115" width="40" height="18" rx="3" fill="#64748b" />
      <text x="42" y="128" textAnchor="middle" fill="#fff" fontSize="8" fontFamily="sans-serif">ARRÊT</text>

      {/* Passager sur le quai */}
      <g transform="translate(50, 120)">
        {/* Corps */}
        <ellipse cx="12" cy="12" rx="9" ry="9" fill="#fbbf24" />
        {/* Tête */}
        <circle cx="12" cy="0" r="8" fill="#fde68a" />
        {/* Yeux tristes */}
        <circle cx="9" cy="-1" r="1.2" fill="#78350f" />
        <circle cx="15" cy="-1" r="1.2" fill="#78350f" />
        {/* Bouche triste */}
        <path d="M9 3 Q12 1.5 15 3" stroke="#78350f" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        {/* Bras levé */}
        <line x1="12" y1="16" x2="0" y2="8" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="12" y1="16" x2="24" y2="20" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        {/* Jambes */}
        <line x1="12" y1="22" x2="8" y2="34" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="12" y1="22" x2="16" y2="34" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" />
        {/* Valise */}
        <rect x="18" y="22" width="12" height="10" rx="2" fill="#64748b" />
        <rect x="21" y="20" width="6" height="3" rx="1" fill="#475569" />
      </g>

      {/* Nuage "?" au-dessus du passager */}
      <g transform="translate(20, 60)">
        <ellipse cx="28" cy="20" rx="26" ry="18" fill="#f1f5f9" />
        <ellipse cx="14" cy="28" rx="14" ry="11" fill="#f1f5f9" />
        <ellipse cx="42" cy="26" rx="16" ry="12" fill="#f1f5f9" />
        <text x="28" y="26" textAnchor="middle" fill="#64748b" fontSize="20" fontFamily="sans-serif" fontWeight="bold">?</text>
      </g>
    </svg>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NotFoundPassenger({ onHome, className }: Props) {
  return (
    <div
      className={cn(
        'min-h-screen flex flex-col items-center justify-center gap-8 px-6 py-16',
        'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100',
        className,
      )}
    >
      <BusMissedSvg className="w-72 h-auto max-w-full" />

      <div className="text-center max-w-lg space-y-4">
        {/* Badge 404 */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs font-mono font-semibold tracking-widest uppercase">
          Erreur 404
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Terminus !{' '}
          <span className="text-blue-600 dark:text-blue-400">
            Tout le monde descend.
          </span>
        </h1>

        <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed">
          Oups, il semblerait que vous ayez manqué votre arrêt. Cette page a
          probablement sauté sa correspondance ou a pris un itinéraire de
          déviation. Pas de panique, le prochain passage est pour bientôt&nbsp;!
        </p>
      </div>

      <button
        onClick={onHome}
        className={cn(
          'inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm',
          'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white',
          'transition-colors focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        )}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h3a1 1 0 001-1v-3h2v3a1 1 0 001 1h3a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
        </svg>
        Retourner à la gare
      </button>

      {/* Pied de page discret */}
      <p className="text-xs text-slate-400 dark:text-slate-600 font-mono">
        404 · Page introuvable · TranslogPro
      </p>
    </div>
  );
}

export default NotFoundPassenger;
