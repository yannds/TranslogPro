/**
 * StateNode — Nœud personnalisé React Flow pour les états de workflow
 *
 * Affiche :
 *   - Nom de l'état (label)
 *   - Badge type (initial | terminal) ou rien pour state normal
 *   - Nombre de transitions sortantes
 *   - Couleur de fond selon simStatus (reached=vert / blocked=rouge / unreached=gris)
 */
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { cn } from '../../../lib/utils';
import type { RFNodeData } from '../ReactFlowAdapter';

interface StateNodeProps {
  data:     RFNodeData;
  selected: boolean;
}

const TYPE_STYLES: Record<string, string> = {
  initial:  'border-blue-500 bg-blue-50 dark:bg-blue-950 dark:border-blue-400',
  terminal: 'border-slate-700 bg-slate-100 dark:bg-slate-800 dark:border-slate-500',
  state:    'border-slate-300 bg-white dark:bg-slate-900 dark:border-slate-600',
};

const TYPE_BADGE: Record<string, string> = {
  initial:  'Départ',
  terminal: 'Fin',
};

const SIM_RING: Record<string, string> = {
  reached:   'ring-2 ring-emerald-400',
  blocked:   'ring-2 ring-red-400',
  unreached: 'opacity-40',
};

export const StateNode = memo(function StateNode({ data, selected }: StateNodeProps) {
  const baseStyle = TYPE_STYLES[data.stateType] ?? TYPE_STYLES.state;
  const simRing   = data.simStatus ? SIM_RING[data.simStatus] : '';

  return (
    <div
      className={cn(
        'min-w-[120px] max-w-[180px] rounded-xl border-2 px-3 py-2 shadow-sm transition-all',
        baseStyle,
        simRing,
        selected && 'ring-2 ring-offset-1 ring-blue-500',
      )}
    >
      {/* Handles */}
      <Handle type="target" position={Position.Left}  className="!bg-slate-400 !w-2.5 !h-2.5" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-2.5 !h-2.5" />

      {/* Badge type */}
      {TYPE_BADGE[data.stateType] && (
        <div className="mb-1">
          <span className={cn(
            'inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
            data.stateType === 'initial'
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
              : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
          )}>
            {TYPE_BADGE[data.stateType]}
          </span>
        </div>
      )}

      {/* Sim indicator */}
      {data.simStatus === 'reached' && (
        <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white dark:border-slate-900" />
      )}
      {data.simStatus === 'blocked' && (
        <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-400 border-2 border-white dark:border-slate-900" />
      )}

      {/* Label */}
      <div className="text-xs font-semibold text-slate-900 dark:text-slate-50 leading-tight">
        {data.label}
      </div>

      {/* ID technique (petit) */}
      <div className="mt-0.5 font-mono text-[9px] text-slate-400 truncate">
        {/* shown on selected only */}
      </div>

      {/* Transitions count */}
      {data.transitionCount > 0 && (
        <div className="mt-1 flex items-center gap-1">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          <span className="text-[9px] text-slate-400">{data.transitionCount} →</span>
        </div>
      )}
    </div>
  );
});
