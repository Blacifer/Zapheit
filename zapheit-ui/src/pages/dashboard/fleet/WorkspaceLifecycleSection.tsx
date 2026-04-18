/**
 * WorkspaceLifecycleSection.tsx
 *
 * Agent Lifecycle State Machine — the agent's "employment timeline".
 * Shows current lifecycle state, full transition history, and buttons for
 * all legal next states.
 *
 * States (HR metaphor):
 *   draft → provisioning → active → suspended → decommissioning → terminated
 */

import { useEffect, useState } from 'react';
import {
  GitBranch, Clock, User, ArrowRight, AlertTriangle, CheckCircle2,
  PauseCircle, PlayCircle, Trash2, RefreshCw,
} from 'lucide-react';
import { api } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import type { AIAgent } from '../../../types';

interface Props {
  agent: AIAgent;
}

type LifecycleState =
  | 'draft'
  | 'provisioning'
  | 'active'
  | 'suspended'
  | 'decommissioning'
  | 'terminated';

interface TransitionRecord {
  id: string;
  from_state: string;
  to_state: string;
  reason: string | null;
  actor_email: string | null;
  created_at: string;
}

// Legal transitions per state
const LEGAL_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  draft:           ['provisioning'],
  provisioning:    ['active', 'terminated'],
  active:          ['suspended', 'decommissioning', 'terminated'],
  suspended:       ['active', 'decommissioning', 'terminated'],
  decommissioning: ['terminated'],
  terminated:      [],
};

const STATE_COLORS: Record<LifecycleState, string> = {
  draft:           'bg-slate-500/20 text-slate-300 border-slate-500/30',
  provisioning:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
  active:          'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  suspended:       'bg-amber-500/20 text-amber-300 border-amber-500/30',
  decommissioning: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  terminated:      'bg-red-500/20 text-red-300 border-red-500/30',
};

const STATE_DOT_COLORS: Record<LifecycleState, string> = {
  draft:           'bg-slate-400',
  provisioning:    'bg-blue-400',
  active:          'bg-emerald-400',
  suspended:       'bg-amber-400',
  decommissioning: 'bg-orange-400',
  terminated:      'bg-red-400',
};

const STATE_LABELS: Record<LifecycleState, string> = {
  draft:           'Draft',
  provisioning:    'Provisioning',
  active:          'Active',
  suspended:       'Suspended',
  decommissioning: 'Decommissioning',
  terminated:      'Terminated',
};

const STATE_DESCRIPTIONS: Record<LifecycleState, string> = {
  draft:           'Agent record created, not yet configured',
  provisioning:    'Being set up and enrolled into a runtime',
  active:          'Fully operational and handling requests',
  suspended:       'Temporarily paused by an administrator',
  decommissioning: 'Being wound down, draining queued jobs',
  terminated:      'Permanently shut down — no further calls',
};

const BUTTON_META: Record<LifecycleState, { label: string; icon: React.ReactNode; variant: string }> = {
  draft:           { label: 'Start Provisioning', icon: <RefreshCw className="w-3.5 h-3.5" />, variant: 'blue' },
  provisioning:    { label: 'Mark Active',        icon: <CheckCircle2 className="w-3.5 h-3.5" />, variant: 'emerald' },
  active:          { label: 'Activate',            icon: <PlayCircle className="w-3.5 h-3.5" />, variant: 'emerald' },
  suspended:       { label: 'Suspend',             icon: <PauseCircle className="w-3.5 h-3.5" />, variant: 'amber' },
  decommissioning: { label: 'Begin Decommission',  icon: <AlertTriangle className="w-3.5 h-3.5" />, variant: 'orange' },
  terminated:      { label: 'Terminate',           icon: <Trash2 className="w-3.5 h-3.5" />, variant: 'red' },
};

