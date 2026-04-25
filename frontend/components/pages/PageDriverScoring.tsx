/**
 * PageDriverScoring — leaderboard scoring conducteurs (Sprint 10.4).
 *
 * Consomme GET /api/tenants/:tenantId/driver-profile/scoring/leaderboard.
 * Bouton "Recalculer" déclenche POST /scoring/recompute-all (admin only).
 *
 * Design :
 *   - Top 3 avec podium (gold/silver/bronze)
 *   - Tableau détaillé DataTableMaster avec colonnes :
 *     rang, nom, score global, ponctualité, incidents, volume trips
 *   - Progress bars ARIA pour chaque composante
 *   - Light + dark compatible, responsive
 *   - WCAG : role=table, aria-sort, aria-label sur chaque progress
 *
 * DRY : seuils affichés lus depuis TenantBusinessConfig via le payload
 *       (backend les inclut dans chaque DriverScore).
 */

import { useMemo, useState } from 'react';
import { Trophy, RefreshCw, Award, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiPost } from '../../lib/api';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../../lib/utils';
import DataTableMaster, { type Column } from '../DataTableMaster';

interface DriverScoreRow {
  id:                string;
  staffId:           string;
  overallScore:      number;
  punctualityScore:  number;
  incidentScore:     number;
  tripVolumeScore:   number;
  tripsCompleted:    number;
  tripsOnTime:       number;
  incidents:         number;
  windowStart:       string;
  windowEnd:         string;
  staff: {
    id: string; status: string;
    user: { id: string; name: string | null; email: string };
  };
}

export function PageDriverScoring() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const [recomputing, setRecomputing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const deps = useMemo(() => [tenantId, refreshTick], [tenantId, refreshTick]);
  const { data: rows, loading, error } = useFetch<DriverScoreRow[]>(
    tenantId ? `/api/tenants/${tenantId}/driver-profile/scoring/leaderboard?limit=50` : null,
    deps,
  );

  async function handleRecompute() {
    if (!tenantId) return;
    setRecomputing(true);
    try {
      await apiPost<{ recomputed: number }>(
        `/api/tenants/${tenantId}/driver-profile/scoring/recompute-all`,
        {},
      );
      setRefreshTick(n => n + 1);
    } finally {
      setRecomputing(false);
    }
  }

  const podium = (rows ?? []).slice(0, 3);
  const rest   = (rows ?? []).slice(3);

  const leaderboardColumns: Column<DriverScoreRow>[] = [
    {
      key: 'staffId', header: t('driverScoring.driver'), sortable: true,
      cellRenderer: (_v, row) => (
        <div>
          <p className="font-semibold t-text">{row.staff.user.name ?? row.staff.user.email}</p>
          <p className="text-xs t-text-3">{row.staff.user.email}</p>
        </div>
      ),
      csvValue: (_v, row) => row.staff.user.name ?? row.staff.user.email,
    },
    {
      key: 'overallScore', header: t('driverScoring.overall'), sortable: true, align: 'right', width: '120px',
      cellRenderer: (v) => <span className="tabular-nums font-bold t-text">{(v as number).toFixed(1)}</span>,
    },
    {
      key: 'punctualityScore', header: t('driverScoring.punctuality'), sortable: true, align: 'right', width: '110px',
      cellRenderer: (v) => <span className="tabular-nums t-text-2">{Math.round((v as number) * 100)}%</span>,
    },
    {
      key: 'incidents', header: t('driverScoring.incidents'), sortable: true, align: 'right', width: '100px',
      cellRenderer: (v) => <span className="tabular-nums t-text-2">{String(v)}</span>,
    },
    {
      key: 'tripsCompleted', header: t('driverScoring.trips'), sortable: true, align: 'right', width: '100px',
      cellRenderer: (v) => <span className="tabular-nums t-text-2">{String(v)}</span>,
    },
  ];

  return (
    <main className="p-4 sm:p-6 space-y-6" role="main" aria-label={t('driverScoring.title')}>
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <Trophy className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('driverScoring.title')}</h1>
            <p className="text-sm t-text-2 mt-0.5">{t('driverScoring.subtitle')}</p>
          </div>
        </div>
        <Button onClick={handleRecompute} disabled={recomputing || !tenantId}>
          <RefreshCw className={cn('w-4 h-4 mr-2', recomputing && 'animate-spin')} aria-hidden />
          {recomputing ? t('driverScoring.recomputing') : t('driverScoring.recompute')}
        </Button>
      </header>

      <ErrorAlert error={error} icon />

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      )}

      {!loading && (rows?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Users className="w-10 h-10 mx-auto t-text-3 mb-2" aria-hidden />
            <p className="t-text-2">{t('driverScoring.empty')}</p>
          </CardContent>
        </Card>
      )}

      {!loading && podium.length > 0 && (
        <section aria-labelledby="podium-title">
          <h2 id="podium-title" className="text-xs font-semibold t-text-2 uppercase tracking-wider mb-3">
            {t('driverScoring.podium')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {podium.map((row, idx) => (
              <PodiumCard key={row.id} row={row} rank={idx + 1} t={t} />
            ))}
          </div>
        </section>
      )}

      {!loading && rest.length > 0 && (
        <section aria-labelledby="leaderboard-title">
          <h2 id="leaderboard-title" className="text-xs font-semibold t-text-2 uppercase tracking-wider mb-3">
            {t('driverScoring.ranking')}
          </h2>
          <DataTableMaster<DriverScoreRow>
            columns={leaderboardColumns}
            data={rest}
            defaultSort={{ key: 'overallScore', dir: 'desc' }}
            searchPlaceholder={t('driverScoring.searchPlaceholder')}
            emptyMessage={t('driverScoring.empty')}
            exportFormats={['csv']}
            exportFilename="driver-scoring-leaderboard"
          />
        </section>
      )}
    </main>
  );
}

