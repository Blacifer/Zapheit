import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Brain,
  CheckCircle,
  Clock,
  Download,
  Eye,
  FileJson,
  Layers3,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { api } from '../../lib/api-client';
import { usdToInr } from '../../lib/currency';
import { useFineTuneJobs, type FineTuneJobRecord } from '../../hooks/useData';

interface TrainingRecord {
  prompt: string;
  completion: string;
}

interface ProviderEstimate {
  provider: string;
  modelId: string;
  estimatedCostInr: number;
  liveProviderSupported: boolean;
  source: 'curated' | 'custom';
}

interface DuplicateIssue {
  prompt: string;
  count: number;
}

interface ParsedDataset {
  fileName: string;
  records: TrainingRecord[];
  trainRecords: TrainingRecord[];
  validationRecords: TrainingRecord[];
  preview: TrainingRecord[];
  stats: {
    examples: number;
    avgPromptLength: number;
    avgCompletionLength: number;
    readinessScore: number;
    validationRatio: number;
    duplicateCount: number;
  };
  providerEstimate: ProviderEstimate;
  issues: string[];
  duplicateIssues: DuplicateIssue[];
}

interface FineTuneJob {
  id: string;
  name: string;
  baseModel: string;
  epochs: number;
  status: 'ready' | 'needs_attention' | 'provider_queued' | 'provider_running' | 'provider_succeeded' | 'provider_failed';
  createdAt: string;
  examples: number;
  estimatedCostInr: number;
  readinessScore: number;
  issues: string[];
  fileName: string;
  providerState: 'staged_local' | 'openai_submitted';
  providerJobId?: string;
  validationExamples: number;
  providerStatusText?: string;
  fineTunedModel?: string | null;
  trainedTokens?: number | null;
}

const DATASET_STORAGE_KEY = 'rasi.finetunePreparedDataset';
const BASE_MODELS = [
  // ── OpenAI (live fine-tuning supported) ──────────────────────────────────
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', tier: 'Best Value', inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, liveProviderSupported: true },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI', tier: 'Highest Quality', inputUsdPerMillion: 3.75, outputUsdPerMillion: 15, liveProviderSupported: true },
  { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'OpenAI', tier: 'Fast Iteration', inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6, liveProviderSupported: false },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI', tier: 'Reasoning Heavy', inputUsdPerMillion: 2, outputUsdPerMillion: 8, liveProviderSupported: false },
  // ── Anthropic (dataset prep + cost estimate; live submission coming soon) ─
  { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', tier: 'Strong Writing', inputUsdPerMillion: 3, outputUsdPerMillion: 15, liveProviderSupported: false },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic', tier: 'Low Latency', inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.25, liveProviderSupported: false },
  // ── Google (dataset prep + cost estimate; live submission coming soon) ────
  { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google', tier: 'Cost Efficient', inputUsdPerMillion: 0.35, outputUsdPerMillion: 0.7, liveProviderSupported: false },
  // ── Open Source (dataset prep + export only) ──────────────────────────────
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta', tier: 'Open Model', inputUsdPerMillion: 0.88, outputUsdPerMillion: 0.88, liveProviderSupported: false },
  { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'Mistral', tier: 'Enterprise Drafting', inputUsdPerMillion: 4, outputUsdPerMillion: 12, liveProviderSupported: false },
];

const EPOCH_OPTIONS = [
  { value: 1, label: 'Quick check', hint: 'Use this to validate whether the dataset shape is working.' },
  { value: 2, label: 'Balanced run', hint: 'Good default for a first pass.' },
  { value: 3, label: 'Thorough run', hint: 'Stronger fitting, slightly higher cost.' },
  { value: 5, label: 'Aggressive run', hint: 'Only use when the dataset is large and clean.' },
];

const SUPPORTED_LIVE_FINE_TUNE_MODELS = new Set([
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
]);

