import { getBezierPath, EdgeLabelRenderer, BaseEdge, type EdgeProps } from 'reactflow';

export type ConditionalEdgeData = {
  label?: string;
};

export function ConditionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<ConditionalEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const label = data?.label;
  const isTrue = label === 'true' || label === 'approved';
  const isFalse = label === 'false' || label === 'denied';

  const labelColor = isTrue
    ? 'bg-green-100 text-green-700 border-green-300'
    : isFalse
    ? 'bg-red-100 text-red-600 border-red-300'
    : 'bg-gray-100 text-gray-600 border-gray-300';

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ stroke: '#d1d5db' }} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${labelColor}`}>
              {label}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
