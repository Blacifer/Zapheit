import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Zap } from 'lucide-react';

export type ActionNodeData = {
  label: string;
  tool?: string;
  integration?: string;
};

const CONNECTOR_COLORS: Record<string, string> = {
  slack: 'border-pink-600',
  jira: 'border-blue-600',
  github: 'border-slate-500',
  hubspot: 'border-orange-600',
  quickbooks: 'border-green-600',
  'google-workspace': 'border-red-600',
  'zoho-people': 'border-yellow-600',
  notion: 'border-slate-600',
};

export const ActionNode = memo(({ data, selected }: NodeProps<ActionNodeData>) => {
  const borderColor = data.integration
    ? CONNECTOR_COLORS[data.integration] || 'border-purple-700'
    : 'border-purple-700';

  return (
    <div
      className={`bg-slate-800 border-2 rounded-xl shadow-md px-4 py-3 min-w-[180px] max-w-[240px] ${
        selected ? 'border-purple-500' : borderColor
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-purple-400" />
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-4 h-4 text-purple-500 shrink-0" />
        <span className="text-xs font-semibold text-purple-300 uppercase tracking-wide">
          {data.integration ? 'Connector' : 'Action'}
        </span>
      </div>
      <p className="text-sm font-medium text-gray-100 truncate">{data.label || 'Unnamed Action'}</p>
      {data.tool && (
        <p className="text-xs text-gray-400 mt-0.5 truncate">{data.tool}</p>
      )}
      {data.integration && (
        <span className="mt-1 inline-block text-xs bg-purple-900/30 text-purple-300 px-1.5 py-0.5 rounded">
          via {data.integration}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400" />
    </div>
  );
});
ActionNode.displayName = 'ActionNode';
