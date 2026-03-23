import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList,
  RefreshCw,
  Zap,
  Lock,
  Copy,
  Download,
  Share2,
  ThumbsUp,
  ThumbsDown,
  Wand2,
  Mic,
  MicOff,
  FileText,
  Link,
  ArrowRight,
  Plus,
  Calendar,
  Cpu,
  BarChart2,
  Settings,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Sparkles,
  Trash2,
  GitBranch,
  Save,
  Play,
  AlertTriangle,
} from 'lucide-react';
import type { AIAgent } from '../../types';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type { PlaybookPackId, Playbook } from '../../lib/playbooks/types';
import { PLAYBOOK_PACKS, PLAYBOOKS } from '../../lib/playbooks/registry';
import type { AgentJob, CustomPlaybook, PlaybookSchedule, PlaybookTrigger } from '../../lib/api/platform';

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(text: string): JSX.Element {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-base font-semibold text-white mt-4 mb-1">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-bold text-white mt-5 mb-2 border-b border-slate-700 pb-1">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl font-bold text-white mt-5 mb-2">{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: JSX.Element[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(<li key={i} className="ml-4 text-slate-200">{renderInline(lines[i].slice(2))}</li>);
        i++;
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-2">{items}</ul>);
      continue;
    } else if (/^\d+\.\s/.test(line)) {
      const items: JSX.Element[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i} className="ml-4 text-slate-200">{renderInline(lines[i].replace(/^\d+\.\s/, ''))}</li>);
        i++;
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-2">{items}</ol>);
      continue;
    } else if (line.startsWith('```')) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 overflow-x-auto text-xs text-slate-200 my-2">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
    } else if (line.trim() === '') {
      if (elements.length > 0) elements.push(<div key={i} className="h-1" />);
    } else {
      elements.push(<p key={i} className="text-slate-200 leading-relaxed">{renderInline(line)}</p>);
    }
    i++;
  }

  return <div className="space-y-1 text-sm">{elements}</div>;
}

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++} className="text-white font-semibold">{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++} className="italic">{m[3]}</em>);
    else if (m[4]) parts.push(<code key={key++} className="bg-slate-900/60 px-1 rounded text-cyan-300 text-[11px]">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Extract sections from markdown output for structured card display
function extractSections(text: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  const re = /^#{1,3}\s+(.+)$/gm;
  const headingPositions: Array<{ index: number; heading: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    headingPositions.push({ index: m.index, heading: m[1] });
  }
  for (let i = 0; i < headingPositions.length; i++) {
    const start = headingPositions[i].index;
    const end = i + 1 < headingPositions.length ? headingPositions[i + 1].index : text.length;
    const body = text.slice(start, end).replace(/^#{1,3}\s+.+\n/, '').trim();
    if (body) sections.push({ heading: headingPositions[i].heading, body });
  }
  return sections;
}

// Extract human-readable text from job output
function extractJobResult(job: AgentJob): string {
  const output = job.output as any;
  if (!output) return '';
  if (output.final?.message) return output.final.message;
  if (output.message) return output.message;
  const stepsArr = Array.isArray(output.steps) ? output.steps : [];
  const lastStep = stepsArr[stepsArr.length - 1];
  if (lastStep?.message) return lastStep.message;
  return '';
}

// ─── Custom playbook card with eval/test suite ────────────────────────────────

type TestCase = { id: string; inputs: Record<string, string>; checklist: string[] };
type TestResult = { id: string; status: 'running' | 'passed' | 'failed' | 'error'; output: string; scores: Record<string, boolean | null>; score: number };

// ─── Workflow step types (B7 + B8) ────────────────────────────────────────────
type LlmStep = {
  id: string;
  kind: 'llm';
  agent_id?: string | null;  // B7: per-step agent override
  model?: string;
  temperature?: number;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  next?: string | null;      // explicit next step id; null = sequential
};

type BranchCondition = {
  test: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'else' | 'llm';
  value?: string;
  prompt?: string;           // for test: 'llm' — yes/no question for the judge
  next: string;              // step id to jump to
};

type BranchStep = {
  id: string;
  kind: 'branch';
  source: string;            // which step's output to evaluate
  conditions: BranchCondition[];
};

type WorkflowStep = LlmStep | BranchStep;

type Workflow = {
  steps: WorkflowStep[];
  start?: string;
  final_step?: string;
  version: number;
};

function makeDefaultWorkflow(): Workflow {
  return {
    version: 2,
    steps: [
      {
        id: 'step_1',
        kind: 'llm',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: '{{input.input}}' },
        ],
      },
    ],
  };
}

function getWorkflow(cp: CustomPlaybook): Workflow {
  const wf = cp.workflow;
  if (wf && Array.isArray(wf.steps) && wf.steps.length > 0) return wf as Workflow;
  return makeDefaultWorkflow();
}

function llmStepsOf(wf: Workflow): LlmStep[] {
  return wf.steps.filter((s): s is LlmStep => s.kind === 'llm');
}

