import { ChevronRight, Database, DollarSign, Eye, FileText, Shield, Sparkles, TrendingUp, Webhook, Zap } from 'lucide-react';
import { SettingsMcpSection } from './SettingsMcpSection';

export function AdvancedSection({ onNavigate }: { onNavigate?: (page: string) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Advanced</h2>
        <p className="text-slate-400 text-sm">Deep configuration areas for expert operators. These are intentionally separate from day-to-day settings.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { id: 'persona', icon: FileText, label: 'Persona Library', desc: 'Define agent personas and communication styles.', color: 'from-violet-500 to-purple-600' },
          { id: 'shadow', icon: Eye, label: 'Shadow Mode', desc: 'Run canary agents alongside production in parallel.', color: 'from-slate-500 to-slate-600' },
          { id: 'api-analytics', icon: TrendingUp, label: 'API Analytics', desc: 'Deep-dive into request patterns and latency.', color: 'from-blue-500 to-cyan-600' },
          { id: 'webhooks', icon: Webhook, label: 'Webhook Events', desc: 'Push platform events to your HTTP endpoints.', color: 'from-orange-500 to-amber-600' },
          { id: 'batch', icon: Zap, label: 'Batch Processing', desc: 'Submit bulk LLM jobs with async result retrieval.', color: 'from-yellow-500 to-orange-500' },
          { id: 'fine-tuning', icon: Sparkles, label: 'Fine-tuning', desc: 'Train custom models on your proprietary data.', color: 'from-pink-500 to-rose-600' },
          { id: 'caching', icon: Database, label: 'Prompt Caching', desc: 'Cache frequent responses to cut costs by up to 80%.', color: 'from-cyan-500 to-sky-600' },
          { id: 'pricing', icon: DollarSign, label: 'Pricing Calculator', desc: 'Estimate costs before running large workloads.', color: 'from-teal-500 to-emerald-600' },
          { id: 'legal', icon: Shield, label: 'Safe Harbor & Legal', desc: 'Compliance documentation and terms of service.', color: 'from-slate-500 to-slate-600' },
        ].map((tool) => (
          <button
            key={tool.id}
            onClick={() => onNavigate?.(tool.id)}
            className="group flex flex-col gap-3 p-5 bg-slate-800/40 hover:bg-slate-700/50 border border-slate-700/50 hover:border-cyan-500/30 rounded-2xl transition-all text-left"
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tool.color} flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
              <tool.icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors flex items-center gap-2">
                {tool.label}
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
              </p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{tool.desc}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
        <SettingsMcpSection />
      </div>
    </div>
  );
}
