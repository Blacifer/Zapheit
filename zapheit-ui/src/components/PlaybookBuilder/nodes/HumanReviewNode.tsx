import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { UserCheck } from 'lucide-react';

export type HumanReviewNodeData = {
  label: string;
  required_role?: 'viewer' | 'manager' | 'admin' | 'super_admin';
  timeout_hours?: number;
};

const ROLE_COLORS: Record<string, string> = {
  viewer: 'text-gray-400 bg-gray-900/30',
  manager: 'text-blue-400 bg-blue-900/30',
  admin: 'text-orange-400 bg-orange-900/30',
  super_admin: 'text-red-400 bg-red-900/30',
};

export const HumanReviewNode = memo(({ data, selected }: NodeProps<HumanReviewNodeData>) => (
  <div
    className={`bg-slate-800 border-2 rounded-xl shadow-md px-4 py-3 min-w-[180px] max-w-[240px] ${
      selected ? 'border-green-500' : 'border-green-700'
    }`}
  >
    <Handle type="target" position={Position.Top} className="!bg-green-400" />
    <div className="flex items-center gap-2 mb-1">
      <UserCheck className="w-4 h-4 text-green-500 shrink-0" />
      <span className="text-xs font-semibold text-green-300 uppercase tracking-wide">Human Review</span>
    </div>
    <p className="text-sm font-medium text-gray-100 truncate">{data.label || 'Approval Gate'}</p>
    <div className="mt-1 flex flex-wrap gap-1">
      {data.required_role && (
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ROLE_COLORS[data.required_role] ?? ROLE_COLORS.viewer}`}>
          {data.required_role}
        </span>
      )}
      {data.timeout_hours && (
        <span className="text-xs text-gray-400 bg-slate-700 px-1.5 py-0.5 rounded">
          {data.timeout_hours}h timeout
        </span>
      )}
    </div>
    {/* approved / denied handles */}
    <Handle
      type="source"
      position={Position.Bottom}
      id="approved"
      style={{ left: '30%' }}
      className="!bg-green-500"
    />
    <Handle
      type="source"
      position={Position.Bottom}
      id="denied"
      style={{ left: '70%' }}
      className="!bg-red-400"
    />
  </div>
));
HumanReviewNode.displayName = 'HumanReviewNode';
