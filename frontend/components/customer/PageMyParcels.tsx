/**
 * PageMyParcels — "Mes colis" pour le profil CUSTOMER.
 *
 * Charge GET /api/tenants/:tenantId/parcels/my (filtre senderId backend)
 * et affiche la liste des colis expédiés par le client connecté.
 */

import { Package, MapPin, Loader2 } from 'lucide-react';
import { useFetch }  from '../../lib/hooks/useFetch';
import { useAuth }   from '../../lib/auth/auth.context';

interface MyParcel {
  id:            string;
  trackingCode:  string;
  status:        string;
  weight:        number;
  price:         number | null;
  createdAt:     string;
  destination:   { id: string; name: string } | null;
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  CREATED:    { label: 'Enregistré',  cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  AT_ORIGIN:  { label: 'À l\'agence',  cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  PACKED:     { label: 'Groupé',      cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' },
  LOADED:     { label: 'Chargé',      cls: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
  IN_TRANSIT: { label: 'En route',    cls: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300' },
  ARRIVED:    { label: 'Arrivé',      cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  DELIVERED:  { label: 'Livré',       cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
  DAMAGED:    { label: 'Endommagé',   cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  LOST:       { label: 'Perdu',       cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
  RETURNED:   { label: 'Retourné',    cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function PageMyParcels() {
  const { user } = useAuth();
  const url = user?.tenantId ? `/api/tenants/${user.tenantId}/parcels/my` : null;
  const { data, loading, error } = useFetch<MyParcel[]>(url, [user?.tenantId]);

  const parcels = data ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
          <Package className="w-5 h-5 text-orange-600 dark:text-orange-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Mes colis</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Colis que vous avez expédiés — suivi en temps réel.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Chargement…</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          Impossible de charger vos colis : {error}
        </div>
      )}

      {!loading && !error && parcels.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center">
          <Package className="w-8 h-8 text-slate-400 mx-auto mb-3" aria-hidden />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Aucun colis expédié.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Déposez un colis en agence — il apparaîtra ici sous votre numéro de suivi.
          </p>
        </div>
      )}

      {!loading && parcels.length > 0 && (
        <ul className="space-y-3" role="list">
          {parcels.map(p => {
            const status = STATUS_STYLE[p.status] ?? { label: p.status, cls: 'bg-slate-100 text-slate-700' };
            return (
              <li
                key={p.id}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-orange-500" aria-hidden />
                      {p.destination?.name ?? 'Destination inconnue'}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                      {p.trackingCode}
                    </p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${status.cls}`}>
                    {status.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {p.weight} kg · Déposé le {formatDate(p.createdAt)}
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {p.price != null ? `${p.price.toLocaleString('fr-FR')} XAF` : '—'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