const VARIANT_CLASSES: Record<string, string> = {
  blue:    'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30',
  emerald: 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30',
  amber:   'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30',
  orange:  'bg-orange-600/20 hover:bg-orange-600/30 text-orange-300 border border-orange-500/30',
  red:     'bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function WorkspaceLifecycleSection({ agent }: Props) {
  const currentState: LifecycleState = ((agent as any).lifecycle_state ?? 'active') as LifecycleState;
  const legalNext = LEGAL_TRANSITIONS[currentState] ?? [];

  const [history, setHistory] = useState<TransitionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState<LifecycleState | null>(null);
  const [reasonModal, setReasonModal] = useState<{ toState: LifecycleState } | null>(null);
  const [reasonText, setReasonText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.agents.getLifecycleHistory(agent.id).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setHistory(res.data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [agent.id]);

  async function handleTransition(toState: LifecycleState, reason?: string) {
    setTransitioning(toState);
    const res = await api.agents.transitionLifecycle(agent.id, toState, reason);
    setTransitioning(null);
    if (!res.success) {
      toast.error(res.error ?? 'Transition failed');
      return;
    }
    toast.success(`Agent moved to ${STATE_LABELS[toState]}`);
    // Refresh history
    const histRes = await api.agents.getLifecycleHistory(agent.id);
    if (histRes.success && histRes.data) setHistory(histRes.data);
    setReasonModal(null);
    setReasonText('');
  }

  function openReasonModal(toState: LifecycleState) {
    // Require reason for risky transitions
    const requiresReason: LifecycleState[] = ['suspended', 'decommissioning', 'terminated'];
    if (requiresReason.includes(toState)) {
      setReasonModal({ toState });
    } else {
      handleTransition(toState);
    }
  }

  return (
    <div className="space-y-6">
      {/* Current state card */}
      <div className="bg-white/5 rounded-xl p-5 border border-white/10">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${STATE_DOT_COLORS[currentState]} shrink-0 mt-0.5`} />
            <div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATE_COLORS[currentState]}`}>
                  {STATE_LABELS[currentState]}
                </span>
              </div>
              <p className="text-sm text-white/50 mt-1">{STATE_DESCRIPTIONS[currentState]}</p>
            </div>
          </div>

          {/* Action buttons for legal next states */}
          {legalNext.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {legalNext.map((nextState) => {
                const meta = BUTTON_META[nextState];
                const isLoading = transitioning === nextState;
                return (
                  <button
                    key={nextState}
                    onClick={() => openReasonModal(nextState)}
                    disabled={!!transitioning}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[meta.variant]}`}
                  >
                    {isLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      meta.icon
                    )}
                    {nextState === 'active' && currentState === 'suspended' ? 'Resume' : BUTTON_META[nextState].label}
                  </button>
                );
              })}
            </div>
          )}

          {currentState === 'terminated' && (
            <span className="text-xs text-red-400/70 italic">Terminal state — no further transitions</span>
          )}
        </div>
      </div>

      {/* Transition timeline */}
      <div>
        <h3 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
          <GitBranch className="w-4 h-4" />
          Transition History
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-white/40 py-4">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading history…
          </div>
        ) : history.length === 0 ? (
          <div className="text-sm text-white/40 py-4">
            No transitions recorded yet. This agent was created with its current state.
          </div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-3.5 top-0 bottom-0 w-px bg-white/10" />

            <div className="space-y-3">
              {[...history].reverse().map((t) => {
                const fromState = t.from_state as LifecycleState;
                const toState = t.to_state as LifecycleState;
                return (
                  <div key={t.id} className="relative flex gap-3 pl-8">
                    {/* Dot on timeline */}
                    <div className={`absolute left-2 top-2 w-3 h-3 rounded-full border-2 border-[#0f1117] ${STATE_DOT_COLORS[toState]}`} />

                    <div className="flex-1 bg-white/5 rounded-lg px-3 py-2.5 border border-white/10">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${STATE_COLORS[fromState]}`}>
                          {STATE_LABELS[fromState] ?? fromState}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-white/30 shrink-0" />
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${STATE_COLORS[toState]}`}>
                          {STATE_LABELS[toState] ?? toState}
                        </span>
                      </div>

                      {t.reason && (
                        <p className="text-xs text-white/50 mt-1.5">"{t.reason}"</p>
                      )}

                      <div className="flex items-center gap-3 mt-1.5 text-xs text-white/30">
                        {t.actor_email && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {t.actor_email}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(t.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Reason modal */}
      {reasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-base font-semibold text-white mb-1">
              Transition to {STATE_LABELS[reasonModal.toState]}
            </h3>
            <p className="text-sm text-white/50 mb-4">
              {STATE_DESCRIPTIONS[reasonModal.toState]}
            </p>
            <label className="block text-xs font-medium text-white/60 mb-1.5">
              Reason <span className="text-red-400">*</span>
            </label>
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 resize-none focus:outline-none focus:border-white/30"
              rows={3}
              placeholder="Explain why this transition is being performed…"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setReasonModal(null); setReasonText(''); }}
                className="px-4 py-1.5 rounded-lg text-sm text-white/60 hover:text-white/80 border border-white/10 hover:border-white/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleTransition(reasonModal.toState, reasonText.trim() || undefined)}
                disabled={!reasonText.trim() || !!transitioning}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[BUTTON_META[reasonModal.toState].variant]}`}
              >
                {transitioning ? 'Transitioning…' : `Confirm — Move to ${STATE_LABELS[reasonModal.toState]}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
