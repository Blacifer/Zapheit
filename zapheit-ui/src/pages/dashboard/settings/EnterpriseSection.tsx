import { useState, useEffect } from 'react';
import { Globe, Shield, Eye, Plus, Trash2, Save, Loader2, CheckCircle2, KeyRound, Palette } from 'lucide-react';
import { useApp } from '../../../context/AppContext';

const DATA_REGIONS = [
  { value: 'in-south1', label: 'India (South 1)', badge: 'Data stored in India' },
  { value: 'us-central1', label: 'United States (Central 1)', badge: 'Data stored in USA' },
  { value: 'eu-west1', label: 'Europe (West 1)', badge: 'Data stored in EU' },
] as const;

interface SsoConfig {
  id: string;
  provider: string;
  metadata_url?: string;
  domain_hint?: string;
  enabled: boolean;
}

interface ShadowAiSummary {
  total: number;
  blocked: number;
  by_provider: Record<string, number>;
}

export function EnterpriseSection({ userRole }: { userRole?: string | null }) {
  const { user } = useApp();
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  const [dataRegion, setDataRegion] = useState('in-south1');
  const [ipAllowlist, setIpAllowlist] = useState<string[]>([]);
  const [newCidr, setNewCidr] = useState('');
  const [cidrError, setCidrError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [shadowAi, setShadowAi] = useState<ShadowAiSummary | null>(null);
  const [ssoConfigs, setSsoConfigs] = useState<SsoConfig[]>([]);
  const [ssoForm, setSsoForm] = useState({ provider: 'okta', metadata_url: '', domain_hint: '' });
  const [savingSso, setSavingSso] = useState(false);

  const [wlEnabled, setWlEnabled] = useState(false);
  const [wlForm, setWlForm] = useState({
    wl_logo_url: '', wl_primary_color: '#6366f1', wl_custom_domain: '',
    wl_product_name: '', wl_support_email: '', wl_email_from_name: '',
  });
  const [savingWl, setSavingWl] = useState(false);
  const [wlSaved, setWlSaved] = useState(false);

  const token = (user as any)?._jwt || localStorage.getItem('sb-access-token') || '';
  const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3001';

  useEffect(() => {
    async function load() {
      try {
        const [settingsRes, shadowRes, ssoRes, wlRes] = await Promise.all([
          fetch(`${apiBase}/api/enterprise/settings`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${apiBase}/api/enterprise/shadow-ai`, {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null),
          fetch(`${apiBase}/api/sso`, {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null),
          fetch(`${apiBase}/api/white-label`, {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null),
        ]);

        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setDataRegion(data.data_region ?? 'in-south1');
          setIpAllowlist(data.ip_allowlist ?? []);
        }
        if (shadowRes?.ok) {
          setShadowAi(await shadowRes.json());
        }
        if (ssoRes?.ok) {
          const d = await ssoRes.json();
          setSsoConfigs(d.data ?? []);
        }
        if (wlRes?.ok) {
          const d = await wlRes.json();
          setWlEnabled(d.white_label_enabled ?? false);
          setWlForm({
            wl_logo_url: d.wl_logo_url ?? '',
            wl_primary_color: d.wl_primary_color ?? '#6366f1',
            wl_custom_domain: d.wl_custom_domain ?? '',
            wl_product_name: d.wl_product_name ?? '',
            wl_support_email: d.wl_support_email ?? '',
            wl_email_from_name: d.wl_email_from_name ?? '',
          });
        }
      } catch {
        // non-fatal
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

  function addCidr() {
    const val = newCidr.trim();
    if (!cidrRegex.test(val)) {
      setCidrError('Enter a valid IPv4 address or CIDR range (e.g. 203.0.113.0/24)');
      return;
    }
    if (ipAllowlist.includes(val)) {
      setCidrError('Already in the list');
      return;
    }
    setIpAllowlist((prev) => [...prev, val]);
    setNewCidr('');
    setCidrError('');
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`${apiBase}/api/enterprise/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ data_region: dataRegion, ip_allowlist: ipAllowlist }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  const regionInfo = DATA_REGIONS.find((r) => r.value === dataRegion);

  if (loading) {
    return (
      <div className="min-h-[20vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Enterprise</h2>
        <p className="text-slate-400 text-sm">Data residency, network access controls, and shadow AI monitoring.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Data region</p>
          <p className="mt-3 text-lg font-bold text-white">{regionInfo?.label ?? dataRegion}</p>
          <span className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {regionInfo?.badge ?? 'Data residency active'}
          </span>
        </div>
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">IP allowlist</p>
          <p className="mt-3 text-2xl font-bold text-white">{ipAllowlist.length}</p>
          <p className="mt-1 text-sm text-slate-400">{ipAllowlist.length === 0 ? 'No restrictions — all IPs allowed' : 'CIDR ranges permitted'}</p>
        </div>
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Unauthorised AI (30 days)</p>
          <p className="mt-3 text-2xl font-bold text-white">{shadowAi?.total ?? '—'}</p>
          <p className="mt-1 text-sm text-slate-400">{shadowAi ? `${shadowAi.blocked} blocked` : 'Shadow AI detection active'}</p>
        </div>
      </div>

      {/* Data residency */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 rounded-xl"><Globe className="w-5 h-5 text-blue-400" /></div>
          <div>
            <h3 className="text-base font-semibold text-white">Data Residency</h3>
            <p className="text-sm text-slate-400">Choose where your organisation's data is stored and processed.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {DATA_REGIONS.map((r) => (
            <button
              key={r.value}
              disabled={!isAdmin}
              onClick={() => isAdmin && setDataRegion(r.value)}
              className={`p-4 rounded-xl border text-left transition-all ${
                dataRegion === r.value
                  ? 'border-cyan-500/60 bg-cyan-500/10 text-white'
                  : 'border-slate-700/50 bg-slate-800/60 text-slate-400 hover:border-slate-600'
              } ${!isAdmin ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <p className="text-sm font-semibold">{r.label}</p>
              <p className="text-xs text-slate-500 mt-1">{r.badge}</p>
            </button>
          ))}
        </div>
      </div>

      {/* IP allowlist */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 rounded-xl"><Shield className="w-5 h-5 text-amber-400" /></div>
          <div>
            <h3 className="text-base font-semibold text-white">IP Allowlist</h3>
            <p className="text-sm text-slate-400">Restrict API access to specific IP addresses or CIDR ranges. Leave empty to allow all IPs.</p>
          </div>
        </div>

        <div className="space-y-2">
          {ipAllowlist.map((cidr) => (
            <div key={cidr} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-700/40 border border-slate-700/50">
              <span className="text-sm font-mono text-slate-200">{cidr}</span>
              {isAdmin && (
                <button
                  onClick={() => setIpAllowlist((prev) => prev.filter((c) => c !== cidr))}
                  className="text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {ipAllowlist.length === 0 && (
            <p className="text-sm text-slate-500 italic px-1">No IP restrictions — all IPs can access the API.</p>
          )}
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newCidr}
              onChange={(e) => { setNewCidr(e.target.value); setCidrError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && addCidr()}
              placeholder="203.0.113.0/24 or 10.0.0.1"
              className="flex-1 bg-slate-700/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60 font-mono"
            />
            <button
              onClick={addCidr}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600/50 rounded-lg text-sm text-slate-200 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        )}
        {cidrError && <p className="text-xs text-red-400">{cidrError}</p>}
      </div>

      {/* Shadow AI events */}
      {shadowAi && shadowAi.total > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-500/10 rounded-xl"><Eye className="w-5 h-5 text-purple-400" /></div>
            <div>
              <h3 className="text-base font-semibold text-white">Unauthorised AI Activity (Last 30 Days)</h3>
              <p className="text-sm text-slate-400">Direct calls to AI providers detected outside the Zapheit gateway.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(shadowAi.by_provider).map(([provider, count]) => (
              <div key={provider} className="rounded-xl bg-slate-700/40 border border-slate-700/50 p-3 text-center">
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">{provider}</p>
                <p className="text-xl font-bold text-white">{count}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* White-label */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-violet-500/10 rounded-xl"><Palette className="w-5 h-5 text-violet-400" /></div>
            <div>
              <h3 className="text-base font-semibold text-white">White-label</h3>
              <p className="text-sm text-slate-400">Custom logo, domain, and product name for system integrators.</p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={async () => {
                const next = !wlEnabled;
                setWlEnabled(next);
                await fetch(`${apiBase}/api/white-label`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ white_label_enabled: next }),
                });
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${wlEnabled ? 'bg-violet-500' : 'bg-slate-600'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${wlEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          )}
        </div>

        {wlEnabled && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { field: 'wl_product_name', label: 'Product name', placeholder: 'e.g. AcmeAI' },
                { field: 'wl_custom_domain', label: 'Custom domain', placeholder: 'ai.acme.com' },
                { field: 'wl_logo_url', label: 'Logo URL', placeholder: 'https://cdn.acme.com/logo.png' },
                { field: 'wl_primary_color', label: 'Primary colour', placeholder: '#1a73e8' },
                { field: 'wl_support_email', label: 'Support email', placeholder: 'support@acme.com' },
                { field: 'wl_email_from_name', label: 'Email sender name', placeholder: 'AcmeAI Support' },
              ].map(({ field, label, placeholder }) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
                  <input
                    type="text"
                    value={wlForm[field as keyof typeof wlForm]}
                    onChange={(e) => setWlForm((f) => ({ ...f, [field]: e.target.value }))}
                    disabled={!isAdmin}
                    placeholder={placeholder}
                    className="w-full bg-slate-700/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500/60 disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
            {isAdmin && (
              <button
                disabled={savingWl}
                onClick={async () => {
                  setSavingWl(true);
                  setWlSaved(false);
                  try {
                    const res = await fetch(`${apiBase}/api/white-label`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify(wlForm),
                    });
                    if (res.ok) { setWlSaved(true); setTimeout(() => setWlSaved(false), 3000); }
                  } finally {
                    setSavingWl(false);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors"
              >
                {savingWl ? <Loader2 className="w-4 h-4 animate-spin" /> : wlSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {savingWl ? 'Saving…' : wlSaved ? 'Saved' : 'Save white-label'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* SAML/SSO */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-500/10 rounded-xl"><KeyRound className="w-5 h-5 text-cyan-400" /></div>
          <div>
            <h3 className="text-base font-semibold text-white">SAML / SSO</h3>
            <p className="text-sm text-slate-400">Connect Okta, Azure AD, or Google Workspace for single sign-on.</p>
          </div>
        </div>

        {ssoConfigs.length > 0 && (
          <div className="space-y-2">
            {ssoConfigs.map((cfg) => (
              <div key={cfg.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-700/40 border border-slate-700/50">
                <div>
                  <p className="text-sm font-semibold text-white capitalize">{cfg.provider.replace('_', ' ')}</p>
                  {cfg.domain_hint && <p className="text-xs text-slate-400 mt-0.5">{cfg.domain_hint}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-600/20 text-slate-400'}`}>
                    {cfg.enabled ? 'Active' : 'Disabled'}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={async () => {
                        await fetch(`${apiBase}/api/sso/${cfg.provider}`, {
                          method: 'DELETE',
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        setSsoConfigs((prev) => prev.filter((c) => c.id !== cfg.id));
                      }}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={ssoForm.provider}
                onChange={(e) => setSsoForm((f) => ({ ...f, provider: e.target.value }))}
                className="bg-slate-700/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/60"
              >
                <option value="okta">Okta</option>
                <option value="azure_ad">Azure AD</option>
                <option value="google">Google Workspace</option>
                <option value="custom">Custom SAML</option>
              </select>
              <input
                type="url"
                value={ssoForm.metadata_url}
                onChange={(e) => setSsoForm((f) => ({ ...f, metadata_url: e.target.value }))}
                placeholder="IdP metadata URL"
                className="bg-slate-700/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
              />
              <input
                type="text"
                value={ssoForm.domain_hint}
                onChange={(e) => setSsoForm((f) => ({ ...f, domain_hint: e.target.value }))}
                placeholder="Domain (e.g. acme.com)"
                className="bg-slate-700/60 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
              />
            </div>
            <button
              disabled={savingSso || !ssoForm.metadata_url}
              onClick={async () => {
                setSavingSso(true);
                try {
                  const res = await fetch(`${apiBase}/api/sso`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify(ssoForm),
                  });
                  if (res.ok) {
                    const d = await res.json();
                    setSsoConfigs((prev) => {
                      const filtered = prev.filter((c) => c.provider !== ssoForm.provider);
                      return d.data ? [...filtered, d.data] : filtered;
                    });
                    setSsoForm({ provider: 'okta', metadata_url: '', domain_hint: '' });
                  }
                } finally {
                  setSavingSso(false);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 border border-slate-600/50 rounded-lg text-sm text-slate-200 transition-colors"
            >
              {savingSso ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add SSO provider
            </button>
          </div>
        )}
      </div>

      {/* Save */}
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-black font-semibold rounded-xl text-sm transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}
