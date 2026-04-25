/**
 * PageDriverRest — « Mes temps de repos » (espace chauffeur).
 *
 * Tableau de bord de conformité RH :
 *   - Carte "Repos en cours" (si actif) avec bouton Terminer + compteur live
 *   - Carte "Conformité" (canDrive, temps restant, statut)
 *   - Carte "Synthèse période" (total, nb périodes, nb violations)
 *   - Tableau historique avec filtre 7 / 30 / 90 jours
 *   - Bouton "Démarrer un repos" quand aucun repos actif
 *
 * API :
 *   GET   /api/tenants/:tid/driver-profile/drivers/:staffId/rest-compliance
 *   GET   /api/tenants/:tid/driver-profile/drivers/:staffId/rest-history?limit=50
 *   GET   /api/tenants/:tid/driver-profile/rest-config
 *   POST  /api/tenants/:tid/driver-profile/rest-periods
 *   PATCH /api/tenants/:tid/driver-profile/rest-periods/:id/end
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Coffee, Play, Square, ShieldCheck, ShieldAlert, Clock, AlertTriangle, Calendar,
} from 'lucide-react';
import { useAuth }  from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiGet, apiPost, apiPatch } from '../../lib/api';
import { Badge }    from '../ui/Badge';
import { Button }   from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ─── Types API ────────────────────────────────────────────────────────────────

interface RestPeriod {
  id:        string;
  tenantId:  string;
  staffId:   string;
  startedAt: string;
  endedAt:   string | null;
  source:    'AUTO' | 'MANUAL' | 'MEDICAL' | string;
  notes:     string | null;
}

interface RestCompliance {
  canDrive:             boolean;
  restRemainingMinutes: number;
  activeRestPeriod:     { id: string; startedAt: string } | null;
}

interface RestConfig {
  minRestMinutes:          number;
  maxDrivingMinutesPerDay: number;
  maxDrivingMinutesPerWeek:number;
  alertBeforeEndRestMin:   number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(mins: number): string {
  if (mins < 0) mins = 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function periodDurationMin(p: RestPeriod): number {
  const end = p.endedAt ? new Date(p.endedAt).getTime() : Date.now();
  return Math.floor((end - new Date(p.startedAt).getTime()) / 60_000);
}

// ─── i18n ────────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  AUTO:    'driverRest.sourceAuto',
  MANUAL:  'driverRest.sourceManual',
  MEDICAL: 'driverRest.sourceMedical',
};

type RangeDays = 7 | 30 | 90;

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageDriverRest() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const staffId  = user?.staffId  ?? '';

  const [compliance, setCompliance] = useState<RestCompliance | null>(null);
  const [history,    setHistory]    = useState<RestPeriod[] | null>(null);
  const [config,     setConfig]     = useState<RestConfig | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState<string | null>(null);
  const [acting,     setActing]     = useState(false);
  const [range,      setRange]      = useState<RangeDays>(30);

  // Refresh live du compteur repos en cours (toutes les 30s)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!compliance?.activeRestPeriod) return;
    const t = setInterval(() => setTick(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, [compliance?.activeRestPeriod]);

  const base = tenantId && staffId
    ? `/api/tenants/${tenantId}/driver-profile`
    : null;

  const load = useCallback(async () => {
    if (!base || !staffId) { setLoading(false); return; }
    setErr(null);
    try {
      const [c, h, cfg] = await Promise.all([
        apiGet<RestCompliance>(`${base}/drivers/${staffId}/rest-compliance`),
        apiGet<RestPeriod[]>  (`${base}/drivers/${staffId}/rest-history?limit=50`),
        apiGet<RestConfig>    (`${base}/rest-config`),
      ]);
      setCompliance(c);
      setHistory(h);
      setConfig(cfg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('driverRest.errorLoading'));
    } finally {
      setLoading(false);
    }
  }, [base, staffId]);

  useEffect(() => { void load(); }, [load]);

  const startRest = async () => {
    if (!base || !staffId || acting) return;
    setActing(true); setErr(null);
    try {
      await apiPost(`${base}/rest-periods`, {
        staffId,
        startedAt: new Date().toISOString(),
        source:    'MANUAL',
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('driverRest.errorStart'));
    } finally { setActing(false); }
  };

  const endRest = async (periodId: string) => {
    if (!base || acting) return;
    setActing(true); setErr(null);
    try {
      await apiPatch(`${base}/rest-periods/${periodId}/end`, {
        endedAt: new Date().toISOString(),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('driverRest.errorEnd'));
    } finally { setActing(false); }
  };

  // ── Dérivations ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!history) return [];
    const cutoff = Date.now() - range * 24 * 3600_000;
    return history.filter(p => new Date(p.startedAt).getTime() >= cutoff);
  }, [history, range]);

  const stats = useMemo(() => {
    const closed = filtered.filter(p => p.endedAt);
    const totalMin = closed.reduce((s, p) => s + periodDurationMin(p), 0);
    const violations = config
      ? closed.filter(p => periodDurationMin(p) < config.minRestMinutes).length
      : 0;
    return { total: closed.length, totalMin, violations };
  }, [filtered, config]);

  // ── Colonnes DataTableMaster ──────────────────────────────────────────────
  const restColumns: Column<RestPeriod>[] = [
    {
      key: 'startedAt', header: t('driverRest.start'), sortable: true,
      cellRenderer: (v) => <span className="t-text">{fmtDateTime(v as string)}</span>,
      csvValue: (v) => new Date(v as string).toISOString(),
    },
    {
      key: 'endedAt', header: t('driverRest.end'), sortable: true,
      cellRenderer: (v) => v
        ? <span className="t-text">{fmtDateTime(v as string)}</span>
        : <span className="italic t-text-2">{t('driverRest.inProgress')}</span>,
      csvValue: (v) => v ? new Date(v as string).toISOString() : '',
    },
    {
      key: 'id', header: t('driverRest.duration'), sortable: false, width: '120px',
      cellRenderer: (_v, row) => (
        <span className="t-text font-mono">{fmtDuration(periodDurationMin(row))}</span>
      ),
      csvValue: (_v, row) => fmtDuration(periodDurationMin(row)),
    },
    {
      key: 'source', header: t('driverRest.source'), sortable: true, width: '130px',
      cellRenderer: (v) => (
        <span className="t-text-2">{SOURCE_LABEL[v as string] ? t(SOURCE_LABEL[v as string]) : (v as string)}</span>
      ),
      csvValue: (v) => SOURCE_LABEL[v as string] ? t(SOURCE_LABEL[v as string]) : (v as string),
    },
    {
      key: 'tenantId', header: t('driverRest.statusLabel'), sortable: false, width: '160px',
      cellRenderer: (_v, row) => {
        const dur   = periodDurationMin(row);
        const isOk  = !config || dur >= config.minRestMinutes;
        const isEnd = !!row.endedAt;
        if (!isEnd)  return <Badge variant="warning">{t('driverRest.inProgress')}</Badge>;
        return isOk
          ? <Badge variant="success">{t('driverRest.compliant')}</Badge>
          : <Badge variant="danger">{t('driverRest.insufficient')}</Badge>;
      },
      csvValue: (_v, row) => {
        const dur = periodDurationMin(row);
        const isOk = !config || dur >= config.minRestMinutes;
        return !row.endedAt ? 'IN_PROGRESS' : (isOk ? 'COMPLIANT' : 'INSUFFICIENT');
      },
    },
  ];

  const activeElapsedMin = compliance?.activeRestPeriod
    // tick forces re-eval ; la variable est utilisée implicitement via Date.now()
    ? Math.floor((Date.now() - new Date(compliance.activeRestPeriod.startedAt).getTime()) / 60_000)
    : 0;
  void tick;

  // ── Rendu ────────────────────────────────────────────────────────────────

  if (!staffId) {
    return (
      <div className="p-6">
        <ErrorAlert error={t('driverRest.noProfile')} icon />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <div
          className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"
          role="status" aria-label="Chargement…"
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-600/10 text-teal-600 flex items-center justify-center">
            <Coffee className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold t-text">{t('driverRest.pageTitle')}</h1>
            <p className="text-sm t-text-2">{t('driverRest.pageSubtitle')}</p>
          </div>
        </div>
        {!compliance?.activeRestPeriod && (
          <Button onClick={() => void startRest()} disabled={acting}>
            <Play className="w-4 h-4 mr-1" />
            {t('driverRest.startRest')}
          </Button>
        )}
      </header>

      <ErrorAlert error={err} icon />

      {/* ── Cartes ──────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Repos en cours */}
        <div className={`rounded-xl border t-border p-4 ${compliance?.activeRestPeriod ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800' : 't-card'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-semibold uppercase tracking-wide t-text-2">{t('driverRest.currentRest')}</span>
          </div>
          {compliance?.activeRestPeriod ? (
            <>
              <p className="text-2xl font-bold t-text">{fmtDuration(activeElapsedMin)}</p>
              <p className="text-xs t-text-2 mt-1">
                {t('driverRest.startedOn')} {fmtDateTime(compliance.activeRestPeriod.startedAt)}
              </p>
              {config && activeElapsedMin < config.minRestMinutes && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                  {t('driverRest.remainingBefore')} <strong>{fmtDuration(config.minRestMinutes - activeElapsedMin)}</strong> {t('driverRest.beforeCompliance')}
                </p>
              )}
              <Button
                variant="secondary"
                onClick={() => void endRest(compliance.activeRestPeriod!.id)}
                disabled={acting}
                className="mt-3 w-full"
              >
                <Square className="w-4 h-4 mr-1" /> {t('driverRest.endRest')}
              </Button>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold t-text">{t('driverRest.none')}</p>
              <p className="text-xs t-text-2 mt-1">{t('driverRest.noneDesc')}</p>
            </>
          )}
        </div>

        {/* Conformité */}
        <div className="rounded-xl border t-border t-card p-4">
          <div className="flex items-center gap-2 mb-2">
            {compliance?.canDrive
              ? <ShieldCheck className="w-4 h-4 text-emerald-600" />
              : <ShieldAlert className="w-4 h-4 text-red-600" />}
            <span className="text-xs font-semibold uppercase tracking-wide t-text-2">{t('driverRest.drivingStatus')}</span>
          </div>
          <p className="text-2xl font-bold t-text">
            {compliance?.canDrive ? t('driverRest.authorized') : t('driverRest.blocked')}
          </p>
          <p className="text-xs t-text-2 mt-1">
            {compliance?.canDrive
              ? t('driverRest.canResume')
              : `${t('driverRest.insufficientRest')} ${fmtDuration(compliance?.restRemainingMinutes ?? 0)}.`}
          </p>
          {config && (
            <p className="text-[11px] t-text-2 mt-3 pt-3 border-t t-border">
              {t('driverRest.minRegulation')} : <strong>{fmtDuration(config.minRestMinutes)}</strong>
            </p>
          )}
        </div>

        {/* Synthèse période */}
        <div className="rounded-xl border t-border t-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-teal-600" />
            <span className="text-xs font-semibold uppercase tracking-wide t-text-2">
              {t('driverRest.synthesisPeriod')} {range} {t('driverRest.days')}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold t-text">{stats.total}</p>
            <p className="text-sm t-text-2">{t('driverRest.periods')}{stats.total > 1 ? 's' : ''}</p>
          </div>
          <p className="text-xs t-text-2 mt-1">
            {t('driverRest.totalRest')} : <strong>{fmtDuration(stats.totalMin)}</strong>
          </p>
          {stats.violations > 0 ? (
            <p className="text-xs text-red-600 dark:text-red-400 mt-3 pt-3 border-t t-border flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {stats.violations} {t('driverRest.violations')}{stats.violations > 1 ? 's' : ''} {t('driverRest.minDuration')}
            </p>
          ) : (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-3 pt-3 border-t t-border">
              {t('driverRest.noViolation')}
            </p>
          )}
        </div>
      </section>

      {/* ── Historique ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border t-border t-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b t-border">
          <h2 className="font-semibold t-text">{t('driverRest.history')}</h2>
          <div className="flex gap-1 text-xs">
            {([7, 30, 90] as RangeDays[]).map(d => (
              <button
                key={d}
                onClick={() => setRange(d)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  range === d
                    ? 'bg-teal-600 text-white'
                    : 't-text-2 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {d} j
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          <DataTableMaster<RestPeriod>
            columns={restColumns}
            data={filtered}
            defaultSort={{ key: 'startedAt', dir: 'desc' }}
            searchPlaceholder={t('driverRest.searchPeriods')}
            emptyMessage={`${t('driverRest.noHistory')} ${range} ${t('driverRest.lastDays')}`}
            exportFormats={['csv']}
            exportFilename="driver-rest-periods"
          />
        </div>
      </section>
    </div>
  );
}
