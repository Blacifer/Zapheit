import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator, IndianRupee, AlertTriangle, Check, Loader2, RefreshCw, Save,
  Building2, MapPin, TrendingUp, Users, BarChart3, Clock,
} from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import type { SimulationResult, CtcSimulation, CtcStats } from '../../lib/api/ctc';

function cx(...v: Array<string | false | null | undefined>) { return v.filter(Boolean).join(' '); }

function formatINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function CTCCalculatorPage() {
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<CtcStats | null>(null);
  const [simulations, setSimulations] = useState<CtcSimulation[]>([]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [tab, setTab] = useState<'calculator' | 'history' | 'structures'>('calculator');

  // Calculator inputs
  const [ctcAnnual, setCtcAnnual] = useState(1200000);
  const [basicPercent, setBasicPercent] = useState(50);
  const [isMetro, setIsMetro] = useState(true);
  const [pfCapped, setPfCapped] = useState(true);
  const [includeEsi, setIncludeEsi] = useState(false);
  const [includeLta, setIncludeLta] = useState(true);
  const [includeMedical, setIncludeMedical] = useState(false);
  const [includeNps, setIncludeNps] = useState(false);
  const [npsPercent, setNpsPercent] = useState(0);

  const loadSidebar = useCallback(async () => {
    try {
      const [sRes, hRes] = await Promise.all([
        api.ctc.getStats(),
        api.ctc.listSimulations(10),
      ]);
      if (sRes.data) setStats(sRes.data);
      if (hRes.data) setSimulations(hRes.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSidebar(); }, [loadSidebar]);

  async function runSimulation(save = false) {
    setBusy(true);
    try {
      const res = await api.ctc.simulate({
        ctc_annual: ctcAnnual,
        basic_percent: basicPercent / 100,
        is_metro: isMetro,
        pf_capped: pfCapped,
        include_esi: includeEsi,
        include_lta: includeLta,
        include_medical: includeMedical,
        include_nps: includeNps,
        nps_percent: npsPercent / 100,
        save,
        simulation_name: save ? `CTC ₹${(ctcAnnual / 100000).toFixed(1)}L` : undefined,
      });
      if (res.data) {
        setResult(res.data);
        if (save) {
          toast.success('Simulation saved');
          loadSidebar();
        }
      } else {
        toast.error(res.error || 'Simulation failed');
      }
    } catch { toast.error('Simulation failed'); }
    setBusy(false);
  }

  function loadFromHistory(sim: CtcSimulation) {
    setCtcAnnual(sim.ctc_annual);
    setIsMetro(sim.is_metro);
    setPfCapped(sim.pf_capped);
    setIncludeEsi(sim.include_esi);
    if (sim.breakdown) {
      setResult(sim.breakdown);
      setBasicPercent(Math.round((sim.breakdown.summary?.basic_percent || 0.5) * 100));
    }
    setTab('calculator');
  }

  const ctcLakhs = useMemo(() => (ctcAnnual / 100000).toFixed(1), [ctcAnnual]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Calculator className="h-7 w-7 text-cyan-400" />
            CTC Calculator
          </h1>
          <p className="text-sm text-slate-400 mt-1">India payroll simulation with Wage Code 2019 compliance validation</p>
        </div>
        <button onClick={loadSidebar} className="p-2 rounded-lg bg-slate-800/60 text-slate-300 hover:text-white border border-slate-700/50 transition-colors">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Active Structures', value: stats.active_structures, icon: Users, color: 'text-cyan-400' },
            { label: 'Total Annual CTC', value: formatINR(stats.total_annual_ctc), icon: IndianRupee, color: 'text-emerald-400' },
            { label: 'Avg CTC', value: formatINR(stats.avg_annual_ctc), icon: TrendingUp, color: 'text-amber-400' },
            { label: 'Saved Simulations', value: stats.saved_simulations, icon: Save, color: 'text-purple-400' },
          ].map(s => (
            <div key={s.label} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <s.icon className={cx('h-4 w-4', s.color)} />
                <span className="text-xs text-slate-400">{s.label}</span>
              </div>
              <div className={cx('text-lg font-bold', s.color)}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/40 rounded-xl p-1 w-fit">
        {([['calculator', 'Calculator', Calculator], ['history', 'Saved', Clock], ['structures', 'Structures', BarChart3]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id as any)}
            className={cx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              tab === id ? 'bg-slate-700/80 text-white' : 'text-slate-400 hover:text-slate-200')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* Calculator Tab */}
      {tab === 'calculator' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left — Inputs */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-cyan-400" /> Annual CTC
              </h3>

              {/* CTC input */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400">CTC (₹)</label>
                  <span className="text-xs text-cyan-400 font-medium">₹{ctcLakhs}L / year</span>
                </div>
                <input type="range" min={300000} max={10000000} step={50000} value={ctcAnnual}
                  onChange={e => setCtcAnnual(Number(e.target.value))}
                  className="w-full accent-cyan-500" />
                <input type="number" min={100000} max={100000000} value={ctcAnnual}
                  onChange={e => setCtcAnnual(Number(e.target.value) || 0)}
                  className="w-full mt-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50" />
              </div>

              {/* Basic % */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-400">Basic Pay %</label>
                  <span className={cx('text-xs font-medium', basicPercent < 50 ? 'text-rose-400' : 'text-emerald-400')}>{basicPercent}%</span>
                </div>
                <input type="range" min={40} max={80} step={1} value={basicPercent}
                  onChange={e => setBasicPercent(Number(e.target.value))}
                  className="w-full accent-cyan-500" />
                {basicPercent < 50 && (
                  <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Below 50% — non-compliant with Wage Code 2019
                  </p>
                )}
              </div>

              {/* Toggles */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white">Metro city</span>
                    <p className="text-xs text-slate-500">HRA at 50% vs 40% of basic</p>
                  </div>
                  <button onClick={() => setIsMetro(!isMetro)}
                    className={cx('w-10 h-5 rounded-full transition-colors relative',
                      isMetro ? 'bg-cyan-600' : 'bg-slate-600')}>
                    <span className={cx('block w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform',
                      isMetro ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white">PF capped at ₹15,000</span>
                    <p className="text-xs text-slate-500">Uncapped = PF on full basic</p>
                  </div>
                  <button onClick={() => setPfCapped(!pfCapped)}
                    className={cx('w-10 h-5 rounded-full transition-colors relative',
                      pfCapped ? 'bg-cyan-600' : 'bg-slate-600')}>
                    <span className={cx('block w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform',
                      pfCapped ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white">Include ESI</span>
                    <p className="text-xs text-slate-500">If gross ≤ ₹21,000/month</p>
                  </div>
                  <button onClick={() => setIncludeEsi(!includeEsi)}
                    className={cx('w-10 h-5 rounded-full transition-colors relative',
                      includeEsi ? 'bg-cyan-600' : 'bg-slate-600')}>
                    <span className={cx('block w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform',
                      includeEsi ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white">Include LTA</span>
                  </div>
                  <button onClick={() => setIncludeLta(!includeLta)}
                    className={cx('w-10 h-5 rounded-full transition-colors relative',
                      includeLta ? 'bg-cyan-600' : 'bg-slate-600')}>
                    <span className={cx('block w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform',
                      includeLta ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white">Include Medical</span>
                  </div>
                  <button onClick={() => setIncludeMedical(!includeMedical)}
                    className={cx('w-10 h-5 rounded-full transition-colors relative',
                      includeMedical ? 'bg-cyan-600' : 'bg-slate-600')}>
                    <span className={cx('block w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform',
                      includeMedical ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-white">Include NPS</span>
                    {includeNps && (
                      <div className="flex items-center gap-2 mt-1">
                        <input type="range" min={1} max={10} step={1} value={npsPercent || 4}
                          onChange={e => setNpsPercent(Number(e.target.value))}
                          className="w-24 accent-cyan-500" />
                        <span className="text-xs text-slate-400">{npsPercent || 4}%</span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setIncludeNps(!includeNps); if (!includeNps) setNpsPercent(4); }}
                    className={cx('w-10 h-5 rounded-full transition-colors relative shrink-0',
                      includeNps ? 'bg-cyan-600' : 'bg-slate-600')}>
                    <span className={cx('block w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform',
                      includeNps ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button onClick={() => runSimulation(false)} disabled={busy}
                  className="flex-1 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Calculate
                </button>
                <button onClick={() => runSimulation(true)} disabled={busy}
                  className="py-2.5 px-4 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 text-sm font-medium transition-colors flex items-center gap-2">
                  <Save className="h-4 w-4" /> Save
                </button>
              </div>
            </div>
          </div>

          {/* Right — Results */}
          <div className="lg:col-span-3 space-y-5">
            {!result && (
              <div className="text-center py-20 text-slate-500">
                <Calculator className="h-12 w-12 mx-auto mb-4 opacity-40" />
                <p>Adjust the parameters and click Calculate to see the CTC breakdown</p>
              </div>
            )}

            {result && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 text-center">
                    <div className="text-xs text-slate-400 mb-1">Annual CTC</div>
                    <div className="text-xl font-bold text-white">{formatINR(result.ctc_annual)}</div>
                    <div className="text-xs text-slate-500">{formatINR(result.ctc_monthly)}/mo</div>
                  </div>
                  <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 text-center">
                    <div className="text-xs text-slate-400 mb-1">Est. Take Home</div>
                    <div className="text-xl font-bold text-emerald-400">{formatINR(result.take_home_estimate.annual)}</div>
                    <div className="text-xs text-slate-500">{formatINR(result.take_home_estimate.monthly)}/mo</div>
                  </div>
                  <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 text-center">
                    <div className="text-xs text-slate-400 mb-1">Deductions</div>
                    <div className="text-xl font-bold text-amber-400">{formatINR(result.summary.total_deductions_annual)}</div>
                    <div className="text-xs text-slate-500">{formatINR(Math.round(result.summary.total_deductions_annual / 12))}/mo</div>
                  </div>
                </div>

                {/* Compliance warnings */}
                {result.compliance_warnings.length > 0 && (
                  <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-rose-400 mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" /> Compliance Warnings
                    </h3>
                    <ul className="space-y-1">
                      {result.compliance_warnings.map((w, i) => (
                        <li key={i} className="text-sm text-rose-300">{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.compliance_warnings.length === 0 && (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm text-emerald-300">Compliant with Wage Code 2019 — basic ≥ 50% of CTC</span>
                  </div>
                )}

                {/* Component breakdown table */}
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-700/50">
                    <h3 className="text-sm font-semibold text-white">Component Breakdown</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700/50 text-left text-xs text-slate-500 uppercase">
                          <th className="px-5 py-3">Component</th>
                          <th className="px-5 py-3 text-right">Monthly (₹)</th>
                          <th className="px-5 py-3 text-right">Annual (₹)</th>
                          <th className="px-5 py-3">Rule</th>
                          <th className="px-5 py-3 text-center">Taxable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.components.map(c => (
                          <tr key={c.component_type} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">{c.component_name}</span>
                                {c.is_statutory && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">Statutory</span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-3 text-right text-slate-300 font-mono">
                              {c.monthly_amount.toLocaleString('en-IN')}
                            </td>
                            <td className="px-5 py-3 text-right text-slate-300 font-mono">
                              {c.annual_amount.toLocaleString('en-IN')}
                            </td>
                            <td className="px-5 py-3 text-slate-500 text-xs">{c.calculation_rule}</td>
                            <td className="px-5 py-3 text-center">
                              {c.is_taxable
                                ? <span className="text-xs text-amber-400">Yes</span>
                                : <span className="text-xs text-emerald-400">No</span>
                              }
                            </td>
                          </tr>
                        ))}
                        {/* Total row */}
                        <tr className="bg-slate-800/40 font-semibold">
                          <td className="px-5 py-3 text-white">Total CTC</td>
                          <td className="px-5 py-3 text-right text-white font-mono">{result.ctc_monthly.toLocaleString('en-IN')}</td>
                          <td className="px-5 py-3 text-right text-white font-mono">{result.ctc_annual.toLocaleString('en-IN')}</td>
                          <td className="px-5 py-3" />
                          <td className="px-5 py-3" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div className="space-y-4">
          {simulations.length === 0 ? (
            <div className="text-center py-16 text-slate-500">No saved simulations yet</div>
          ) : (
            <div className="space-y-3">
              {simulations.map(sim => (
                <button key={sim.id} onClick={() => loadFromHistory(sim)}
                  className="w-full text-left bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 hover:border-cyan-500/30 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-white">{sim.simulation_name || 'Untitled'}</h3>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                        <span className="flex items-center gap-1">
                          <IndianRupee className="h-3 w-3" /> {formatINR(sim.ctc_annual)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {sim.location}
                        </span>
                        <span>{sim.pf_capped ? 'PF Capped' : 'PF Uncapped'}</span>
                        <span>{new Date(sim.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {sim.compliance_warnings?.length > 0 && (
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Structures Tab — placeholder for salary structures list */}
      {tab === 'structures' && (
        <div className="text-center py-16 text-slate-500">
          <Building2 className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p className="text-lg font-medium text-slate-400 mb-2">Salary Structures</p>
          <p className="text-sm">Employee salary structures are managed via the API. Use the CTC simulator to generate compliant breakdowns, then assign them to employees.</p>
        </div>
      )}
    </div>
  );
}
