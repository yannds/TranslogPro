/**
 * DashboardSkeleton — Placeholder du Dashboard pendant le chargement.
 *
 * Reproduit la structure du Dashboard : header + 2 rangées de KPI + charts + activité.
 * Utilise le composant Skeleton partagé (aria-hidden, pulse CSS).
 */
import { Skeleton, SkeletonText } from '../ui/Skeleton';

interface DashboardSkeletonProps {
  /** Nombre de KPIs attendus en ligne 1 (par défaut 4) */
  row1Count?: number;
  /** Nombre de KPIs attendus en ligne 2 (par défaut 4 ; 0 = masquée) */
  row2Count?: number;
  showChart?:    boolean;
  showTopLines?: boolean;
  showActivity?: boolean;
}

function KpiCardSkeleton() {
  return (
    <div className="t-card-bordered rounded-2xl p-5">
      <div className="flex items-start justify-between mb-4">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <Skeleton className="w-12 h-4 rounded-full" />
      </div>
      <Skeleton className="h-8 w-24 mb-2" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function DashboardSkeleton({
  row1Count = 4,
  row2Count = 4,
  showChart = true,
  showTopLines = true,
  showActivity = true,
}: DashboardSkeletonProps) {
  return (
    <div
      className="p-4 sm:p-6 space-y-6"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* KPIs row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: row1Count }).map((_, i) => <KpiCardSkeleton key={`r1-${i}`} />)}
      </div>

      {/* KPIs row 2 */}
      {row2Count > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: row2Count }).map((_, i) => <KpiCardSkeleton key={`r2-${i}`} />)}
        </div>
      )}

      {/* Charts row */}
      <div className={`grid grid-cols-1 gap-4 ${showChart ? 'lg:grid-cols-3' : 'lg:grid-cols-1'}`}>
        {showChart && (
          <div className="lg:col-span-2 t-card-bordered rounded-2xl p-5 space-y-3">
            <Skeleton className="h-3 w-32" />
            <div className="flex items-end gap-1.5 h-24">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="flex-1" style={{ height: `${30 + ((i * 13) % 70)}%` }} />
              ))}
            </div>
          </div>
        )}

        {showTopLines && (
          <div className="t-card-bordered rounded-2xl p-5 space-y-4">
            <Skeleton className="h-3 w-28" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity */}
      {showActivity && (
        <div className="t-card-bordered rounded-2xl p-5 space-y-3">
          <Skeleton className="h-3 w-36" />
          <SkeletonText lines={5} lastLineWidth="70%" />
        </div>
      )}
    </div>
  );
}
