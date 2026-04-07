import { useRef, useMemo, useState, useEffect } from 'react';
import { ArrowRight, ChevronDown, MessageSquarePlus, Plus, Search, Sparkles, Star, X } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { AIAgent } from '../../../../types';
import type { UnifiedApp } from '../types';
import { CATEGORY_META, SORT_OPTIONS, TYPE_OPTIONS, BADGE_STYLE } from '../constants';
import { getAppServiceId, getSetupModeLabel, useOutsideClick } from '../helpers';
import { AppLogo } from './AppLogo';
import { IntentPicker } from './IntentPicker';

interface BrowseViewProps {
  apps: UnifiedApp[];
  agents: AIAgent[];
  featured?: UnifiedApp[];
  initialCategory?: string | null;
  onConnect: (app: UnifiedApp) => void;
  onManage: (app: UnifiedApp) => void;
}

function BrowseCard({ app, popLabel, onConnect, onManage }: {
  app: UnifiedApp;
  popLabel: string | null;
  onConnect: (a: UnifiedApp) => void;
  onManage: (a: UnifiedApp) => void;
}) {
  return (
    <button
      onClick={() => { if (app.connected) onManage(app); else onConnect(app); }}
      className={cn(
        'group text-left rounded-2xl border p-4 flex items-start gap-3 transition-all',
        app.connected
          ? 'border-emerald-500/20 bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07] cursor-pointer'
          : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/15 cursor-pointer',
      )}
    >
      <AppLogo appId={app.appId} logoLetter={app.logoLetter} colorHex={app.colorHex} logoUrl={app.logoUrl} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-tight truncate">{app.name}</p>
            {popLabel && <p className="text-[10px] text-slate-500 mt-0.5">{popLabel}</p>}
          </div>
          {app.connected ? (
            <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-emerald-400/25 bg-emerald-500/15 text-emerald-300 font-medium">Connected</span>
          ) : app.badge ? (
            <span className={cn('shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-medium', BADGE_STYLE[app.badge] || BADGE_STYLE['Verified'])}>{app.badge}</span>
          ) : (
            <span className="shrink-0 w-6 h-6 rounded-lg border border-white/10 bg-white/[0.04] group-hover:bg-white/[0.12] group-hover:border-white/20 flex items-center justify-center transition-all">
              <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" />
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed line-clamp-2">{app.description}</p>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {(app.primarySetupMode || app.connectionType) && (
                <span className="text-[10px] text-slate-600">
                  {getSetupModeLabel(app.primarySetupMode, app.connectionType)}
                </span>
              )}
          {app.trustTier && (
            <span className="text-[9px] px-1 py-0.5 rounded border border-white/10 text-slate-500 font-medium">{app.trustTier}</span>
          )}
          {app.maturity && app.maturity !== 'connected' && (
            <span className="text-[9px] px-1 py-0.5 rounded border border-white/10 text-slate-500 font-medium">{app.maturity}</span>
          )}
          {app.installCount > 0 && (
            <span className="text-[9px] text-slate-600">
              {app.installCount >= 1000
                ? `${(app.installCount / 1000).toFixed(app.installCount % 1000 === 0 ? 0 : 1)}k installs`
                : `${app.installCount} installs`}
            </span>
          )}
          {CATEGORY_META[app.category] && (
            <span className="text-[9px] text-slate-600">{CATEGORY_META[app.category].label}</span>
          )}
        </div>
      </div>
    </button>
  );
}

