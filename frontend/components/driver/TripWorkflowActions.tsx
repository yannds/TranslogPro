/**
 * TripWorkflowActions — panneau d'actions contextuelles sur un trajet.
 *
 * Expose les 3 transitions driver autorisées par le backend :
 *   - PLANNED/OPEN  → BOARDING       (« Ouvrir l'embarquement »)
 *   - BOARDING      → IN_PROGRESS    (« Démarrer le voyage »)
 *   - IN_PROGRESS   → COMPLETED      (« Arrivé à destination »)
 *
 * Le backend `flight-deck.service.updateTripStatus` ([flight-deck.service.ts:215-253])
 * fait autorité sur la séquence ; toute transition non-autorisée renvoie 400.
 * Ce composant projette simplement l'état courant sur les boutons autorisés —
 * l'UI ne réplique jamais la machine à états.
 *
 * Mode réutilisable :
 *   - `role='driver'`  : affiche tous les boutons (défaut)
 *   - `role='agent'`   : cache le bouton Démarrer (réservé chauffeur) — quand
 *     les pages station/quai seront câblées à un endpoint agent-level, ce prop
 *     permettra la réutilisation. Pas de bouton « Annuler » par design :
 *     l'annulation reste une action tenant-admin (scope .tenant).
 *
 * Mobile-first : boutons larges (min-height 44px), empilés vert. en <sm, 2 cols
 * en ≥sm. `aria-busy` pendant la requête, focus visible, labels i18n.
 */

import { useState } from 'react';
import { DoorOpen, Play, Flag, Loader2, FileSignature, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiPost, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';

export type TripWorkflowRole = 'driver' | 'agent';

interface Props {
  tenantId: string;
  tripId:   string;
  status:   string;
  role?:    TripWorkflowRole;
  /** Appelé après une transition réussie — le parent refetch le détail. */
  onTransitioned?: () => void;
  /** Affiche aussi le bouton « Voir le manifeste » (nav vers /driver/manifest). */
  showManifest?: boolean;
}

type NextStatus = 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED';

// Mapping UI-label → (statut attendu côté backend). Seule la transition "next"
// du state graph est activée ; les autres sont en outline/disabled pour
// montrer la progression sans permettre les sauts d'étapes (backend 400).
const NEXT_FOR: Record<string, NextStatus | null> = {
  PLANNED:             'BOARDING',
  OPEN:                'BOARDING',
  BOARDING:            'IN_PROGRESS',
  IN_PROGRESS:         'COMPLETED',
  IN_PROGRESS_PAUSED:  'COMPLETED',
  IN_PROGRESS_DELAYED: 'COMPLETED',
  COMPLETED:           null,
  CANCELLED:           null,
};

export function TripWorkflowActions({
  tenantId, tripId, status, role = 'driver', onTransitioned, showManifest,
}: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<NextStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextExpected = NEXT_FOR[status] ?? null;

  async function transitionTo(next: NextStatus) {
    setBusy(next); setError(null);
    try {
      await apiPost(`/api/tenants/${tenantId}/flight-deck/trips/${tripId}/status`, { status: next });
      onTransitioned?.();
    } catch (e) {
      setError(e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e));
    } finally { setBusy(null); }
  }

  // ── Helper : bouton contextuel à un statut attendu ──────────────────────────
  // Activé seulement si le trajet est dans l'état qui permet cette transition.
  // Sinon il reste visible en outline/désactivé pour repère visuel du flow.
  function ActionButton({
    targetNext, icon, label, variant = 'default',
  }: {
    targetNext: NextStatus;
    icon: React.ReactNode;
    label: string;
    variant?: 'default' | 'outline';
  }) {
    const isNext    = nextExpected === targetNext;
    const isLoading = busy === targetNext;
    return (
      <Button
        variant={isNext ? variant : 'outline'}
        disabled={!isNext || busy !== null}
        onClick={() => transitionTo(targetNext)}
        leftIcon={isLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : icon}
        className="min-h-[44px] w-full justify-center"
        aria-busy={isLoading}
      >
        {label}
      </Button>
    );
  }

  return (
    <section
      aria-label={t('tripActions.sectionLabel')}
      className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800"
    >
      <header>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('tripActions.sectionLabel')}
        </h4>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          {t('tripActions.sectionHint')}
        </p>
      </header>

      <ErrorAlert error={error} icon />

      {/* Boutons de transition — 2 colonnes ≥sm, empilés sur mobile pour tap
          facile. Le bouton actif (isNext) est en variant par défaut, les
          autres sont outline pour visualiser la progression. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ActionButton
          targetNext="BOARDING"
          icon={<DoorOpen className="w-4 h-4" aria-hidden />}
          label={t('tripActions.openBoarding')}
        />
        {/* Le bouton « Démarrer » reste présent en mode driver. En mode agent
            on le cache (scope réservé chauffeur côté backend guard). */}
        {role === 'driver' && (
          <ActionButton
            targetNext="IN_PROGRESS"
            icon={<Play className="w-4 h-4" aria-hidden />}
            label={t('tripActions.startTrip')}
          />
        )}
        <ActionButton
          targetNext="COMPLETED"
          icon={<Flag className="w-4 h-4" aria-hidden />}
          label={t('tripActions.arriveDestination')}
        />
      </div>

      {/* Actions transverses — liens contextuels, pas de transition d'état.
          Signer manifeste = raccourci vers /driver/manifest où la signature
          vit déjà (permission data.manifest.sign.agency). */}
      <div className="flex flex-wrap gap-2 pt-1">
        {showManifest && (
          <Button
            variant="ghost" size="sm"
            onClick={() => navigate('/driver/manifest')}
            leftIcon={<FileSignature className="w-4 h-4" aria-hidden />}
            className="min-h-[36px]"
          >
            {t('tripActions.signManifest')}
          </Button>
        )}
        <Button
          variant="ghost" size="sm"
          onClick={() => navigate('/driver/checkin')}
          leftIcon={<ClipboardList className="w-4 h-4" aria-hidden />}
          className="min-h-[36px]"
        >
          {t('tripActions.checkInPassengers')}
        </Button>
      </div>
    </section>
  );
}
