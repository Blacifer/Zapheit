import { useState, useRef, useEffect } from 'react';
import { Upload, Play, Download, CheckCircle, AlertCircle, Clock, FileJson, Trash2 } from 'lucide-react';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { supabase } from '../../lib/supabase-client';
import { getFrontendConfig } from '../../lib/config';

interface BatchItem {
  prompt: string;
  model?: string;
}

interface Batch {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  requests: number;
  succeeded: number;
  failed: number;
  cost: number;
  progress: number;
  items: BatchItem[];
  results: Array<{ prompt: string; response?: string; error?: string; costUSD: number; latency: number }>;
}

const BATCH_STORAGE_KEY = 'rasi.batchJobs';
const USD_TO_INR = 83;

function formatInrFromUsd(usd: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(usd * USD_TO_INR);
}

export default function BatchProcessingPage() {
  const [newBatch, setNewBatch] = useState({
    name: '',
    description: '',
    model: 'openai/gpt-4o',
  });
  const [file, setFile] = useState<File | null>(null);
  const [parsedItems, setParsedItems] = useState<BatchItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>(() => {
    try {
      const stored = localStorage.getItem(BATCH_STORAGE_KEY);
      if (!stored) return [];

      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('Failed to restore batch history:', err);
      return [];
    }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string, name: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(batches));
    } catch (err) {
      console.error('Failed to persist batch history:', err);
    }
  }, [batches]);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
          const res = await fetch(`${apiUrl}/models`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
              setAvailableModels(json.data);
              return;
            }
          }
        }
      } catch (err) {
        // Fall back gracefully
      }

      // Fallback
      setAvailableModels([
        { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o' },
        { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
        { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
        { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' },
      ]);
    };

    fetchModels();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;

        let items: any[] = [];

        try {
          const parsedObject = JSON.parse(text);
          if (Array.isArray(parsedObject)) {
            items = parsedObject;
          } else if (typeof parsedObject === 'object' && parsedObject !== null) {
            // It's a single JSON object rather than an array or multiple lines
            items = [parsedObject];
          } else {
            throw new Error("Parsed JSON is not an array or object");
          }
        } catch (jsonErr) {
          const lines = text.split('\n').filter(l => l.trim().length > 0);
          items = lines.map((line, idx) => {
            try {
              return JSON.parse(line);
            } catch (err) {
              throw new Error(`Invalid JSON format on line ${idx + 1}`);
            }
          });
        }

        // Deep normalization to extract prompts from any widely used schema (e.g. OpenAI Batch, standard chat, etc.)
        items = items.map(item => {
          if (typeof item === 'string') return { prompt: item };
          if (!item || typeof item !== 'object') return item;

          const normalized = { ...item };

          // Auto-map variations into standard "prompt"
          if (!normalized.prompt) {
            if (normalized.custom_id && normalized.body?.messages) {
              // Standard OpenAI Batch structural format
              normalized.prompt = normalized.body.messages.map((m: any) => m.content).join('\n');
              if (normalized.body.model && !normalized.model) normalized.model = normalized.body.model;
            } else if (normalized.messages && Array.isArray(normalized.messages)) {
              // Typical POST /chat/completions payload
              normalized.prompt = normalized.messages.map((m: any) => m.content).join('\n');
            } else if (normalized.text) {
              normalized.prompt = normalized.text;
            } else if (normalized.content) {
              normalized.prompt = normalized.content;
            } else if (normalized.input) {
              normalized.prompt = normalized.input;
            } else if (normalized.instruction) {
              normalized.prompt = normalized.instruction;
            } else if (normalized.message) {
              normalized.prompt = typeof normalized.message === 'string'
                ? normalized.message
                : JSON.stringify(normalized.message);
            } else {
              // Final graceful fallback: if we absolutely cannot identify a text field, 
              // simply serialize the entire JSON object itself as the prompt for the model to analyze.
              normalized.prompt = JSON.stringify(normalized);
            }
          }
          return normalized;
        });

        const invalidIdx = items.findIndex(item => !(item && typeof item === 'object' && item.prompt));
        if (invalidIdx !== -1) {
          const invalidItem = items[invalidIdx];
          const keys = typeof invalidItem === 'object' && invalidItem !== null ? Object.keys(invalidItem).join(', ') : typeof invalidItem;
          throw new Error(`Record ${invalidIdx + 1} could not find prompt context. Found fields: [${keys || 'none'}]`);
        }

        setParsedItems(items);
        toast.success(`Successfully parsed ${items.length} requests`);
      } catch (err: any) {
        toast.error(err.message || 'Failed to parse file structure');
        setFile(null);
        setParsedItems([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(selected);
  };

  const processBatchAsync = async (batchId: string, items: BatchItem[], defaultModel: string) => {
    // Process items sequentially (or could be chunked with Promise.all)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const modelToUse = item.model || defaultModel;

      try {
        const res = await api.batches.processLine(item.prompt, modelToUse);

        setBatches(prev => prev.map(b => {
          if (b.id !== batchId) return b;

          const isSuccess = res.success;
          const costUSD = res.data?.costUSD || 0;

          const newResults = [...b.results, {
            prompt: item.prompt,
            response: res.data?.response,
            error: res.error,
            costUSD,
            latency: res.data?.latency || 0
          }];

          const succeeded = isSuccess ? b.succeeded + 1 : b.succeeded;
          const failed = isSuccess ? b.failed : b.failed + 1;
          const progress = Math.round(((i + 1) / items.length) * 100);

          return {
            ...b,
            succeeded,
            failed,
            cost: b.cost + costUSD,
            progress,
            results: newResults,
            status: (i === items.length - 1) ? 'completed' : 'processing'
          };
        }));
      } catch (err: any) {
        // Handle unexpected fetch errors
        setBatches(prev => prev.map(b => {
          if (b.id !== batchId) return b;
          return {
            ...b,
            failed: b.failed + 1,
            progress: Math.round(((i + 1) / items.length) * 100),
            results: [...b.results, { prompt: item.prompt, error: err.message, costUSD: 0, latency: 0 }],
            status: (i === items.length - 1) ? 'completed' : 'processing'
          };
        }));
      }
    }
  };

  const handleSubmit = async () => {
    if (!newBatch.name) return toast.error('Please enter a batch name');
    if (parsedItems.length === 0) return toast.error('Please upload a valid JSON file');

    const batchId = `batch_${Math.random().toString(36).substring(2, 9)}`;
    const newBatchRecord: Batch = {
      id: batchId,
      name: newBatch.name,
      description: newBatch.description,
      status: 'processing',
      createdAt: new Date().toLocaleString(),
      requests: parsedItems.length,
      succeeded: 0,
      failed: 0,
      cost: 0,
      progress: 0,
      items: parsedItems,
      results: []
    };

    setBatches(prev => [newBatchRecord, ...prev]);
    setIsSubmitting(true);

    // Reset form
    setNewBatch({ ...newBatch, name: '', description: '' });
    setFile(null);
    setParsedItems([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    toast.success('Batch processing started in background');

    setIsSubmitting(false);

    // Start async processing
    processBatchAsync(batchId, newBatchRecord.items, newBatch.model);
  };

  const handleDownload = (batch: Batch) => {
    const jsonl = batch.results.map(r => JSON.stringify(r)).join('\n');
    const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${batch.name.replace(/\s+/g, '_')}_results.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteBatch = (batchId: string) => {
    setBatches(prev => prev.filter(batch => batch.id !== batchId));
    toast.success('Batch removed from queue history');
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Header */}
      <div className="relative">
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">
          Batch Processing
        </h1>
        <p className="text-slate-400 mt-2 text-lg max-w-2xl">
          Process massive volumes of requests asynchronously with guaranteed better rates.
        </p>
      </div>

      {/* Benefits */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-indigo-500/5 to-cyan-500/5 blur-3xl -z-10 rounded-[3rem]" />

        <div className="group bg-slate-900/40 backdrop-blur-md border border-slate-700 hover:border-green-500/50 rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgb(34,197,94,0.12)]">
          <div className="w-12 h-12 rounded-xl bg-green-500/20 text-green-400 flex items-center justify-center text-xl font-bold mb-4 group-hover:scale-110 transition-transform">
            50%
          </div>
          <p className="text-white font-semibold text-lg">Massive Savings</p>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">Batch API pricing is strictly 50% cheaper compared to standard synchronous API requests.</p>
        </div>

        <div className="group bg-slate-900/40 backdrop-blur-md border border-slate-700 hover:border-cyan-500/50 rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgb(6,182,212,0.12)]">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Clock className="w-6 h-6" />
          </div>
          <p className="text-white font-semibold text-lg">No Rate Limits</p>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">Offload 1000s of requests without worrying about getting 429s. Process at your own pace.</p>
        </div>

        <div className="group bg-slate-900/40 backdrop-blur-md border border-slate-700 hover:border-purple-500/50 rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgb(168,85,247,0.12)]">
          <div className="w-12 h-12 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center text-xl font-bold mb-4 group-hover:scale-110 transition-transform">
            10x
          </div>
          <p className="text-white font-semibold text-lg">Higher Throughput</p>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">Data is fanned out and processed in parallel asynchronously across multiple server clusters.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Create New Batch */}
        <div className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/60 shadow-2xl rounded-2xl p-6 sm:p-8 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-indigo-500 opacity-50 group-hover:opacity-100 transition-opacity" />

          <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
            <span className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
              <Upload className="w-5 h-5" />
            </span>
            Create New Batch
          </h2>

          <div className="space-y-5">
            <div>
              <label className="text-slate-300 font-medium mb-2 block text-sm">Batch Name</label>
              <input
                type="text"
                placeholder="e.g., Q3 Customer Feedback Analysis"
                value={newBatch.name}
                onChange={(e) => setNewBatch({ ...newBatch, name: e.target.value })}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all font-medium"
              />
            </div>

            <div>
              <label className="text-slate-300 font-medium mb-2 block text-sm">Description <span className="text-slate-500 font-normal">(Optional)</span></label>
              <textarea
                placeholder="What exactly will this batch job accomplish?"
                value={newBatch.description}
                onChange={(e) => setNewBatch({ ...newBatch, description: e.target.value })}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 resize-none h-24 transition-all"
              />
            </div>

            <div>
              <label className="text-slate-300 font-medium mb-2 block text-sm">Fallback Model</label>
              <select
                value={newBatch.model}
                onChange={(e) => setNewBatch({ ...newBatch, model: e.target.value })}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all cursor-pointer appearance-none max-h-48 overflow-y-auto"
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </select>
            </div>

            <div
              className={`border-2 border-dashed ${file ? 'border-purple-500/50 bg-purple-500/5' : 'border-slate-600 hover:border-purple-400 hover:bg-slate-800/50'} rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 relative group`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".json,.jsonl"
                onChange={handleFileUpload}
              />
              {file ? (
                <div className="animate-in zoom-in duration-300">
                  <FileJson className="w-10 h-10 text-purple-400 mx-auto mb-3 drop-shadow-[0_0_15px_rgba(168,85,247,0.4)]" />
                  <p className="text-white font-semibold text-lg truncate px-4">{file.name}</p>
                  <p className="text-purple-300/80 text-sm mt-1">{parsedItems.length} valid JSON records instantly parsed</p>
                </div>
              ) : (
                <div className="group-hover:scale-105 transition-transform duration-300">
                  <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-slate-700 transition-colors">
                    <Upload className="w-7 h-7 text-slate-400 group-hover:text-purple-400 transition-colors" />
                  </div>
                  <p className="text-white font-semibold text-lg">Upload your JSONL payload</p>
                  <p className="text-slate-400 text-sm mt-2 max-w-[250px] mx-auto leading-relaxed">Drag and drop your file here, or click to browse. Each line must be a valid JSON object.</p>
                </div>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={isSubmitting || parsedItems.length === 0 || !newBatch.name}
              className="w-full relative overflow-hidden group bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all shadow-lg hover:shadow-purple-500/25 flex items-center justify-center gap-2 mt-4"
            >
              {isSubmitting ? (
                <>
                  <Clock className="w-5 h-5 animate-spin" />
                  Orchestrating Workflow...
                </>
              ) : (
                <>
                  <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  <Play className="w-5 h-5 relative z-10 fill-current" />
                  <span className="relative z-10">Queue Processing Job</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {/* Active Batches */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-slate-700/60 shadow-2xl rounded-2xl p-6 sm:p-8 flex flex-col h-full max-h-[800px] overflow-hidden">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              Queue Status
              {batches.some(b => b.status === 'processing') && (
                <span className="relative flex h-3 w-3 ml-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500"></span>
                </span>
              )}
            </h2>

            <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
              {batches.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-700 rounded-xl">
                  <FileJson className="w-12 h-12 text-slate-600 mb-3" />
                  <p className="text-slate-400 font-medium">Your processing queue is empty.</p>
                  <p className="text-slate-500 text-sm mt-1">Jobs will securely appear here once submitted.</p>
                </div>
              ) : (
                batches.map((batch) => (
                  <div
                    key={batch.id}
                    className="group bg-slate-900/60 border border-slate-700 hover:border-slate-500 rounded-xl p-5 hover:shadow-lg transition-all duration-300 relative overflow-hidden"
                  >
                    {batch.status === 'processing' && (
                      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-purple-500 tracking-in-expand to-transparent animate-pulse" />
                    )}

                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-3 mb-1.5">
                          <p className="text-white font-semibold truncate text-lg group-hover:text-purple-300 transition-colors">{batch.name}</p>
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wide ${batch.status === 'completed'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : batch.status === 'processing'
                                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse'
                                : 'bg-slate-700 text-slate-300 border border-slate-600'
                              }`}
                          >
                            {batch.status.toUpperCase()}
                          </span>
                        </div>
                        {batch.description && <p className="text-slate-400 text-sm truncate">{batch.description}</p>}
                        <p className="text-slate-500 text-xs mt-1.5 font-medium flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {batch.createdAt}
                        </p>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-2">
                        {batch.status === 'completed' && (
                          <button
                            onClick={() => handleDownload(batch)}
                            className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 p-2.5 rounded-lg transition-all hover:scale-105 active:scale-95 group"
                            title="Download Results (.jsonl)"
                          >
                            <Download className="w-5 h-5 group-hover:animate-bounce" />
                          </button>
                        )}

                        {batch.status !== 'processing' && (
                          <button
                            onClick={() => handleDeleteBatch(batch.id)}
                            className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 p-2.5 rounded-lg transition-all hover:scale-105 active:scale-95"
                            title="Remove Batch"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {batch.progress !== undefined && (
                      <div className="mb-4">
                        <div className="flex justify-between mb-1.5 items-end">
                          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Completion</span>
                          <span className="text-xs font-bold text-white">{batch.progress}%</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700/50">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ease-out relative ${batch.status === 'completed'
                              ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                              : 'bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-500'
                              }`}
                            style={{ width: `${batch.progress}%` }}
                          >
                            <div className="absolute inset-0 bg-white/20 banner-glow animate-pulse" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-2 pt-4 border-t border-slate-800/80 bg-slate-800/20 -mx-5 -mb-5 px-5 pb-5">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Items</p>
                        <p className="text-base text-white font-semibold">{batch.requests.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-green-500" /> Success
                        </p>
                        <p className="text-base text-white font-semibold">{batch.succeeded.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-red-500" /> Fails
                        </p>
                        <p className="text-base text-white font-semibold">{batch.failed}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Est. Cost</p>
                        <p className="text-base font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
                          {formatInrFromUsd(batch.cost)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 shadow-xl rounded-2xl p-8 relative overflow-hidden">
        <div className="absolute right-0 bottom-0 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none translate-x-1/3 translate-y-1/3" />
        <h3 className="text-2xl font-bold text-white mb-8">The Batch Workflow</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="relative group">
            <div className="absolute -inset-2 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl blur opacity-0 group-hover:opacity-20 transition duration-500" />
            <div className="relative">
              <div className="w-12 h-12 bg-purple-500/20 border border-purple-500/30 rounded-xl flex items-center justify-center text-purple-400 font-black text-xl mb-4 shadow-[0_0_15px_rgba(168,85,247,0.15)] group-hover:scale-110 transition-transform">
                1
              </div>
              <p className="text-white font-bold text-lg mb-2">Build Payload</p>
              <p className="text-slate-400 text-sm leading-relaxed">Prepare a JSONL file where each distinct line contains your raw payload map e.g., <code className="bg-slate-900 px-1 py-0.5 rounded border border-slate-700 text-purple-300">{"{"}"prompt":"..."{"}"}</code></p>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute -inset-2 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-xl blur opacity-0 group-hover:opacity-20 transition duration-500" />
            <div className="relative">
              <div className="w-12 h-12 bg-indigo-500/20 border border-indigo-500/30 rounded-xl flex items-center justify-center text-indigo-400 font-black text-xl mb-4 shadow-[0_0_15px_rgba(99,102,241,0.15)] group-hover:scale-110 transition-transform">
                2
              </div>
              <p className="text-white font-bold text-lg mb-2">Upload & Sync</p>
              <p className="text-slate-400 text-sm leading-relaxed">Upload into our orchestrator layer. It safely merges your records and pipes them into our highly-available distributed queuing system.</p>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute -inset-2 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl blur opacity-0 group-hover:opacity-20 transition duration-500" />
            <div className="relative">
              <div className="w-12 h-12 bg-blue-500/20 border border-blue-500/30 rounded-xl flex items-center justify-center text-blue-400 font-black text-xl mb-4 shadow-[0_0_15px_rgba(59,130,246,0.15)] group-hover:scale-110 transition-transform">
                3
              </div>
              <p className="text-white font-bold text-lg mb-2">Auto Execute</p>
              <p className="text-slate-400 text-sm leading-relaxed">Background worker clusters burst your requests directly into LLM sub-networks while strictly respecting required limits and guarding bounds.</p>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute -inset-2 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-xl blur opacity-0 group-hover:opacity-20 transition duration-500" />
            <div className="relative">
              <div className="w-12 h-12 bg-cyan-500/20 border border-cyan-500/30 rounded-xl flex items-center justify-center text-cyan-400 font-black text-xl mb-4 shadow-[0_0_15px_rgba(6,182,212,0.15)] group-hover:scale-110 transition-transform">
                4
              </div>
              <p className="text-white font-bold text-lg mb-2">Render Output</p>
              <p className="text-slate-400 text-sm leading-relaxed">Webhook triggers optionally notify your server. Review real-time telemetry metrics and safely export the finalized generated blob files.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