function PodiumCard({ row, rank, t }: { row: DriverScoreRow; rank: number; t: (k: string) => string }) {
  const medalColor = rank === 1 ? 'amber' : rank === 2 ? 'slate' : 'orange';
  const medalText  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  return (
    <Card className={cn(
      'border-2',
      medalColor === 'amber'  && 'border-amber-400/60 dark:border-amber-700/60',
      medalColor === 'slate'  && 'border-slate-400/60 dark:border-slate-600/60',
      medalColor === 'orange' && 'border-orange-400/60 dark:border-orange-700/60',
    )}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-3xl" aria-label={`${t('driverScoring.rank')} ${rank}`}>{medalText}</span>
          <Award className="w-5 h-5 t-text-3" aria-hidden />
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-bold t-text truncate">{row.staff.user.name ?? row.staff.user.email}</p>
        <p className="text-xs t-text-3 truncate mb-3">{row.staff.user.email}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-black tabular-nums t-text">{row.overallScore.toFixed(1)}</span>
          <span className="text-sm t-text-3">/ 100</span>
        </div>
        <div className="mt-3 space-y-1.5">
          <ScoreBar label={t('driverScoring.punctuality')} value={row.punctualityScore} />
          <ScoreBar label={t('driverScoring.reliability')} value={row.incidentScore} />
          <ScoreBar label={t('driverScoring.activity')}    value={row.tripVolumeScore} />
        </div>
        <p className="text-[10px] t-text-3 mt-3 tabular-nums">
          {row.tripsOnTime}/{row.tripsCompleted} {t('driverScoring.tripsOnTime')} · {row.incidents} {t('driverScoring.incidentsLabel')}
        </p>
      </CardContent>
    </Card>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="t-text-2">{label}</span>
        <span className="tabular-nums t-text">{pct}%</span>
      </div>
      <div
        className="w-full h-1.5 bg-gray-200 dark:bg-slate-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${pct}%`}
      >
        <div
          className="h-full bg-teal-500 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
