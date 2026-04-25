/**
 * TransitionEdge — Arête personnalisée React Flow pour les transitions de workflow
 *
 * Affiche :
 *   - Label = nom de l'action (ex: "CONFIRM_PAYMENT")
 *   - Badge permission (scope coloré)
 *   - Badges guards (si présents)
 *   - Couleur selon simStatus (reached=vert / blocked=rouge)
 */
import { memo } from 'react';
import {
  getBezierPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from 'reactflow';
import { cn } from '../../../lib/utils';
import type { RFEdgeData } from '../ReactFlowAdapter';

const SCOPE_COLORS: Record<string, string> = {
  own:    'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  agency: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  tenant: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
  global: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
};

function extractScope(permission: string): string {
  const parts = permission.split('.');
  return parts[parts.length - 1] ?? 'tenant';
}

interface TransitionEdgeProps extends EdgeProps {
  data?: RFEdgeData;
}

export const TransitionEdge = memo(function TransitionEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data = {} as RFEdgeData, selected,
}: TransitionEdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const scope = extractScope(data?.permission ?? '');
  const scopeColor = SCOPE_COLORS[scope] ?? SCOPE_COLORS.tenant;

  const strokeColor =
    data?.simStatus === 'reached'  ? '#10b981' :
    data?.simStatus === 'blocked'  ? '#ef4444' :
    selected                       ? '#3b82f6' : '#94a3b8';

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        strokeWidth={selected ? 2.5 : 1.5}
        stroke={strokeColor}
        fill="none"
        strokeDasharray={data?.simStatus === 'reached' ? '5 3' : undefined}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position:  'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className={cn(
            'rounded-md px-2 py-1 text-[10px] font-medium shadow-sm border',
            'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700',
            'flex flex-col items-center gap-0.5 max-w-[140px]',
            selected && 'ring-1 ring-blue-400',
          )}
        >
          {/* Action name */}
          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate w-full text-center">
            {data?.action}
          </span>

          {/* Permission scope */}
          {data?.permission && (
            <span className={cn('rounded px-1 text-[9px] font-bold uppercase', scopeColor)}>
              {scope}
            </span>
          )}

          {/* Guards (si présents) */}
          {data?.guards?.length > 0 && (
            <div className="flex flex-wrap gap-0.5 justify-center">
              {data.guards.slice(0, 2).map(g => (
                <span key={g} className="rounded bg-slate-100 dark:bg-slate-800 px-1 text-[8px] text-slate-500 dark:text-slate-400">
                  ⛨ {g.replace('check', '')}
                </span>
              ))}
              {data.guards.length > 2 && (
                <span className="text-[8px] text-slate-400">+{data.guards.length - 2}</span>
              )}
            </div>
          )}

          {/* Sim blocked */}
          {data?.simStatus === 'blocked' && (
            <span className="text-red-500 text-[9px] font-bold">⛔ Bloqué</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