function formatInr(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatJobStatus(status: FineTuneJob['status']) {
  switch (status) {
    case 'provider_queued': return 'Provider queued';
    case 'provider_running': return 'Provider running';
    case 'provider_succeeded': return 'Provider succeeded';
    case 'provider_failed': return 'Provider failed';
    case 'needs_attention': return 'Needs attention';
    default: return 'Ready';
  }
}

function deriveModelMeta(modelId: string) {
  const curated = BASE_MODELS.find((entry) => entry.id === modelId);
  if (curated) {
    return { ...curated, source: 'curated' as const };
  }

  const provider = modelId.includes('/') ? modelId.split('/')[0] : 'custom';
  const normalizedProvider = provider.charAt(0).toUpperCase() + provider.slice(1);
  const fallbackPricing = provider === 'openai'
    ? { inputUsdPerMillion: 2, outputUsdPerMillion: 8 }
    : provider === 'anthropic'
      ? { inputUsdPerMillion: 3, outputUsdPerMillion: 15 }
      : provider === 'google'
        ? { inputUsdPerMillion: 0.35, outputUsdPerMillion: 0.7 }
        : { inputUsdPerMillion: 1.5, outputUsdPerMillion: 3 };

  return {
    id: modelId,
    name: modelId,
    provider: normalizedProvider,
    tier: 'Custom override',
    ...fallbackPricing,
    liveProviderSupported: SUPPORTED_LIVE_FINE_TUNE_MODELS.has(modelId),
    source: 'custom' as const,
  };
}

function normalizeContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const part = item as Record<string, unknown>;
          if (typeof part.text === 'string') return part.text.trim();
          if (typeof part.content === 'string') return part.content.trim();
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text.trim();
    if (typeof record.content === 'string') return record.content.trim();
  }
  return '';
}

function normalizeTrainingRecord(parsed: any): TrainingRecord | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const directPrompt = normalizeContent(parsed.prompt);
  const directCompletion = normalizeContent(parsed.completion);
  if (directPrompt && directCompletion) {
    return { prompt: directPrompt, completion: directCompletion };
  }

  const inputOutputPrompt = normalizeContent(parsed.input);
  const inputOutputCompletion = normalizeContent(parsed.output);
  if (inputOutputPrompt && inputOutputCompletion) {
    return { prompt: inputOutputPrompt, completion: inputOutputCompletion };
  }

  const qaPrompt = normalizeContent(parsed.question || parsed.instruction);
  const qaCompletion = normalizeContent(parsed.answer || parsed.response);
  if (qaPrompt && qaCompletion) {
    return { prompt: qaPrompt, completion: qaCompletion };
  }

  const resultPrompt = normalizeContent(parsed.prompt);
  const resultCompletion = normalizeContent(parsed.response || parsed.result || parsed.output_text || parsed.generated_text);
  if (resultPrompt && resultCompletion) {
    return { prompt: resultPrompt, completion: resultCompletion };
  }

  if (parsed.body?.messages && Array.isArray(parsed.body.messages)) {
    parsed = { ...parsed, messages: parsed.body.messages };
  }

  if (Array.isArray(parsed.messages)) {
    const systemMessages = parsed.messages
      .filter((message: any) => message?.role === 'system')
      .map((message: any) => normalizeContent(message?.content))
      .filter(Boolean);
    const userMessages = parsed.messages
      .filter((message: any) => message?.role === 'user')
      .map((message: any) => normalizeContent(message?.content))
      .filter(Boolean);
    const assistantMessages = parsed.messages
      .filter((message: any) => message?.role === 'assistant')
      .map((message: any) => normalizeContent(message?.content))
      .filter(Boolean);
    const prompt = [...systemMessages, ...userMessages].join('\n').trim();
    const completion = assistantMessages.join('\n').trim();
    if (prompt && completion) {
      return { prompt, completion };
    }
  }

  return null;
}

function estimateProviderCostInr(records: TrainingRecord[], baseModel: string, epochs: number): ProviderEstimate {
  const model = deriveModelMeta(baseModel);
  const promptTokens = records.reduce((sum, record) => sum + Math.ceil(record.prompt.length / 4), 0);
  const completionTokens = records.reduce((sum, record) => sum + Math.ceil(record.completion.length / 4), 0);
  const usd = ((promptTokens * model.inputUsdPerMillion) + (completionTokens * model.outputUsdPerMillion)) / 1_000_000 * epochs;

  return {
    provider: model.provider,
    modelId: model.id,
    estimatedCostInr: Math.max(50, Math.round(usdToInr(usd))),
    liveProviderSupported: model.liveProviderSupported,
    source: model.source,
  };
}

