import { useEffect, useMemo, useState } from 'react';
import { Shield, Plus, RefreshCw, Trash2, X, BookOpen, ChevronRight, Zap, GitBranch, Filter, ToggleLeft, ToggleRight } from 'lucide-react';
import { api, type ActionPolicyRow, type RoutingRule, type InterceptorRule, type ActionPolicyConstraints } from '../../lib/api-client';
import { toast } from '../../lib/toast';

type Editor = {
  service: string;
  action: string;
  enabled: boolean;
  require_approval: boolean;
  required_role: 'viewer' | 'manager' | 'admin' | 'super_admin';
  webhook_allowlist_text: string;
  routing_rules: RoutingRule[];
  amount_field: string;
  amount_threshold: string;
  threshold_required_role: 'viewer' | 'manager' | 'admin' | 'super_admin';
  entity_field: string;
  allowed_entities_text: string;
  business_hours_start: string;
  business_hours_end: string;
  business_hours_utc_offset: string;
  emergency_disabled: boolean;
  dual_approval: boolean;
  notes: string;
};

const EMPTY_RULE: RoutingRule = { condition: '', required_role: 'manager', required_user_id: null };

type PolicyTemplate = {
  id: string;
  category: 'soc2' | 'dpdpa' | 'cost' | 'pii' | 'hr';
  name: string;
  description: string;
  service: string;
  action: string;
  require_approval: boolean;
  required_role: Editor['required_role'];
  notes: string;
};

const POLICY_TEMPLATES: PolicyTemplate[] = [
  // SOC2
  { id: 'soc2-delete', category: 'soc2', name: 'Require approval for data deletion', description: 'Any agent action that deletes data must be approved by an admin.', service: 'internal', action: 'data.record.delete', require_approval: true, required_role: 'admin', notes: 'SOC2 CC6.1 — Logical access controls. Prevents unauthorized data destruction.' },
  { id: 'soc2-export', category: 'soc2', name: 'Gate bulk data exports', description: 'Manager approval required before agent can export bulk records.', service: 'internal', action: 'data.records.export', require_approval: true, required_role: 'manager', notes: 'SOC2 CC6.3 — Data egress control.' },
  { id: 'soc2-permission', category: 'soc2', name: 'Gate permission changes', description: 'Admin approval required for any agent-initiated role or permission change.', service: 'internal', action: 'iam.role.assign', require_approval: true, required_role: 'admin', notes: 'SOC2 CC6.2 — Access provisioning.' },
  // DPDPA India
  { id: 'dpdpa-pii-share', category: 'dpdpa', name: 'Block PII sharing to external services', description: 'Require explicit admin approval before agent shares PII fields externally.', service: 'webhook', action: 'webhook.call', require_approval: true, required_role: 'admin', notes: 'DPDPA Section 8(3) — Data fiduciary must ensure data is not transferred without purpose.' },
  { id: 'dpdpa-aadhaar', category: 'dpdpa', name: 'Gate Aadhaar/PAN data handling', description: 'Admin must approve any action accessing Aadhaar or PAN fields.', service: 'internal', action: 'compliance.sensitive_data.access', require_approval: true, required_role: 'admin', notes: 'DPDPA Schedule II — Sensitive personal data requires heightened protection.' },
  { id: 'dpdpa-consent', category: 'dpdpa', name: 'Require consent check before messaging', description: 'Manager approval required before agent sends SMS/email to users.', service: 'internal', action: 'messaging.user.send', require_approval: true, required_role: 'manager', notes: 'DPDPA Section 6 — Processing only with consent of data principal.' },
  // Cost Guardrails
  { id: 'cost-refund', category: 'cost', name: 'Gate Razorpay refunds', description: 'Manager approval required for any refund initiated by an agent.', service: 'razorpay', action: 'create_refund', require_approval: true, required_role: 'manager', notes: 'Prevents agents from issuing unauthorized refunds autonomously.' },
  { id: 'cost-payroll', category: 'cost', name: 'Gate payroll runs (Gusto/Deel)', description: 'Admin approval required before agent triggers any payroll or contractor payment.', service: 'gusto', action: 'run_payroll', require_approval: true, required_role: 'admin', notes: 'High-value, irreversible action — always require a human in the loop.' },
  { id: 'cost-deel', category: 'cost', name: 'Gate Deel contractor payments', description: 'Admin approval required before agent creates any Deel payment.', service: 'deel', action: 'create_payment', require_approval: true, required_role: 'admin', notes: 'Contractor payments are irreversible — require admin sign-off.' },
  // PII Protection
  { id: 'pii-zendesk', category: 'pii', name: 'Require approval for Zendesk ticket creation', description: 'Manager approval required when agent creates tickets containing customer data.', service: 'zendesk', action: 'create_ticket', require_approval: true, required_role: 'manager', notes: 'Prevents leaking PII fields into unreviewed support tickets.' },
  { id: 'pii-hubspot', category: 'pii', name: 'Gate HubSpot contact data export', description: 'Admin approval required for any CRM contact data export action.', service: 'hubspot', action: 'export_contacts', require_approval: true, required_role: 'admin', notes: 'Contact data export can violate GDPR/DPDPA if not reviewed.' },
  { id: 'pii-webhook', category: 'pii', name: 'Restrict webhook hosts to allowlist', description: 'Block webhook calls to any host not in your pre-approved allowlist.', service: 'webhook', action: 'webhook.call', require_approval: false, required_role: 'manager', notes: 'Prevents exfiltration of PII via rogue webhook calls.' },
  // HR Automation
  { id: 'hr-offer', category: 'hr', name: 'Gate offer letter generation', description: 'Manager approval required before agent generates and sends an offer letter.', service: 'internal', action: 'hr.offer_letter.send', require_approval: true, required_role: 'manager', notes: 'Ensures compensation and terms are reviewed before sending.' },
  { id: 'hr-termination', category: 'hr', name: 'Require admin for termination actions', description: 'Admin approval required for any agent-initiated employee offboarding or termination.', service: 'internal', action: 'hr.employee.terminate', require_approval: true, required_role: 'admin', notes: 'Irreversible — requires human oversight at all times.' },
  { id: 'hr-salary', category: 'hr', name: 'Gate salary change requests', description: 'Admin approval required before agent can submit or approve salary changes.', service: 'internal', action: 'hr.compensation.update', require_approval: true, required_role: 'admin', notes: 'Compensation changes require dual approval to prevent manipulation.' },
];

