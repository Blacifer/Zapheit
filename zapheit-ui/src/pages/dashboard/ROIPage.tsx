import { useMemo, useState } from 'react';
import {
  Clock, Download, IndianRupee, Share2, ShieldCheck, TrendingUp, Zap,
} from 'lucide-react';
import { useAgents, useCostData, useIncidents } from '../../hooks/useData';

const HOURS_PER_INCIDENT = 3;
const MESSAGES_PER_HOUR_SAVED = 200;
const TOKENS_PER_MESSAGE = 800;

function StatCard({ icon: Icon, value, label, color }: { icon: React.ElementType; value: string; label: string; color: string }) {
  return (
    <div className={`rounded-2xl border bg-slate-900/60 p-5 ${color}`}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
    </div>
  );
}

export default function ROIPage() {
  const { agents } = useAgents();
  const { incidents } = useIncidents();
  const { costData } = useCostData();
  const [hourlyRate, setHourlyRate] = useState(500);
  const [copied, setCopied] = useState(false);

  const metrics = useMemo(() => {
    const totalMessages = costData.reduce((s: number, d: { tokens: number }) => s + Math.round(d.tokens / TOKENS_PER_MESSAGE), 0);
    const incidentsCaught = incidents.filter((i) => i.status === 'resolved' || i.status === 'open').length;
    const hoursAutoSaved = Math.round(totalMessages / MESSAGES_PER_HOUR_SAVED);
    const hoursIncidentSaved = incidentsCaught * HOURS_PER_INCIDENT;
    const totalHoursSaved = hoursAutoSaved + hoursIncidentSaved;
    const valueSavedINR = totalHoursSaved * hourlyRate;
    const totalCostINR = costData.reduce((s: number, d: { cost: number }) => s + d.cost * 83, 0);
    const roiMultiple = totalCostINR > 0 ? Math.round(valueSavedINR / totalCostINR) : 0;
    return { totalMessages, incidentsCaught, totalHoursSaved, valueSavedINR, totalCostINR, roiMultiple, activeAgents: agents.filter((a) => a.status === 'active').length };
  }, [agents, incidents, costData, hourlyRate]);

  const shareText = `Zapheit saved us ${metrics.totalHoursSaved.toLocaleString()} hours and caught ${metrics.incidentsCaught} AI problems this month. That's ${metrics.roiMultiple}x ROI. #AIGovernance #Zapheit`;

  const handleCopy = () => {
    void navigator.clipboard.writeText(shareText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExportPDF = () => window.print();

  const fmtINR = (v: number) =>
    v >= 100000
      ? `₹${(v / 100000).toFixed(1)}L`
      : v >= 1000
        ? `₹${(v / 1000).toFixed(1)}k`
        : `₹${Math.round(v).toLocaleString('en-IN')}`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Your ROI from Zapheit</h1>
          <p className="mt-1 text-sm text-slate-400">
            Based on {metrics.activeAgents} active {metrics.activeAgents === 1 ? 'assistant' : 'assistants'} · all-time data
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-700"
          >
            <Download className="h-4 w-4" />
            Export PDF
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
          >
            {copied ? <ShieldCheck className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {copied ? 'Copied!' : 'Share results'}
          </button>
        </div>
      </div>

      {/* Hero ROI badge */}
      {metrics.roiMultiple > 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-slate-900/60 p-8 text-center">
          <p className="text-6xl font-black text-white">{metrics.roiMultiple}x</p>
          <p className="mt-2 text-lg font-semibold text-emerald-400">Return on investment</p>
          <p className="mt-1 text-sm text-slate-400">
            You've saved {fmtINR(metrics.valueSavedINR)} in value against {fmtINR(metrics.totalCostINR)} spent on AI
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-10 text-center">
          <TrendingUp className="mx-auto mb-4 h-12 w-12 text-slate-600" />
          <p className="font-semibold text-white">ROI data will appear once your assistants start handling conversations</p>
          <p className="mt-1 text-sm text-slate-400">Connect an assistant and send your first message to see your return.</p>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Zap}
          value={metrics.totalMessages >= 1000 ? `${(metrics.totalMessages / 1000).toFixed(1)}k` : String(metrics.totalMessages)}
          label="Messages handled by AI"
          color="border-cyan-500/20 text-cyan-400"
        />
        <StatCard
          icon={ShieldCheck}
          value={String(metrics.incidentsCaught)}
          label="Problems caught before customers"
          color="border-emerald-500/20 text-emerald-400"
        />
        <StatCard
          icon={Clock}
          value={`${metrics.totalHoursSaved.toLocaleString()} hrs`}
          label="Hours saved (estimated)"
          color="border-violet-500/20 text-violet-400"
        />
        <StatCard
          icon={IndianRupee}
          value={fmtINR(metrics.valueSavedINR)}
          label="Value delivered"
          color="border-amber-500/20 text-amber-400"
        />
      </div>

      {/* Hourly rate input */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-5">
        <label className="mb-2 block text-sm font-medium text-white">Your team's hourly rate (₹)</label>
        <p className="mb-3 text-xs text-slate-400">We use this to estimate the value of time saved. Change it to match your context.</p>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={100}
            max={5000}
            step={50}
            value={hourlyRate}
            onChange={(e) => setHourlyRate(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
          <span className="w-24 text-right text-sm font-semibold text-white">₹{hourlyRate.toLocaleString('en-IN')}/hr</span>
        </div>
      </div>

      {/* Shareable card */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-white">Shareable results card</p>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-cyan-400 transition hover:text-cyan-300"
          >
            <Download className="h-3.5 w-3.5" />
            Copy to clipboard
          </button>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 font-mono text-sm leading-relaxed text-slate-300">
          {shareText}
        </div>
      </div>

      {/* How it's calculated */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/30 p-5">
        <p className="mb-3 text-sm font-semibold text-white">How this is calculated</p>
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>• <strong className="text-slate-300">Messages handled:</strong> total tokens ÷ {TOKENS_PER_MESSAGE} (average tokens per conversation turn)</li>
          <li>• <strong className="text-slate-300">Hours saved:</strong> messages ÷ {MESSAGES_PER_HOUR_SAVED} (estimated human messages/hour) + incidents × {HOURS_PER_INCIDENT} hours each</li>
          <li>• <strong className="text-slate-300">Value delivered:</strong> hours saved × your hourly rate</li>
          <li>• <strong className="text-slate-300">ROI multiple:</strong> value delivered ÷ total AI spend (in INR)</li>
        </ul>
      </div>
    </div>
  );
}
