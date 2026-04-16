/**
 * PageCustomerHome — Accueil du portail Client.
 *
 * Affiche un résumé d'activité (compteurs simples) basé sur les permissions
 * disponibles. Adaptatif : ne montre que ce que l'utilisateur peut consulter.
 */

import { Ticket, Package, MessageSquareWarning } from 'lucide-react';
import { useFetch }  from '../../lib/hooks/useFetch';
import { useAuth }   from '../../lib/auth/auth.context';
import { useI18n }   from '../../lib/i18n/useI18n';

interface CountResult { length: number }

function ActivityCard({
  icon: Icon, label, count, href, color,
}: {
  icon:  typeof Ticket;
  label: string;
  count: number | null;
  href:  string;
  color: 'teal' | 'orange' | 'amber';
}) {
  const palette = {
    teal:   'bg-teal-50 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300',
    orange: 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300',
    amber:  'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  } as const;
  return (
    <a
      href={href}
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:shadow-md transition-shadow"
    >
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${palette[color]} mb-3`}>
        <Icon className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">
        {count ?? '—'}
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </a>
  );
}

export function PageCustomerHome() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const perms = new Set(user?.permissions ?? []);

  const canTickets = perms.has('data.ticket.read.own');
  const canParcels = perms.has('data.parcel.read.own') || perms.has('data.parcel.track.own');

  const tickets = useFetch<CountResult[]>(
    canTickets && tenantId ? `/api/tenants/${tenantId}/tickets/my` : null,
    [tenantId],
  );
  const parcels = useFetch<CountResult[]>(
    canParcels && tenantId ? `/api/tenants/${tenantId}/parcels/my` : null,
    [tenantId],
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Bonjour {user?.name ?? user?.email}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Bienvenue dans votre espace personnel.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {canTickets && (
          <ActivityCard
            icon={Ticket}
            label="billets"
            count={tickets.data?.length ?? null}
            href="/customer/trips"
            color="teal"
          />
        )}
        {canParcels && (
          <ActivityCard
            icon={Package}
            label="colis expédiés"
            count={parcels.data?.length ?? null}
            href="/customer/parcels"
            color="orange"
          />
        )}
        <a
          href="/customer/claim"
          className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <MessageSquareWarning className="w-5 h-5 text-amber-500 mx-auto mb-2" aria-hidden />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Une question ?</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Contactez l'assistance
          </p>
        </a>
      </div>
    </div>
  );
}
