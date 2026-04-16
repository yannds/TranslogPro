/**
 * PageMaintenancePlanning — « Planning garage »
 *
 * Vue calendrier hebdomadaire des interventions planifiées. Un bus par ligne,
 * jour par colonne. Clic sur une case → détail de l'intervention.
 *
 * API : GET /api/tenants/:tid/garage/reports  (pas de filtre serveur par date)
 */

import { useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Bus } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { useI18n }                       from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Skeleton }                      from '../ui/Skeleton';
import { Button }                        from '../ui/Button';
import { Dialog }                        from '../ui/Dialog';
import { ErrorAlert }                    from '../ui/ErrorAlert';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportStatus = 'SCHEDULED' | 'COMPLETED' | 'APPROVED';

interface ReportRow {
  id:          string;
  busId:       string;
  type:        string;
  description: string;
  scheduledAt: string;
  status:      ReportStatus;
  bus?:        { plateNumber: string; model?: string | null };
}

const DAYS_LABEL_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_LABEL_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_VARIANT: Record<ReportStatus, 'info' | 'warning' | 'success'> = {
  SCHEDULED: 'info',
  COMPLETED: 'warning',
  APPROVED:  'success',
};

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay(); // 0 = dim
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageMaintenancePlanning() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const DAYS_LABEL = lang === 'en' ? DAYS_LABEL_EN : DAYS_LABEL_FR;
  const url = tenantId ? `/api/tenants/${tenantId}/garage/reports` : null;

  const { data: reports, loading, error } = useFetch<ReportRow[]>(url, [url]);

  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const [detail, setDetail] = useState<ReportRow | null>(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)),
    [anchor],
  );

  // Bus rows + daily map
  const { busRows, byBusDay } = useMemo(() => {
    const list = reports ?? [];
    const busMap = new Map<string, { plate: string; model?: string | null }>();
    const map = new Map<string, ReportRow[]>();
    for (const r of list) {
      busMap.set(r.busId, {
        plate: r.bus?.plateNumber ?? r.busId.slice(0, 8),
        model: r.bus?.model,
      });
      const d = new Date(r.scheduledAt);
      for (let i = 0; i < 7; i++) {
        if (isSameDay(d, days[i])) {
          const key = `${r.busId}|${i}`;
          const arr = map.get(key) ?? [];
          arr.push(r);
          map.set(key, arr);
          break;
        }
      }
    }
    const rows = Array.from(busMap.entries())
      .map(([id, meta]) => ({ id, ...meta }))
      .sort((a, b) => a.plate.localeCompare(b.plate));
    return { busRows: rows, byBusDay: map };
  }, [reports, days]);

  const weekLabel = `${days[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — ${days[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('maintenancePlanning.pageTitle')}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <CalendarClock className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('maintenancePlanning.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('maintenancePlanning.pageDesc')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, -7))}>
            <ChevronLeft className="w-4 h-4" aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(startOfWeek(new Date()))}>
            {t('maintenancePlanning.today')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, 7))}>
            <ChevronRight className="w-4 h-4" aria-hidden />
          </Button>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      <Card>
        <CardHeader heading={weekLabel} description={t('maintenancePlanning.busPerLine')} />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : busRows.length === 0 ? (
            <div className="py-16 text-center text-slate-500 dark:text-slate-400">
              {t('maintenancePlanning.noIntervention')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="inline-block min-w-full">
                <div className="grid grid-cols-[160px_repeat(7,minmax(120px,1fr))] border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                  <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('maintenancePlanning.vehicle')}</div>
                  {days.map((d, i) => {
                    const today = isSameDay(d, new Date());
                    return (
                      <div key={i} className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-center ${today ? 'text-teal-600 dark:text-teal-400' : 'text-slate-500'}`}>
                        <div>{DAYS_LABEL[i]}</div>
                        <div className="tabular-nums font-bold text-sm">{d.getDate()}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {busRows.map(b => (
                    <div key={b.id} className="grid grid-cols-[160px_repeat(7,minmax(120px,1fr))]">
                      <div className="px-4 py-3 flex items-center gap-2 min-w-0">
                        <Bus className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{b.plate}</p>
                          <p className="text-[11px] text-slate-500 truncate">{b.model || '—'}</p>
                        </div>
                      </div>
                      {days.map((_, i) => {
                        const key = `${b.id}|${i}`;
                        const items = byBusDay.get(key) ?? [];
                        return (
                          <div key={i} className="px-1.5 py-2 space-y-1 border-l border-slate-100 dark:border-slate-800">
                            {items.length === 0
                              ? <span className="block h-8" aria-hidden />
                              : items.map(r => (
                                <button key={r.id} type="button"
                                  onClick={() => setDetail(r)}
                                  className="w-full text-left px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-teal-400 dark:hover:border-teal-600 transition-colors">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <Badge size="sm" variant={STATUS_VARIANT[r.status]}>{r.type}</Badge>
                                  </div>
                                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                    {new Date(r.scheduledAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </button>
                              ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!detail}
        onOpenChange={o => { if (!o) setDetail(null); }}
        title={detail ? `${detail.type} — ${detail.bus?.plateNumber ?? ''}` : ''}
        description={detail ? new Date(detail.scheduledAt).toLocaleString('fr-FR') : undefined}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <Badge variant={STATUS_VARIANT[detail.status]}>{detail.status}</Badge>
            <p className="text-slate-700 dark:text-slate-300">{detail.description}</p>
          </div>
        )}
      </Dialog>
    </main>
  );
}
