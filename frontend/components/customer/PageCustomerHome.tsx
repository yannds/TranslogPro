/**
 * PageCustomerHome — Accueil du portail Client.
 *
 * Layout :
 *   - Hero de bienvenue avec prénom
 *   - 3 cartes activité (billets, colis, incidents/réclamations)
 *   - Widget "Prochain voyage" si applicable
 *   - Widget "Denoncer/Signaler" (CTA vers portail incidents)
 *
 * i18n : toutes les chaînes via t(). Light-mode first, dark: variants.
 * A11y : rôles sémantiques, focus visible, cards navigables clavier.
 */

import { useMemo } from 'react';
import { Ticket, Package, MessageSquareWarning, AlertTriangle, MapPin, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth }   from '../../lib/auth/auth.context';
import { useI18n }   from '../../lib/i18n/useI18n';
import { useOfflineList } from '../../lib/hooks/useOfflineList';
import { cn } from '../../lib/utils';

interface TicketRow {
  id:            string;
  tripId:        string;
  status:        string;
  passengerName: string;
  seatNumber:    string | null;
  pricePaid:     number;
  createdAt:     string;
  trip?: {
    departureScheduled?: string;
    route?: { origin?: { name: string }; destination?: { name: string } };
  };
}

interface ParcelRow {
  id:         string;
  status:     string;
  trackingRef?: string;
  createdAt:  string;
}

type CardColor = 'teal' | 'orange' | 'amber' | 'red';

const PALETTE: Record<CardColor, { bg: string; text: string; border: string }> = {
  teal:   { bg: 'bg-teal-50 dark:bg-teal-950/30',     text: 'text-teal-700 dark:text-teal-300',     border: 'hover:border-teal-400 dark:hover:border-teal-600' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-300', border: 'hover:border-orange-400 dark:hover:border-orange-600' },
  amber:  { bg: 'bg-amber-50 dark:bg-amber-950/30',   text: 'text-amber-700 dark:text-amber-300',   border: 'hover:border-amber-400 dark:hover:border-amber-600' },
  red:    { bg: 'bg-red-50 dark:bg-red-950/30',       text: 'text-red-700 dark:text-red-300',       border: 'hover:border-red-400 dark:hover:border-red-600' },
};

function ActivityCard({
  icon: Icon, label, count, href, color, description,
}: {
  icon:        typeof Ticket;
  label:       string;
  count:       number | null;
  href:        string;
  color:       CardColor;
  description?: string;
}) {
  const p = PALETTE[color];
  return (
    <Link
      to={href}
      className={cn(
        'rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5',
        'transition-all shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-teal-500 focus:outline-none',
        p.border,
      )}
      aria-label={`${label}: ${count ?? 0}`}
    >
      <div className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg mb-3', p.bg, p.text)}>
        <Icon className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{count ?? '—'}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
      {description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
      )}
    </Link>
  );
}

