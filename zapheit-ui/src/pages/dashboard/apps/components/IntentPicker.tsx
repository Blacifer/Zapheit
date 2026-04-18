import { Sparkles } from 'lucide-react';
import { INTENTS } from '../constants';

interface IntentPickerProps {
  onSelect: (bundleId: string) => void;
}

export function IntentPicker({ onSelect }: IntentPickerProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-violet-300" />
        <p className="text-sm font-bold text-white">What are you trying to automate?</p>
      </div>
      <p className="text-xs text-slate-400 mb-4">Pick a use case and we'll highlight the right apps.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {INTENTS.map(({ id, label, Icon, color, bundleId }) => (
          <button
            key={id}
            onClick={() => onSelect(bundleId)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.07] text-left transition-all group"
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: color + '20', border: `1px solid ${color}35` }}
            >
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <span className="text-xs font-medium text-slate-300 group-hover:text-white transition-colors">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