export function BrowseView({ apps, agents, featured: featuredProp, initialCategory, onConnect, onManage }: BrowseViewProps) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string>('popular');
  const [filterType, setFilterType] = useState<'all' | 'oauth2' | 'api_key'>('all');
  const [filterCategory, setFilterCategory] = useState<string>(
    initialCategory && CATEGORY_META[initialCategory] ? initialCategory : 'all'
  );
  const [activeDropdown, setActiveDropdown] = useState<'sort' | 'type' | 'cat' | null>(null);

  // Sync filterCategory when parent changes the selected sidebar category
  useEffect(() => {
    if (initialCategory && CATEGORY_META[initialCategory]) {
      setFilterCategory(initialCategory);
    } else if (!initialCategory) {
      setFilterCategory('all');
    }
  }, [initialCategory]);
  const [intentDone, setIntentDone] = useState(apps.some((a) => a.connected));
  const [highlightBundle, setHighlightBundle] = useState<string | null>(null);
  const filtersRef = useRef<HTMLDivElement>(null);

  useOutsideClick(filtersRef, () => setActiveDropdown(null));

  const popularityMap = useMemo(() => {
    const sorted = [...apps].sort((a, b) => b.installCount - a.installCount);
    const m: Record<string, number> = {};
    sorted.forEach((a, i) => { m[a.id] = i + 1; });
    return m;
  }, [apps]);

  const recommendations = useMemo(() => {
    const agentIds = new Set(agents.map((a) => a.id).filter(Boolean));
    return apps.filter((a) => {
      if (a.connected) return false;
      const serviceId = getAppServiceId(a);
      return agents.some((agent) => agentIds.has(agent.id) && ((agent as any).integrationIds || []).includes(serviceId));
    }).slice(0, 4);
  }, [apps, agents]);

  const filtered = useMemo(() => {
    let list = [...apps].filter(a => !a.comingSoon);
    if (filterType !== 'all') list = list.filter((a) => a.authType === filterType);
    if (filterCategory !== 'all') list = list.filter((a) => a.category === filterCategory);
    if (search) {
      const q = search.toLowerCase();
      const nameScoped = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        (a.appId || '').toLowerCase().includes(q) ||
        (a.developer || '').toLowerCase().includes(q)
      );
      list = (nameScoped.length > 0 ? nameScoped : list).filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        (a.developer || '').toLowerCase().includes(q) ||
        (a.appId || '').toLowerCase().includes(q)
      );
    }
    if (sortBy === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => b.installCount - a.installCount);
    return list;
  }, [apps, filterType, filterCategory, search, sortBy]);

  const featured = useMemo(
    () => (!search && filterCategory === 'all' && filterType === 'all')
      ? (featuredProp ?? apps.filter((a) => a.featured && !a.comingSoon))
      : [],
    [featuredProp, apps, search, filterCategory, filterType]
  );

  const groupedByDomain = useMemo(() => {
    if (search || filterCategory !== 'all' || filterType !== 'all') return null;
    const groups: Record<string, UnifiedApp[]> = {};
    const domainOrder = ['communication', 'it', 'hr', 'sales', 'finance', 'support', 'recruitment', 'compliance', 'marketing', 'productivity', 'analytics', 'legal'];
    for (const app of filtered) {
      const cat = app.category || 'productivity';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(app);
    }
    return domainOrder.filter(d => groups[d]?.length).map(d => ({ domain: d, apps: groups[d], meta: CATEGORY_META[d] }));
  }, [filtered, search, filterCategory, filterType]);

  function popLabel(a: UnifiedApp): string | null {
    const r = popularityMap[a.id];
    if (!r) return null;
    if (r === 1) return 'Most popular';
    if (r <= 10) return `#${r} popular`;
    return null;
  }

  const handleIntentSelect = (bundleId: string) => {
    setHighlightBundle(bundleId);
    setIntentDone(true);
    const categoryHint = bundleId.replace('-stack', '');
    if (categoryHint === 'support' || categoryHint === 'finance' || categoryHint === 'sales' || categoryHint === 'compliance') {
      setFilterCategory(categoryHint);
    } else if (categoryHint === 'hiring') {
      setFilterCategory('recruitment');
    } else if (categoryHint === 'it') {
      setFilterCategory('it');
    }
  };

  const toggle = (d: typeof activeDropdown) => setActiveDropdown((p: typeof activeDropdown) => p === d ? null : d);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filters bar */}
      <div ref={filtersRef} className="flex items-center gap-2 px-4 py-3 border-b border-white/8 shrink-0 flex-wrap sticky top-0 z-10 bg-[#0d1117]">
        <div className="relative flex-1 min-w-0 sm:min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search apps..."
            value={search}
            onChange={(e: { target: { value: string } }) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {(['sort', 'type', 'cat'] as const).map((d) => {
          const label = d === 'sort' ? 'Sort' : d === 'type' ? 'Setup' : 'Categories';
          const isActive = activeDropdown === d
            || (d === 'type' && filterType !== 'all')
            || (d === 'cat' && filterCategory !== 'all');
          return (
            <div key={d} className="relative">
              <button
                onClick={() => toggle(d)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors',
                  isActive
                    ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                )}
              >
                {label} <ChevronDown className="w-3 h-3" />
              </button>
              {activeDropdown === d && (
                <div className="absolute top-full mt-1 right-0 min-w-[11rem] rounded-xl border border-white/10 bg-[#161b26] shadow-xl z-20 overflow-hidden">
                  {d === 'sort' && SORT_OPTIONS.map((o) => (
                    <button key={o.value} onClick={() => { setSortBy(o.value); setActiveDropdown(null); }}
                      className={cn('w-full text-left px-3.5 py-2.5 text-xs hover:bg-white/5 transition-colors', sortBy === o.value ? 'text-white font-medium' : 'text-slate-400')}>
                      {o.label}
                    </button>
                  ))}
                  {d === 'type' && TYPE_OPTIONS.map((o) => (
                    <button key={o.value} onClick={() => { setFilterType(o.value as typeof filterType); setActiveDropdown(null); }}
                      className={cn('w-full text-left px-3.5 py-2.5 text-xs hover:bg-white/5 transition-colors', filterType === o.value ? 'text-white font-medium' : 'text-slate-400')}>
                      {o.label}
                    </button>
                  ))}
                  {d === 'cat' && Object.entries(CATEGORY_META).map(([k, { label: lbl, Icon, color }]) => (
                    <button key={k} onClick={() => { setFilterCategory(k); setActiveDropdown(null); }}
                      className={cn('w-full text-left px-3.5 py-2.5 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors', filterCategory === k ? 'text-white font-medium' : 'text-slate-400')}>
                      <Icon className={cn('w-3.5 h-3.5', color)} />{lbl}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Intent picker */}
        {!intentDone && !search && filterCategory === 'all' && filterType === 'all' && (
          <IntentPicker onSelect={handleIntentSelect} />
        )}

        {/* Recommendation banner */}
        {intentDone && recommendations.length > 0 && !search && filterCategory === 'all' && (
          <div className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.04] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-violet-300" />
              <p className="text-sm font-semibold text-white">Recommended for your agents</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {recommendations.map((a: UnifiedApp) => (
                <button
                  key={a.id}
                  onClick={() => onConnect(a)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/8 bg-white/[0.04] hover:bg-white/[0.08] transition-all"
                >
                    <AppLogo appId={a.appId} logoLetter={a.logoLetter} colorHex={a.colorHex} logoUrl={a.logoUrl} size="sm" />
                  <div className="text-left">
                    <p className="text-xs font-semibold text-white">{a.name}</p>
                  </div>
                  <ArrowRight className="w-3 h-3 text-slate-500 ml-1" />
                </button>
              ))}
            </div>
          </div>
        )}

        {highlightBundle && !search && (
          <p className="text-xs text-violet-300">
            Showing the apps most relevant to the workflow you selected.
          </p>
        )}

        {/* Featured */}
        {featured.length > 0 && !search && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-amber-300" />
              <h3 className="text-sm font-semibold text-white">Featured</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {featured.map((a: UnifiedApp) => (
                <BrowseCard key={a.id} app={a} popLabel={popLabel(a)} onConnect={onConnect} onManage={onManage} />
              ))}
            </div>
          </div>
        )}

        {/* Full grid */}
        <div>
          {(search || filterCategory !== 'all' || filterType !== 'all') && (
            <p className="text-xs text-slate-500 mb-3">
              {filtered.length} app{filtered.length !== 1 ? 's' : ''}{search ? ` for "${search}"` : ''}
            </p>
          )}
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No apps found{search ? ` for "${search}"` : ''}.</p>
            </div>
          ) : groupedByDomain ? (
            <div className="space-y-6">
              {groupedByDomain.map(({ domain, apps: domainApps, meta }) => (
                <div key={domain} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <meta.Icon className={cn('w-4 h-4', meta.color)} />
                    <h3 className="text-sm font-semibold text-white">{meta.label}</h3>
                    <span className="text-xs text-slate-500">{domainApps.length} app{domainApps.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {domainApps.map((a: UnifiedApp) => (
                      <BrowseCard key={a.id} app={a} popLabel={popLabel(a)} onConnect={onConnect} onManage={onManage} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map((a: UnifiedApp) => (
                <BrowseCard key={a.id} app={a} popLabel={popLabel(a)} onConnect={onConnect} onManage={onManage} />
              ))}
            </div>
          )}
        </div>

        {/* Request integration CTA */}
        <div className="text-center py-8 border-t border-white/5">
          <MessageSquarePlus className="w-5 h-5 text-slate-500 mx-auto mb-2" />
          <p className="text-sm text-slate-400 mb-1">Don't see an app you need?</p>
          <button className="text-sm text-cyan-400 hover:text-cyan-300 font-medium transition-colors">
            Request an integration →
          </button>
        </div>
      </div>
    </div>
  );
}