export function PageCustomerHome() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const perms = new Set(user?.permissions ?? []);

  const canTickets = perms.has('data.ticket.read.own');
  const canParcels = perms.has('data.parcel.read.own') || perms.has('data.parcel.track.own');

  const {
    items: tickets, loading: ticketsLoading, fromCache: ticketsFromCache,
  } = useOfflineList<TicketRow>({
    table:    'passengers',
    tenantId,
    url:      (canTickets && tenantId) ? `/api/tenants/${tenantId}/tickets/my` : null,
    toRecord: (row) => ({ id: row.id, tripId: row.tripId }),
    deps:     [tenantId, canTickets],
  });

  const {
    items: parcels, loading: parcelsLoading,
  } = useOfflineList<ParcelRow>({
    table:    'parcels',
    tenantId,
    url:      (canParcels && tenantId) ? `/api/tenants/${tenantId}/parcels/my` : null,
    toRecord: (row) => ({ id: row.id }),
    deps:     [tenantId, canParcels],
  });

  // Prochain voyage : le ticket CONFIRMED le plus proche dans le futur.
  const nextTrip = useMemo(() => {
    const now = Date.now();
    return tickets
      .filter(t => (t.status === 'CONFIRMED' || t.status === 'CHECKED_IN')
        && t.trip?.departureScheduled
        && new Date(t.trip.departureScheduled).getTime() > now)
      .sort((a, b) =>
        new Date(a.trip!.departureScheduled!).getTime() - new Date(b.trip!.departureScheduled!).getTime(),
      )[0];
  }, [tickets]);

  const greeting = (user?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? '').trim();

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6" role="region" aria-label={t('customerHome.regionLabel')}>
      {/* Hero */}
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
          {greeting
            ? t('customerHome.greetingName', { name: greeting })
            : t('customerHome.greeting')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t('customerHome.welcome')}
        </p>
      </header>

      {/* Prochain voyage */}
      {nextTrip && (
        <section
          className="rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/20 p-4 md:p-5"
          aria-label={t('customerHome.nextTrip')}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white shrink-0">
              <MapPin className="w-5 h-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-teal-700 dark:text-teal-400 font-semibold">
                {t('customerHome.nextTrip')}
              </p>
              <p className="text-base md:text-lg font-semibold text-slate-900 dark:text-white truncate">
                {nextTrip.trip?.route?.origin?.name ?? '?'} →{' '}
                {nextTrip.trip?.route?.destination?.name ?? '?'}
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                {new Date(nextTrip.trip!.departureScheduled!).toLocaleString(undefined, {
                  weekday: 'short', day: '2-digit', month: 'short',
                  hour: '2-digit', minute: '2-digit',
                })}
                {nextTrip.seatNumber && (
                  <> · {t('customerHome.seat')} {nextTrip.seatNumber}</>
                )}
              </p>
            </div>
            <Link
              to="/customer/trips"
              className="shrink-0 text-sm font-medium text-teal-700 dark:text-teal-300 hover:underline"
            >
              {t('customerHome.seeAll')} →
            </Link>
          </div>
        </section>
      )}

      {ticketsFromCache && (
        <div
          role="note"
          className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          {t('offline.cachedData')}
        </div>
      )}

      {/* Cartes activité */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {canTickets && (
          <ActivityCard
            icon={Ticket}
            label={t('customerHome.tickets')}
            count={ticketsLoading ? null : tickets.length}
            href="/customer/trips"
            color="teal"
            description={t('customerHome.ticketsDesc')}
          />
        )}
        {canParcels && (
          <ActivityCard
            icon={Package}
            label={t('customerHome.parcels')}
            count={parcelsLoading ? null : parcels.length}
            href="/customer/parcels"
            color="orange"
            description={t('customerHome.parcelsDesc')}
          />
        )}
        <ActivityCard
          icon={AlertTriangle}
          label={t('customerHome.incidents')}
          count={null}
          href="/customer/incidents"
          color="red"
          description={t('customerHome.incidentsDesc')}
        />
      </div>

      {/* Actions rapides */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to="/customer/claim"
          className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors focus-visible:ring-2 focus-visible:ring-teal-500 focus:outline-none"
        >
          <MessageSquareWarning className="w-5 h-5 text-amber-500 mx-auto mb-2" aria-hidden />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('customerHome.supportTitle')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('customerHome.supportDesc')}</p>
        </Link>

        <Link
          to="/customer/incidents/new"
          className="rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-5 text-center hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors focus-visible:ring-2 focus-visible:ring-red-500 focus:outline-none"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mx-auto mb-2" aria-hidden />
          <p className="text-sm font-semibold text-red-900 dark:text-red-200">{t('customerHome.reportIncidentTitle')}</p>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1">{t('customerHome.reportIncidentDesc')}</p>
        </Link>
      </div>

      {(ticketsLoading || parcelsLoading) && (
        <div
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('common.loading')}
        </div>
      )}
    </div>
  );
}
