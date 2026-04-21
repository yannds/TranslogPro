import type { ComponentType } from 'react';
import { Loader2, ShieldAlert, Wrench, Shield, Heart, PackageSearch, Siren, AlertTriangle, CheckCircle2, MapPin, Bus } from 'lucide-react';
import { useFetch }        from '../../lib/hooks/useFetch';
import { useAuth }         from '../../lib/auth/auth.context';
import { useI18n }         from '../../lib/i18n/useI18n';
import { Badge }           from '../ui/Badge';
import { cn }              from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Incident {
  id:                  string;
  type:                string;
  severity:            string;
  description:         string;
  locationDescription: string | null;
  tripId:              string | null;
  busId:               string | null;
  isSos:               boolean;
  status:              string;
  createdAt:           string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(['OPEN', 'ASSIGNED', 'IN_PROGRESS']);

const SEVERITY_VARIANT: Record<string, 'danger' | 'warning' | 'info' | 'default'> = {
  CRITICAL: 'danger',
  HIGH:     'warning',
  MEDIUM:   'info',
  LOW:      'default',
};

const SEVERITY_BORDER: Record<string, string> = {
  CRITICAL: 'border-l-red-500',
  HIGH:     'border-l-orange-500',
  MEDIUM:   'border-l-amber-400',
  LOW:      'border-l-blue-400',
};

const TYPE_ICON: Record<string, ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
  MECHANICAL:  Wrench,
  SECURITY:    Shield,
  HEALTH:      Heart,
  LOST_OBJECT: PackageSearch,
  SOS:         Siren,
  ACCIDENT:    AlertTriangle,
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60)  return `${mins} min`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}j`;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageSafety() {
  const { user } = useAuth();
  const { t }    = useI18n();

  const { data, loading, error } = useFetch<Incident[]>(
    user?.tenantId ? `/api/tenants/${user.tenantId}/incidents` : null,
    [user?.tenantId],
  );

  const active = (data ?? []).filter(i => ACTIVE_STATUSES.has(i.status));

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-500" aria-hidden="true" />
          <h1 className="text-2xl font-bold t-text">{t('safety.title')}</h1>
        </div>
        {!loading && data && (
          <span className={cn(
            'text-xs font-semibold px-2.5 py-1 rounded-full',
            active.length > 0
              ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
              : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
          )}>
            {active.length > 0
              ? t('safety.activeCount', { count: active.length })
              : t('safety.noIncidents')}
          </span>
        )}
      </header>

      {/* Chargement */}
      {loading && (
        <div role="status" className="flex items-center gap-2 t-text-2 py-8 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span className="text-sm">{t('safety.loading')}</span>
        </div>
      )}

      {/* Erreur */}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400 py-4">{error}</p>
      )}

      {/* Aucun incident actif */}
      {!loading && !error && active.length === 0 && (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-3 py-16 text-center"
        >
          <CheckCircle2 className="w-12 h-12 text-green-500" aria-hidden="true" />
          <p className="font-semibold t-text">{t('safety.noIncidents')}</p>
          <p className="text-sm t-text-2 max-w-xs">{t('safety.noIncidentsDesc')}</p>
        </div>
      )}

      {/* Liste des incidents actifs */}
      {active.length > 0 && (
        <ul className="space-y-3" aria-label={t('safety.title')}>
          {active.map(incident => {
            const Icon      = TYPE_ICON[incident.type] ?? AlertTriangle;
            const sevBorder = SEVERITY_BORDER[incident.severity] ?? 'border-l-gray-400';
            const sevVar    = SEVERITY_VARIANT[incident.severity] ?? 'default';

            return (
              <li
                key={incident.id}
                className={cn(
                  't-card-bordered rounded-xl p-4 border-l-4',
                  sevBorder,
                )}
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={cn(
                      'w-5 h-5 mt-0.5 shrink-0',
                      incident.severity === 'CRITICAL' ? 'text-red-500'
                      : incident.severity === 'HIGH'   ? 'text-orange-500'
                      : incident.severity === 'MEDIUM' ? 'text-amber-500'
                      : 'text-blue-400',
                    )}
                    aria-hidden
                  />

                  <div className="flex-1 min-w-0">
                    {/* En-tête */}
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-semibold t-text">
                        {t(`safety.type.${incident.type}`)}
                      </span>
                      {incident.isSos && (
                        <Badge variant="danger" size="sm">{t('safety.sosLabel')}</Badge>
                      )}
                      <Badge variant={sevVar} size="sm">
                        {t(`safety.severity.${incident.severity}`)}
                      </Badge>
                      <Badge variant="default" size="sm">
                        {t(`safety.status.${incident.status}`)}
                      </Badge>
                      <span className="text-xs t-text-3 ml-auto">
                        {timeAgo(incident.createdAt)}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-sm t-text-2 leading-snug">{incident.description}</p>

                    {/* Méta */}
                    {(incident.locationDescription || incident.tripId) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                        {incident.locationDescription && (
                          <span className="flex items-center gap-1 text-xs t-text-3">
                            <MapPin className="w-3 h-3" aria-hidden />
                            {incident.locationDescription}
                          </span>
                        )}
                        {incident.tripId && (
                          <span className="flex items-center gap-1 text-xs t-text-3">
                            <Bus className="w-3 h-3" aria-hidden />
                            {t('safety.tripLabel')} {incident.tripId.slice(-8)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
