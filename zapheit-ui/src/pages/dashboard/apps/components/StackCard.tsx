import { ArrowRight } from 'lucide-react';
import type { AppDef, AppStack } from '../data/catalog';
import { APP_CATALOG } from '../data/catalog';

interface StackCardProps {
  stack: AppStack;
  onSelect: () => void;
}

export function StackCard({ stack, onSelect }: StackCardProps) {
  const apps = stack.appIds.map((id) => APP_CATALOG.find((a) => a.appId === id)).filter(Boolean) as AppDef[];
  return (
    <button
      onClick={onSelect}
      className="shrink-0 w-56 rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.07] p-4 text-left transition-all hover:border-white/15 group"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background: `${stack.colorHex}22`, border: `1px solid ${stack.colorHex}33` }}>
        <span style={{ color: stack.colorHex }} className="flex items-center justify-center"><stack.Icon className="w-4 h-4" /></span>
      </div>
      <p className="text-sm font-semibold text-white mb-1">{stack.name}</p>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">{stack.description}</p>
      <div className="flex items-center gap-1 flex-wrap">
        {apps.map((a) => (
          <span key={a.appId} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.07] text-slate-400 font-medium">{a.name}</span>
        ))}
      </div>
      <div className="flex items-center gap-1 mt-3 text-[11px] font-semibold group-hover:text-blue-400 text-slate-500 transition-colors">
        Set up <ArrowRight className="w-3 h-3" />
      </div>
    </button>
  );
}