function parseTrainingFile(text: string, fileName: string, baseModel: string, epochs: number): ParsedDataset {
  const rawLines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (rawLines.length === 0) {
    throw new Error('Training file is empty');
  }

  const records = rawLines.map((line, index) => {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on line ${index + 1}`);
    }

    const normalized = normalizeTrainingRecord(parsed);
    if (!normalized || !normalized.prompt || !normalized.completion) {
      if (typeof parsed.prompt === 'string' && typeof parsed.error === 'string') {
        throw new Error(`Line ${index + 1} is a failed result row with prompt + error only. Fine-tuning needs a usable target output like completion or response.`);
      }
      throw new Error(`Line ${index + 1} must include prompt/completion, input/output, question/answer, response text, or chat-format messages`);
    }

    return normalized;
  });

  const promptChars = records.reduce((sum, record) => sum + record.prompt.length, 0);
  const completionChars = records.reduce((sum, record) => sum + record.completion.length, 0);
  const avgPromptLength = Math.round(promptChars / records.length);
  const avgCompletionLength = Math.round(completionChars / records.length);

  const duplicateMap = new Map<string, number>();
  records.forEach((record) => {
    const key = record.prompt.toLowerCase().trim();
    duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
  });
  const duplicateIssues = [...duplicateMap.entries()]
    .filter(([, count]) => count > 1)
    .slice(0, 5)
    .map(([prompt, count]) => ({ prompt, count }));

  const validationCount = records.length >= 50 ? Math.max(10, Math.round(records.length * 0.1)) : 0;
  const validationRecords = validationCount > 0 ? records.slice(-validationCount) : [];
  const trainRecords = validationCount > 0 ? records.slice(0, records.length - validationCount) : records;

  const issues: string[] = [];
  if (records.length < 25) issues.push('Dataset is too small for a meaningful domain adaptation pass.');
  if (records.length < 100) issues.push('Fewer than 100 examples will limit generalization quality.');
  if (avgCompletionLength < 40) issues.push('Completions look short; training signal may be too weak.');
  if (avgPromptLength > 3000) issues.push('Average prompt length is high; training cost will rise quickly.');
  if (validationCount === 0) issues.push('Validation split not created yet. Add at least 50 examples for a basic holdout set.');
  if (duplicateIssues.length > 0) issues.push(`Detected ${duplicateIssues.length} duplicate prompt patterns. Deduplicate before serious training.`);

  const providerEstimate = estimateProviderCostInr(records, baseModel, epochs);
  const readinessScore = Math.max(
    0,
    Math.min(
      100,
      100 - (issues.length * 12) + (records.length >= 100 ? 10 : 0) + (records.length >= 250 ? 10 : 0)
    )
  );

  return {
    fileName,
    records,
    trainRecords,
    validationRecords,
    preview: records.slice(0, 3),
    stats: {
      examples: records.length,
      avgPromptLength,
      avgCompletionLength,
      readinessScore,
      validationRatio: validationCount > 0 ? Math.round((validationCount / records.length) * 100) : 0,
      duplicateCount: duplicateIssues.length,
    },
    providerEstimate,
    issues,
    duplicateIssues,
  };
}

function parseBatchResultsFile(text: string, fileName: string, baseModel: string, epochs: number) {
  const rawLines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (rawLines.length === 0) {
    throw new Error('Batch results file is empty');
  }

  const extracted: TrainingRecord[] = [];
  let skippedErrors = 0;
  let skippedEmpty = 0;

  rawLines.forEach((line, index) => {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on line ${index + 1}`);
    }

    const prompt = normalizeContent(parsed.prompt);
    const completion = normalizeContent(parsed.response || parsed.result || parsed.output_text || parsed.generated_text);

    if (prompt && completion) {
      extracted.push({ prompt, completion });
      return;
    }

    if (prompt && typeof parsed.error === 'string') {
      skippedErrors += 1;
      return;
    }

    skippedEmpty += 1;
  });

  if (extracted.length === 0) {
    throw new Error('No successful prompt-response rows found. This results file only contains failures or unsupported rows.');
  }

  const parsedDataset = parseTrainingFile(
    extracted.map(record => JSON.stringify(record)).join('\n'),
    fileName,
    baseModel,
    epochs,
  );

  return {
    dataset: parsedDataset,
    extractedCount: extracted.length,
    skippedErrors,
    skippedEmpty,
  };
}

