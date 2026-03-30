import { ArrowUpRight, ChevronDown, CheckCircle2, Layers, Search } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { UnifiedApp } from '../types';
import { CATEGORIES } from '../constants';

interface CategorySidebarProps {
  search: string;
  onSearchChange: (v: string) => void;
  selectedCat: string | null;
  onSelectCat: (id: string | null) => void;
  showMyApps: boolean;
  onToggleMyApps: () => void;
  myApps: UnifiedApp[];
  allApps: UnifiedApp[];
  onSelectApp: (app: UnifiedApp) => void;
  showCategories: boolean;
  onToggleCategories: () => void;
  onNavigate?: (route: string) => void;
}

export function CategorySidebar({
  search, onSearchChange, selectedCat, onSelectCat,
  showMyApps, onToggleMyApps, myApps, allApps, onSelectApp,
  showCategories, onToggleCategories, onNavigate,
}: CategorySidebarProps) {
  return (
    <div className="hidden md:flex w-56 shrink-0 border-r border-white/8 flex-col bg-[#080f1a] overflow-y-auto">
      {/* Search */}
      <div className="p-3 border-b border-white/[0.06]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Find apps..."
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/30 transition-colors"
          />
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {/* Apps overview */}
        <button
          onClick={() => { onSelectCat(null); if (showMyApps) onToggleMyApps(); }}
          className={cn('w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors', !selectedCat && !showMyApps ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]')}
        >
          <Layers className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">Apps overview</span>
        </button>

        {/* My apps */}
        <button
          onClick={onToggleMyApps}
          className={cn('w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors', showMyApps && !selectedCat ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]')}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-left">My apps</span>
          {myApps.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 font-semibold">
              {myApps.length}
            </span>
          )}
          <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 transition-transform', showMyApps && 'rotate-180')} />
        </button>

        {/* My apps expanded list */}
        {showMyApps && myApps.length > 0 && (
          <div className="pl-2 space-y-0.5 ml-1 border-l border-white/[0.06]">
            {myApps.slice(0, 8).map((a) => (
              <button
                key={a.id}
                onClick={() => onSelectApp(a)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/[0.04] transition-colors text-left"
              >
                <div
                  className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                  style={{ backgroundColor: a.colorHex }}
                >
                  {a.logoLetter}
                </div>
                <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Categories */}
        <div className="pt-2">
          <button
            onClick={onToggleCategories}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
          >
            <span className="flex-1 text-left">Categories</span>
            <ChevronDown className={cn('w-3 h-3 transition-transform', showCategories && 'rotate-180')} />
          </button>

          {showCategories && (
            <div className="space-y-0.5">
              <button
                onClick={() => onSelectCat(null)}
                className={cn('w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors', !selectedCat && !showMyApps ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]')}
              >
                All apps
              </button>
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const count = allApps.filter((a) => a.category === cat.apiCategory && a.connected).length;
                const isSelected = selectedCat === cat.id;
                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => { onSelectCat(cat.id); if (showMyApps) onToggleMyApps(); }}
                      className={cn('w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors', isSelected ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]')}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left truncate">{cat.label}</span>
                      {count > 0 && (
                        <span className="text-[10px] w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-semibold shrink-0">
                          {count}
                        </span>
                      )}
                    </button>
                    {isSelected && cat.hubRoute && cat.hubLabel && onNavigate && (
                      <button
                        onClick={() => onNavigate(cat.hubRoute!)}
                        className="w-full flex items-center gap-1.5 pl-8 pr-2 py-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        <ArrowUpRight className="w-3 h-3 shrink-0" />
                        <span>{cat.hubLabel}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}
