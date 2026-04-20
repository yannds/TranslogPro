/**
 * notify — Wrapper centralisé au-dessus de Sonner.
 *
 * Usage : `notify.success('Billet vendu', { description: 'N° TK-2345' })`.
 *
 * Stockage : Set des IDs actifs mis à jour via onDismiss/onAutoClose de Sonner,
 * exposé via subscribe(fn) pour alimenter le composant « Fermer tout ».
 * Pas de toast.getHistory() (inclut les fermés) ni de DOM query (fragile).
 *
 * i18n : les messages doivent déjà être traduits par l'appelant via t(). Ce
 * wrapper ne résout pas de clés — il tend à rester neutre côté i18n pour
 * éviter une double indirection.
 */
import { toast } from 'sonner';

type ActiveSet = Set<string | number>;
const active: ActiveSet = new Set();
const listeners = new Set<(count: number) => void>();

function notifyListeners() {
  listeners.forEach(fn => fn(active.size));
}

function track<T extends string | number>(id: T): T {
  active.add(id);
  notifyListeners();
  return id;
}

function untrack(id: string | number) {
  if (active.delete(id)) notifyListeners();
}

interface NotifyOptions {
  description?: string;
  /** Durée d'affichage en ms (défaut Sonner ~4s). 0 = persistant. */
  duration?:    number;
}

function baseOpts(opts?: NotifyOptions) {
  return {
    description: opts?.description,
    duration:    opts?.duration,
    onDismiss:   (t: { id: string | number }) => untrack(t.id),
    onAutoClose: (t: { id: string | number }) => untrack(t.id),
  };
}

export const notify = {
  success(message: string, opts?: NotifyOptions) {
    return track(toast.success(message, baseOpts(opts)));
  },
  error(message: string, opts?: NotifyOptions) {
    return track(toast.error(message, baseOpts(opts)));
  },
  warning(message: string, opts?: NotifyOptions) {
    return track(toast.warning(message, baseOpts(opts)));
  },
  info(message: string, opts?: NotifyOptions) {
    return track(toast.info(message, baseOpts(opts)));
  },
  /** Ferme tous les toasts affichés. */
  dismissAll() {
    toast.dismiss();
    active.clear();
    notifyListeners();
  },
  /** S'abonner au compteur actif (pour le bouton « Fermer tout »). */
  subscribe(fn: (count: number) => void): () => void {
    listeners.add(fn);
    // Émet le compteur courant à l'abonnement pour que l'UI se synchro
    // immédiatement sans attendre le prochain toast.
    fn(active.size);
    return () => { listeners.delete(fn); };
  },
};
