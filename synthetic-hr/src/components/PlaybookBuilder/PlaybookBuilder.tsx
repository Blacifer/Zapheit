import { useState, useCallback, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  ReactFlowProvider,
  ReactFlowInstance,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { StepNode, type StepNodeData } from './nodes/StepNode';
import { ConditionNode, type ConditionNodeData } from './nodes/ConditionNode';
import { ActionNode, type ActionNodeData } from './nodes/ActionNode';
import { HumanReviewNode, type HumanReviewNodeData } from './nodes/HumanReviewNode';
import { ConditionalEdge } from './edges/ConditionalEdge';
import { Brain, GitBranch, Zap, UserCheck, Plus, Save, Trash2 } from 'lucide-react';

const nodeTypes = {
  llm_step: StepNode,
  condition: ConditionNode,
  action: ActionNode,
  human_review: HumanReviewNode,
};

const edgeTypes = {
  conditional: ConditionalEdge,
};

const CONNECTOR_ACTIONS: Record<string, string[]> = {
  slack: ['send_message', 'create_channel', 'list_channels', 'add_reaction', 'upload_file'],
  jira: ['create_issue', 'update_issue', 'transition_issue', 'add_comment', 'search_issues'],
  github: ['create_issue', 'create_pr', 'add_comment', 'list_repos', 'merge_pr'],
  hubspot: ['create_contact', 'update_contact', 'create_deal', 'search_contacts', 'add_note'],
  quickbooks: ['create_invoice', 'create_payment', 'list_customers', 'create_expense'],
  'google-workspace': ['send_email', 'create_event', 'create_doc', 'list_files', 'share_file'],
  'zoho-people': ['create_record', 'update_record', 'list_records', 'get_attendance'],
  notion: ['create_page', 'update_page', 'query_database', 'create_database', 'add_block'],
};

export type WorkflowGraph = {
  type: 'workflow_run';
  nodes: Node[];
  edges: Edge[];
  start: string | null;
};

type Props = {
  initialGraph?: WorkflowGraph | null;
  onSave: (graph: WorkflowGraph) => void;
};

const PALETTE: Array<{
  type: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  defaultData: StepNodeData | ConditionNodeData | ActionNodeData | HumanReviewNodeData;
}> = [
  {
    type: 'llm_step',
    label: 'LLM Step',
    icon: <Brain className="w-4 h-4" />,
    color: 'text-blue-600',
    defaultData: { label: 'LLM Step', model: 'gpt-4o', output_key: 'result' },
  },
  {
    type: 'condition',
    label: 'Condition',
    icon: <GitBranch className="w-4 h-4" />,
    color: 'text-amber-600',
    defaultData: { label: 'If / Else', condition: '' },
  },
  {
    type: 'action',
    label: 'Connector Action',
    icon: <Zap className="w-4 h-4" />,
    color: 'text-purple-600',
    defaultData: { label: 'Connector Action', tool: '', integration: '' },
  },
  {
    type: 'human_review',
    label: 'Human Review',
    icon: <UserCheck className="w-4 h-4" />,
    color: 'text-green-600',
    defaultData: { label: 'Approval Gate', required_role: 'manager', timeout_hours: 24 },
  },
];

let nodeCounter = 1;
function newId() {
  return `n${Date.now()}_${nodeCounter++}`;
}

function toWorkflowGraph(nodes: Node[], edges: Edge[]): WorkflowGraph {
  return {
    type: 'workflow_run',
    nodes,
    edges,
    start: nodes[0]?.id ?? null,
  };
}

function PlaybookBuilderInner({ initialGraph, onSave }: Props) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph?.edges ?? []);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds: Edge[]) =>
        addEdge({ ...connection, type: 'conditional', data: { label: connection.sourceHandle ?? '' } }, eds)
      ),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!reactFlowWrapper.current || !rfInstance) return;

      const type = event.dataTransfer.getData('application/reactflow-type');
      const defaultData = JSON.parse(event.dataTransfer.getData('application/reactflow-data') || '{}');
      if (!type) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = rfInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const newNode: Node = {
        id: newId(),
        type,
        position,
        data: { ...defaultData },
      };
      setNodes((nds: Node[]) => nds.concat(newNode));
    },
    [rfInstance, setNodes]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds: Node[]) => nds.filter((n: Node) => n.id !== selectedNode.id));
    setEdges((eds: Edge[]) => eds.filter((e: Edge) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  }, [selectedNode, setNodes, setEdges]);

  const updateSelectedData = useCallback(
    (key: string, value: string) => {
      if (!selectedNode) return;
      setNodes((nds: Node[]) =>
        nds.map((n: Node) =>
          n.id === selectedNode.id ? { ...n, data: { ...n.data, [key]: value } } : n
        )
      );
      setSelectedNode((prev) => (prev ? { ...prev, data: { ...prev.data, [key]: value } } : null));
    },
    [selectedNode, setNodes]
  );

  const handleSave = useCallback(() => {
    onSave(toWorkflowGraph(nodes, edges));
  }, [nodes, edges, onSave]);

  return (
    <div className="flex h-full w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Left palette */}
      <div className="w-44 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Drag to add</p>
        {PALETTE.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/reactflow-type', item.type);
              e.dataTransfer.setData('application/reactflow-data', JSON.stringify(item.defaultData));
              e.dataTransfer.effectAllowed = 'move';
            }}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 cursor-grab shadow-sm hover:shadow-md transition-shadow select-none"
          >
            <span className={item.color}>{item.icon}</span>
            <span className="text-sm text-gray-700 dark:text-gray-200">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div ref={reactFlowWrapper} className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setRfInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          deleteKeyCode="Delete"
          className="bg-gray-50 dark:bg-gray-950"
        >
          <Background gap={16} color="#e5e7eb" />
          <Controls />
          <MiniMap
            nodeColor={(n: Node) => {
              if (n.type === 'llm_step') return '#3b82f6';
              if (n.type === 'condition') return '#f59e0b';
              if (n.type === 'action') return '#a855f7';
              if (n.type === 'human_review') return '#22c55e';
              return '#6b7280';
            }}
            className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-700"
          />
          <Panel position="top-right" className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow transition-colors"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
          </Panel>
        </ReactFlow>

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <Plus className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-2" />
            <p className="text-gray-400 dark:text-gray-500 text-sm">Drag nodes from the left panel to build your playbook</p>
          </div>
        )}
      </div>

      {/* Right property panel */}
      {selectedNode && (
        <div className="w-64 shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Properties</p>
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Label</label>
            <input
              value={selectedNode.data.label ?? ''}
              onChange={(e) => updateSelectedData('label', e.target.value)}
              className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {selectedNode.type === 'llm_step' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <select
                  value={selectedNode.data.model ?? 'gpt-4o'}
                  onChange={(e) => updateSelectedData('model', e.target.value)}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="claude-3-5-sonnet">claude-3.5-sonnet</option>
                  <option value="claude-3-haiku">claude-3-haiku</option>
                  <option value="gemini-pro">gemini-pro</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Prompt</label>
                <textarea
                  value={selectedNode.data.prompt ?? ''}
                  onChange={(e) => updateSelectedData('prompt', e.target.value)}
                  rows={4}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
                  placeholder="System or user prompt..."
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Output key</label>
                <input
                  value={selectedNode.data.output_key ?? ''}
                  onChange={(e) => updateSelectedData('output_key', e.target.value)}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="result"
                />
              </div>
            </>
          )}

          {selectedNode.type === 'condition' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Condition expression</label>
              <input
                value={selectedNode.data.condition ?? ''}
                onChange={(e) => updateSelectedData('condition', e.target.value)}
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="{{result}} !== null"
              />
              <p className="text-xs text-gray-400 mt-1">
                Left handle = true, right handle = false
              </p>
            </div>
          )}

          {selectedNode.type === 'action' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Connector</label>
                <select
                  value={selectedNode.data.integration ?? ''}
                  onChange={(e) => {
                    updateSelectedData('integration', e.target.value);
                    updateSelectedData('tool', '');
                    updateSelectedData('label', e.target.value ? `${e.target.value} Action` : 'Connector Action');
                  }}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select connector…</option>
                  <option value="slack">Slack</option>
                  <option value="jira">Jira</option>
                  <option value="github">GitHub</option>
                  <option value="hubspot">HubSpot</option>
                  <option value="quickbooks">QuickBooks</option>
                  <option value="google-workspace">Google Workspace</option>
                  <option value="zoho-people">Zoho People</option>
                  <option value="notion">Notion</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Action</label>
                <select
                  value={selectedNode.data.tool ?? ''}
                  onChange={(e) => {
                    updateSelectedData('tool', e.target.value);
                    const connector = selectedNode.data.integration || '';
                    if (e.target.value && connector) {
                      updateSelectedData('label', `${connector}.${e.target.value}`);
                    }
                  }}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select action…</option>
                  {(CONNECTOR_ACTIONS[selectedNode.data.integration ?? ''] ?? []).map((a: string) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                {!selectedNode.data.integration && (
                  <p className="text-xs text-gray-400 mt-1">Select a connector first</p>
                )}
              </div>
            </>
          )}

          {selectedNode.type === 'human_review' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Required role</label>
                <select
                  value={selectedNode.data.required_role ?? 'manager'}
                  onChange={(e) => updateSelectedData('required_role', e.target.value)}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="viewer">Viewer</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Timeout (hours)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={selectedNode.data.timeout_hours ?? 24}
                  onChange={(e) => updateSelectedData('timeout_hours', e.target.value)}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Left = approved, right = denied
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PlaybookBuilder(props: Props) {
  return (
    <ReactFlowProvider>
      <PlaybookBuilderInner {...props} />
    </ReactFlowProvider>
  );
}
