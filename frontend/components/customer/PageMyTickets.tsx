/**
 * PageMyTickets — "Mes voyages" pour le profil CUSTOMER.
 *
 * Charge GET /api/tenants/:tenantId/tickets/my (filtre passengerId backend)
 * et affiche la liste des billets du client connecté avec leur trip associé.
 */

import { Ticket, Calendar, MapPin, Loader2 } from 'lucide-react';
import { useFetch }  from '../../lib/hooks/useFetch';
import { useAuth }   from '../../lib/auth/auth.context';

interface MyTicket {
  id:           string;
  status:       string;
  pricePaid:    number;
  qrCode:       string;
  seatNumber:   string | null;
  createdAt:    string;
  trip: {
    id:                 string;
    departureScheduled: string;
    arrivalScheduled:   string;
    route:              { id: string; name: string } | null;
    bus:                { id: string; plateNumber: string } | null;
  } | null;
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  CONFIRMED:  { label: 'Confirmé',     cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  CHECKED_IN: { label: 'Enregistré',   cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  BOARDED:    { label: 'À bord',       cls: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300' },
  COMPLETED:  { label: 'Terminé',      cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  CANCELLED:  { label: 'Annulé',       cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
  PENDING_PAYMENT: { label: 'À payer', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  EXPIRED:    { label: 'Expiré',       cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function PageMyTickets() {
  const { user } = useAuth();
  const url = user?.tenantId ? `/api/tenants/${user.tenantId}/tickets/my` : null;
  const { data, loading, error } = useFetch<MyTicket[]>(url, [user?.tenantId]);

  const tickets = data ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <Ticket className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Mes voyages</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Vos billets de transport — historique et statut en temps réel.
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
          Impossible de charger vos billets : {error}
        </div>
      )}

      {!loading && !error && tickets.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center">
          <Ticket className="w-8 h-8 text-slate-400 mx-auto mb-3" aria-hidden />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Aucun billet pour le moment.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Vos achats de billets apparaîtront ici.
          </p>
        </div>
      )}

      {!loading && tickets.length > 0 && (
        <ul className="space-y-3" role="list">
          {tickets.map(t => {
            const status = STATUS_STYLE[t.status] ?? { label: t.status, cls: 'bg-slate-100 text-slate-700' };
            return (
              <li
                key={t.id}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-teal-500" aria-hidden />
                      {t.trip?.route?.name ?? 'Trajet inconnu'}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" aria-hidden />
                      {formatDate(t.trip?.departureScheduled)}
                    </p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${status.cls}`}>
                    {status.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {t.seatNumber ? `Siège ${t.seatNumber}` : 'Siège libre'}
                    {t.trip?.bus?.plateNumber ? ` · Bus ${t.trip.bus.plateNumber}` : ''}
                  </span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {t.pricePaid.toLocaleString('fr-FR')} XAF
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
