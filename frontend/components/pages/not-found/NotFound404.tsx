/**
 * NotFound404 — Switcher entre les 4 variantes 404.
 *
 * Sélection de la variante :
 *   - prop `variant` explicite (passenger | parcel | driver | maintenance)
 *   - OU aléatoire si variant='random' (défaut)
 *
 * Usage Next.js (app router) :
 *   // app/not-found.tsx
 *   import { NotFound404 } from '@/components/pages/not-found';
 *   export default function NotFound() {
 *     return <NotFound404 variant="random" onAction={() => router.push('/')} />;
 *   }
 *
 * Usage Next.js (pages router) :
 *   // pages/404.tsx
 *   import { NotFound404 } from '@/components/pages/not-found';
 *   export default function Page404() {
 *     return <NotFound404 />;
 *   }
 */
import { useMemo }              from 'react';
import { NotFoundPassenger }   from './NotFoundPassenger';
import { NotFoundParcel }      from './NotFoundParcel';
import { NotFoundDriver }      from './NotFoundDriver';
import { NotFoundMaintenance } from './NotFoundMaintenance';

export type NotFound404Variant =
  | 'passenger'
  | 'parcel'
  | 'driver'
  | 'maintenance'
  | 'random';

interface Props {
  variant?:  NotFound404Variant;
  /** Callback commun pour le bouton d'action (navigation, router.push, etc.) */
  onAction?: () => void;
  className?: string;
}

const VARIANTS: Exclude<NotFound404Variant, 'random'>[] = [
  'passenger',
  'parcel',
  'driver',
  'maintenance',
];

export function NotFound404({ variant = 'random', onAction, className }: Props) {
  const resolved = useMemo<Exclude<NotFound404Variant, 'random'>>(() => {
    if (variant !== 'random') return variant;
    return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
  }, [variant]);

  switch (resolved) {
    case 'passenger':
      return <NotFoundPassenger   onHome={onAction}        className={className} />;
    case 'parcel':
      return <NotFoundParcel      onTrack={onAction}       className={className} />;
    case 'driver':
      return <NotFoundDriver      onRecalculate={onAction} className={className} />;
    case 'maintenance':
      return <NotFoundMaintenance onNextBus={onAction}     className={className} />;
  }
}

export default NotFound404;
