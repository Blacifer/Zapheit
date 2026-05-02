import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, X, Minus, Search, Plus, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { APP_CATALOG, STACKS } from './data/catalog';
import type { AppDef } from './data/catalog';
import { LOGO_DOMAINS } from './constants';

/* ─── Logo ──────────────────────────────────────────────────────────────── */

function appLogoSrc(app: AppDef): string | null {
  const domain = LOGO_DOMAINS[app.appId];
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=40` : null;
}

function AppLogo({ app, size = 36 }: { app: AppDef; size?: number }) {
  const [err, setErr] = useState(false);
  const src = appLogoSrc(app);
  if (!err && src) {
    return <img src={src} alt={app.name} width={size} height={size} className="rounded-lg object-contain" onError={() => setErr(true)} />;
  }
  return (
    <div className="rounded-lg flex items-center justify-center text-sm font-bold text-white"
      style={{ width: size, height: size, backgroundColor: app.colorHex + '33', color: app.colorHex }}>
      {app.logoLetter || app.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

/* ─── Capability rows ────────────────────────────────────────────────────── */

type CellVal = boolean | string | null;

interface Row {
  label: string;
  key: (app: AppDef) => CellVal;
  render?: (val: CellVal) => React.ReactNode;
}

function boolCell(val: CellVal) {
  if (val === true) return <Check className="w-4 h-4 text-emerald-400 mx-auto" />;
  if (val === false) return <X className="w-4 h-4 text-slate-600 mx-auto" />;
  return <Minus className="w-4 h-4 text-slate-700 mx-auto" />;
}

function textCell(val: CellVal) {
  if (!val) return <span className="text-slate-600 text-xs">—</span>;
  return <span className="text-xs text-slate-300">{String(val)}</span>;
}

const ROWS: Row[] = [
  {
    label: 'Category',
    key: (a) => a.category,
    render: (v) => <span className="text-xs text-slate-300 capitalize">{String(v || '—')}</span>,
  },
  {
    label: 'Auth type',
    key: (a) => a.auth === 'oauth' ? 'OAuth' : 'API Key',
    render: (v) => {
      const isOAuth = v === 'OAuth';
      return (
        <span className={cn('text-xs px-2 py-0.5 rounded-full border', isOAuth ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-slate-600/50 bg-white/[0.04] text-slate-400')}>
          {String(v)}
        </span>
      );
    },
  },
  {
    label: 'India-native',
    key: (a) => Boolean(a.isIndiaNative),
    render: boolCell,
  },
  {
    label: 'Production ready',
    key: (a) => a.productionStatus === 'production_ready',
    render: boolCell,
  },
  {
    label: 'Workspace',
    key: (a) => Boolean(a.workspaceRoute),
    render: boolCell,
  },
  {
    label: 'Suggested agent',
    key: (a) => a.suggestedAgent || null,
    render: textCell,
  },
  {
    label: 'Stacks',
    key: (a) => {
      const names = STACKS.filter((s) => s.appIds.includes(a.appId)).map((s) => s.name);
      return names.length ? names.join(', ') : null;
    },
    render: textCell,
  },
];

/* ─── App picker ──────────────────────────────────────────────────────────── */

function AppPicker({ selected, onSelect, onRemove }: {
  selected: AppDef[];
  onSelect: (app: AppDef) => void;
  onRemove: (appId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const selectedIds = new Set(selected.map((a) => a.appId));
    const base = APP_CATALOG.filter((a) => !selectedIds.has(a.appId));
    if (!q) return base.slice(0, 30);
    const lq = q.toLowerCase();
    return base.filter((a) => a.name.toLowerCase().includes(lq) || a.category.toLowerCase().includes(lq)).slice(0, 20);
  }, [q, selected]);

  return (
    <div className="relative">
      {selected.length < 3 && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-white/20 text-slate-400 hover:text-white hover:border-white/40 text-xs transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add app
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full mt-2 w-64 rounded-2xl border border-white/10 bg-[#0d1829] shadow-2xl z-50 p-3">
          <input
            autoFocus
            type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search apps…"
            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500/40 mb-2"
          />
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {filtered.map((app) => (
              <button key={app.appId} onClick={() => { onSelect(app); setOpen(false); setQ(''); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-left">
                <AppLogo app={app} size={20} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{app.name}</p>
                  <p className="text-[10px] text-slate-500 capitalize">{app.category}</p>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="text-xs text-slate-500 text-center py-3">No results</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Preset comparison groups ───────────────────────────────────────────── */

const PRESETS: { label: string; appIds: string[] }[] = [
  { label: 'HR Platforms',        appIds: ['greythr', 'keka', 'darwinbox'] },
  { label: 'Job Boards',          appIds: ['naukri', 'linkedin', 'apna'] },
  { label: 'Finance & Payments',  appIds: ['cashfree', 'tally', 'cleartax'] },
  { label: 'Support / Helpdesk',  appIds: ['freshdesk', 'zendesk', 'intercom'] },
  { label: 'CRM',                 appIds: ['hubspot', 'salesforce', 'zoho-crm'] },
  { label: 'Communication',       appIds: ['slack', 'microsoft-365', 'whatsapp-business'] },
];

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function AppComparison() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialIds = searchParams.get('apps')?.split(',').slice(0, 3) ?? [];
  const [selected, setSelected] = useState<AppDef[]>(() =>
    initialIds.map((id) => APP_CATALOG.find((a) => a.appId === id)).filter(Boolean) as AppDef[]
  );

  function addApp(app: AppDef) {
    if (selected.length < 3) setSelected((prev) => [...prev, app]);
  }

  function removeApp(appId: string) {
    setSelected((prev) => prev.filter((a) => a.appId !== appId));
  }

  function loadPreset(ids: string[]) {
    setSelected(ids.map((id) => APP_CATALOG.find((a) => a.appId === id)).filter(Boolean) as AppDef[]);
  }

  const colWidth = selected.length === 0 ? '' : selected.length === 1 ? 'w-64' : selected.length === 2 ? 'w-56' : 'w-48';

  return (
    <div className="min-h-screen bg-[#080f1a] p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/dashboard/apps')}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Apps
        </button>
        <span className="text-slate-700">/</span>
        <h1 className="text-sm font-medium text-white">Compare Apps</h1>
      </div>

      {/* Presets */}
      <div className="mb-6">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Quick compare</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => loadPreset(p.appIds)}
              className="text-xs px-3 py-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Comparison table */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {/* Row label column */}
              <th className="text-left px-5 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider w-40">Feature</th>

              {/* App columns */}
              {selected.map((app) => (
                <th key={app.appId} className={cn('px-4 py-4 text-center', colWidth)}>
                  <div className="flex flex-col items-center gap-2">
                    <AppLogo app={app} size={36} />
                    <p className="text-sm font-semibold text-white leading-tight">{app.name}</p>
                    <p className="text-[10px] text-slate-500 capitalize">{app.category}</p>
                    {app.workspaceRoute && (
                      <button onClick={() => navigate(`/dashboard/${app.workspaceRoute}`)}
                        className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                        <ExternalLink className="w-2.5 h-2.5" /> Open workspace
                      </button>
                    )}
                    <button onClick={() => removeApp(app.appId)}
                      className="p-1 text-slate-600 hover:text-rose-400 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </th>
              ))}

              {/* Add column */}
              {selected.length < 3 && (
                <th className="px-4 py-4 text-center">
                  <AppPicker selected={selected} onSelect={addApp} onRemove={removeApp} />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, ri) => (
              <tr key={row.label} className={cn('border-b border-white/[0.04]', ri % 2 === 0 ? '' : 'bg-white/[0.01]')}>
                <td className="px-5 py-3 text-xs text-slate-400 font-medium">{row.label}</td>
                {selected.map((app) => {
                  const val = row.key(app);
                  return (
                    <td key={app.appId} className={cn('px-4 py-3 text-center', colWidth)}>
                      {row.render ? row.render(val) : textCell(val)}
                    </td>
                  );
                })}
                {selected.length < 3 && <td />}
              </tr>
            ))}

            {/* Description row */}
            <tr>
              <td className="px-5 py-3 text-xs text-slate-400 font-medium align-top">Description</td>
              {selected.map((app) => (
                <td key={app.appId} className={cn('px-4 py-3 text-center align-top', colWidth)}>
                  <p className="text-xs text-slate-400 leading-relaxed">{app.description || '—'}</p>
                </td>
              ))}
              {selected.length < 3 && <td />}
            </tr>
          </tbody>
        </table>

        {selected.length === 0 && (
          <div className="py-16 text-center">
            <Search className="w-8 h-8 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-slate-500 mb-4">Select apps to compare</p>
            <div className="flex flex-wrap justify-center gap-2">
              {PRESETS.slice(0, 3).map((p) => (
                <button key={p.label} onClick={() => loadPreset(p.appIds)}
                  className="text-xs px-3 py-1.5 rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors">
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
