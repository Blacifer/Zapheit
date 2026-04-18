import { useState, useMemo } from 'react';
import { DollarSign, Plus, Clock, User, ChevronRight, ArrowRight } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { WriteForm, type WriteFormField } from '../shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
    createdate?: string;
    hs_lastmodifieddate?: string;
    hubspot_owner_id?: string;
  };
}

interface DealPipelineProps {
  deals: HubSpotDeal[];
  loading: boolean;
  onCreate: (data: Record<string, string>) => void;
  onUpdateStage: (dealId: string, properties: Record<string, string>) => void;
}

/* ------------------------------------------------------------------ */
/*  Pipeline stages                                                    */
/* ------------------------------------------------------------------ */

const STAGES: { key: string; label: string; color: string }[] = [
  { key: 'appointmentscheduled', label: 'Appointment', color: 'border-cyan-500/40 bg-cyan-500/5' },
  { key: 'qualifiedtobuy',       label: 'Qualified',   color: 'border-blue-500/40 bg-blue-500/5' },
  { key: 'presentationscheduled', label: 'Presentation', color: 'border-violet-500/40 bg-violet-500/5' },
  { key: 'decisionmakerboughtin', label: 'Decision',    color: 'border-amber-500/40 bg-amber-500/5' },
  { key: 'contractsent',         label: 'Contract',    color: 'border-orange-500/40 bg-orange-500/5' },
  { key: 'closedwon',            label: 'Won',         color: 'border-emerald-500/40 bg-emerald-500/5' },
  { key: 'closedlost',           label: 'Lost',        color: 'border-red-500/40 bg-red-500/5' },
];

function stageMeta(key: string) {
  return STAGES.find((s) => s.key === key) || { key, label: key, color: 'border-white/10 bg-white/[0.02]' };
}