const TEMPLATE_CATEGORIES: Array<{ id: PolicyTemplate['category']; label: string; color: string }> = [
  { id: 'soc2', label: 'SOC2 Compliance', color: 'text-violet-300 border-violet-500/30 bg-violet-500/10' },
  { id: 'dpdpa', label: 'DPDPA India', color: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  { id: 'cost', label: 'Cost Guardrails', color: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
  { id: 'pii', label: 'PII Protection', color: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
  { id: 'hr', label: 'HR Automation', color: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10' },
];

const DEFAULT_ACTIONS: Array<{ service: string; action: string; hint: string }> = [
  { service: 'internal', action: 'support.ticket.create', hint: 'Create support ticket' },
  { service: 'internal', action: 'support.ticket.update_status', hint: 'Update ticket status' },
  { service: 'internal', action: 'sales.lead.create', hint: 'Create sales lead' },
  { service: 'internal', action: 'sales.lead.update_stage', hint: 'Update lead stage' },
  { service: 'internal', action: 'it.access_request.create', hint: 'Create access request' },
  { service: 'internal', action: 'it.access_request.decide', hint: 'Approve/reject access request' },
  { service: 'webhook', action: 'webhook.call', hint: 'External webhook call (runtime)' },
];

function allowlistToText(list: unknown): string {
  if (!Array.isArray(list)) return '';
  return list.map((h) => String(h)).join(', ');
}

function textToAllowlist(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, 50);
}

function constraintsToEditor(constraints: ActionPolicyConstraints | null | undefined) {
  return {
    amount_field: constraints?.amount_field || '',
    amount_threshold: constraints?.amount_threshold != null ? String(constraints.amount_threshold) : '',
    threshold_required_role: constraints?.threshold_required_role || 'admin',
    entity_field: constraints?.entity_field || '',
    allowed_entities_text: Array.isArray(constraints?.allowed_entities) ? constraints!.allowed_entities!.join(', ') : '',
    business_hours_start: constraints?.business_hours?.start || '',
    business_hours_end: constraints?.business_hours?.end || '',
    business_hours_utc_offset: constraints?.business_hours?.utc_offset || '+05:30',
    emergency_disabled: Boolean(constraints?.emergency_disabled),
    dual_approval: Boolean(constraints?.dual_approval),
  };
}

function editorToConstraints(editor: Editor): ActionPolicyConstraints {
  const amountThreshold = editor.amount_threshold.trim().length > 0 ? Number(editor.amount_threshold) : null;
  const allowedEntities = textToAllowlist(editor.allowed_entities_text);
  const hasBusinessHours = editor.business_hours_start.trim() && editor.business_hours_end.trim();

  return {
    amount_field: editor.amount_field.trim() || null,
    amount_threshold: Number.isFinite(amountThreshold) ? amountThreshold : null,
    threshold_required_role: editor.threshold_required_role || null,
    entity_field: editor.entity_field.trim() || null,
    allowed_entities: allowedEntities.length > 0 ? allowedEntities : null,
    business_hours: hasBusinessHours
      ? {
          start: editor.business_hours_start.trim(),
          end: editor.business_hours_end.trim(),
          utc_offset: editor.business_hours_utc_offset.trim() || '+00:00',
        }
      : null,
    emergency_disabled: editor.emergency_disabled || null,
    dual_approval: editor.dual_approval || null,
  };
}

function summarizeConstraints(constraints: ActionPolicyConstraints | null | undefined): string[] {
  if (!constraints || typeof constraints !== 'object') return [];
  const labels: string[] = [];
  if (constraints.dual_approval) labels.push('Dual approval');
  if (constraints.emergency_disabled) labels.push('Emergency stop');
  if (constraints.amount_field && constraints.amount_threshold != null) labels.push(`Threshold on ${constraints.amount_field}`);
  if (constraints.entity_field && Array.isArray(constraints.allowed_entities) && constraints.allowed_entities.length > 0) labels.push('Entity-scoped');
  if (constraints.business_hours?.start && constraints.business_hours?.end) labels.push('Business hours');
  return labels;
}

// ── Gateway Interceptors component ──────────────────────────────────────────

const INTERCEPT_TABS: Array<{ id: 'patch_request' | 'patch_response' | 'route_model'; label: string; icon: any; desc: string; color: string }> = [
  { id: 'patch_request', label: 'Request Patch', icon: Filter, desc: 'Transform messages before they reach the LLM — redact PII, inject system instructions.', color: 'text-cyan-400' },
  { id: 'patch_response', label: 'Response Patch', icon: Zap, desc: 'Transform LLM output before returning to caller — auto-redact PII in responses.', color: 'text-violet-400' },
  { id: 'route_model', label: 'Model Routing', icon: GitBranch, desc: 'Reroute high-risk or expensive requests to a safer/cheaper model automatically.', color: 'text-amber-400' },
];

const TRANSFORM_LABELS: Record<string, string> = {
  redact_pii: 'Redact PII',
  replace: 'Find & Replace',
  append_system: 'Append to system prompt',
  prepend_system: 'Prepend to system prompt',
};

const MATCH_LABELS: Record<string, string> = {
  always: 'Always',
  pii_detected: 'When PII detected',
  keyword: 'When keyword found',
  regex: 'When regex matches',
};

const CONDITION_LABELS: Record<string, string> = {
  always: 'Always',
  risk_score_above: 'Risk score above threshold',
  monthly_cost_above: 'Monthly cost above ($USD)',
};

const GATEWAY_MODELS_UI = [
  { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku (fast, cheap)' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (fast, cheap)' },
  { id: 'anthropic/claude-3-5-sonnet', label: 'Claude 3.5 Sonnet (capable)' },
  { id: 'openai/gpt-4o', label: 'GPT-4o (powerful)' },
  { id: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash (fast)' },
  { id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B (open)' },
];

function emptyRule(tab: 'patch_request' | 'patch_response' | 'route_model'): InterceptorRule {
  if (tab === 'route_model') return { id: crypto.randomUUID(), enabled: true, condition: 'risk_score_above', threshold: 70, target_model: 'anthropic/claude-3-haiku' };
  return { id: crypto.randomUUID(), enabled: true, match_type: 'always', transform: 'redact_pii' };
}

interface GatewayInterceptorsSectionProps {
  rows: ActionPolicyRow[];
  show: boolean;
  onToggle: () => void;
  tab: 'patch_request' | 'patch_response' | 'route_model';
  onTabChange: (t: 'patch_request' | 'patch_response' | 'route_model') => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
  onSaved: (row: ActionPolicyRow) => void;
}

function GatewayInterceptorsSection({ rows, show, onToggle, tab, onTabChange, saving, setSaving, onSaved }: GatewayInterceptorsSectionProps) {
  const existingPolicy = rows.find(r => r.service === '__gateway__' && r.action === tab) || null;
  const [rules, setRules] = useState<InterceptorRule[]>(existingPolicy?.interceptor_rules || []);
  const [enabled, setEnabled] = useState(existingPolicy?.enabled !== false);

  // Sync state when switching tabs or when rows change
  const ep = rows.find(r => r.service === '__gateway__' && r.action === tab) || null;
  useEffect(() => {
    setRules(ep?.interceptor_rules || []);
    setEnabled(ep?.enabled !== false);
  }, [tab, ep?.id, ep?.updated_at]);

  const addRule = () => setRules(prev => [...prev, emptyRule(tab)]);

  const updateRule = (idx: number, patch: Partial<InterceptorRule>) =>
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const removeRule = (idx: number) => setRules(prev => prev.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    const res = await api.actionPolicies.upsert({
      service: '__gateway__',
      action: tab,
      enabled,
      require_approval: false,
      interceptor_rules: rules,
      notes: `Gateway ${tab} interceptor — managed by Rasi Gateway Interceptors UI`,
    });
    setSaving(false);
    if (res.success && res.data) {
      toast.success('Gateway interceptor saved.');
      onSaved(res.data);
    } else {
      toast.error((res as any).error || 'Failed to save interceptor.');
    }
  };

  const activeTab = INTERCEPT_TABS.find(t => t.id === tab)!;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/20 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/40 transition"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Gateway Interceptors</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-medium">NEW</span>
          {rows.filter(r => r.service === '__gateway__' && r.enabled && (r.interceptor_rules?.length ?? 0) > 0).length > 0 && (
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
              {rows.filter(r => r.service === '__gateway__' && r.enabled && (r.interceptor_rules?.length ?? 0) > 0).length} active
            </span>
          )}
        </div>
        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${show ? 'rotate-90' : ''}`} />
      </button>

      {show && (
        <div className="border-t border-slate-700/50 p-5 space-y-5">
          <p className="text-sm text-slate-400">
            Intercept every request through the LLM gateway in real time — redact PII before it reaches the model, sanitize responses before they reach your users, and automatically reroute risky or expensive requests to safer/cheaper models.
          </p>

          {/* Tab switcher */}
          <div className="flex gap-2 flex-wrap">
            {INTERCEPT_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border ${
                  tab === t.id
                    ? `${t.color} border-current bg-current/10`
                    : 'text-slate-400 border-slate-700 hover:border-slate-500'
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Active tab content */}
          <div className="bg-slate-900/40 border border-slate-700/40 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={`text-sm font-semibold ${activeTab.color}`}>{activeTab.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{activeTab.desc}</p>
              </div>
              <button
                onClick={() => setEnabled((v: boolean) => !v)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all flex-shrink-0 ${
                  enabled ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-slate-500 border-slate-700'
                }`}
              >
                {enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                {enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            {/* Rules list */}
            {rules.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">No rules yet — add one below.</p>
            ) : (
              <div className="space-y-3">
                {rules.map((rule, idx) => (
                  <div key={rule.id || idx} className="bg-slate-800/60 border border-slate-700/40 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-300">Rule {idx + 1}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateRule(idx, { enabled: rule.enabled === false ? true : false })}
                          className={`text-xs px-2 py-0.5 rounded border transition-all ${rule.enabled === false ? 'text-slate-500 border-slate-700' : 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'}`}
                        >
                          {rule.enabled === false ? 'Off' : 'On'}
                        </button>
                        <button onClick={() => removeRule(idx)} className="p-1 text-slate-500 hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {tab === 'route_model' ? (
                      /* Model routing rule */
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Condition</label>
                          <select
                            value={rule.condition || 'risk_score_above'}
                            onChange={e => updateRule(idx, { condition: e.target.value as any })}
                            className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500"
                          >
                            {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                        {(rule.condition === 'risk_score_above' || rule.condition === 'monthly_cost_above') && (
                          <div>
                            <label className="text-xs text-slate-400 mb-1 block">
                              {rule.condition === 'risk_score_above' ? 'Threshold (0–100)' : 'Threshold (USD/month)'}
                            </label>
                            <input
                              type="number"
                              value={rule.threshold ?? (rule.condition === 'risk_score_above' ? 70 : 10)}
                              onChange={e => updateRule(idx, { threshold: Number(e.target.value) })}
                              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500"
                            />
                          </div>
                        )}
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Reroute to model</label>
                          <select
                            value={rule.target_model || 'anthropic/claude-3-haiku'}
                            onChange={e => updateRule(idx, { target_model: e.target.value })}
                            className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500"
                          >
                            {GATEWAY_MODELS_UI.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                        </div>
                      </div>
                    ) : (
                      /* Request / response patch rule */
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-slate-400 mb-1 block">Match when</label>
                            <select
                              value={rule.match_type || 'always'}
                              onChange={e => updateRule(idx, { match_type: e.target.value as any })}
                              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500"
                            >
                              {Object.entries(MATCH_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          {(rule.match_type === 'keyword' || rule.match_type === 'regex') && (
                            <div>
                              <label className="text-xs text-slate-400 mb-1 block">
                                {rule.match_type === 'keyword' ? 'Keyword' : 'Regex pattern'}
                              </label>
                              <input
                                value={rule.match_value || ''}
                                onChange={e => updateRule(idx, { match_value: e.target.value })}
                                placeholder={rule.match_type === 'keyword' ? 'e.g. password' : 'e.g. \\d{12}'}
                                className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500 font-mono"
                              />
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Transform</label>
                          <select
                            value={rule.transform || 'redact_pii'}
                            onChange={e => updateRule(idx, { transform: e.target.value as any })}
                            className="w-full sm:w-1/2 px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500"
                          >
                            {Object.entries(TRANSFORM_LABELS)
                              .filter(([k]) => tab === 'patch_request' || (k !== 'append_system' && k !== 'prepend_system'))
                              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                        {rule.transform === 'replace' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-slate-400 mb-1 block">Find (regex)</label>
                              <input
                                value={rule.find || ''}
                                onChange={e => updateRule(idx, { find: e.target.value })}
                                placeholder="e.g. api_key=\S+"
                                className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500 font-mono"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 mb-1 block">Replace with</label>
                              <input
                                value={rule.replacement || ''}
                                onChange={e => updateRule(idx, { replacement: e.target.value })}
                                placeholder="e.g. [REDACTED]"
                                className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500"
                              />
                            </div>
                          </div>
                        )}
                        {(rule.transform === 'append_system' || rule.transform === 'prepend_system') && (
                          <div>
                            <label className="text-xs text-slate-400 mb-1 block">Text to inject into system prompt</label>
                            <textarea
                              value={rule.text || ''}
                              onChange={e => updateRule(idx, { text: e.target.value })}
                              rows={2}
                              placeholder="e.g. Never reveal API keys or credentials. Always cite sources."
                              className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg outline-none focus:border-cyan-500 resize-none"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={addRule}
                className="flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add rule
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-sm font-semibold flex items-center gap-2"
              >
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                {saving ? 'Saving…' : 'Save Interceptor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ActionPoliciesPage() {
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ActionPolicyRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTemplateCategory, setActiveTemplateCategory] = useState<PolicyTemplate['category']>('soc2');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showInterceptors, setShowInterceptors] = useState(false);
  const [interceptorTab, setInterceptorTab] = useState<'patch_request' | 'patch_response' | 'route_model'>('patch_request');
  const [savingInterceptor, setSavingInterceptor] = useState(false);
  const [editor, setEditor] = useState<Editor>({
    service: 'internal',
    action: 'support.ticket.create',
    enabled: true,
    require_approval: true,
    required_role: 'manager',
    webhook_allowlist_text: '',
    routing_rules: [],
    amount_field: '',
    amount_threshold: '',
    threshold_required_role: 'admin',
    entity_field: '',
    allowed_entities_text: '',
    business_hours_start: '',
    business_hours_end: '',
    business_hours_utc_offset: '+05:30',
    emergency_disabled: false,
    dual_approval: false,
    notes: '',
  });

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId]);

  const load = async () => {
    setBusy(true);
    try {
      const res = await api.actionPolicies.list({ limit: 200 });
      if (!res.success) throw new Error(res.error || 'Failed to load action policies');
      setRows(res.data || []);
      if (!selectedId && res.data?.[0]?.id) setSelectedId(res.data[0].id);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load action policies');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    setEditor({
      service: selected.service,
      action: selected.action,
      enabled: Boolean(selected.enabled),
      require_approval: Boolean(selected.require_approval),
      required_role: selected.required_role || 'manager',
      webhook_allowlist_text: allowlistToText(selected.webhook_allowlist),
      routing_rules: Array.isArray(selected.routing_rules) ? selected.routing_rules : [],
      ...constraintsToEditor(selected.policy_constraints),
      notes: selected.notes || '',
    });
  }, [selected]);

  const upsert = async () => {
    setBusy(true);
    try {
      const payload = {
        service: editor.service.trim(),
        action: editor.action.trim(),
        enabled: editor.enabled,
        require_approval: editor.require_approval,
        required_role: editor.required_role,
        webhook_allowlist: editor.service === 'webhook' ? textToAllowlist(editor.webhook_allowlist_text) : [],
        routing_rules: editor.routing_rules.filter((r) => r.required_role),
        policy_constraints: editorToConstraints(editor),
        notes: editor.notes.trim() || undefined,
      };
      const res = await api.actionPolicies.upsert(payload);
      if (!res.success) throw new Error(res.error || 'Failed to save policy');
      toast.success('Saved');
      await load();
      if (res.data?.id) setSelectedId(res.data.id);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save policy');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await api.actionPolicies.remove(selected.id);
      if (!res.success) throw new Error(res.error || 'Failed to delete policy');
      toast.success('Deleted');
      setSelectedId(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete policy');
    } finally {
      setBusy(false);
    }
  };

  const selectTemplate = (service: string, action: string) => {
    setSelectedId(null);
    setEditor((prev) => ({
      ...prev,
      service,
      action,
      webhook_allowlist_text: service === 'webhook' ? prev.webhook_allowlist_text : '',
      routing_rules: [],
    }));
  };

  const applyTemplate = (t: PolicyTemplate) => {
    setSelectedId(null);
    setEditor({
      service: t.service,
      action: t.action,
      enabled: true,
      require_approval: t.require_approval,
      required_role: t.required_role,
      webhook_allowlist_text: '',
      routing_rules: [],
      amount_field: '',
      amount_threshold: '',
      threshold_required_role: 'admin',
      entity_field: '',
      allowed_entities_text: '',
      business_hours_start: '',
      business_hours_end: '',
      business_hours_utc_offset: '+05:30',
      emergency_disabled: false,
      dual_approval: false,
      notes: t.notes,
    });
    setShowTemplates(false);
    // Scroll to top so user sees the pre-filled editor
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast.success(`Template applied — review and save.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-cyan-400" />
            Action Policies
          </h1>
          <p className="text-sm text-slate-400 mt-1">Configure who can approve which connector actions and which webhook hosts are allowed.</p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 inline-flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-slate-800/30 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <div className="text-sm text-slate-300">Policies ({rows.length})</div>
            <button
              onClick={() => {
                setSelectedId(null);
                setEditor({
                  service: 'internal',
                  action: 'support.ticket.create',
                  enabled: true,
                  require_approval: true,
                  required_role: 'manager',
                  webhook_allowlist_text: '',
                  routing_rules: [],
                  amount_field: '',
                  amount_threshold: '',
                  threshold_required_role: 'admin',
                  entity_field: '',
                  allowed_entities_text: '',
                  business_hours_start: '',
                  business_hours_end: '',
                  business_hours_utc_offset: '+05:30',
                  emergency_disabled: false,
                  dual_approval: false,
                  notes: '',
                });
              }}
              className="px-2 py-1 rounded-md bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700 text-xs text-slate-200 inline-flex items-center gap-1"
              title="New policy"
            >
              <Plus className="w-4 h-4" />
              New
            </button>
          </div>
          <div className="max-h-[560px] overflow-auto">
            {rows.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">No action policies configured yet.</div>
            ) : rows.map((r) => {
              const selectedRow = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-800/60 hover:bg-slate-800/40 ${selectedRow ? 'bg-cyan-500/10' : ''}`}
                >
                  <div className="text-sm text-white truncate">{r.service}:{r.action}</div>
                  <div className="text-xs text-slate-400 mt-1">
                    {r.enabled ? 'Enabled' : 'Disabled'} · role ≥ {r.required_role} · {r.require_approval ? 'Approval required' : 'Auto-approve'}
                  </div>
                  {summarizeConstraints(r.policy_constraints).length > 0 ? (
                    <div className="text-[11px] text-cyan-300 mt-1">
                      {summarizeConstraints(r.policy_constraints).join(' · ')}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 bg-slate-800/30 border border-slate-700 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-slate-400">Edit</div>
              <div className="text-white font-semibold truncate">
                {editor.service}:{editor.action}
              </div>
            </div>
            {selected ? (
              <button
                onClick={remove}
                disabled={busy}
                className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-200 text-sm border border-red-500/30 inline-flex items-center gap-2 disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">Service</label>
              <input
                value={editor.service}
                onChange={(e) => setEditor((p) => ({ ...p, service: e.target.value }))}
                className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                placeholder="internal | webhook"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Action</label>
              <input
                value={editor.action}
                onChange={(e) => setEditor((p) => ({ ...p, action: e.target.value }))}
                className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                placeholder="support.ticket.create"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-slate-400">Quick templates</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {DEFAULT_ACTIONS.map((t) => (
                  <button
                    key={`${t.service}:${t.action}`}
                    onClick={() => selectTemplate(t.service, t.action)}
                    className="px-3 py-1.5 rounded-full text-xs border bg-slate-800/30 text-slate-300 border-slate-700 hover:bg-slate-800/60"
                    title={t.hint}
                  >
                    {t.service}:{t.action}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400">Required role</label>
              <select
                value={editor.required_role}
                onChange={(e) => setEditor((p) => ({ ...p, required_role: e.target.value as any }))}
                className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
              >
                <option value="viewer">viewer</option>
                <option value="manager">manager</option>
                <option value="admin">admin</option>
                <option value="super_admin">super_admin</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">Enforced when approving connector_action jobs.</p>
            </div>

            <div>
              <label className="text-xs text-slate-400">Approval mode</label>
              <select
                value={editor.require_approval ? 'required' : 'auto'}
                onChange={(e) => setEditor((p) => ({ ...p, require_approval: e.target.value === 'required' }))}
                className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
              >
                <option value="required">Require approval</option>
                <option value="auto">Auto-approve</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">Auto-approve applies at job creation time.</p>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-slate-400">Enabled</label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editor.enabled}
                  onChange={(e) => setEditor((p) => ({ ...p, enabled: e.target.checked }))}
                />
                <span className="text-sm text-slate-200">{editor.enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">Disabled actions are blocked at runtime even if a job exists.</p>
            </div>

            {editor.service.trim() === 'webhook' ? (
              <div className="md:col-span-2">
                <label className="text-xs text-slate-400">Webhook allowlist (hosts)</label>
                <input
                  value={editor.webhook_allowlist_text}
                  onChange={(e) => setEditor((p) => ({ ...p, webhook_allowlist_text: e.target.value }))}
                  className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                  placeholder="example.com, hooks.mycompany.com"
                />
                <p className="text-xs text-slate-500 mt-1">Runtime should only call allowed hosts for webhook actions.</p>
              </div>
            ) : null}

            <div className="md:col-span-2">
              <label className="text-xs text-slate-400">Notes</label>
              <textarea
                value={editor.notes}
                onChange={(e) => setEditor((p) => ({ ...p, notes: e.target.value }))}
                rows={4}
                className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                placeholder="Why this policy exists, expected usage, owners…"
              />
            </div>

            {editor.require_approval ? (
              <div className="md:col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs text-slate-400">Routing Rules</label>
                    <p className="text-xs text-slate-500 mt-0.5">Override required_role (and optionally assign a specific approver) based on action payload conditions. Rules are evaluated top-to-bottom; first match wins.</p>
                  </div>
                  <button
                    onClick={() => setEditor((p) => ({ ...p, routing_rules: [...p.routing_rules, { ...EMPTY_RULE }] }))}
                    className="px-2 py-1 rounded-md bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700 text-xs text-slate-300 inline-flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Rule
                  </button>
                </div>

                {editor.routing_rules.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">No routing rules — default role applies to all approvals.</div>
                ) : editor.routing_rules.map((rule, i) => (
                  <div key={i} className="flex flex-col gap-2 p-3 bg-slate-900/40 border border-slate-700/60 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-5 shrink-0">#{i + 1}</span>
                      <input
                        value={rule.condition || ''}
                        onChange={(e) => setEditor((p) => ({
                          ...p,
                          routing_rules: p.routing_rules.map((r, j) => j === i ? { ...r, condition: e.target.value } : r),
                        }))}
                        className="flex-1 bg-slate-900/50 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs font-mono"
                        placeholder='Condition, e.g. amount > 5000 (leave empty to always match)'
                      />
                      <button
                        onClick={() => setEditor((p) => ({ ...p, routing_rules: p.routing_rules.filter((_, j) => j !== i) }))}
                        className="p-1 text-slate-500 hover:text-red-400 rounded"
                        title="Remove rule"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex gap-2 pl-7">
                      <div className="flex-1">
                        <label className="text-xs text-slate-500">Required Role</label>
                        <select
                          value={rule.required_role}
                          onChange={(e) => setEditor((p) => ({
                            ...p,
                            routing_rules: p.routing_rules.map((r, j) => j === i ? { ...r, required_role: e.target.value as RoutingRule['required_role'] } : r),
                          }))}
                          className="mt-0.5 w-full bg-slate-900/50 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs"
                        >
                          <option value="viewer">viewer</option>
                          <option value="manager">manager</option>
                          <option value="admin">admin</option>
                          <option value="super_admin">super_admin</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-500">Assign to User ID <span className="text-slate-600">(optional UUID)</span></label>
                        <input
                          value={rule.required_user_id || ''}
                          onChange={(e) => setEditor((p) => ({
                            ...p,
                            routing_rules: p.routing_rules.map((r, j) => j === i ? { ...r, required_user_id: e.target.value || null } : r),
                          }))}
                          className="mt-0.5 w-full bg-slate-900/50 border border-slate-700 rounded px-2 py-1.5 text-slate-200 text-xs font-mono"
                          placeholder="Paste user UUID from Team settings…"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {editor.routing_rules.length > 0 ? (
                  <p className="text-xs text-slate-500">
                    Condition format: <code className="text-slate-400">field {'>'} value</code>, <code className="text-slate-400">field == value</code>, <code className="text-slate-400">field contains text</code>. Fields reference <code className="text-slate-400">action_payload</code>.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="md:col-span-2 rounded-xl border border-slate-700 bg-slate-900/30 p-4 space-y-4">
              <div>
                <label className="text-xs text-slate-400">Governance constraints</label>
                <p className="text-xs text-slate-500 mt-1">Optional guardrails for thresholds, business hours, entity scope, emergency shutdown, and dual approval.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Amount field</label>
                  <input
                    value={editor.amount_field}
                    onChange={(e) => setEditor((p) => ({ ...p, amount_field: e.target.value }))}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                    placeholder="amount or payment.amount"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Approval threshold</label>
                  <input
                    type="number"
                    value={editor.amount_threshold}
                    onChange={(e) => setEditor((p) => ({ ...p, amount_threshold: e.target.value }))}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                    placeholder="5000"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Threshold role</label>
                  <select
                    value={editor.threshold_required_role}
                    onChange={(e) => setEditor((p) => ({ ...p, threshold_required_role: e.target.value as Editor['threshold_required_role'] }))}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                  >
                    <option value="viewer">viewer</option>
                    <option value="manager">manager</option>
                    <option value="admin">admin</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Entity field</label>
                  <input
                    value={editor.entity_field}
                    onChange={(e) => setEditor((p) => ({ ...p, entity_field: e.target.value }))}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                    placeholder="merchant_id or user.id"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-slate-400">Allowed entities</label>
                  <input
                    value={editor.allowed_entities_text}
                    onChange={(e) => setEditor((p) => ({ ...p, allowed_entities_text: e.target.value }))}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                    placeholder="merchant_live_india, merchant_test_ops"
                  />
                  <p className="text-xs text-slate-500 mt-1">Comma-separated values matched against the entity field above.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-400">Business hours start</label>
                  <input
                    value={editor.business_hours_start}
                    onChange={(e) => setEditor((p) => ({ ...p, business_hours_start: e.target.value }))}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                    placeholder="09:00"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Business hours end</label>
                  <input
                    value={editor.business_hours_end}
                    onChange={(e) => setEditor((p) => ({ ...p, business_hours_end: e.target.value }))}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                    placeholder="18:00"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">UTC offset</label>
                  <input
                    value={editor.business_hours_utc_offset}
                    onChange={(e) => setEditor((p) => ({ ...p, business_hours_utc_offset: e.target.value }))}
                    className="mt-1 w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm"
                    placeholder="+05:30"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={editor.dual_approval}
                    onChange={(e) => setEditor((p) => ({ ...p, dual_approval: e.target.checked }))}
                  />
                  <div>
                    <div className="text-sm text-slate-200">Require dual approval</div>
                    <div className="text-xs text-slate-500">Two distinct approvers must clear this action.</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={editor.emergency_disabled}
                    onChange={(e) => setEditor((p) => ({ ...p, emergency_disabled: e.target.checked }))}
                  />
                  <div>
                    <div className="text-sm text-slate-200">Emergency disable</div>
                    <div className="text-xs text-slate-500">Blocks this action immediately at execution time.</div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={upsert}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-sm font-semibold"
            >
              Save Policy
            </button>
          </div>
        </div>
      </div>

      {/* Gateway Interceptors */}
      <GatewayInterceptorsSection
        rows={rows}
        show={showInterceptors}
        onToggle={() => setShowInterceptors((v) => !v)}
        tab={interceptorTab}
        onTabChange={setInterceptorTab}
        saving={savingInterceptor}
        setSaving={setSavingInterceptor}
        onSaved={(updated) => setRows((prev) => {
          const idx = prev.findIndex((r) => r.id === updated.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
          return [updated, ...prev];
        })}
      />

      {/* Template Gallery */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/20 overflow-hidden">
        <button
          onClick={() => setShowTemplates((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/40 transition"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-white">Browse Policy Templates</span>
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">{POLICY_TEMPLATES.length}</span>
          </div>
          <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${showTemplates ? 'rotate-90' : ''}`} />
        </button>

        {showTemplates && (
          <div className="border-t border-slate-700 p-5 space-y-5">
            <p className="text-sm text-slate-400">Pre-built policies organized by compliance category. Click <strong className="text-white">Use Template</strong> to pre-fill the editor — review and save to activate.</p>

            {/* Category tabs */}
            <div className="flex flex-wrap gap-2">
              {TEMPLATE_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveTemplateCategory(cat.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${activeTemplateCategory === cat.id ? cat.color : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200'}`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Template cards */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {POLICY_TEMPLATES.filter((t) => t.category === activeTemplateCategory).map((t) => {
                const cat = TEMPLATE_CATEGORIES.find((c) => c.id === t.category)!;
                const alreadyExists = rows.some((r) => r.service === t.service && r.action === t.action);
                return (
                  <div key={t.id} className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{t.name}</p>
                        <p className="mt-1 text-xs text-slate-400 leading-relaxed">{t.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className={`rounded-full border px-2 py-0.5 font-medium ${cat.color}`}>{cat.label}</span>
                      <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-slate-400">{t.service}</span>
                      {t.require_approval && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">Requires Approval</span>}
                      <span className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-slate-400">{t.required_role}</span>
                    </div>
                    <button
                      onClick={() => applyTemplate(t)}
                      className={`mt-auto rounded-lg border px-3 py-2 text-xs font-semibold transition ${alreadyExists ? 'border-slate-600 bg-slate-800/40 text-slate-400 hover:bg-slate-800/60' : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'}`}
                    >
                      {alreadyExists ? 'Override with Template' : 'Use Template'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