function downloadJsonl(fileName: string, records: TrainingRecord[]) {
  const payload = records.map((record) => JSON.stringify(record)).join('\n');
  const blob = new Blob([payload], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function downloadSampleTemplate() {
  downloadJsonl('fine_tune_template.jsonl', [
    {
      prompt: 'Customer asks for refund status on order #4821.',
      completion: 'Confirm the order ID, verify payment capture, explain the refund timeline, and offer to share the tracking reference if needed.',
    },
    {
      prompt: 'Lead asks for pricing on the enterprise plan with 120 employees.',
      completion: 'Acknowledge the headcount, ask about required integrations, and respond with the enterprise pricing path plus a sales follow-up CTA.',
    },
    {
      prompt: 'Employee requests leave balance and policy for casual leave.',
      completion: 'Check the leave balance, explain the casual leave rule clearly, and mention escalation to HR only if the balance looks inconsistent.',
    },
  ]);
}

function recordToJob(r: FineTuneJobRecord): FineTuneJob {
  return {
    id: r.id,
    name: r.name,
    baseModel: r.base_model,
    epochs: r.epochs,
    status: r.status as FineTuneJob['status'],
    createdAt: new Date(r.created_at).toLocaleString('en-IN'),
    examples: r.examples,
    estimatedCostInr: Number(r.estimated_cost_inr),
    readinessScore: r.readiness_score,
    issues: r.issues,
    fileName: r.file_name,
    providerState: r.provider_state,
    validationExamples: r.validation_examples,
    providerJobId: r.provider_job_id ?? undefined,
    providerStatusText: r.provider_status_text ?? undefined,
    fineTunedModel: r.fine_tuned_model,
    trainedTokens: r.trained_tokens,
  };
}

export default function ModelFineTuningPage() {
  const [newFineTune, setNewFineTune] = useState({
    name: '',
    modelMode: 'curated' as 'curated' | 'custom',
    baseModel: 'openai/gpt-4o-mini',
    customModel: '',
    epochs: 2,
  });
  const [dataset, setDataset] = useState<ParsedDataset | null>(() => {
    try {
      const stored = localStorage.getItem(DATASET_STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  });
  const { jobs: jobRecords, createStagedJob, deleteJob, markJobSubmitted, refetch } = useFineTuneJobs();
  const jobs = useMemo(() => jobRecords.map(recordToJob), [jobRecords]);

  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchResultsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dataset) {
      localStorage.removeItem(DATASET_STORAGE_KEY);
      return;
    }
    localStorage.setItem(DATASET_STORAGE_KEY, JSON.stringify(dataset));
  }, [dataset]);

  // Stable key over the set of in-flight provider job IDs — avoids resetting the interval on every refetch
  const queuedJobsKey = useMemo(
    () =>
      jobs
        .filter(j => j.providerState === 'openai_submitted' && j.providerJobId && !['provider_succeeded', 'provider_failed'].includes(j.status))
        .map(j => j.providerJobId!)
        .sort()
        .join(','),
    [jobs],
  );

  useEffect(() => {
    if (!queuedJobsKey) return;
    const providerJobIds = queuedJobsKey.split(',');

    const interval = window.setInterval(async () => {
      // Fetching each job's status causes the backend to sync the DB row;
      // then we refetch to pick up the updated state from DB.
      await Promise.allSettled(providerJobIds.map(id => api.fineTunes.getOpenAIJobStatus(id)));
      void refetch();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [queuedJobsKey, refetch]);

  const summary = useMemo(() => {
    const readyJobs = jobs.filter(job => ['ready', 'provider_queued', 'provider_running', 'provider_succeeded'].includes(job.status)).length;
    const needsAttention = jobs.filter(job => ['needs_attention', 'provider_failed'].includes(job.status)).length;
    const avgScore = jobs.length === 0 ? 0 : Math.round(jobs.reduce((sum, job) => sum + job.readinessScore, 0) / jobs.length);
    return { readyJobs, needsAttention, avgScore };
  }, [jobs]);

  const effectiveModelId = newFineTune.modelMode === 'custom' && newFineTune.customModel.trim()
    ? newFineTune.customModel.trim()
    : newFineTune.baseModel;
  const selectedModel = deriveModelMeta(effectiveModelId);
  const selectedEpoch = EPOCH_OPTIONS.find(option => option.value === newFineTune.epochs) || EPOCH_OPTIONS[1];

  const reparseExistingDataset = (nextBaseModel: string, nextEpochs: number) => {
    if (!dataset) return;
    const refreshed = parseTrainingFile(
      dataset.records.map(record => JSON.stringify(record)).join('\n'),
      dataset.fileName,
      nextBaseModel,
      nextEpochs,
    );
    setDataset(refreshed);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setIsParsing(true);
    const reader = new FileReader();
    reader.onload = readEvent => {
      try {
        const text = String(readEvent.target?.result || '');
        const parsed = parseTrainingFile(text, selectedFile.name, effectiveModelId, newFineTune.epochs);
        setDataset(parsed);
        toast.success(`Validated ${parsed.stats.examples} training examples`);
      } catch (error: any) {
        setDataset(null);
        toast.error(error.message || 'Unable to parse training file');
      } finally {
        setIsParsing(false);
      }
    };
    reader.onerror = () => {
      setDataset(null);
      setIsParsing(false);
      toast.error('Unable to read training file');
    };
    reader.readAsText(selectedFile);
  };

  const handleBatchResultsImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setIsParsing(true);
    const reader = new FileReader();
    reader.onload = readEvent => {
      try {
        const text = String(readEvent.target?.result || '');
        const result = parseBatchResultsFile(text, selectedFile.name, effectiveModelId, newFineTune.epochs);
        setDataset(result.dataset);
        toast.success(
          `Imported ${result.extractedCount} successful rows` +
          (result.skippedErrors > 0 ? `, skipped ${result.skippedErrors} failed rows` : '')
        );
      } catch (error: any) {
        setDataset(null);
        toast.error(error.message || 'Unable to import batch results');
      } finally {
        setIsParsing(false);
      }
    };
    reader.onerror = () => {
      setDataset(null);
      setIsParsing(false);
      toast.error('Unable to read batch results file');
    };
    reader.readAsText(selectedFile);
  };

  const resetPreparedState = () => {
    setNewFineTune(prev => ({ ...prev, name: '', modelMode: 'curated', customModel: '' }));
    setDataset(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (batchResultsInputRef.current) batchResultsInputRef.current.value = '';
  };

  const handleCreateJob = async () => {
    if (!newFineTune.name.trim()) {
      toast.error('Enter a fine-tune name');
      return;
    }
    if (!dataset) {
      toast.error('Upload and validate a JSONL dataset first');
      return;
    }

    setIsSubmitting(true);

    const stagedJobData = {
      name: newFineTune.name.trim(),
      baseModel: effectiveModelId,
      epochs: newFineTune.epochs,
      fileName: dataset.fileName,
      examples: dataset.stats.examples,
      validationExamples: dataset.validationRecords.length,
      estimatedCostInr: dataset.providerEstimate.estimatedCostInr,
      readinessScore: dataset.stats.readinessScore,
      issues: dataset.issues,
      status: dataset.issues.length === 0 ? 'ready' : 'needs_attention',
    };

    try {
      if (dataset.providerEstimate.liveProviderSupported && dataset.issues.length === 0 && effectiveModelId.startsWith('openai/')) {
        // Stage the job first so we have an ID to link back to after OpenAI submission
        let stagedId: string | undefined;
        try {
          const stageRes = await createStagedJob.mutateAsync(stagedJobData);
          stagedId = stageRes.data?.id;
        } catch {
          // Non-fatal — we still try to submit to OpenAI even if DB staging failed
        }

        const response = await api.fineTunes.createOpenAIJob({
          name: newFineTune.name.trim(),
          baseModel: effectiveModelId,
          epochs: newFineTune.epochs,
          trainingRecords: dataset.trainRecords,
          validationRecords: dataset.validationRecords,
          stagedJobId: stagedId,
        });

        if (!response.success || !response.data) {
          toast.error(response.error || 'OpenAI fine-tune creation failed');
          // If staging succeeded, it's already in DB as 'ready'; otherwise create it now as a fallback
          if (!stagedId) await createStagedJob.mutateAsync(stagedJobData).catch(() => null);
        } else {
          const createdJob = response.data;
          if (stagedId) markJobSubmitted(stagedId, createdJob.id);
          toast.success('OpenAI fine-tune job created and queued');
        }
      } else {
        await createStagedJob.mutateAsync(stagedJobData);
        toast.success(
          dataset.providerEstimate.liveProviderSupported
            ? 'Job staged with warnings. Fix dataset issues before provider training.'
            : 'Job staged locally. Live provider fine-tuning is not wired for this model yet.'
        );
      }

      resetPreparedState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteJob = (jobId: string) => {
    deleteJob.mutate(jobId);
    toast.success('Fine-tune job removed');
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="relative overflow-hidden rounded-3xl border border-slate-700/70 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.16),_transparent_24%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,8,23,0.95))] p-8">
        <div className="absolute inset-0 opacity-40 pointer-events-none bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.04)_35%,transparent_70%)]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-extrabold text-white">Model Fine-tuning Studio</h1>
            <p className="text-slate-300 mt-3 text-lg leading-relaxed">
              Validate your dataset, inspect samples, split train and validation cleanly, and submit directly to OpenAI when the dataset is ready. Anthropic and Google fine-tuning — prepare your dataset now, submit when provider APIs go live.
            </p>
            <p className="text-slate-500 mt-2 text-sm">
              Jobs are saved to your account. Export your JSONL files to preserve training data across devices.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-full xl:min-w-[560px]">
            <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4">
              <p className="text-green-400 text-sm uppercase tracking-wider">Ready Or Queued</p>
              <p className="text-white text-3xl font-bold mt-2">{summary.readyJobs}</p>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
              <p className="text-amber-400 text-sm uppercase tracking-wider">Needs Attention</p>
              <p className="text-white text-3xl font-bold mt-2">{summary.needsAttention}</p>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
              <p className="text-cyan-400 text-sm uppercase tracking-wider">Average Readiness</p>
              <p className="text-white text-3xl font-bold mt-2">{summary.avgScore}%</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-6">
          <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-400" />
            Prepare Fine-tune Job
          </h2>

          <div className="space-y-5">
            <div>
              <label className="text-white font-medium mb-2 block">Fine-tune Name</label>
              <input
                type="text"
                placeholder="e.g., Customer Support Specialist"
                value={newFineTune.name}
                onChange={(e) => setNewFineTune({ ...newFineTune, name: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-white font-medium">Base Model</label>
                <span className="text-xs text-slate-400">Curated shortlist for fine-tuning</span>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-slate-900/50 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setNewFineTune((prev) => ({ ...prev, modelMode: 'curated' }));
                    reparseExistingDataset(newFineTune.baseModel, newFineTune.epochs);
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${newFineTune.modelMode === 'curated' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-white'}`}
                >
                  Recommended
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewFineTune((prev) => ({ ...prev, modelMode: 'custom' }));
                    if (newFineTune.customModel.trim()) {
                      reparseExistingDataset(newFineTune.customModel.trim(), newFineTune.epochs);
                    }
                  }}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${newFineTune.modelMode === 'custom' ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'text-slate-400 hover:text-white'}`}
                >
                  Use another model
                </button>
              </div>
              {newFineTune.modelMode === 'curated' ? (
              <select
                value={newFineTune.baseModel}
                onChange={(e) => {
                  const next = e.target.value;
                  setNewFineTune({ ...newFineTune, baseModel: next });
                  reparseExistingDataset(next, newFineTune.epochs);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500"
              >
                {BASE_MODELS.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} • {model.provider} • {model.tier}{model.liveProviderSupported ? ' ✓ Live' : ' — Coming Soon'}
                  </option>
                ))}
              </select>
              ) : (
                <input
                  type="text"
                  value={newFineTune.customModel}
                  onChange={(e) => {
                    const next = e.target.value;
                    setNewFineTune({ ...newFineTune, customModel: next });
                    if (dataset && next.trim()) {
                      reparseExistingDataset(next.trim(), newFineTune.epochs);
                    }
                  }}
                  placeholder="e.g., openai/gpt-4.1-mini or provider/model-id"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-fuchsia-500"
                />
              )}
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-white font-medium">{selectedModel.name}</p>
                    <p className="text-slate-400 text-sm mt-1">{selectedModel.provider} • {selectedModel.tier}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 justify-end">
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${selectedModel.source === 'curated' ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/20' : 'bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/20'}`}>
                      {selectedModel.source === 'curated' ? 'Recommended' : 'Custom'}
                    </span>
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${selectedModel.liveProviderSupported ? 'bg-green-500/15 text-green-300 border border-green-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'}`}>
                      {selectedModel.liveProviderSupported ? 'Live submission ready' : 'Dataset prep only — coming soon'}
                    </span>
                  </div>
                </div>
                <p className="text-slate-500 text-xs mt-3">
                  {selectedModel.liveProviderSupported
                    ? 'Your dataset will be validated and submitted directly to OpenAI when you create the job.'
                    : selectedModel.provider === 'OpenAI'
                      ? 'This OpenAI model does not yet have a fine-tuning API endpoint. Stage the job now — live submission will be enabled once available.'
                      : `${selectedModel.provider} fine-tuning API is not yet publicly available. Prepare and validate your dataset now so you can submit the moment it launches.`}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-white font-medium">Training Intensity</label>
              <select
                value={newFineTune.epochs}
                onChange={(e) => {
                  const nextEpochs = Number(e.target.value);
                  setNewFineTune({ ...newFineTune, epochs: nextEpochs });
                  reparseExistingDataset(newFineTune.baseModel, nextEpochs);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500"
              >
                {EPOCH_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label} • {option.hint}</option>
                ))}
              </select>
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                <p className="text-white font-medium">{selectedEpoch.label}</p>
                <p className="text-slate-400 text-sm mt-1">{selectedEpoch.hint}</p>
              </div>
            </div>

            <div
              className="border-2 border-dashed border-slate-600 rounded-2xl p-8 text-center hover:border-slate-500 cursor-pointer transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".jsonl,.json"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              <p className="text-white font-semibold text-lg">Upload training dataset</p>
              <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
                Supports `prompt`/`completion`, `prompt`/`response`, `input`/`output`, `question`/`answer`, or chat-format `messages` JSONL.
              </p>
              {isParsing && <p className="text-cyan-400 text-sm mt-3 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Validating dataset...</p>}
              {dataset && <p className="text-green-400 text-sm mt-3">{dataset.fileName} validated</p>}
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-white font-medium">Import from batch results</p>
                  <p className="text-slate-400 text-sm mt-1">
                    Converts successful `prompt + response` rows into fine-tuning data and skips failed rows automatically.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    ref={batchResultsInputRef}
                    type="file"
                    accept=".jsonl,.json"
                    className="hidden"
                    onChange={handleBatchResultsImport}
                  />
                  <button
                    type="button"
                    onClick={() => batchResultsInputRef.current?.click()}
                    className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-cyan-200 hover:bg-cyan-500/20 transition-colors"
                  >
                    Import batch results
                  </button>
                  <button
                    type="button"
                    onClick={downloadSampleTemplate}
                    className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-2 text-white hover:border-slate-500 transition-colors"
                  >
                    Download sample template
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={handleCreateJob}
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-fuchsia-500 to-violet-500 hover:from-fuchsia-400 hover:to-violet-400 disabled:from-slate-700 disabled:to-slate-700 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Brain className="w-4 h-4" />
              {isSubmitting ? 'Submitting...' : dataset?.providerEstimate.liveProviderSupported && dataset.issues.length === 0 && newFineTune.baseModel.startsWith('openai/')
                ? 'Create OpenAI Fine-tune'
                : 'Stage Fine-tune Job'}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-6">
            <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              Dataset Readiness
            </h2>

            {!dataset ? (
              <div className="min-h-[260px] border border-dashed border-slate-700 rounded-2xl flex flex-col items-center justify-center text-center px-6">
                <FileJson className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-slate-300 font-medium">No dataset validated yet</p>
                <p className="text-slate-500 text-sm mt-2 max-w-sm">Upload a JSONL file to inspect sample records, deduplication warnings, split quality, and provider-specific cost.</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Examples</p>
                    <p className="text-white text-2xl font-bold mt-1">{dataset.stats.examples}</p>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Est. Cost</p>
                    <p className="text-cyan-400 text-2xl font-bold mt-1">{formatInr(dataset.providerEstimate.estimatedCostInr)}</p>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Validation</p>
                    <p className="text-white text-2xl font-bold mt-1">{dataset.validationRecords.length}</p>
                    <p className="text-slate-500 text-xs mt-1">{dataset.stats.validationRatio}% holdout</p>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Duplicates</p>
                    <p className="text-white text-2xl font-bold mt-1">{dataset.stats.duplicateCount}</p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-slate-300 font-medium">Readiness score</p>
                    <p className="text-sm text-slate-400">{dataset.stats.readinessScore}%</p>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                    <div className={`h-full rounded-full ${dataset.stats.readinessScore >= 80 ? 'bg-green-500' : dataset.stats.readinessScore >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${dataset.stats.readinessScore}%` }} />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white font-medium">Provider path</p>
                    <p className="text-slate-300 text-sm mt-1">
                      {dataset.providerEstimate.liveProviderSupported
                        ? `This model can submit a real ${dataset.providerEstimate.provider} fine-tune job.`
                        : `${dataset.providerEstimate.provider} fine-tuning is not wired yet, so this job will stay local.`}
                    </p>
                  </div>
                  <Layers3 className="w-5 h-5 text-slate-500 mt-1" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => downloadJsonl(`${dataset.fileName.replace(/\.(jsonl|json)$/i, '')}_train.jsonl`, dataset.trainRecords)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-white hover:border-slate-500 transition-colors"
                  >
                    <Download className="w-4 h-4" /> Export train split
                  </button>
                  <button
                    onClick={() => downloadJsonl(`${dataset.fileName.replace(/\.(jsonl|json)$/i, '')}_validation.jsonl`, dataset.validationRecords)}
                    disabled={dataset.validationRecords.length === 0}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-white hover:border-slate-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" /> Export validation split
                  </button>
                </div>

                <div className="space-y-2">
                  {dataset.issues.length === 0 ? (
                    <div className="flex items-start gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-4">
                      <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
                      <div>
                        <p className="text-white font-medium">Dataset looks healthy</p>
                        <p className="text-slate-300 text-sm mt-1">Structure, split size, and dataset volume are strong enough for a first supervised fine-tune run.</p>
                      </div>
                    </div>
                  ) : (
                    dataset.issues.map(issue => (
                      <div key={issue} className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                        <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5" />
                        <p className="text-slate-200 text-sm">{issue}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-6">
            <h2 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
              <Eye className="w-5 h-5 text-green-400" />
              Sample Preview
            </h2>
            {!dataset ? (
              <p className="text-slate-500 text-sm">Upload a dataset to inspect example prompt/completion pairs before training.</p>
            ) : (
              <div className="space-y-3">
                {dataset.preview.map((record, index) => (
                  <div key={`${record.prompt}-${index}`} className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
                    <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Sample {index + 1}</p>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-lg bg-slate-950/60 p-3">
                        <p className="text-xs text-cyan-400 mb-1">Prompt</p>
                        <p className="text-sm text-slate-200 whitespace-pre-wrap">{record.prompt}</p>
                      </div>
                      <div className="rounded-lg bg-slate-950/60 p-3">
                        <p className="text-xs text-green-400 mb-1">Completion</p>
                        <p className="text-sm text-slate-200 whitespace-pre-wrap">{record.completion}</p>
                      </div>
                    </div>
                  </div>
                ))}
                {dataset.duplicateIssues.length > 0 && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
                    <p className="text-amber-300 font-medium text-sm mb-2">Duplicate prompt patterns detected</p>
                    <div className="space-y-2">
                      {dataset.duplicateIssues.map(issue => (
                        <div key={`${issue.prompt}-${issue.count}`} className="text-xs text-slate-200">
                          <span className="text-amber-300">{issue.count}x</span> {issue.prompt.slice(0, 90)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-xl font-bold text-white">Your Fine-tune Jobs</h2>
          <p className="text-sm text-slate-400">OpenAI jobs auto-refresh every 15 seconds</p>
        </div>

        {jobs.length === 0 ? (
          <div className="border border-dashed border-slate-700 rounded-2xl p-10 text-center">
            <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-medium">No fine-tune jobs staged yet</p>
            <p className="text-slate-500 text-sm mt-2">Validate a dataset and create a provider job or local staged job. It will survive refresh on this browser.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map(job => (
              <div key={job.id} className="rounded-2xl border border-slate-700 bg-slate-900/50 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-white font-semibold text-lg">{job.name}</p>
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${job.status === 'provider_succeeded' ? 'bg-green-500/20 text-green-300' : job.status === 'provider_running' ? 'bg-blue-500/20 text-blue-300' : job.status === 'provider_queued' ? 'bg-cyan-500/20 text-cyan-300' : job.status === 'provider_failed' || job.status === 'needs_attention' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'}`}>
                        {formatJobStatus(job.status)}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm">{job.baseModel} • {job.epochs} intensity • {job.fileName}</p>
                    <p className="text-slate-500 text-xs mt-1">Saved {job.createdAt}</p>
                    {job.providerJobId && <p className="text-cyan-400 text-xs mt-2">OpenAI Job ID: {job.providerJobId}</p>}
                    {job.fineTunedModel && <p className="text-green-400 text-xs mt-1">Fine-tuned model: {job.fineTunedModel}</p>}
                  </div>

                  <button
                    onClick={() => handleDeleteJob(job.id)}
                    className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 p-2 rounded-lg transition-colors"
                    title="Remove job"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4 pt-4 border-t border-slate-700">
                  <div>
                    <p className="text-xs text-slate-400">Examples</p>
                    <p className="text-sm text-white font-medium">{job.examples}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Validation</p>
                    <p className="text-sm text-white font-medium">{job.validationExamples}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Readiness</p>
                    <p className="text-sm text-cyan-400 font-medium">{job.readinessScore}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Est. Cost</p>
                    <p className="text-sm text-white font-medium">{formatInr(job.estimatedCostInr)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Provider State</p>
                    <p className="text-sm text-slate-300 font-medium">{job.providerState === 'openai_submitted' ? 'OpenAI submitted' : 'Local staged'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Status Detail</p>
                    <p className="text-sm text-slate-300 font-medium">{job.providerStatusText || 'Not submitted'}</p>
                  </div>
                </div>

                {(job.trainedTokens || job.issues.length > 0) && (
                  <div className="mt-4 space-y-2">
                    {job.trainedTokens ? (
                      <div className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-md px-3 py-2">
                        Trained tokens: {job.trainedTokens.toLocaleString('en-IN')}
                      </div>
                    ) : null}
                    {job.issues.map(issue => (
                      <div key={issue} className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                        {issue}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-2xl p-6">
          <h3 className="text-white font-bold mb-3">Best Fit</h3>
          <ul className="space-y-2 text-sm text-slate-300">
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-purple-300" /> Domain-specific terminology</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-purple-300" /> Style and tone matching</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-purple-300" /> Structured output normalization</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-purple-300" /> Repetitive workflows with stable examples</li>
          </ul>
        </div>

        <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-2xl p-6">
          <h3 className="text-white font-bold mb-3">Data Requirements</h3>
          <ul className="space-y-2 text-sm text-slate-300">
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-green-300" /> 100+ high-quality examples for strong results</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-green-300" /> Clean JSONL prompt-completion or chat-format pairs</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-green-300" /> Holdout validation split for trustworthy evaluation</li>
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-green-300" /> OpenAI API key configured for live provider submission</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
