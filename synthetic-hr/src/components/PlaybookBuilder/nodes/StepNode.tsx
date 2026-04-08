import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Brain } from 'lucide-react';

export type StepNodeData = {
  label: string;
  model?: string;
  prompt?: string;
  output_key?: string;
};

export const StepNode = memo(({ data, selected }: NodeProps<StepNodeData>) => (
  <div
    className={`bg-slate-800 border-2 rounded-xl shadow-md px-4 py-3 min-w-[180px] max-w-[240px] ${
      selected ? 'border-blue-500' : 'border-blue-700'
    }`}
  >
    <Handle type="target" position={Position.Top} className="!bg-blue-400" />
    <div className="flex items-center gap-2 mb-1">
      <Brain className="w-4 h-4 text-blue-500 shrink-0" />
      <span className="text-xs font-semibold text-blue-300 uppercase tracking-wide">LLM Step</span>
    </div>
    <p className="text-sm font-medium text-gray-100 truncate">{data.label || 'Unnamed Step'}</p>
    {data.model && (
      <p className="text-xs text-gray-400 mt-0.5 truncate">{data.model}</p>
    )}
    {data.output_key && (
      <span className="mt-1 inline-block text-xs bg-blue-900/30 text-blue-300 px-1.5 py-0.5 rounded">
        → {data.output_key}
      </span>
    )}
    <Handle type="source" position={Position.Bottom} className="!bg-blue-400" />
  </div>
));
StepNode.displayName = 'StepNode';
