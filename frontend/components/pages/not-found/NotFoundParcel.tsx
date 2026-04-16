/**
 * NotFoundParcel — 404 "Colis égaré"
 *
 * Thème : logistique — colis introuvable en entrepôt.
 * Illustration : colis avec des jambes qui s'enfuit des rayonnages.
 */
import { cn } from '../../../lib/utils';
import { useI18n } from '../../../lib/i18n/useI18n';

interface Props {
  onTrack?: () => void;
  className?: string;
}

// ─── Illustration SVG ────────────────────────────────────────────────────────

function ParcelLostSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Entrepôt / rayonnages en fond */}
      {/* Étagère gauche */}
      <rect x="10" y="60" width="6" height="130" rx="2" fill="#cbd5e1" />
      <rect x="10" y="80"  width="70" height="5" rx="2" fill="#94a3b8" />
      <rect x="10" y="120" width="70" height="5" rx="2" fill="#94a3b8" />
      <rect x="10" y="160" width="70" height="5" rx="2" fill="#94a3b8" />
      <rect x="76" y="60" width="6" height="130" rx="2" fill="#cbd5e1" />
      {/* Colis sur l'étagère gauche */}
      <rect x="16" y="62" width="24" height="18" rx="2" fill="#fb923c" />
      <line x1="28" y1="62" x2="28" y2="80" stroke="#ea580c" strokeWidth="1.5" />
      <rect x="44" y="65" width="26" height="15" rx="2" fill="#fbbf24" />
      <line x1="57" y1="65" x2="57" y2="80" stroke="#d97706" strokeWidth="1.5" />

      <rect x="16" y="102" width="28" height="18" rx="2" fill="#a78bfa" />
      <rect x="50" y="104" width="20" height="16" rx="2" fill="#60a5fa" />

      <rect x="16" y="142" width="22" height="18" rx="2" fill="#34d399" />
      <rect x="44" y="144" width="26" height="16" rx="2" fill="#f472b6" />

      {/* Espace vide (colis manquant) */}
      <rect x="18" y="86" width="26" height="15" rx="2" fill="#f8fafc" stroke="#e2e8f0" strokeDasharray="3 2" />
      <text x="31" y="97" textAnchor="middle" fill="#cbd5e1" fontSize="9" fontFamily="sans-serif">?</text>

      {/* Étagère droite */}
      <rect x="234" y="60" width="6" height="130" rx="2" fill="#cbd5e1" />
      <rect x="234" y="80"  width="70" height="5" rx="2" fill="#94a3b8" />
      <rect x="234" y="120" width="70" height="5" rx="2" fill="#94a3b8" />
      <rect x="234" y="160" width="70" height="5" rx="2" fill="#94a3b8" />
      <rect x="296" y="60" width="6" height="130" rx="2" fill="#cbd5e1" />
      {/* Colis sur l'étagère droite */}
      <rect x="240" y="62" width="20" height="18" rx="2" fill="#f472b6" />
      <rect x="266" y="64" width="28" height="16" rx="2" fill="#60a5fa" />
      <rect x="240" y="102" width="24" height="18" rx="2" fill="#fbbf24" />
      <rect x="240" y="142" width="22" height="18" rx="2" fill="#fb923c" />
      <rect x="268" y="144" width="26" height="16" rx="2" fill="#a78bfa" />

      {/* Sol */}
      <rect x="0" y="185" width="320" height="6" rx="3" fill="#e2e8f0" />

      {/* Colis avec des jambes qui s'enfuit */}
      <g transform="translate(118, 95)">
        {/* Corps du colis */}
        <rect x="0" y="0" width="52" height="48" rx="6" fill="#f59e0b" />
        {/* Ombre sous le colis */}
        <ellipse cx="26" cy="52" rx="22" ry="5" fill="#00000015" />
        {/* Croix d'emballage */}
        <line x1="26" y1="0" x2="26" y2="48" stroke="#d97706" strokeWidth="2" />
        <line x1="0" y1="24" x2="52" y2="24" stroke="#d97706" strokeWidth="2" />
        {/* Étiquette */}
        <rect x="8" y="8" width="36" height="12" rx="2" fill="#fef3c7" />
        <line x1="11" y1="12" x2="40" y2="12" stroke="#d97706" strokeWidth="1" />
        <line x1="11" y1="16" x2="34" y2="16" stroke="#d97706" strokeWidth="1" opacity="0.5" />
        {/* Yeux (trous de l'emballage) */}
        <circle cx="17" cy="30" r="4" fill="#fff" />
        <circle cx="35" cy="30" r="4" fill="#fff" />
        <circle cx="18" cy="30" r="2" fill="#1e293b" />
        <circle cx="36" cy="30" r="2" fill="#1e293b" />
        {/* Bouche espiègle */}
        <path d="M17 38 Q26 44 35 38" stroke="#92400e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* Jambes du colis qui court */}
        <line x1="14" y1="48" x2="4"  y2="68" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
        <line x1="14" y1="48" x2="18" y2="70" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
        <line x1="38" y1="48" x2="30" y2="70" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
        <line x1="38" y1="48" x2="48" y2="67" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
        {/* Chaussures */}
        <ellipse cx="4"  cy="70" rx="6" ry="4" fill="#92400e" />
        <ellipse cx="18" cy="72" rx="6" ry="4" fill="#92400e" />
        <ellipse cx="30" cy="72" rx="6" ry="4" fill="#92400e" />
        <ellipse cx="48" cy="69" rx="6" ry="4" fill="#92400e" />
        {/* Traînée de mouvement */}
        <line x1="-10" y1="20" x2="-25" y2="20" stroke="#fde68a" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        <line x1="-10" y1="28" x2="-30" y2="28" stroke="#fde68a" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="-10" y1="36" x2="-20" y2="36" stroke="#fde68a" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      </g>

      {/* Points de suspension de recherche */}
      <circle cx="100" cy="50" r="4" fill="#f59e0b" opacity="0.8" />
      <circle cx="115" cy="40" r="3" fill="#f59e0b" opacity="0.6" />
      <circle cx="130" cy="33" r="2" fill="#f59e0b" opacity="0.4" />
    </svg>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NotFoundParcel({ onTrack, className }: Props) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'min-h-screen flex flex-col items-center justify-center gap-8 px-6 py-16',
        'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100',
        className,
      )}
    >
      <ParcelLostSvg className="w-72 h-auto max-w-full" />

      <div className="text-center max-w-lg space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-xs font-mono font-semibold tracking-widest uppercase">
          {t('notFoundParcel.badge')}
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {t('notFoundParcel.title1')}{' '}
          <span className="text-amber-500 dark:text-amber-400">
            {t('notFoundParcel.title2')}
          </span>
        </h1>

        <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed">
          {t('notFoundParcel.body')}
        </p>
      </div>

      <button
        onClick={onTrack}
        className={cn(
          'inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-sm',
          'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white',
          'transition-colors focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-amber-400 focus-visible:ring-offset-2',
        )}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
        </svg>
        {t('notFoundParcel.button')}
      </button>

      <p className="text-xs text-slate-400 dark:text-slate-600 font-mono">
        {t('notFoundParcel.footer')}
      </p>
    </div>
  );
}

export default NotFoundParcel;