function CustomPlaybookCard({
  cp,
  agents,
  agentId: defaultAgentId,
  onUpdate,
  onDelete,
}: {
  cp: CustomPlaybook;
  agents: { id: string; name: string }[];
  agentId: string;
  onUpdate: (cp: CustomPlaybook) => void;
  onDelete: () => void;
}) {
  const [showTest, setShowTest] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow>(() => getWorkflow(cp));
  const [builderDirty, setBuilderDirty] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>(() => {
    try { return (cp as any).test_cases || []; } catch { return []; }
  });
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [running, setRunning] = useState(false);

  // ── Run panel state ───────────────────────────────────────────────────────
  const [showRun, setShowRun] = useState(false);
  const [runFields, setRunFields] = useState<Record<string, string>>(() =>
    Object.fromEntries((cp.fields || []).map((f) => [f.key, ''])));
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [runOutput, setRunOutput] = useState('');
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  const addTestCase = () => {
    const tc: TestCase = {
      id: crypto.randomUUID(),
      inputs: Object.fromEntries((cp.fields || []).map((f) => [f.key, ''])),
      checklist: ['Output is relevant and complete', 'Output is professional in tone'],
    };
    const updated = [...testCases, tc];
    setTestCases(updated);
    void api.playbooks.updateCustom(cp.id, { test_cases: updated } as any);
  };

  const updateChecklist = (tcId: string, text: string) => {
    setTestCases((prev) => prev.map((tc) => tc.id === tcId ? { ...tc, checklist: text.split('\n').filter(Boolean) } : tc));
  };

  const saveTestCases = () => {
    void api.playbooks.updateCustom(cp.id, { test_cases: testCases } as any);
    toast.success('Test cases saved');
  };

  const runTests = async () => {
    if (!testCases.length) { toast.error('Add at least one test case first'); return; }
    const agent = agents.find((a) => a.id === defaultAgentId) || agents[0];
    if (!agent) { toast.error('No agent available'); return; }
    setRunning(true);

    for (const tc of testCases) {
      setResults((prev) => ({ ...prev, [tc.id]: { id: tc.id, status: 'running', output: '', scores: {}, score: 0 } }));
      try {
        // Create a job for this test case.
        // Use workflow_run if the playbook has a multi-step workflow, else chat_turn.
        const wf = getWorkflow(cp);
        const res = await api.jobs.create({
          agent_id: agent.id,
          type: 'workflow_run',
          input: { workflow: wf, fields: tc.inputs },
          playbook_id: cp.id,
        }) as any;

        if (!res.success) throw new Error(res.error || 'Job creation failed');

        // Poll for completion.
        let output = '';
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          const poll = await api.jobs.get(res.data.job.id) as any;
          if (poll.success && (poll.data.job.status === 'succeeded' || poll.data.job.status === 'failed')) {
            const out = poll.data.job.output;
            output = out?.final?.message || out?.message || '';
            break;
          }
        }

        // Evaluate checklist with LLM.
        const evalInput = {
          model: 'openai/gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a quality evaluator. For each checklist item, answer YES or NO based on whether the output satisfies it. Respond with a JSON object: { "item text": true/false }',
            },
            {
              role: 'user',
              content: `Output to evaluate:\n${output}\n\nChecklist:\n${tc.checklist.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
            },
          ],
        };

        const evalRes = await api.jobs.create({ agent_id: agent.id, type: 'chat_turn', input: evalInput }) as any;
        let scores: Record<string, boolean | null> = {};
        if (evalRes.success) {
          for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise((r) => setTimeout(r, 2000));
            const poll = await api.jobs.get(evalRes.data.job.id) as any;
            if (poll.success && poll.data.job.status === 'succeeded') {
              const raw = poll.data.job.output?.message || '';
              try {
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                if (jsonMatch) scores = JSON.parse(jsonMatch[0]);
              } catch { /* ignore */ }
              break;
            }
          }
        }

        const passed = Object.values(scores).filter(Boolean).length;
        const total = tc.checklist.length;
        const score = total > 0 ? Math.round((passed / total) * 100) : 0;

        setResults((prev) => ({
          ...prev,
          [tc.id]: { id: tc.id, status: score >= 70 ? 'passed' : 'failed', output, scores, score },
        }));
      } catch (err: any) {
        setResults((prev) => ({ ...prev, [tc.id]: { id: tc.id, status: 'error', output: err?.message || 'Error', scores: {}, score: 0 } }));
      }
    }

    setRunning(false);
    toast.success('Test run complete');
  };

  // ── Workflow builder helpers ──────────────────────────────────────────────

  const wfUpdate = (fn: (wf: Workflow) => Workflow) => {
    setWorkflow((prev) => fn(prev));
    setBuilderDirty(true);
  };

  const addLlmStep = () => {
    wfUpdate((wf) => ({
      ...wf,
      steps: [
        ...wf.steps,
        {
          id: `step_${wf.steps.length + 1}`,
          kind: 'llm' as const,
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system' as const, content: 'You are a helpful assistant.' },
            { role: 'user' as const, content: '' },
          ],
        },
      ],
    }));
  };

  const addBranchAfter = (afterIdx: number) => {
    const llmSteps = llmStepsOf(workflow);
    if (llmSteps.length < 2) {
      toast.error('Add at least 2 LLM steps before adding a branch.');
      return;
    }
    const sourceStep = workflow.steps[afterIdx];
    const branch: BranchStep = {
      id: `branch_${Date.now()}`,
      kind: 'branch',
      source: sourceStep?.id || workflow.steps[0].id,
      conditions: [
        { test: 'contains', value: '', next: llmSteps[0].id },
        { test: 'else', next: llmSteps[llmSteps.length - 1].id },
      ],
    };
    wfUpdate((wf) => {
      const steps = [...wf.steps];
      steps.splice(afterIdx + 1, 0, branch);
      return { ...wf, steps };
    });
  };

  const removeStep = (id: string) => {
    wfUpdate((wf) => ({ ...wf, steps: wf.steps.filter((s) => s.id !== id) }));
  };

  const updateLlmStep = (id: string, patch: Partial<LlmStep>) => {
    wfUpdate((wf) => ({
      ...wf,
      steps: wf.steps.map((s) => s.id === id && s.kind === 'llm' ? { ...s, ...patch } : s),
    }));
  };

  const updateBranchStep = (id: string, patch: Partial<BranchStep>) => {
    wfUpdate((wf) => ({
      ...wf,
      steps: wf.steps.map((s) => s.id === id && s.kind === 'branch' ? { ...s, ...patch } : s),
    }));
  };

  const saveWorkflow = async () => {
    const res = await api.playbooks.updateCustom(cp.id, { workflow } as any);
    if (res.success && res.data) { onUpdate(res.data); setBuilderDirty(false); toast.success('Workflow saved'); }
    else toast.error(res.error || 'Failed to save');
  };

  // ── Builder helpers ───────────────────────────────────────────────────────

  const moveStep = (idx: number, dir: -1 | 1) => {
    wfUpdate((wf) => {
      const steps = [...wf.steps];
      const target = idx + dir;
      if (target < 0 || target >= steps.length) return wf;
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...wf, steps };
    });
  };

  /** Insert template token at cursor position in a tracked textarea. */
  const insertAtCursor = (refKey: string, token: string, stepId: string, msgIdx: number) => {
    const el = textareaRefs.current.get(refKey);
    const step = workflow.steps.find((s) => s.id === stepId) as LlmStep | undefined;
    if (!step || step.kind !== 'llm') return;
    const base = step.messages[msgIdx]?.content ?? '';
    let newVal: string;
    let cursor: number;
    if (el) {
      const s = el.selectionStart ?? base.length;
      const e = el.selectionEnd ?? base.length;
      newVal = base.slice(0, s) + token + base.slice(e);
      cursor = s + token.length;
    } else {
      newVal = base + token;
      cursor = newVal.length;
    }
    const msgs = step.messages.map((m, i) => i === msgIdx ? { ...m, content: newVal } : m);
    updateLlmStep(stepId, { messages: msgs });
    if (el) setTimeout(() => { el.focus(); el.setSelectionRange(cursor, cursor); }, 0);
  };

  // ── Run playbook ──────────────────────────────────────────────────────────

  const runPlaybook = async () => {
    const agent = agents.find((a) => a.id === defaultAgentId) || agents[0];
    if (!agent) { toast.error('No agent available'); return; }
    setRunStatus('running');
    setRunOutput('');
    try {
      const wf = getWorkflow(cp);
      const res = await api.jobs.create({
        agent_id: agent.id,
        type: 'workflow_run',
        input: { workflow: wf, fields: runFields },
        playbook_id: cp.id,
      }) as any;
      if (!res.success) throw new Error(res.error || 'Job creation failed');
      const jobId = res.data.job.id;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await api.jobs.get(jobId) as any;
        if (poll.success) {
          const j = poll.data.job;
          if (j.status === 'succeeded' || j.status === 'failed') {
            const out = j.output?.final?.message || j.output?.message || '';
            setRunOutput(out || (j.status === 'failed' ? 'Run failed.' : '(no output)'));
            setRunStatus(j.status === 'succeeded' ? 'done' : 'error');
            return;
          }
        }
      }
      setRunStatus('error');
      setRunOutput('Timed out waiting for result.');
    } catch (err: any) {
      setRunStatus('error');
      setRunOutput(err?.message || 'Unknown error');
    }
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{cp.name}</div>
          <div className="text-xs text-slate-400 mt-0.5">{cp.description}</div>
          <div className="text-xs text-slate-500 mt-0.5">v{cp.version} · {cp.fields?.length ?? 0} fields · {cp.category}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${cp.enabled ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-400'}`}>
            {cp.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <button
            onClick={() => { setShowRun((v) => !v); setShowBuilder(false); setShowTest(false); }}
            className={`px-2 py-1 rounded-md border text-xs flex items-center gap-1 ${showRun ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-900/40 text-slate-300 border-slate-700 hover:bg-slate-900/60'}`}
          >
            <Play className="w-3 h-3" />
            Run
          </button>
          <button
            onClick={() => { setShowBuilder((v) => !v); setShowTest(false); setShowRun(false); }}
            className={`px-2 py-1 rounded-md border text-xs flex items-center gap-1 ${showBuilder ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-slate-900/40 text-slate-300 border-slate-700 hover:bg-slate-900/60'}`}
          >
            <Settings className="w-3 h-3" />
            Build
          </button>
          <button
            onClick={() => { setShowTest((v) => !v); setShowBuilder(false); setShowRun(false); }}
            className={`px-2 py-1 rounded-md border text-xs ${showTest ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' : 'bg-slate-900/40 text-slate-300 border-slate-700 hover:bg-slate-900/60'}`}
          >
            Test
          </button>
          <button
            onClick={() => api.playbooks.updateCustom(cp.id, { enabled: !cp.enabled }).then((r) => { if (r.success && r.data) onUpdate(r.data); })}
            className="px-2 py-1 rounded-md bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700 text-xs text-slate-300"
          >
            {cp.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={() => api.playbooks.deleteCustom(cp.id).then((r) => { if (r.success) onDelete(); })}
            className="px-2 py-1 rounded-md bg-slate-900/40 hover:bg-red-900/20 border border-slate-700 hover:border-red-500/30 text-xs text-slate-400 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      </div>

      {/* ── Workflow Builder (B7 + B8) ─────────────────────────────────────── */}
      {showBuilder && (
        <div className="border-t border-slate-700 p-4 bg-slate-900/30 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-cyan-300 flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5" />
              Workflow Builder — {workflow.steps.length} step{workflow.steps.length !== 1 ? 's' : ''}
            </div>
            <div className="flex gap-2">
              <button
                onClick={addLlmStep}
                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add LLM Step
              </button>
              <button
                onClick={saveWorkflow}
                disabled={!builderDirty}
                className="px-2 py-1 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-medium flex items-center gap-1"
              >
                <Save className="w-3 h-3" /> Save
              </button>
            </div>
          </div>

          {workflow.steps.length === 0 ? (
            <p className="text-xs text-slate-500">No steps yet. Click "Add LLM Step" to start building.</p>
          ) : (
            <div className="space-y-2">
              {workflow.steps.map((step, idx) => {
                const llmIds = llmStepsOf(workflow).map((s) => s.id);

                if (step.kind === 'branch') {
                  const bs = step as BranchStep;
                  return (
                    <div key={step.id} className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-amber-300 font-medium">
                          <GitBranch className="w-3.5 h-3.5" />
                          Branch · evaluates output of step
                          <select
                            value={bs.source}
                            onChange={(e) => updateBranchStep(bs.id, { source: e.target.value })}
                            className="bg-slate-900/60 border border-amber-500/30 rounded px-1.5 py-0.5 text-amber-200 text-xs"
                          >
                            {llmIds.map((lid) => <option key={lid} value={lid}>{lid}</option>)}
                          </select>
                        </div>
                        <button onClick={() => removeStep(bs.id)} className="text-slate-500 hover:text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {/* Conditions */}
                      <div className="space-y-1 pl-2">
                        {bs.conditions.map((cond, ci) => {
                          const nextValid = !cond.next || llmIds.includes(cond.next);
                          return (
                            <div key={ci} className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <select
                                  value={cond.test}
                                  onChange={(e) => {
                                    const conds = bs.conditions.map((c, i) => i === ci ? { ...c, test: e.target.value as BranchCondition['test'] } : c);
                                    updateBranchStep(bs.id, { conditions: conds });
                                  }}
                                  className="bg-slate-900/60 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 text-xs"
                                >
                                  <option value="contains">contains</option>
                                  <option value="equals">equals</option>
                                  <option value="starts_with">starts with</option>
                                  <option value="ends_with">ends with</option>
                                  <option value="llm">LLM judge</option>
                                  <option value="else">else (fallback)</option>
                                </select>
                                {cond.test !== 'else' && cond.test !== 'llm' && (
                                  <input
                                    value={cond.value || ''}
                                    onChange={(e) => {
                                      const conds = bs.conditions.map((c, i) => i === ci ? { ...c, value: e.target.value } : c);
                                      updateBranchStep(bs.id, { conditions: conds });
                                    }}
                                    className="flex-1 min-w-[80px] bg-slate-900/60 border border-slate-700 rounded px-2 py-0.5 text-slate-200 text-xs"
                                    placeholder="text to match…"
                                  />
                                )}
                                <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                                <div className="flex items-center gap-1">
                                  <select
                                    value={cond.next}
                                    onChange={(e) => {
                                      const conds = bs.conditions.map((c, i) => i === ci ? { ...c, next: e.target.value } : c);
                                      updateBranchStep(bs.id, { conditions: conds });
                                    }}
                                    className={`bg-slate-900/60 border rounded px-1.5 py-0.5 text-xs ${nextValid ? 'border-slate-700 text-slate-200' : 'border-red-500/50 text-red-300'}`}
                                  >
                                    <option value="">— pick step —</option>
                                    {llmIds.map((lid) => <option key={lid} value={lid}>{lid}</option>)}
                                  </select>
                                  {!nextValid && (
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" title="Target step ID not found" />
                                  )}
                                </div>
                                <button
                                  onClick={() => {
                                    const conds = bs.conditions.filter((_, i) => i !== ci);
                                    updateBranchStep(bs.id, { conditions: conds });
                                  }}
                                  className="text-slate-600 hover:text-red-400"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                              {/* LLM judge prompt input */}
                              {cond.test === 'llm' && (
                                <textarea
                                  value={cond.prompt || ''}
                                  onChange={(e) => {
                                    const conds = bs.conditions.map((c, i) => i === ci ? { ...c, prompt: e.target.value } : c);
                                    updateBranchStep(bs.id, { conditions: conds });
                                  }}
                                  rows={2}
                                  placeholder={`Ask a yes/no question about the output, e.g. "Is the severity critical?"`}
                                  className="w-full bg-slate-900/60 border border-amber-500/20 rounded px-2 py-1 text-xs text-slate-200 font-mono resize-none focus:outline-none focus:border-amber-500/50"
                                />
                              )}
                            </div>
                          );
                        })}
                        <button
                          onClick={() => {
                            const conds = [...bs.conditions, { test: 'contains' as const, value: '', next: llmIds[0] || '' }];
                            updateBranchStep(bs.id, { conditions: conds });
                          }}
                          className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 mt-1"
                        >
                          <Plus className="w-3 h-3" /> Add condition
                        </button>
                      </div>
                    </div>
                  );
                }

                // LLM step
                const ls = step as LlmStep;
                return (
                  <div key={step.id} className="bg-slate-900/40 border border-slate-700 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-[10px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono">LLM</span>
                        <input
                          value={ls.id}
                          onChange={(e) => updateLlmStep(ls.id, { id: e.target.value })}
                          className="font-mono text-xs bg-transparent border-b border-slate-700 text-slate-300 w-28 focus:outline-none focus:border-cyan-500/50"
                          placeholder="step id"
                        />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => moveStep(idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                          className="text-slate-500 hover:text-slate-300 disabled:opacity-20 p-0.5"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveStep(idx, 1)}
                          disabled={idx === workflow.steps.length - 1}
                          title="Move down"
                          className="text-slate-500 hover:text-slate-300 disabled:opacity-20 p-0.5"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => addBranchAfter(idx)}
                          title="Add branch after this step"
                          className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 border border-amber-500/30 rounded px-1.5 py-0.5"
                        >
                          <GitBranch className="w-3 h-3" /> Branch
                        </button>
                        <button onClick={() => removeStep(ls.id)} className="text-slate-500 hover:text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* B7: Agent selector per step */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500">Agent (optional override)</label>
                        <select
                          value={ls.agent_id || ''}
                          onChange={(e) => updateLlmStep(ls.id, { agent_id: e.target.value || null })}
                          className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs"
                        >
                          <option value="">Default (job agent)</option>
                          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500">Model</label>
                        <input
                          value={ls.model || ''}
                          onChange={(e) => updateLlmStep(ls.id, { model: e.target.value })}
                          className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono"
                          placeholder="openai/gpt-4o-mini"
                        />
                      </div>
                    </div>

                    {/* Messages */}
                    {ls.messages.map((msg, mi) => {
                      const refKey = `${ls.id}-${mi}`;
                      return (
                        <div key={mi}>
                          <label className="text-[10px] text-slate-500 capitalize">{msg.role} message</label>
                          <textarea
                            ref={(el) => { if (el) textareaRefs.current.set(refKey, el); else textareaRefs.current.delete(refKey); }}
                            value={msg.content}
                            onChange={(e) => {
                              const msgs = ls.messages.map((m, i) => i === mi ? { ...m, content: e.target.value } : m);
                              updateLlmStep(ls.id, { messages: msgs });
                            }}
                            rows={msg.role === 'system' ? 2 : 3}
                            className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono resize-none focus:outline-none focus:border-cyan-500/50"
                            placeholder={msg.role === 'user' ? 'Use {{input.field_name}} or {{steps.step_id.message}}' : 'System instructions…'}
                          />
                          {/* Field key chips — click to insert at cursor */}
                          {(cp.fields || []).length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(cp.fields || []).map((f) => (
                                <button
                                  key={f.key}
                                  type="button"
                                  onClick={() => insertAtCursor(refKey, `{{input.${f.key}}}`, ls.id, mi)}
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-cyan-400 hover:bg-slate-700 hover:text-cyan-300"
                                  title={`Insert {{input.${f.key}}}`}
                                >
                                  {`{{input.${f.key}}}`}
                                </button>
                              ))}
                              {llmStepsOf(workflow).filter((s) => s.id !== ls.id).map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => insertAtCursor(refKey, `{{steps.${s.id}.message}}`, ls.id, mi)}
                                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-400 hover:bg-slate-700 hover:text-amber-300"
                                  title={`Insert {{steps.${s.id}.message}}`}
                                >
                                  {`{{steps.${s.id}.message}}`}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {workflow.steps.length > 0 && (
            <div className="pt-1">
              <label className="text-[10px] text-slate-500">Final step (output shown to user)</label>
              <select
                value={workflow.final_step || ''}
                onChange={(e) => wfUpdate((wf) => ({ ...wf, final_step: e.target.value || undefined }))}
                className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs"
              >
                <option value="">(last executed step)</option>
                {llmStepsOf(workflow).map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── Run panel ────────────────────────────────────────────────────── */}
      {showRun && (
        <div className="border-t border-slate-700 p-4 bg-slate-900/30 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-emerald-300 flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" />
              Run Playbook
            </div>
            {runStatus === 'running' && (
              <span className="text-xs text-cyan-400 flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" /> Running…
              </span>
            )}
          </div>

          {/* Field inputs */}
          {(cp.fields || []).length === 0 ? (
            <p className="text-xs text-slate-500">No fields defined. Add fields via the Build tab.</p>
          ) : (
            <div className="space-y-2">
              {(cp.fields || []).map((f) => (
                <div key={f.key}>
                  <label className="text-[10px] text-slate-400">{f.label}</label>
                  {f.kind === 'textarea' ? (
                    <textarea
                      value={runFields[f.key] || ''}
                      onChange={(e) => setRunFields((p) => ({ ...p, [f.key]: e.target.value }))}
                      rows={3}
                      placeholder={f.placeholder}
                      className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50 resize-none"
                    />
                  ) : (
                    <input
                      value={runFields[f.key] || ''}
                      onChange={(e) => setRunFields((p) => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => void runPlaybook()}
            disabled={runStatus === 'running'}
            className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5"
          >
            {runStatus === 'running'
              ? <><RefreshCw className="w-3 h-3 animate-spin" /> Running…</>
              : <><Play className="w-3 h-3" /> Run</>
            }
          </button>

          {/* Result */}
          {(runStatus === 'done' || runStatus === 'error') && (
            <div className={`rounded-lg border p-3 space-y-2 ${runStatus === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-medium ${runStatus === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>
                  {runStatus === 'error' ? 'Run failed' : 'Result'}
                </span>
                {runStatus === 'done' && (
                  <button
                    onClick={() => { void navigator.clipboard.writeText(runOutput); toast.success('Copied'); }}
                    className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                )}
              </div>
              <div className="text-xs text-slate-200 max-h-96 overflow-y-auto">
                {runStatus === 'done' ? renderMarkdown(runOutput) : <p className="text-red-300">{runOutput}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Eval / test suite panel */}
      {showTest && (
        <div className="border-t border-slate-700 p-4 bg-slate-900/30 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-200">Test Suite — {testCases.length} test case{testCases.length !== 1 ? 's' : ''}</div>
            <div className="flex gap-2">
              <button onClick={addTestCase} className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 flex items-center gap-1">
                <Plus className="w-3 h-3" />
                Add test
              </button>
              <button
                onClick={saveTestCases}
                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300"
              >
                Save
              </button>
              <button
                onClick={() => void runTests()}
                disabled={running || testCases.length === 0}
                className="px-2 py-1 rounded-md bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {running ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {running ? 'Running…' : 'Run all tests'}
              </button>
            </div>
          </div>

          {testCases.length === 0 ? (
            <p className="text-xs text-slate-500">No test cases yet. Click "Add test" to define inputs and a quality checklist.</p>
          ) : (
            <div className="space-y-3">
              {testCases.map((tc, idx) => {
                const result = results[tc.id];
                return (
                  <div key={tc.id} className="bg-slate-900/40 border border-slate-700 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-medium">Test {idx + 1}</span>
                      {result && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                          result.status === 'running' ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' :
                          result.status === 'passed' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                          result.status === 'failed' ? 'bg-red-500/15 text-red-300 border-red-500/30' :
                          'bg-slate-700/50 text-slate-400 border-slate-600'
                        }`}>
                          {result.status === 'running' ? 'Running…' : `${result.score}% — ${result.status}`}
                        </span>
                      )}
                    </div>
                    {/* Inputs */}
                    <div className="space-y-1">
                      {cp.fields?.map((f) => (
                        <div key={f.key}>
                          <label className="text-[10px] text-slate-500">{f.label}</label>
                          <input
                            value={tc.inputs[f.key] || ''}
                            onChange={(e) => setTestCases((prev) => prev.map((t) => t.id === tc.id ? { ...t, inputs: { ...t.inputs, [f.key]: e.target.value } } : t))}
                            className="w-full mt-0.5 bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                          />
                        </div>
                      ))}
                    </div>
                    {/* Checklist */}
                    <div>
                      <label className="text-[10px] text-slate-500">Quality checklist (one per line)</label>
                      <textarea
                        value={tc.checklist.join('\n')}
                        onChange={(e) => updateChecklist(tc.id, e.target.value)}
                        rows={3}
                        className="w-full mt-0.5 bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50 resize-none"
                      />
                    </div>
                    {/* Results */}
                    {result && result.status !== 'running' && result.output && (
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1">Output preview</div>
                        <p className="text-xs text-slate-300 bg-slate-900/60 rounded p-2 line-clamp-3">{result.output}</p>
                        {Object.entries(result.scores).length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {Object.entries(result.scores).map(([item, pass]) => (
                              <div key={item} className="flex items-center gap-2 text-xs">
                                <span className={pass ? 'text-emerald-400' : 'text-red-400'}>{pass ? '✓' : '✗'}</span>
                                <span className="text-slate-400 truncate">{item}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Analytics tab ────────────────────────────────────────────────────────────

type AnalyticsData = {
  totals: { runs: number; succeeded: number; cost_usd: number; days: number };
  by_playbook: Array<{ playbook_id: string; runs: number; succeeded: number; failed: number; thumbsUp: number; thumbsDown: number; avg_cost_usd: number; success_rate: number }>;
  daily_series: Array<{ date: string; runs: number }>;
};

function AnalyticsTab({ schedules, triggers }: { schedules: any[]; triggers: any[] }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    api.playbooks.getAnalytics(days).then((res) => {
      if (res.success && res.data) setData(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [days]);

  const maxRuns = data ? Math.max(1, ...data.by_playbook.map((p) => p.runs)) : 1;
  const maxDaily = data ? Math.max(1, ...data.daily_series.map((d) => d.runs)) : 1;

  // SVG line chart for daily series
  const LINE_W = 560;
  const LINE_H = 80;
  const points = data?.daily_series.map((d, i, arr) => {
    const x = (i / Math.max(1, arr.length - 1)) * LINE_W;
    const y = LINE_H - (d.runs / maxDaily) * (LINE_H - 8) - 4;
    return `${x},${y}`;
  }).join(' ') || '';

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-white">Playbook Analytics</h2>
        <div className="flex gap-1 bg-slate-800/40 border border-slate-700 rounded-lg p-1">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1 rounded text-xs font-medium ${days === d ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-8 text-center">Loading analytics…</div>
      ) : !data ? (
        <div className="text-sm text-slate-400 py-8 text-center">No data available yet. Run some playbooks first.</div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total runs', value: data.totals.runs },
              { label: 'Succeeded', value: data.totals.succeeded },
              { label: 'Cost (INR)', value: `₹${Math.round(data.totals.cost_usd * 94)}` },
              { label: 'Active schedules', value: schedules.filter((s) => s.enabled).length },
            ].map((stat) => (
              <div key={stat.label} className="bg-slate-800/40 border border-slate-700 rounded-xl p-4">
                <div className="text-2xl font-bold text-white">{stat.value}</div>
                <div className="text-xs text-slate-400 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Daily volume line chart */}
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
            <div className="text-sm font-medium text-slate-200 mb-3">Run volume — last {days} days</div>
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${LINE_W} ${LINE_H + 20}`} className="w-full" style={{ minWidth: 280 }}>
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
                  <line key={pct} x1={0} x2={LINE_W} y1={LINE_H - pct * (LINE_H - 8) - 4} y2={LINE_H - pct * (LINE_H - 8) - 4}
                    stroke="#334155" strokeWidth={0.5} />
                ))}
                {/* Fill */}
                {data.daily_series.length > 1 && (
                  <polyline
                    points={`0,${LINE_H} ${points} ${LINE_W},${LINE_H}`}
                    fill="rgba(6,182,212,0.12)" stroke="none"
                  />
                )}
                {/* Line */}
                {data.daily_series.length > 1 && (
                  <polyline points={points} fill="none" stroke="#06b6d4" strokeWidth={2} strokeLinejoin="round" />
                )}
                {/* Dots */}
                {data.daily_series.map((d, i, arr) => {
                  const x = (i / Math.max(1, arr.length - 1)) * LINE_W;
                  const y = LINE_H - (d.runs / maxDaily) * (LINE_H - 8) - 4;
                  return d.runs > 0 ? <circle key={i} cx={x} cy={y} r={3} fill="#06b6d4" /> : null;
                })}
                {/* X-axis labels (first + last + middle) */}
                {data.daily_series.length > 1 && [0, Math.floor(data.daily_series.length / 2), data.daily_series.length - 1].map((idx) => {
                  const d = data.daily_series[idx];
                  const x = (idx / Math.max(1, data.daily_series.length - 1)) * LINE_W;
                  return (
                    <text key={idx} x={x} y={LINE_H + 16} textAnchor="middle"
                      fill="#64748b" fontSize={9}>
                      {d.date.slice(5)}
                    </text>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Runs by playbook */}
          {data.by_playbook.length > 0 && (
            <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
              <div className="text-sm font-medium text-slate-200 mb-4">Runs by playbook</div>
              <div className="space-y-3">
                {data.by_playbook.map((p) => {
                  const name = p.playbook_id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                  const pct = Math.round((p.runs / maxRuns) * 100);
                  const feedbackTotal = p.thumbsUp + p.thumbsDown;
                  const feedbackScore = feedbackTotal > 0 ? Math.round((p.thumbsUp / feedbackTotal) * 100) : null;
                  return (
                    <div key={p.playbook_id}>
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-xs text-slate-300 truncate flex-1">{name}</span>
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-shrink-0">
                          <span>{p.runs} runs</span>
                          <span className="text-emerald-400">{p.success_rate}% ok</span>
                          {feedbackScore !== null && <span className="text-amber-400">{feedbackScore}% ▲</span>}
                          {p.avg_cost_usd > 0 && <span>₹{Math.round(p.avg_cost_usd * 94)}/run</span>}
                        </div>
                      </div>
                      <div className="h-2 bg-slate-900/60 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trigger stats */}
          {triggers.length > 0 && (
            <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
              <div className="text-sm font-medium text-slate-200 mb-3">Auto-trigger activity</div>
              <div className="space-y-2">
                {triggers.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{t.event_type} → {t.playbook_id}</span>
                    <div className="flex items-center gap-3 text-slate-500">
                      <span>{t.fire_count || 0} fires</span>
                      <span className={t.enabled ? 'text-emerald-400' : 'text-slate-500'}>{t.enabled ? 'Active' : 'Paused'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-tabs ─────────────────────────────────────────────────────────────────

type MainTab = 'run' | 'schedules' | 'triggers' | 'custom' | 'analytics';

const PACK_STORAGE_KEY = 'synthetic_hr.playbooks.pack';

export default function PlaybooksPage({
  agents,
  onNavigate,
}: {
  agents: AIAgent[];
  onNavigate?: (page: string) => void;
}) {
  const allPlaybooks = useMemo(() => PLAYBOOKS, []);
  const [customPlaybooks, setCustomPlaybooks] = useState<CustomPlaybook[]>([]);
  const [schedules, setSchedules] = useState<PlaybookSchedule[]>([]);
  const [triggers, setTriggers] = useState<PlaybookTrigger[]>([]);

  // Schedule / trigger form state
  const [showNewSchedule, setShowNewSchedule] = useState(false);
  const [schedDraft, setSchedDraft] = useState<{
    playbook_id: string; agent_id: string; cron_expression: string; timezone: string;
    input_template: Record<string, string>;
  }>({ playbook_id: '', agent_id: '', cron_expression: '0 9 * * 1', timezone: 'UTC', input_template: {} });
  const [schedSaving, setSchedSaving] = useState(false);

  const [showNewTrigger, setShowNewTrigger] = useState(false);
  const [trigDraft, setTrigDraft] = useState<{
    name: string; playbook_id: string; agent_id: string; event_type: string;
    field_mappings: Array<{ event_path: string; field_key: string }>;
  }>({ name: '', playbook_id: '', agent_id: '', event_type: 'incident.created', field_mappings: [] });
  const [trigSaving, setTrigSaving] = useState(false);

  // Result panel comments
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; content: string; created_at: string }>>([]);
  const [newComment, setNewComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  const initialPack = (() => {
    try {
      const saved = localStorage.getItem(PACK_STORAGE_KEY) as PlaybookPackId | null;
      if (saved && ['all', 'hr', 'support', 'sales', 'it'].includes(saved)) return saved;
    } catch { /* ignore */ }
    return 'all' as PlaybookPackId;
  })();

  const [pack, setPack] = useState<PlaybookPackId>(initialPack);
  const [showDisabled, setShowDisabled] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [enabledByPlaybookId, setEnabledByPlaybookId] = useState<Record<string, boolean>>({});
  const [apiSettingsByPlaybookId, setApiSettingsByPlaybookId] = useState<Record<string, { api_enabled: boolean; api_slug: string | null }>>({});
  const [apiPanelPlaybookId, setApiPanelPlaybookId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('run');

  useEffect(() => {
    (async () => {
      const res = await api.playbooks.listSettings();
      if (!res.success) return;
      const map: Record<string, boolean> = {};
      const apiMap: Record<string, { api_enabled: boolean; api_slug: string | null }> = {};
      for (const row of res.data || []) {
        if (row?.playbook_id) {
          map[row.playbook_id] = Boolean(row.enabled);
          apiMap[row.playbook_id] = { api_enabled: Boolean(row.api_enabled), api_slug: row.api_slug || null };
        }
      }
      setEnabledByPlaybookId(map);
      setApiSettingsByPlaybookId(apiMap);
    })().catch(() => void 0);

    api.playbooks.listCustom().then((r) => { if (r.success) setCustomPlaybooks(r.data || []); }).catch(() => void 0);
    api.playbooks.listSchedules().then((r) => { if (r.success) setSchedules(r.data || []); }).catch(() => void 0);
    api.playbooks.listTriggers().then((r) => { if (r.success) setTriggers(r.data || []); }).catch(() => void 0);
  }, []);

  const packPlaybooks = useMemo(() => {
    const filtered = pack === 'all' ? allPlaybooks : allPlaybooks.filter((p) => p.pack === pack);
    if (showDisabled) return filtered;
    return filtered.filter((p) => enabledByPlaybookId[p.id] !== false);
  }, [allPlaybooks, enabledByPlaybookId, pack, showDisabled]);

  const [selectedPlaybookId, setSelectedPlaybookId] = useState(() => packPlaybooks[0]?.id || allPlaybooks[0]?.id || '');
  const selectedPlaybook: Playbook | undefined =
    packPlaybooks.find((p) => p.id === selectedPlaybookId) ||
    allPlaybooks.find((p) => p.id === selectedPlaybookId) ||
    packPlaybooks[0] ||
    allPlaybooks[0];

  const recommendedAgents = useMemo(() => {
    if (!selectedPlaybook?.recommendedAgentType) return agents;
    const match = agents.filter((a) => String(a.agent_type || '').toLowerCase() === selectedPlaybook.recommendedAgentType);
    return match.length ? match : agents;
  }, [agents, selectedPlaybook?.recommendedAgentType]);

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Result state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string>('');
  const [resultError, setResultError] = useState<string | null>(null);
  const [sections, setSections] = useState<Array<{ heading: string; body: string }>>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Generate panel state
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateContext, setGenerateContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Improve state
  const [showImprove, setShowImprove] = useState(false);
  const [improveFeedback, setImproveFeedback] = useState('');
  const [improving, setImproving] = useState(false);

  // Bulk run state
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkRows, setBulkRows] = useState<Array<Record<string, string>>>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchJobs, setBatchJobs] = useState<AgentJob[]>([]);

  // Chain state
  const [chainTarget, setChainTarget] = useState<string | null>(null);

  // Share state
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollJob = useCallback((jobId: string) => {
    let attempts = 0;
    const maxAttempts = 60;
    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        stopPolling();
        setResultError('Timed out waiting for result. Check Run History for updates.');
        setJobStatus('timeout');
        return;
      }
      try {
        const res = await api.jobs.get(jobId);
        if (!res.success || !res.data?.job) return;
        const job = res.data.job;
        setJobStatus(job.status);
        if (job.status === 'succeeded') {
          stopPolling();
          const text = extractJobResult(job);
          setResultText(text);
          setSections(extractSections(text));
        } else if (job.status === 'failed' || job.status === 'canceled') {
          stopPolling();
          setResultError(job.error || `Job ${job.status}.`);
        }
      } catch { /* ignore poll errors */ }
    }, 2000);
  }, [stopPolling]);

  const ensureAgentSelected = () => {
    if (selectedAgentId) return selectedAgentId;
    const first = recommendedAgents[0]?.id || agents[0]?.id || '';
    if (first) setSelectedAgentId(first);
    return first;
  };

  const runPlaybook = async () => {
    const agentId = ensureAgentSelected();
    if (!agentId) {
      toast.error('No agents found. Create an agent first.');
      return;
    }
    if (!selectedPlaybook) return;

    setBusy(true);
    setCurrentJobId(null);
    setJobStatus(null);
    setResultText('');
    setResultError(null);
    setSections([]);
    setShareUrl(null);
    stopPolling();

    try {
      const built = selectedPlaybook.buildJob(inputs);
      const res = await api.jobs.create({
        agent_id: agentId,
        type: built.type,
        input: built.input,
        playbook_id: selectedPlaybook.id,
      });

      if (!res.success || !res.data?.job?.id) {
        throw new Error(res.error || 'Failed to create job');
      }

      const job = res.data.job;
      setCurrentJobId(job.id);
      setJobStatus(job.status);

      if (built.type === 'connector_action') {
        toast.success('Submitted for approval. Review it in Pending Actions.');
        return;
      }

      pollJob(job.id);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to run playbook');
    } finally {
      setBusy(false);
    }
  };

  const runImprove = async () => {
    if (!improveFeedback.trim() || !currentJobId || !selectedPlaybook) return;
    const agentId = ensureAgentSelected();
    if (!agentId) return;

    setImproving(true);
    setResultText('');
    setResultError(null);
    setSections([]);
    stopPolling();

    try {
      const built = selectedPlaybook.buildJob(inputs);
      const improveInput = {
        ...built.input,
        _improve_context: {
          previous_output: resultText,
          improvement_request: improveFeedback,
        },
      };
      // Prepend improvement instruction to messages
      if (built.type === 'chat_turn' && improveInput.messages) {
        improveInput.messages = [
          ...improveInput.messages,
          { role: 'assistant', content: resultText },
          { role: 'user', content: `Please improve the above based on this feedback: ${improveFeedback}` },
        ];
      }

      const res = await api.jobs.create({
        agent_id: agentId,
        type: built.type,
        input: improveInput,
        parent_job_id: currentJobId,
        playbook_id: selectedPlaybook.id,
      });

      if (!res.success || !res.data?.job?.id) throw new Error(res.error || 'Failed to run improvement');
      setCurrentJobId(res.data.job.id);
      setJobStatus(res.data.job.status);
      setShowImprove(false);
      setImproveFeedback('');
      pollJob(res.data.job.id);
    } catch (err: any) {
      toast.error(err?.message || 'Improvement failed');
    } finally {
      setImproving(false);
    }
  };

  const runRegenerate = async () => {
    if (!selectedPlaybook) return;
    const agentId = ensureAgentSelected();
    if (!agentId) return;

    setResultText('');
    setResultError(null);
    setSections([]);
    stopPolling();
    setBusy(true);

    try {
      const built = selectedPlaybook.buildJob(inputs);
      const res = await api.jobs.create({
        agent_id: agentId,
        type: built.type,
        input: built.input,
        parent_job_id: currentJobId || undefined,
        playbook_id: selectedPlaybook.id,
      });
      if (!res.success || !res.data?.job?.id) throw new Error(res.error || 'Failed');
      setCurrentJobId(res.data.job.id);
      setJobStatus(res.data.job.status);
      pollJob(res.data.job.id);
    } catch (err: any) {
      toast.error(err?.message || 'Regeneration failed');
    } finally {
      setBusy(false);
    }
  };

  const runGenerate = async () => {
    if (!generateContext.trim() || !selectedPlaybook) return;
    setGenerating(true);
    try {
      const res = await api.playbooks.generateInputs(selectedPlaybook.id, {
        context: generateContext,
        field_extractor_prompt: selectedPlaybook.fieldExtractorPrompt,
        fields: selectedPlaybook.fields,
      });
      if (!res.success) throw new Error(res.error || 'Generation failed');
      const extracted = res.data?.fields || {};
      setInputs((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(extracted).filter(([, v]) => typeof v === 'string' && v)) }));
      setShowGenerate(false);
      setGenerateContext('');
      toast.success('Fields populated from your description');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate fields');
    } finally {
      setGenerating(false);
    }
  };

  const handlePdfUpload = async (file: File) => {
    // Read PDF as text using FileReader (basic text extraction)
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      // Strip PDF binary noise — keep printable ASCII
      const clean = text.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, '\n').trim();
      setGenerateContext((prev) => (prev ? prev + '\n\n' + clean : clean).slice(0, 8000));
    };
    reader.readAsText(file);
  };

  const startVoice = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Voice input not supported in this browser');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((r: any) => r[0].transcript).join('');
      setGenerateContext(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const copyResult = () => {
    navigator.clipboard.writeText(resultText).then(() => toast.success('Copied to clipboard'));
  };

  const downloadResult = () => {
    const blob = new Blob([resultText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedPlaybook?.id || 'playbook'}-result.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareResult = async () => {
    if (!currentJobId) return;
    try {
      const res = await api.jobs.share(currentJobId);
      if (!res.success) throw new Error(res.error || 'Failed to create share link');
      const baseUrl = window.location.origin;
      const url = `${baseUrl}${res.data!.url_path}`;
      setShareUrl(url);
      navigator.clipboard.writeText(url).then(() => toast.success('Share link copied to clipboard'));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to share');
    }
  };

  const submitFeedback = async (value: 1 | -1) => {
    if (!currentJobId) return;
    const res = await api.jobs.feedback(currentJobId, value);
    if (res.success) toast.success(value === 1 ? 'Thanks for the feedback!' : 'Feedback recorded');
  };

  // Load comments when job changes
  useEffect(() => {
    setComments([]);
    setShowComments(false);
    setNewComment('');
    if (!currentJobId) return;
    api.jobs.listComments(currentJobId).then((r) => { if (r.success) setComments(r.data || []); }).catch(() => void 0);
  }, [currentJobId]);

  const submitComment = async () => {
    if (!currentJobId || !newComment.trim()) return;
    setSendingComment(true);
    const res = await api.jobs.addComment(currentJobId, newComment.trim());
    if (res.success && res.data) {
      setComments((prev) => [...prev, res.data!]);
      setNewComment('');
    } else {
      toast.error(res.error || 'Failed to add comment');
    }
    setSendingComment(false);
  };

  // Schedule creation helpers
  const saveNewSchedule = async () => {
    const d = schedDraft;
    if (!d.playbook_id || !d.agent_id || !d.cron_expression) {
      toast.error('Fill in playbook, agent, and cron expression');
      return;
    }
    setSchedSaving(true);
    const res = await api.playbooks.createSchedule({
      playbook_id: d.playbook_id,
      agent_id: d.agent_id,
      input_template: d.input_template,
      cron_expression: d.cron_expression,
      timezone: d.timezone || 'UTC',
      enabled: true,
    });
    setSchedSaving(false);
    if (res.success && res.data) {
      setSchedules((prev) => [res.data!, ...prev]);
      setShowNewSchedule(false);
      setSchedDraft({ playbook_id: '', agent_id: '', cron_expression: '0 9 * * 1', timezone: 'UTC', input_template: {} });
      toast.success('Schedule created');
    } else {
      toast.error(res.error || 'Failed to create schedule');
    }
  };

  // Trigger creation helpers
  const saveNewTrigger = async () => {
    const d = trigDraft;
    if (!d.name || !d.playbook_id || !d.agent_id || !d.event_type) {
      toast.error('Fill in name, event type, playbook, and agent');
      return;
    }
    const field_mappings = Object.fromEntries(d.field_mappings.filter((m) => m.event_path && m.field_key).map((m) => [m.field_key, m.event_path]));
    setTrigSaving(true);
    const res = await api.playbooks.createTrigger({
      name: d.name,
      playbook_id: d.playbook_id,
      agent_id: d.agent_id,
      event_type: d.event_type,
      event_filter: {},
      field_mappings,
      enabled: true,
    });
    setTrigSaving(false);
    if (res.success && res.data) {
      setTriggers((prev) => [res.data!, ...prev]);
      setShowNewTrigger(false);
      setTrigDraft({ name: '', playbook_id: '', agent_id: '', event_type: 'incident.created', field_mappings: [] });
      toast.success('Trigger created');
    } else {
      toast.error(res.error || 'Failed to create trigger');
    }
  };

  const handleBulkCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split('\n');
      if (lines.length < 2) { toast.error('CSV must have a header row and at least one data row'); return; }
      const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
      });
      setBulkRows(rows);
    };
    reader.readAsText(file);
  };

  const runBulk = async () => {
    if (!selectedPlaybook || !bulkRows.length) return;
    const agentId = ensureAgentSelected();
    if (!agentId) return;

    setBusy(true);
    try {
      const rows = bulkRows.map((row) => selectedPlaybook.buildJob(row).input);
      const built = selectedPlaybook.buildJob({});
      const res = await api.jobs.bulk({
        agent_id: agentId,
        type: built.type,
        playbook_id: selectedPlaybook.id,
        rows,
      });
      if (!res.success) throw new Error(res.error || 'Bulk run failed');
      setBatchId(res.data!.batch_id);
      setBatchJobs(res.data!.jobs);
      toast.success(`${res.data!.count} jobs queued. Track progress in Run History.`);
    } catch (err: any) {
      toast.error(err?.message || 'Bulk run failed');
    } finally {
      setBusy(false);
    }
  };

  const handleChain = (targetId: string) => {
    setChainTarget(targetId);
    const target = allPlaybooks.find((p) => p.id === targetId);
    if (!target || !resultText) return;
    // Auto-populate matching fields from current result
    const newInputs: Record<string, string> = {};
    for (const field of target.fields) {
      if (field.key === 'job_description' && selectedPlaybook?.id === 'jd-generator') {
        newInputs[field.key] = resultText;
      }
    }
    setSelectedPlaybookId(targetId);
    setInputs(newInputs);
    setResultText('');
    setSections([]);
    setCurrentJobId(null);
    setChainTarget(null);
    toast.success(`Chained to ${target.title}`);
  };

  const updatePack = (next: PlaybookPackId) => {
    setPack(next);
    try { localStorage.setItem(PACK_STORAGE_KEY, next); } catch { /* ignore */ }
    const nextList = next === 'all' ? allPlaybooks : allPlaybooks.filter((p) => p.pack === next);
    setSelectedPlaybookId(nextList[0]?.id || '');
    setInputs({});
    setCurrentJobId(null);
    setResultText('');
    setSections([]);
  };

  const setPlaybookEnabled = async (playbookId: string, enabled: boolean) => {
    setEnabledByPlaybookId((prev) => ({ ...prev, [playbookId]: enabled }));
    const res = await api.playbooks.updateSetting(playbookId, { enabled });
    if (!res.success) {
      setEnabledByPlaybookId((prev) => ({ ...prev, [playbookId]: !enabled }));
      toast.error(res.error || 'Failed to update playbook setting');
    } else {
      toast.success(enabled ? 'Playbook enabled' : 'Playbook disabled');
    }
  };

  const saveApiSetting = async (playbookId: string, apiEnabled: boolean, apiSlug: string) => {
    const res = await api.playbooks.updateSetting(playbookId, { api_enabled: apiEnabled, api_slug: apiSlug || null });
    if (!res.success) {
      toast.error(res.error || 'Failed to update API setting');
    } else {
      setApiSettingsByPlaybookId((prev) => ({ ...prev, [playbookId]: { api_enabled: apiEnabled, api_slug: apiSlug || null } }));
      toast.success(apiEnabled ? 'API endpoint enabled' : 'API endpoint disabled');
    }
  };

  const isConnectorPlaybook = selectedPlaybook?.buildJob({}).type === 'connector_action';
  const isRunning = jobStatus === 'queued' || jobStatus === 'running';
  const hasResult = Boolean(resultText);

  // Chainable downstream playbooks
  const chainablePlaybooks = useMemo(() => {
    if (!selectedPlaybook || !hasResult) return [];
    return allPlaybooks.filter((p) => p.id !== selectedPlaybook.id && p.buildJob({}).type !== 'connector_action');
  }, [selectedPlaybook, allPlaybooks, hasResult]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-cyan-400" />
            Playbooks
          </h1>
          <p className="text-sm text-slate-400 mt-1">AI workflow automation — run, schedule, chain, and automate across your org.</p>
        </div>
        <button
          onClick={() => onNavigate?.('jobs')}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700"
        >
          Run History
        </button>
      </div>

      {/* Main tab bar */}
      <div className="flex gap-1 bg-slate-800/40 rounded-xl p-1 w-fit border border-slate-700/50">
        {([
          { id: 'run', label: 'Run', icon: Zap },
          { id: 'schedules', label: `Schedules${schedules.length ? ` (${schedules.length})` : ''}`, icon: Calendar },
          { id: 'triggers', label: `Triggers${triggers.length ? ` (${triggers.length})` : ''}`, icon: Cpu },
          { id: 'custom', label: 'Custom', icon: Settings },
          { id: 'analytics', label: 'Analytics', icon: BarChart2 },
        ] as Array<{ id: MainTab; label: string; icon: any }>).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMainTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mainTab === id
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Run tab ─────────────────────────────────────────────────────────── */}
      {mainTab === 'run' && (
        <>
          {/* Pack + manage controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {([{ id: 'all', label: 'All' }, ...PLAYBOOK_PACKS.map((p) => ({ id: p.id, label: p.label }))] as Array<{ id: PlaybookPackId; label: string }>).map((item) => (
                <button
                  key={item.id}
                  onClick={() => updatePack(item.id)}
                  className={`px-3 py-1.5 rounded-full text-xs border ${
                    pack === item.id
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                      : 'bg-slate-800/30 text-slate-300 border-slate-700 hover:bg-slate-800/60'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDisabled((v) => !v)}
                className={`px-3 py-1.5 rounded-full text-xs border ${showDisabled ? 'bg-slate-700 text-slate-100 border-slate-600' : 'bg-slate-800/30 text-slate-300 border-slate-700 hover:bg-slate-800/60'}`}
              >
                {showDisabled ? 'Showing disabled' : 'Hide disabled'}
              </button>
              <button
                onClick={() => setManageMode((v) => !v)}
                className={`px-3 py-1.5 rounded-full text-xs border ${manageMode ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-slate-800/30 text-slate-300 border-slate-700 hover:bg-slate-800/60'}`}
              >
                {manageMode ? 'Managing' : 'Manage'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: playbook list */}
            <div className="lg:col-span-1 space-y-2">
              {packPlaybooks.map((pb) => {
                const Icon = pb.icon;
                const selected = pb.id === selectedPlaybookId;
                const enabled = enabledByPlaybookId[pb.id] !== false;
                const isConnector = pb.buildJob({}).type === 'connector_action';
                const apiSetting = apiSettingsByPlaybookId[pb.id] || { api_enabled: false, api_slug: null };
                const apiSlug = apiSetting.api_slug || pb.id;
                const apiBase = ((window as any).__SYNTHETICHR_CONFIG__?.apiUrl || '').replace(/\/api$/, '') || window.location.origin;
                const curlCmd = `curl -X POST ${apiBase}/public/playbooks/${apiSlug} \\\n  -H "Authorization: Bearer sk_..." \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(Object.fromEntries(pb.fields.map((f) => [f.key, `<${f.label}>`])))}'`;

                return (
                  <div key={pb.id} className={`rounded-xl border overflow-hidden ${selected ? 'border-cyan-500/30' : 'border-slate-700'}`}>
                    <button
                      onClick={() => {
                        setSelectedPlaybookId(pb.id);
                        setInputs({});
                        setCurrentJobId(null);
                        setResultText('');
                        setSections([]);
                        setResultError(null);
                      }}
                      className={`w-full text-left p-4 transition-colors ${
                        selected ? 'bg-cyan-500/10' : 'bg-slate-800/40 hover:bg-slate-800/60'
                      } ${!enabled ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-900/40 border border-slate-700 flex items-center justify-center flex-shrink-0">
                          <Icon className={`w-5 h-5 ${selected ? 'text-cyan-300' : 'text-slate-300'}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-white font-semibold truncate text-sm">{pb.title}</div>
                          <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{pb.description}</div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${
                              isConnector
                                ? 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                                : 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                            }`}>
                              {isConnector ? <><Lock className="w-2.5 h-2.5" /> Needs Approval</> : <><Zap className="w-2.5 h-2.5" /> Instant</>}
                            </span>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wide">{pb.pack}</span>
                          </div>
                        </div>
                        {manageMode && (
                          <div className="flex items-center gap-2 ml-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void setPlaybookEnabled(pb.id, !enabled); }}
                              className="px-2 py-1 rounded-md bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700 text-xs text-slate-200"
                            >
                              {enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setApiPanelPlaybookId(apiPanelPlaybookId === pb.id ? null : pb.id); }}
                              className={`px-2 py-1 rounded-md border text-xs ${apiSetting.api_enabled ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' : 'bg-slate-900/40 text-slate-400 border-slate-700 hover:bg-slate-900/60'}`}
                            >
                              API
                            </button>
                          </div>
                        )}
                      </div>
                    </button>
                    {/* Inline API panel */}
                    {manageMode && apiPanelPlaybookId === pb.id && (
                      <div className="border-t border-slate-700 px-4 py-3 bg-slate-900/40" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-medium text-slate-300">Expose as API endpoint</span>
                          <button
                            onClick={() => void saveApiSetting(pb.id, !apiSetting.api_enabled, apiSlug)}
                            className={`px-2 py-1 rounded text-xs font-medium border ${apiSetting.api_enabled ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                          >
                            {apiSetting.api_enabled ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>
                        {apiSetting.api_enabled && (
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] text-slate-500 uppercase tracking-wide">Slug</label>
                              <input
                                defaultValue={apiSlug}
                                onBlur={(e) => void saveApiSetting(pb.id, true, e.target.value)}
                                className="mt-1 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500/50"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-500 uppercase tracking-wide">cURL example</label>
                              <pre className="mt-1 bg-slate-950 border border-slate-700 rounded p-2 text-[10px] text-slate-300 overflow-x-auto whitespace-pre-wrap">{curlCmd}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right: run panel */}
            <div className="lg:col-span-2 space-y-4">
              {/* Playbook header */}
              <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">{selectedPlaybook?.title}</h2>
                    <p className="text-sm text-slate-400 mt-1">{selectedPlaybook?.description}</p>
                    {selectedPlaybook?.outputDescription && (
                      <p className="text-xs text-cyan-400/80 mt-2 border-l-2 border-cyan-500/30 pl-2">
                        You'll get: {selectedPlaybook.outputDescription}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setInputs({})}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 flex-shrink-0"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reset
                  </button>
                </div>

                {/* Generate panel toggle */}
                {!isConnectorPlaybook && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowGenerate((v) => !v)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        showGenerate
                          ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                          : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Generate from description
                    </button>
                    <button
                      onClick={() => setBulkMode((v) => !v)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        bulkMode
                          ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                          : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Bulk run (CSV)
                    </button>
                  </div>
                )}

                {/* Generate panel */}
                {showGenerate && !isConnectorPlaybook && (
                  <div className="border border-violet-500/20 bg-violet-500/5 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-violet-300 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4" />
                        Describe what you need
                      </div>
                      <div className="flex gap-2">
                        <label className="cursor-pointer flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300">
                          <FileText className="w-3 h-3" />
                          PDF
                          <input type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); }} />
                        </label>
                        <button
                          onClick={isListening ? stopVoice : startVoice}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs ${isListening ? 'bg-red-500/15 text-red-300 border-red-500/30 animate-pulse' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'}`}
                        >
                          {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                          {isListening ? 'Stop' : 'Voice'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={generateContext}
                      onChange={(e) => setGenerateContext(e.target.value)}
                      placeholder="Paste a job posting, resume, ticket, or type a rough description… AI will fill the form for you."
                      rows={5}
                      className="w-full bg-slate-900/50 border border-violet-500/20 rounded-lg px-3 py-2 text-slate-200 text-sm resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={runGenerate}
                        disabled={!generateContext.trim() || generating}
                        className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2"
                      >
                        {generating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Fill form</>}
                      </button>
                      <button onClick={() => { setShowGenerate(false); setGenerateContext(''); }} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Bulk CSV panel */}
                {bulkMode && !isConnectorPlaybook && (
                  <div className="border border-blue-500/20 bg-blue-500/5 rounded-xl p-4 space-y-3">
                    <div className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                      <FileText className="w-4 h-4" />
                      Bulk Run — Upload CSV
                    </div>
                    <p className="text-xs text-slate-400">
                      CSV column headers must match the form field keys:{' '}
                      <code className="text-cyan-300 bg-slate-900/60 px-1 rounded">
                        {selectedPlaybook?.fields.map((f) => f.key).join(', ')}
                      </code>
                    </p>
                    <div className="flex gap-3 items-center">
                      <label className="cursor-pointer flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200">
                        <FileText className="w-4 h-4" />
                        {bulkRows.length ? `${bulkRows.length} rows loaded` : 'Choose CSV file'}
                        <input type="file" accept=".csv" className="hidden" onChange={handleBulkCsv} />
                      </label>
                      {bulkRows.length > 0 && (
                        <button
                          onClick={runBulk}
                          disabled={busy}
                          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold"
                        >
                          {busy ? 'Running…' : `Run ${bulkRows.length} rows`}
                        </button>
                      )}
                    </div>
                    {batchId && (
                      <div className="text-xs text-emerald-300 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5" />
                        Batch queued: {batchId.slice(0, 8)}… — {batchJobs.length} jobs running
                      </div>
                    )}
                  </div>
                )}

                {/* Agent selector */}
                <div>
                  <label className="text-xs text-slate-400">Agent</label>
                  <select
                    value={selectedAgentId || (recommendedAgents[0]?.id || '')}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                  >
                    {(recommendedAgents.length ? recommendedAgents : agents).map((a) => (
                      <option key={a.id} value={a.id}>{a.name} ({a.agent_type})</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">If the agent isn't deployed to a runtime yet, deploy it from Fleet → Deploy.</p>
                </div>

                {/* Form fields */}
                {!bulkMode && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedPlaybook?.fields.map((field) => {
                      const value = inputs[field.key] || '';
                      if (field.kind === 'textarea') {
                        return (
                          <div key={field.key} className="md:col-span-2">
                            <label className="text-xs text-slate-400">{field.label}</label>
                            <textarea
                              value={value}
                              onChange={(e) => setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              placeholder={field.placeholder}
                              rows={5}
                              className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm resize-y"
                            />
                          </div>
                        );
                      }
                      return (
                        <div key={field.key}>
                          <label className="text-xs text-slate-400">{field.label}</label>
                          <input
                            value={value}
                            onChange={(e) => setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                            placeholder={field.placeholder}
                            className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Run button row */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-slate-500">
                    {isConnectorPlaybook ? 'Submitting creates a job pending your approval.' : 'Result appears below after running.'}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onNavigate?.('jobs')}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700"
                    >
                      History
                    </button>
                    <button
                      onClick={runPlaybook}
                      disabled={busy || isRunning || bulkMode}
                      className={`px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-60 ${
                        isConnectorPlaybook
                          ? 'bg-amber-600 hover:bg-amber-500'
                          : 'bg-cyan-600 hover:bg-cyan-500'
                      }`}
                    >
                      {busy || isRunning
                        ? isRunning
                          ? <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Running…</span>
                          : 'Submitting…'
                        : isConnectorPlaybook ? 'Submit for Approval' : 'Run'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Result panel */}
              {(hasResult || resultError || isRunning) && (
                <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium text-white flex items-center gap-2">
                      {isRunning ? (
                        <><RefreshCw className="w-4 h-4 animate-spin text-cyan-400" /> Generating…</>
                      ) : resultError ? (
                        <span className="text-red-300">Run failed</span>
                      ) : (
                        'Result'
                      )}
                    </div>
                    {hasResult && (
                      <div className="flex items-center gap-1.5">
                        <button onClick={copyResult} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-white" title="Copy">
                          <Copy className="w-4 h-4" />
                        </button>
                        <button onClick={downloadResult} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-white" title="Download">
                          <Download className="w-4 h-4" />
                        </button>
                        <button onClick={shareResult} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-white" title="Share">
                          <Share2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => submitFeedback(1)} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-emerald-300" title="Good result">
                          <ThumbsUp className="w-4 h-4" />
                        </button>
                        <button onClick={() => submitFeedback(-1)} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-red-300" title="Poor result">
                          <ThumbsDown className="w-4 h-4" />
                        </button>
                        <button onClick={runRegenerate} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-white" title="Regenerate">
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button onClick={() => setShowImprove((v) => !v)} className={`p-1.5 rounded-md hover:bg-slate-700 ${showImprove ? 'bg-violet-500/15 text-violet-300' : 'text-slate-400 hover:text-white'}`} title="Improve this">
                          <Sparkles className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {shareUrl && (
                    <div className="flex items-center gap-2 bg-slate-900/40 border border-emerald-500/20 rounded-lg px-3 py-2">
                      <Link className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="text-xs text-emerald-300 truncate">{shareUrl}</span>
                    </div>
                  )}

                  {resultError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-200">{resultError}</div>
                  )}

                  {/* Structured cards */}
                  {sections.length > 1 && (
                    <div className="grid grid-cols-1 gap-2">
                      {sections.map((s) => (
                        <div key={s.heading} className="border border-slate-700/60 rounded-lg overflow-hidden">
                          <button
                            className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/50 text-left"
                            onClick={() => setCollapsedSections((prev) => ({ ...prev, [s.heading]: !prev[s.heading] }))}
                          >
                            <span className="text-sm font-medium text-slate-200">{s.heading}</span>
                            {collapsedSections[s.heading] ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
                          </button>
                          {!collapsedSections[s.heading] && (
                            <div className="px-4 py-3 text-sm text-slate-300">
                              {renderMarkdown(s.body)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Full markdown output */}
                  {hasResult && sections.length <= 1 && (
                    <div className="prose-sm max-w-none">{renderMarkdown(resultText)}</div>
                  )}

                  {/* Improve panel */}
                  {showImprove && hasResult && (
                    <div className="border border-violet-500/20 bg-violet-500/5 rounded-lg p-3 space-y-2">
                      <div className="text-xs text-violet-300 font-medium">What should be improved?</div>
                      <textarea
                        value={improveFeedback}
                        onChange={(e) => setImproveFeedback(e.target.value)}
                        placeholder="e.g., Make it shorter, add salary range, use more formal tone…"
                        rows={2}
                        className="w-full bg-slate-900/50 border border-violet-500/20 rounded-lg px-3 py-2 text-slate-200 text-sm resize-none"
                      />
                      <button
                        onClick={runImprove}
                        disabled={!improveFeedback.trim() || improving}
                        className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        {improving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Improving…</> : <><Sparkles className="w-3.5 h-3.5" /> Improve</>}
                      </button>
                    </div>
                  )}

                  {/* Chain to another playbook */}
                  {hasResult && chainablePlaybooks.length > 0 && (
                    <div className="border-t border-slate-700/60 pt-3">
                      <div className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
                        <ArrowRight className="w-3.5 h-3.5" />
                        Chain to another playbook
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {chainablePlaybooks.slice(0, 6).map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleChain(p.id)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300"
                          >
                            <ArrowRight className="w-3 h-3" />
                            {p.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Comments */}
                  {hasResult && currentJobId && (
                    <div className="border-t border-slate-700/60 pt-3">
                      <button
                        onClick={() => setShowComments((v) => !v)}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 mb-2"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Team notes {comments.length > 0 ? `(${comments.length})` : ''}
                        {showComments ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {showComments && (
                        <div className="space-y-2">
                          {comments.map((c) => (
                            <div key={c.id} className="bg-slate-900/40 border border-slate-700 rounded-lg px-3 py-2">
                              <p className="text-xs text-slate-200">{c.content}</p>
                              <p className="text-[10px] text-slate-500 mt-1">{new Date(c.created_at).toLocaleString()}</p>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <input
                              value={newComment}
                              onChange={(e) => setNewComment(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitComment(); } }}
                              placeholder="Add a note… (Enter to submit)"
                              className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-slate-500"
                            />
                            <button
                              onClick={() => void submitComment()}
                              disabled={!newComment.trim() || sendingComment}
                              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-xs text-slate-200"
                            >
                              {sendingComment ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Post'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Schedules tab ─────────────────────────────────────────────────────── */}
      {mainTab === 'schedules' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-400">Run playbooks automatically on a schedule (cron).</div>
            <button
              onClick={() => {
                setSchedDraft({ playbook_id: allPlaybooks[0]?.id || '', agent_id: agents[0]?.id || '', cron_expression: '0 9 * * 1', timezone: 'UTC', input_template: {} });
                setShowNewSchedule((v) => !v);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New Schedule
            </button>
          </div>

          {/* New schedule form */}
          {showNewSchedule && (
            <div className="bg-slate-800/40 border border-cyan-500/20 rounded-xl p-4 space-y-3">
              <div className="text-sm font-medium text-cyan-300 flex items-center gap-1.5">
                <Calendar className="w-4 h-4" /> New Scheduled Run
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-400">Playbook</label>
                  <select
                    value={schedDraft.playbook_id}
                    onChange={(e) => setSchedDraft((d) => ({ ...d, playbook_id: e.target.value, input_template: {} }))}
                    className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs"
                  >
                    <option value="">— pick playbook —</option>
                    {allPlaybooks.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    {customPlaybooks.map((cp) => <option key={cp.id} value={cp.id}>{cp.name} (custom)</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Agent</label>
                  <select
                    value={schedDraft.agent_id}
                    onChange={(e) => setSchedDraft((d) => ({ ...d, agent_id: e.target.value }))}
                    className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs"
                  >
                    <option value="">— pick agent —</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-400">Cron expression</label>
                <div className="flex flex-wrap gap-1 mt-1 mb-1">
                  {[
                    { label: 'Daily 9am', value: '0 9 * * *' },
                    { label: 'Mon 9am', value: '0 9 * * 1' },
                    { label: 'Weekdays 9am', value: '0 9 * * 1-5' },
                    { label: '1st of month', value: '0 9 1 * *' },
                  ].map((preset) => (
                    <button key={preset.value} type="button"
                      onClick={() => setSchedDraft((d) => ({ ...d, cron_expression: preset.value }))}
                      className={`text-[10px] px-2 py-0.5 rounded border ${schedDraft.cron_expression === preset.value ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-slate-900/40 border-slate-700 text-slate-400 hover:text-slate-300'}`}
                    >{preset.label}</button>
                  ))}
                </div>
                <input
                  value={schedDraft.cron_expression}
                  onChange={(e) => setSchedDraft((d) => ({ ...d, cron_expression: e.target.value }))}
                  placeholder="0 9 * * 1"
                  className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400">Timezone</label>
                <select
                  value={schedDraft.timezone}
                  onChange={(e) => setSchedDraft((d) => ({ ...d, timezone: e.target.value }))}
                  className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs"
                >
                  {['UTC', 'Asia/Kolkata', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Singapore', 'Australia/Sydney'].map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              {/* Input template — show fields for selected playbook */}
              {(() => {
                const pb = allPlaybooks.find((p) => p.id === schedDraft.playbook_id);
                const cp = customPlaybooks.find((p) => p.id === schedDraft.playbook_id);
                const fields = pb?.fields || cp?.fields || [];
                if (fields.length === 0) return null;
                return (
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400">Input template (static values for each run)</label>
                    {fields.map((f: any) => (
                      <div key={f.key}>
                        <label className="text-[10px] text-slate-500">{f.label}</label>
                        <input
                          value={schedDraft.input_template[f.key] || ''}
                          onChange={(e) => setSchedDraft((d) => ({ ...d, input_template: { ...d.input_template, [f.key]: e.target.value } }))}
                          placeholder={f.placeholder}
                          className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                        />
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setShowNewSchedule(false)} className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-300">Cancel</button>
                <button onClick={() => void saveNewSchedule()} disabled={schedSaving} className="px-3 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5">
                  {schedSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Calendar className="w-3 h-3" />}
                  Create Schedule
                </button>
              </div>
            </div>
          )}

          {schedules.length === 0 && !showNewSchedule ? (
            <div className="border border-slate-700 rounded-xl p-8 text-center text-slate-400 text-sm">
              No schedules yet. Create one to run playbooks automatically.
            </div>
          ) : (
            <div className="space-y-2">
              {schedules.map((s) => {
                const pb = allPlaybooks.find((p) => p.id === s.playbook_id);
                const cp = customPlaybooks.find((p) => p.id === s.playbook_id);
                const agent = agents.find((a) => a.id === s.agent_id);
                return (
                  <div key={s.id} className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">{pb?.title || cp?.name || s.playbook_id}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        <code className="text-cyan-300">{s.cron_expression}</code> · {s.timezone} · {agent?.name || s.agent_id}
                      </div>
                      {s.last_run_at && <div className="text-xs text-slate-500 mt-0.5">Last run: {new Date(s.last_run_at).toLocaleString()}</div>}
                      {s.next_run_at && <div className="text-xs text-slate-500">Next: {new Date(s.next_run_at).toLocaleString()}</div>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${s.enabled ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-400 bg-slate-900/20'}`}>
                        {s.enabled ? 'Active' : 'Paused'}
                      </span>
                      <button
                        onClick={() => api.playbooks.updateSchedule(s.id, { enabled: !s.enabled }).then((r) => {
                          if (r.success && r.data) setSchedules((prev) => prev.map((x) => x.id === s.id ? r.data! : x));
                        })}
                        className="px-2 py-1 rounded-md bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700 text-xs text-slate-300"
                      >
                        {s.enabled ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => api.playbooks.deleteSchedule(s.id).then((r) => {
                          if (r.success) setSchedules((prev) => prev.filter((x) => x.id !== s.id));
                        })}
                        className="px-2 py-1 rounded-md bg-slate-900/40 hover:bg-red-900/20 border border-slate-700 hover:border-red-500/30 text-xs text-slate-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Triggers tab ─────────────────────────────────────────────────────── */}
      {mainTab === 'triggers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-400">Auto-run playbooks when system events fire.</div>
            <button
              onClick={() => {
                setTrigDraft({ name: '', playbook_id: allPlaybooks[0]?.id || '', agent_id: agents[0]?.id || '', event_type: 'incident.created', field_mappings: [] });
                setShowNewTrigger((v) => !v);
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New Trigger
            </button>
          </div>

          {/* New trigger form */}
          {showNewTrigger && (
            <div className="bg-slate-800/40 border border-amber-500/20 rounded-xl p-4 space-y-3">
              <div className="text-sm font-medium text-amber-300 flex items-center gap-1.5">
                <Cpu className="w-4 h-4" /> New Auto-Trigger
              </div>
              <div>
                <label className="text-[10px] text-slate-400">Trigger name</label>
                <input
                  value={trigDraft.name}
                  onChange={(e) => setTrigDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g., Incident summary on creation"
                  className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-slate-400">When event fires</label>
                  <select
                    value={trigDraft.event_type}
                    onChange={(e) => setTrigDraft((d) => ({ ...d, event_type: e.target.value }))}
                    className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs"
                  >
                    {['incident.created', 'incident.resolved', 'conversation.ended', 'job.completed', 'approval.requested', 'webhook.received'].map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Run playbook</label>
                  <select
                    value={trigDraft.playbook_id}
                    onChange={(e) => setTrigDraft((d) => ({ ...d, playbook_id: e.target.value, field_mappings: [] }))}
                    className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs"
                  >
                    <option value="">— pick playbook —</option>
                    {allPlaybooks.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    {customPlaybooks.map((cp) => <option key={cp.id} value={cp.id}>{cp.name} (custom)</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-slate-400">With agent</label>
                <select
                  value={trigDraft.agent_id}
                  onChange={(e) => setTrigDraft((d) => ({ ...d, agent_id: e.target.value }))}
                  className="mt-0.5 w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs"
                >
                  <option value="">— pick agent —</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {/* Field mappings: event payload → playbook fields */}
              {(() => {
                const pb = allPlaybooks.find((p) => p.id === trigDraft.playbook_id);
                const cp = customPlaybooks.find((p) => p.id === trigDraft.playbook_id);
                const fields = pb?.fields || cp?.fields || [];
                if (fields.length === 0) return null;
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] text-slate-400">Field mappings — event payload path → playbook field</label>
                      <button type="button" onClick={() => setTrigDraft((d) => ({ ...d, field_mappings: [...d.field_mappings, { event_path: '', field_key: fields[0]?.key || '' }] }))}
                        className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5">
                        <Plus className="w-3 h-3" /> Add mapping
                      </button>
                    </div>
                    {trigDraft.field_mappings.map((m, mi) => (
                      <div key={mi} className="flex items-center gap-2">
                        <input
                          value={m.event_path}
                          onChange={(e) => setTrigDraft((d) => ({ ...d, field_mappings: d.field_mappings.map((x, i) => i === mi ? { ...x, event_path: e.target.value } : x) }))}
                          placeholder="event.payload.description"
                          className="flex-1 bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                        />
                        <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                        <select
                          value={m.field_key}
                          onChange={(e) => setTrigDraft((d) => ({ ...d, field_mappings: d.field_mappings.map((x, i) => i === mi ? { ...x, field_key: e.target.value } : x) }))}
                          className="bg-slate-900/60 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200"
                        >
                          {fields.map((f: any) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <button onClick={() => setTrigDraft((d) => ({ ...d, field_mappings: d.field_mappings.filter((_, i) => i !== mi) }))} className="text-slate-500 hover:text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {trigDraft.field_mappings.length === 0 && (
                      <p className="text-[10px] text-slate-500">No mappings — the trigger fires but passes no inputs to the playbook.</p>
                    )}
                  </div>
                );
              })()}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setShowNewTrigger(false)} className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-xs text-slate-300">Cancel</button>
                <button onClick={() => void saveNewTrigger()} disabled={trigSaving} className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5">
                  {trigSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Cpu className="w-3 h-3" />}
                  Create Trigger
                </button>
              </div>
            </div>
          )}

          {triggers.length === 0 && !showNewTrigger ? (
            <div className="border border-slate-700 rounded-xl p-8 text-center text-slate-400 text-sm">
              No auto-triggers configured. Create one to run playbooks automatically on events.
            </div>
          ) : (
            <div className="space-y-2">
              {triggers.map((t) => {
                const pb = allPlaybooks.find((p) => p.id === t.playbook_id);
                const cp = customPlaybooks.find((p) => p.id === t.playbook_id);
                const agent = agents.find((a) => a.id === t.agent_id);
                const mappingCount = Object.keys(t.field_mappings || {}).length;
                return (
                  <div key={t.id} className="bg-slate-800/40 border border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">{t.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        <code className="text-amber-300">{t.event_type}</code> → {pb?.title || cp?.name || t.playbook_id} · {agent?.name || t.agent_id}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Fired {t.fire_count} times{t.last_fired_at ? ` · last ${new Date(t.last_fired_at).toLocaleString()}` : ''}
                        {mappingCount > 0 && ` · ${mappingCount} field mapping${mappingCount > 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${t.enabled ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-400'}`}>
                        {t.enabled ? 'Active' : 'Paused'}
                      </span>
                      <button
                        onClick={() => api.playbooks.updateTrigger(t.id, { enabled: !t.enabled }).then((r) => {
                          if (r.success && r.data) setTriggers((prev) => prev.map((x) => x.id === t.id ? r.data! : x));
                        })}
                        className="px-2 py-1 rounded-md bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700 text-xs text-slate-300"
                      >
                        {t.enabled ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => api.playbooks.deleteTrigger(t.id).then((r) => {
                          if (r.success) setTriggers((prev) => prev.filter((x) => x.id !== t.id));
                        })}
                        className="px-2 py-1 rounded-md bg-slate-900/40 hover:bg-red-900/20 border border-slate-700 hover:border-red-500/30 text-xs text-slate-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Custom tab ────────────────────────────────────────────────────────── */}
      {mainTab === 'custom' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-400">Build your own playbooks with a custom form and prompt.</div>
            <button
              onClick={() => {
                api.playbooks.createCustom({
                  name: 'New Playbook',
                  description: 'Describe what this playbook does',
                  output_description: 'What the output looks like',
                  category: 'custom',
                  fields: [{ key: 'input', label: 'Input', placeholder: 'Your input here', kind: 'textarea' }],
                  workflow: makeDefaultWorkflow(),
                  enabled: true,
                }).then((r) => {
                  if (r.success && r.data) setCustomPlaybooks((prev) => [r.data!, ...prev]);
                  else toast.error(r.error || 'Failed to create custom playbook');
                });
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              New Custom Playbook
            </button>
          </div>
          {customPlaybooks.length === 0 ? (
            <div className="border border-slate-700 rounded-xl p-8 text-center text-slate-400 text-sm">
              No custom playbooks yet. Create one to build your own AI workflows.
            </div>
          ) : (
            <div className="space-y-2">
              {customPlaybooks.map((cp) => (
                <CustomPlaybookCard
                  key={cp.id}
                  cp={cp}
                  agents={agents}
                  agentId={selectedAgentId}
                  onUpdate={(updated) => setCustomPlaybooks((prev) => prev.map((x) => x.id === updated.id ? updated : x))}
                  onDelete={() => setCustomPlaybooks((prev) => prev.filter((x) => x.id !== cp.id))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Analytics tab ─────────────────────────────────────────────────────── */}
      {mainTab === 'analytics' && <AnalyticsTab schedules={schedules} triggers={triggers} />}
    </div>
  );
}
