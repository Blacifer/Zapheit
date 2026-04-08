import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { GitBranch } from 'lucide-react';

export type ConditionNodeData = {
  label: string;
  condition?: string;
};

export const ConditionNode = memo(({ data, selected }: NodeProps<ConditionNodeData>) => (
  <div
    className={`bg-slate-800 border-2 rounded-xl shadow-md px-4 py-3 min-w-[180px] max-w-[240px] ${
      selected ? 'border-amber-500' : 'border-amber-700'
    }`}
  >
    <Handle type="target" position={Position.Top} className="!bg-amber-400" />
    <div className="flex items-center gap-2 mb-1">
      <GitBranch className="w-4 h-4 text-amber-500 shrink-0" />
      <span className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Condition</span>
    </div>
    <p className="text-sm font-medium text-gray-100 truncate">{data.label || 'If / Else'}</p>
    {data.condition && (
      <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">{data.condition}</p>
    )}
    {/* Two output handles: true (right) and false (left) */}
    <Handle
      type="source"
      position={Position.Bottom}
      id="true"
      style={{ left: '30%' }}
      className="!bg-green-500"
    />
    <Handle
      type="source"
      position={Position.Bottom}
      id="false"
      style={{ left: '70%' }}
      className="!bg-red-400"
    />
  </div>
));
ConditionNode.displayName = 'ConditionNode';
