/**
 * PageScheduler — Module M PRD : gestion des templates de trajets récurrents.
 *
 * Un TripTemplate déclare un trajet répétitif (jours de la semaine + heure
 * de départ). Le scheduler backend génère automatiquement les Trip à 02h00
 * chaque nuit.
 *
 * Endpoints :
 *   - GET    /api/v1/tenants/:tid/scheduler/templates
 *   - POST   /api/v1/tenants/:tid/scheduler/templates
 *   - DELETE /api/v1/tenants/:tid/scheduler/templates/:id  (désactivation soft)
 *
 * Permissions :
 *   - Lecture  : data.trip.read.tenant
 *   - Écriture : data.trip.create.tenant
 *
 * Qualité : i18n fr+en (autres locales TODO), DataTableMaster, WCAG AA,
 * dark+light, responsive desktop-first, security first (RBAC permission-based).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Power } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiDelete } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n, tm } from '../../lib/i18n/useI18n';
import DataTableMaster from '../DataTableMaster';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Checkbox } from '../ui/Checkbox';
import { Badge } from '../ui/Badge';
import { FormFooter } from '../ui/FormFooter';
import { ErrorAlert } from '../ui/ErrorAlert';

interface TripTemplate {
  id:               string;
  routeId:          string;
  weekdays:         number[];
  departureTime:    string;
  defaultBusId:     string | null;
  defaultDriverId:  string | null;
  isActive:         boolean;
  effectiveUntil:   string | null;
  createdAt:        string;
}

interface RouteOption { id: string; name: string; }

const WEEKDAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface DraftTemplate {
  routeId:         string;
  weekdays:        number[];
  departureTime:   string;
  defaultBusId:    string;
  defaultDriverId: string;
  effectiveUntil:  string;
}

const EMPTY_DRAFT: DraftTemplate = {
  routeId:         '',
  weekdays:        [1, 2, 3, 4, 5], // lun-ven par défaut
  departureTime:   '08:00',
  defaultBusId:    '',
  defaultDriverId: '',
  effectiveUntil:  '',
};

export function PageScheduler() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const perms    = user?.permissions ?? [];
  const canRead  = perms.includes('data.trip.read.tenant');
  const canWrite = perms.includes('data.trip.create.tenant');

  const url = tenantId && canRead
    ? `/api/v1/tenants/${tenantId}/scheduler/templates`
    : null;

  const { data, loading, error, refetch } = useFetch<TripTemplate[]>(url, [tenantId]);
  // Routes pour le dropdown — réutilise l'endpoint existant /api/tenants/:id/routes
  const { data: routes } = useFetch<RouteOption[]>(
    tenantId ? `/api/tenants/${tenantId}/routes` : null,
    [tenantId],
  );

  const [editing, setEditing] = useState<DraftTemplate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rows = useMemo(() => data ?? [], [data]);
  const routeMap = useMemo(() => {
    const m = new Map<string, string>();
    (routes ?? []).forEach((r) => m.set(r.id, r.name));
    return m;
  }, [routes]);

  const T = {
    title:        t(tm('Trajets récurrents', 'Recurring trips')),
    subtitle:     t(tm('Modèles de trajets — génération automatique chaque nuit',
                      'Trip templates — auto-generated every night')),
    newBtn:       t(tm('Nouveau template', 'New template')),
    colRoute:     t(tm('Ligne', 'Route')),
    colSchedule:  t(tm('Programmation', 'Schedule')),
    colDeparture: t(tm('Départ', 'Departure')),
    colStatus:    t(tm('Statut', 'Status')),
    colExpires:   t(tm('Expire', 'Expires')),
    empty:        t(tm('Aucun template', 'No template')),
    active:       t(tm('Actif', 'Active')),
    inactive:     t(tm('Désactivé', 'Inactive')),
    everyday:     t(tm('Tous les jours', 'Every day')),
    weekdays:     t(tm('Lun – Ven', 'Mon – Fri')),
    weekend:      t(tm('Sam – Dim', 'Sat – Sun')),
    none:         '—',
    formTitleNew: t(tm('Nouveau template de trajet récurrent', 'New recurring trip template')),
    lblRoute:     t(tm('Ligne', 'Route')),
    lblWeekdays:  t(tm('Jours de la semaine', 'Weekdays')),
    lblDeparture: t(tm('Heure de départ (HH:MM)', 'Departure time (HH:MM)')),
    lblBus:       t(tm('Bus par défaut (optionnel)', 'Default bus (optional)')),
    lblDriver:    t(tm('Chauffeur par défaut (optionnel)', 'Default driver (optional)')),
    lblExpires:   t(tm('Expire le (optionnel)', 'Expires on (optional)')),
    btnCreate:    t(tm('Créer', 'Create')),
    btnDeactivate: t(tm('Désactiver', 'Deactivate')),
    confirmDeact: t(tm('Désactiver ce template ? Aucun nouveau trip ne sera généré.',
                       'Deactivate this template? No further trips will be generated.')),
    pickRoute:    t(tm('— choisir une ligne —', '— pick a route —')),
    readOnly:     t(tm('Lecture seule (permission requise pour modifier)',
                       'Read-only (write permission required)')),
  };

  const dayShort = (idx: number): string => t(tm(
    ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][idx]!,
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][idx]!,
  ));

  const formatWeekdays = (days: number[]): string => {
    const sorted = [...days].sort();
    if (sorted.length === 7) return T.everyday;
    const isWeekdays = sorted.length === 5 && sorted.every((d) => d >= 1 && d <= 5);
    if (isWeekdays) return T.weekdays;
    const isWeekend = sorted.length === 2 && sorted.includes(0) && sorted.includes(6);
    if (isWeekend) return T.weekend;
    return sorted.map((d) => dayShort(d)).join(', ');
  };

  const openNew = () => {
    if (!canWrite) return;
    setEditing({ ...EMPTY_DRAFT });
    setSubmitError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!editing.routeId) {
      setSubmitError(T.pickRoute);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        routeId:       editing.routeId,
        weekdays:      editing.weekdays,
        departureTime: editing.departureTime,
      };
      if (editing.defaultBusId)    body.defaultBusId    = editing.defaultBusId;
      if (editing.defaultDriverId) body.defaultDriverId = editing.defaultDriverId;
      if (editing.effectiveUntil)  body.effectiveUntil  = editing.effectiveUntil;
      await apiPost(`/api/v1/tenants/${tenantId}/scheduler/templates`, body);
      setEditing(null);
      refetch();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const deactivate = async (tpl: TripTemplate) => {
    if (!canWrite) return;
    if (!window.confirm(T.confirmDeact)) return;
    try {
      await apiDelete(`/api/v1/tenants/${tenantId}/scheduler/templates/${tpl.id}`);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const toggleWeekday = (d: number) => {
    if (!editing) return;
    const next = editing.weekdays.includes(d)
      ? editing.weekdays.filter((x) => x !== d)
      : [...editing.weekdays, d];
    setEditing({ ...editing, weekdays: next });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto" aria-labelledby="page-scheduler-title">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 id="page-scheduler-title" className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {T.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{T.subtitle}</p>
        </div>
        {canWrite && (
          <Button onClick={openNew} aria-label={T.newBtn}>
            <Plus size={16} className="mr-1" /> {T.newBtn}
          </Button>
        )}
      </header>

      {!canWrite && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3" role="note">
          {T.readOnly}
        </p>
      )}

      {error && <ErrorAlert error={error} className="mb-4" />}

      <DataTableMaster<TripTemplate>
        data={rows}
        loading={loading}
        emptyMessage={T.empty}
        columns={[
          {
            key: 'routeId',
            header: T.colRoute,
            sortable: true,
            cellRenderer: (v) => routeMap.get(v as string) ?? (v as string),
          },
          {
            key: 'weekdays',
            header: T.colSchedule,
            cellRenderer: (v) => formatWeekdays(v as number[]),
          },
          {
            key: 'departureTime',
            header: T.colDeparture,
            sortable: true,
            align: 'right',
          },
          {
            key: 'isActive',
            header: T.colStatus,
            cellRenderer: (v) => (
              <Badge variant={v ? 'success' : 'default'}>
                {v ? T.active : T.inactive}
              </Badge>
            ),
          },
          {
            key: 'effectiveUntil',
            header: T.colExpires,
            cellRenderer: (v) => v ? new Date(v as string).toLocaleDateString(lang) : T.none,
          },
        ]}
        rowActions={canWrite ? [
          {
            label: T.btnDeactivate,
            icon:  <Power size={14} />,
            onClick: (row) => deactivate(row),
            hidden:  (row) => !row.isActive,
          },
        ] : []}
        exportFormats={['csv', 'json']}
        exportFilename="trip-templates"
      />

      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditing(null); }} title={T.formTitleNew}>
          <form onSubmit={submit} className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="route">{T.lblRoute}</label>
              <Select
                id="route"
                value={editing.routeId}
                onChange={(e) => setEditing({ ...editing, routeId: e.target.value })}
                required
                placeholder={T.pickRoute}
                options={(routes ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            </div>

            <fieldset>
              <legend className="text-sm font-medium mb-1">{T.lblWeekdays}</legend>
              <div className="flex flex-wrap gap-2" role="group" aria-label={T.lblWeekdays}>
                {WEEKDAY_KEYS.map((_, idx) => (
                  <Checkbox
                    key={idx}
                    label={dayShort(idx)}
                    checked={editing.weekdays.includes(idx)}
                    onCheckedChange={() => toggleWeekday(idx)}
                  />
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="hhmm">{T.lblDeparture}</label>
                <Input
                  id="hhmm"
                  type="time"
                  value={editing.departureTime}
                  onChange={(e) => setEditing({ ...editing, departureTime: e.target.value })}
                  required
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="exp">{T.lblExpires}</label>
                <Input
                  id="exp"
                  type="date"
                  value={editing.effectiveUntil}
                  onChange={(e) => setEditing({ ...editing, effectiveUntil: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="bus">{T.lblBus}</label>
                <Input
                  id="bus"
                  value={editing.defaultBusId}
                  onChange={(e) => setEditing({ ...editing, defaultBusId: e.target.value })}
                  placeholder="bus-id"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="drv">{T.lblDriver}</label>
                <Input
                  id="drv"
                  value={editing.defaultDriverId}
                  onChange={(e) => setEditing({ ...editing, defaultDriverId: e.target.value })}
                  placeholder="user-id"
                />
              </div>
            </div>

            {submitError && <ErrorAlert error={submitError} />}

            <FormFooter
              onCancel={() => setEditing(null)}
              submitLabel={T.btnCreate}
              pendingLabel={T.btnCreate + '…'}
              busy={submitting}
            />
          </form>
        </Dialog>
      )}
    </div>
  );
}