function fmtCurrency(val?: string) {
  if (!val) return '';
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return `$${n.toLocaleString()}`;
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DealPipeline({ deals, loading, onCreate, onUpdateStage }: DealPipelineProps) {
  const [view, setView] = useState<'board' | 'list'>('board');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedDeal, setExpandedDeal] = useState<string | null>(null);

  const createFields: WriteFormField[] = [
    { name: 'dealname', label: 'Deal Name', type: 'text', required: true, placeholder: 'Enterprise SaaS contract' },
    { name: 'amount', label: 'Amount', type: 'text', placeholder: '25000' },
    { name: 'dealstage', label: 'Stage', type: 'select', options: STAGES.map((s) => ({ value: s.key, label: s.label })), defaultValue: 'appointmentscheduled' },
    { name: 'closedate', label: 'Close Date', type: 'text', placeholder: 'YYYY-MM-DD' },
  ];

  /* Group deals by stage for board view */
  const byStage = useMemo(() => {
    const map = new Map<string, HubSpotDeal[]>();
    STAGES.forEach((s) => map.set(s.key, []));
    deals.forEach((d) => {
      const stage = d.properties.dealstage || 'appointmentscheduled';
      const arr = map.get(stage);
      if (arr) arr.push(d);
      else {
        const uncategorized = map.get('appointmentscheduled')!;
        uncategorized.push(d);
      }
    });
    return map;
  }, [deals]);

  const totalValue = useMemo(
    () => deals.reduce((sum, d) => sum + (parseFloat(d.properties.amount || '0') || 0), 0),
    [deals],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex gap-1">
          {(['board', 'list'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors capitalize',
                view === v ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-600">
          {deals.length} deals · {fmtCurrency(String(totalValue))} pipeline
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-600/20 text-orange-300 text-[11px] font-medium hover:bg-orange-600/30 transition-colors"
        >
          <Plus className="w-3 h-3" /> New Deal
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <WriteForm
            title="New Deal"
            fields={createFields}
            onSubmit={async (values) => {
              onCreate(values);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Deal"
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="animate-pulse p-4 flex gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-1 h-64 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : view === 'board' ? (
          /* ---- Board view ---- */
          <div className="flex gap-2 p-3 h-full overflow-x-auto">
            {STAGES.map((stage) => {
              const stageDeals = byStage.get(stage.key) || [];
              const stageTotal = stageDeals.reduce(
                (sum, d) => sum + (parseFloat(d.properties.amount || '0') || 0),
                0,
              );

              return (
                <div
                  key={stage.key}
                  className={cn(
                    'flex flex-col w-52 shrink-0 rounded-xl border',
                    stage.color,
                  )}
                >
                  {/* Stage header */}
                  <div className="px-3 py-2 border-b border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-white">{stage.label}</span>
                      <span className="text-[10px] text-slate-500">{stageDeals.length}</span>
                    </div>
                    {stageTotal > 0 && (
                      <span className="text-[10px] text-slate-500">{fmtCurrency(String(stageTotal))}</span>
                    )}
                  </div>

                  {/* Deal cards */}
                  <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                    {stageDeals.map((d) => (
                      <div
                        key={d.id}
                        className="rounded-lg bg-black/30 border border-white/[0.06] px-3 py-2 hover:bg-white/[0.04] transition-colors cursor-default"
                      >
                        <p className="text-[11px] font-medium text-slate-200 truncate">
                          {d.properties.dealname || 'Unnamed deal'}
                        </p>
                        {d.properties.amount && (
                          <p className="text-[10px] text-orange-400 font-medium">
                            {fmtCurrency(d.properties.amount)}
                          </p>
                        )}
                        {d.properties.closedate && (
                          <p className="text-[9px] text-slate-600 mt-0.5">
                            Close {d.properties.closedate}
                          </p>
                        )}

                        {/* Quick-move arrows */}
                        <div className="flex gap-1 mt-1.5">
                          {STAGES.filter((s) => s.key !== stage.key && s.key !== 'closedlost').map((target) => (
                            <button
                              key={target.key}
                              onClick={() => onUpdateStage(d.id, { dealstage: target.key })}
                              className="text-[8px] text-slate-600 hover:text-slate-300 transition-colors"
                              title={`Move to ${target.label}`}
                            >
                              <ArrowRight className="w-2.5 h-2.5" />
                            </button>
                          )).slice(0, 2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ---- List view ---- */
          <div className="overflow-y-auto h-full divide-y divide-white/[0.04]">
            {deals.map((d) => {
              const meta = stageMeta(d.properties.dealstage || '');
              const expanded = expandedDeal === d.id;

              return (
                <div key={d.id} className="hover:bg-white/[0.02] transition-colors">
                  <button
                    onClick={() => setExpandedDeal(expanded ? null : d.id)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <DollarSign className="w-4 h-4 text-orange-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-slate-200 truncate">
                            {d.properties.dealname || 'Unnamed deal'}
                          </span>
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[9px] font-medium border',
                            meta.color,
                            'text-white',
                          )}>
                            {meta.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          {d.properties.amount && (
                            <span className="text-orange-400 font-medium">{fmtCurrency(d.properties.amount)}</span>
                          )}
                          {d.properties.closedate && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" /> Close {d.properties.closedate}
                            </span>
                          )}
                          {d.properties.hs_lastmodifieddate && (
                            <span>Updated {timeAgo(d.properties.hs_lastmodifieddate)}</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className={cn(
                        'w-3.5 h-3.5 text-slate-600 transition-transform',
                        expanded && 'rotate-90',
                      )} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-3 ml-7 flex flex-wrap gap-2">
                      {STAGES.filter((s) => s.key !== d.properties.dealstage).map((s) => (
                        <button
                          key={s.key}
                          onClick={() => onUpdateStage(d.id, { dealstage: s.key })}
                          className={cn(
                            'px-2 py-1 rounded-lg border text-[10px] font-medium transition-colors',
                            s.color,
                            'text-slate-300 hover:text-white',
                          )}
                        >
                          Move → {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
