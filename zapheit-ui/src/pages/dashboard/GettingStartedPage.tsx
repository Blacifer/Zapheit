import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, CheckCircle2, Loader2, Sparkles, Users,
  Headset, TrendingUp, DollarSign, Settings2, MessageSquare,
  Slack, Globe, Bot, Zap, Check, ChevronRight,
} from 'lucide-react';
import type { AIAgent } from '../../types';
import { api } from '../../lib/api-client';
import { toast } from '../../lib/toast';

type UseCase = 'hr' | 'support' | 'sales' | 'finance' | 'it' | 'other';
type Channel = 'slack' | 'whatsapp' | 'teams' | 'web';

const USE_CASES: Array<{
  id: UseCase;
  label: string;
  sub: string;
  icon: React.ReactNode;
  agentName: string;
  sampleQuestion: string;
  sampleAnswer: string;
}> = [
  {
    id: 'hr',
    label: 'HR & People',
    sub: 'Leave policies, onboarding, payroll FAQs',
    icon: <Users className="h-6 w-6 text-violet-400" />,
    agentName: 'HR Assistant',
    sampleQuestion: 'How many leave days do I have left?',
    sampleAnswer: "You have 12 casual leave days remaining this year. Your carry-forward balance is 3 days, giving you a total of 15 available. Would you like to apply for leave?",
  },
  {
    id: 'support',
    label: 'Customer Support',
    sub: 'Answer tickets, escalate issues, track resolutions',
    icon: <Headset className="h-6 w-6 text-blue-400" />,
    agentName: 'Support Assistant',
    sampleQuestion: 'What is your refund policy?',
    sampleAnswer: "We offer full refunds within 30 days of purchase. For subscriptions, you can cancel anytime and we'll prorate the unused portion. Shall I start a refund request for you?",
  },
  {
    id: 'sales',
    label: 'Sales & CRM',
    sub: 'Qualify leads, book demos, update CRM',
    icon: <TrendingUp className="h-6 w-6 text-emerald-400" />,
    agentName: 'Sales Assistant',
    sampleQuestion: 'Show me deals closing this month',
    sampleAnswer: "You have 8 deals closing this month totalling ₹24.5L. 3 are high-priority: Acme Corp (₹8L), Brightside (₹7L), and Nexus Tech (₹4L). Want me to pull the full pipeline?",
  },
  {
    id: 'finance',
    label: 'Finance & Expenses',
    sub: 'Expense approvals, invoice queries, budget tracking',
    icon: <DollarSign className="h-6 w-6 text-amber-400" />,
    agentName: 'Finance Assistant',
    sampleQuestion: 'What is my team\'s budget utilisation?',
    sampleAnswer: "Your team has used ₹3.2L of the ₹5L quarterly budget (64%). Top categories: Travel ₹1.1L, Software ₹0.9L, Training ₹0.7L. You are on track to close the quarter within budget.",
  },
  {
    id: 'it',
    label: 'IT Helpdesk',
    sub: 'Access requests, password resets, troubleshooting',
    icon: <Settings2 className="h-6 w-6 text-cyan-400" />,
    agentName: 'IT Assistant',
    sampleQuestion: 'I need access to the project management tool',
    sampleAnswer: "I've submitted an access request for Jira on your behalf. It typically takes 2–4 hours to provision. You'll receive an email confirmation. Is there anything else you need access to?",
  },
  {
    id: 'other',
    label: 'Something else',
    sub: 'Custom automation for your team',
    icon: <Sparkles className="h-6 w-6 text-rose-400" />,
    agentName: 'AI Assistant',
    sampleQuestion: 'What can you help me with?',
    sampleAnswer: "I can help your team automate repetitive questions, route requests to the right people, and give instant answers from your company knowledge base. What would you like to automate first?",
  },
];

const CHANNELS: Array<{
  id: Channel;
  label: string;
  sub: string;
  icon: React.ReactNode;
  available: boolean;
}> = [
  { id: 'slack', label: 'Slack', sub: 'Employees ask questions in a dedicated channel', icon: <Slack className="h-6 w-6 text-[#4A154B]" />, available: true },
  { id: 'web', label: 'Website Widget', sub: 'Floating chat bubble on your website or portal', icon: <Globe className="h-6 w-6 text-cyan-400" />, available: true },
  { id: 'whatsapp', label: 'WhatsApp', sub: 'Via Twilio — team or customer-facing', icon: <MessageSquare className="h-6 w-6 text-[#25D366]" />, available: false },
  { id: 'teams', label: 'Microsoft Teams', sub: 'Bot integration for your workspace', icon: <MessageSquare className="h-6 w-6 text-[#6264A7]" />, available: false },
];

const CONNECT_APPS = [
  { id: 'slack', label: 'Slack', sub: 'Notifications + channel messages', color: 'bg-violet-500/10 border-violet-500/20 text-violet-300' },
  { id: 'google', label: 'Google Workspace', sub: 'Calendar, Drive, Gmail', color: 'bg-blue-500/10 border-blue-500/20 text-blue-300' },
  { id: 'notion', label: 'Notion', sub: 'Knowledge base + docs', color: 'bg-slate-500/10 border-slate-500/20 text-slate-300' },
  { id: 'jira', label: 'Jira', sub: 'Issues + project tracking', color: 'bg-blue-600/10 border-blue-600/20 text-blue-300' },
];

type Step = 'use_case' | 'channel' | 'connect' | 'test' | 'done';
const STEPS: Step[] = ['use_case', 'channel', 'connect', 'test', 'done'];
const STEP_LABELS = ['What to automate', 'Where it works', 'Connect apps', 'Test it live', 'You\'re live'];

export default function GettingStartedPage({
  agents,
  onNavigate,
  onRefresh,
  storageScope,
}: {
  agents: AIAgent[];
  onNavigate: (page: string) => void;
  onRefresh: () => Promise<void>;
  storageScope: string;
}) {
  const [step, setStep] = useState<Step>('use_case');
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [connectedApps, setConnectedApps] = useState<Set<string>>(new Set());
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const stepIndex = STEPS.indexOf(step);
  const selectedUseCase = USE_CASES.find((u) => u.id === useCase) ?? USE_CASES[0];

  const completionKey = `synthetic_hr_onboarding_completed:${storageScope}`;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  function markComplete() {
    localStorage.setItem(completionKey, new Date().toISOString());
  }

  function goNext() {
    if (step === 'done') return;
    const next = STEPS[stepIndex + 1];
    if (next === 'test' && chatMessages.length === 0) {
      // Pre-populate the demo question
      setChatInput(selectedUseCase.sampleQuestion);
    }
    setStep(next);
  }

  function goBack() {
    if (stepIndex === 0) return;
    setStep(STEPS[stepIndex - 1]);
  }

  function skip() {
    if (step === 'done') return;
    const next = STEPS[stepIndex + 1];
    if (next === 'done') {
      markComplete();
    }
    setStep(next);
  }

  async function handleConnectApp(appId: string) {
    setConnectingApp(appId);
    // Simulate OAuth flow — in production this opens an OAuth popup
    await new Promise((r) => setTimeout(r, 1200));
    setConnectedApps((prev) => new Set([...prev, appId]));
    setConnectingApp(null);
    toast.success(`${CONNECT_APPS.find((a) => a.id === appId)?.label} connected`);
  }

  async function handleSendDemo() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', text }]);
    setChatBusy(true);
    // Use the pre-written sample answer if the question matches, otherwise use a generic reply
    const lowerText = text.toLowerCase();
    const isKnownQuestion = lowerText === selectedUseCase.sampleQuestion.toLowerCase();
    await new Promise((r) => setTimeout(r, 900));
    const reply = isKnownQuestion
      ? selectedUseCase.sampleAnswer
      : `Thanks for your question! As a ${selectedUseCase.agentName}, I can help your team with this. Once you go live, I'll answer questions like this instantly using your company's actual data.`;
    setChatMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    setChatBusy(false);
  }

  async function handleGoLive() {
    setCreatingAgent(true);
    try {
      await api.agents.create({
        name: selectedUseCase.agentName,
        agent_type: useCase ?? 'custom',
        platform: channel === 'slack' ? 'slack' : 'web',
        model_name: 'google/gemini-2.0-flash',
        system_prompt: `You are a helpful ${selectedUseCase.label} assistant. Answer questions clearly and concisely. When unsure, say so and offer to escalate.`,
        config: { use_case: useCase, channel },
      });
      await onRefresh();
      markComplete();
      setStep('done');
    } catch {
      toast.error('Could not create your assistant — you can do it manually from the assistants page.');
      markComplete();
      setStep('done');
    } finally {
      setCreatingAgent(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-start py-8 px-4">
      <div className="w-full max-w-2xl">

        {/* Step progress */}
        {step !== 'done' && (
          <div className="mb-8">
            <div className="flex items-center gap-1 justify-center mb-3">
              {STEPS.slice(0, -1).map((s, i) => (
                <div key={s} className="flex items-center gap-1">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${
                    i < stepIndex ? 'bg-emerald-500 text-white' :
                    i === stepIndex ? 'bg-cyan-500 text-white' :
                    'bg-slate-800 text-slate-500 border border-slate-700'
                  }`}>
                    {i < stepIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  {i < STEPS.length - 2 && (
                    <div className={`h-px w-8 transition-colors ${i < stepIndex ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                  )}
                </div>
              ))}
            </div>
            <p className="text-center text-xs text-slate-500">
              Step {stepIndex + 1} of {STEPS.length - 1} · {STEP_LABELS[stepIndex]}
            </p>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.22 }}
          >

            {/* ── Step 1: Use case ─────────────────────────────── */}
            {step === 'use_case' && (
              <div className="space-y-6">
                <div className="text-center">
                  <h1 className="text-2xl font-bold text-white">What would you like to automate?</h1>
                  <p className="mt-2 text-slate-400 text-sm">Pick the area your AI assistant will work in. You can add more later.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {USE_CASES.map((uc) => (
                    <button
                      key={uc.id}
                      onClick={() => setUseCase(uc.id)}
                      className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all hover:border-cyan-500/40 hover:bg-cyan-500/[0.05] ${
                        useCase === uc.id
                          ? 'border-cyan-500/60 bg-cyan-500/10 ring-1 ring-cyan-500/30'
                          : 'border-white/[0.08] bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-slate-800/60">
                        {uc.icon}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{uc.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-snug">{uc.sub}</p>
                      </div>
                      {useCase === uc.id && (
                        <div className="absolute top-3 right-3">
                          <Check className="h-4 w-4 text-cyan-400" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2">
                  <button onClick={skip} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                    Skip this step →
                  </button>
                  <button
                    onClick={goNext}
                    disabled={!useCase}
                    className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors disabled:opacity-40"
                  >
                    Continue <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Channel ──────────────────────────────── */}
            {step === 'channel' && (
              <div className="space-y-6">
                <div className="text-center">
                  <h1 className="text-2xl font-bold text-white">Where will it work?</h1>
                  <p className="mt-2 text-slate-400 text-sm">Your AI assistant will answer questions from here. You can add more channels later.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {CHANNELS.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => ch.available && setChannel(ch.id)}
                      className={`relative flex items-center gap-4 rounded-2xl border p-4 text-left transition-all ${
                        !ch.available
                          ? 'border-white/[0.05] bg-white/[0.01] opacity-50 cursor-not-allowed'
                          : channel === ch.id
                          ? 'border-cyan-500/60 bg-cyan-500/10 ring-1 ring-cyan-500/30 hover:border-cyan-500/60'
                          : 'border-white/[0.08] bg-white/[0.02] hover:border-cyan-500/40 hover:bg-cyan-500/[0.05]'
                      }`}
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-800/60">
                        {ch.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white flex items-center gap-2">
                          {ch.label}
                          {!ch.available && <span className="text-[10px] font-normal text-slate-500 border border-slate-600 rounded px-1">Coming soon</span>}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{ch.sub}</p>
                      </div>
                      {channel === ch.id && (
                        <div className="absolute top-3 right-3">
                          <Check className="h-4 w-4 text-cyan-400" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-4">
                    <button onClick={goBack} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">← Back</button>
                    <button onClick={skip} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Skip →</button>
                  </div>
                  <button
                    onClick={goNext}
                    disabled={!channel}
                    className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors disabled:opacity-40"
                  >
                    Continue <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Connect apps ─────────────────────────── */}
            {step === 'connect' && (
              <div className="space-y-6">
                <div className="text-center">
                  <h1 className="text-2xl font-bold text-white">Connect your apps</h1>
                  <p className="mt-2 text-slate-400 text-sm">Your assistant will use these to answer questions and take actions. Connect what you use — skip the rest.</p>
                </div>
                <div className="space-y-3">
                  {CONNECT_APPS.map((app) => {
                    const connected = connectedApps.has(app.id);
                    const connecting = connectingApp === app.id;
                    return (
                      <div
                        key={app.id}
                        className={`flex items-center gap-4 rounded-2xl border p-4 transition-all ${
                          connected ? 'border-emerald-500/30 bg-emerald-500/[0.06]' : 'border-white/[0.08] bg-white/[0.02]'
                        }`}
                      >
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm font-bold ${app.color}`}>
                          {app.label.slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white">{app.label}</p>
                          <p className="text-xs text-slate-500">{app.sub}</p>
                        </div>
                        {connected ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                            <CheckCircle2 className="h-4 w-4" /> Connected
                          </span>
                        ) : (
                          <button
                            onClick={() => handleConnectApp(app.id)}
                            disabled={connecting}
                            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08] transition-colors disabled:opacity-60"
                          >
                            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                            {connecting ? 'Connecting…' : 'Connect'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-4">
                    <button onClick={goBack} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">← Back</button>
                    <button onClick={skip} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Skip →</button>
                  </div>
                  <button
                    onClick={goNext}
                    className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors"
                  >
                    {connectedApps.size > 0 ? 'Continue' : 'Skip for now'} <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 4: Test it live ─────────────────────────── */}
            {step === 'test' && (
              <div className="space-y-6">
                <div className="text-center">
                  <h1 className="text-2xl font-bold text-white">Test it live</h1>
                  <p className="mt-2 text-slate-400 text-sm">Ask your {selectedUseCase.agentName} a question to see what it will feel like.</p>
                </div>

                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                  {/* Chat header */}
                  <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500/20 border border-cyan-500/30">
                      <Bot className="h-4 w-4 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{selectedUseCase.agentName}</p>
                      <p className="text-xs text-emerald-400 flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" /> Preview mode
                      </p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="min-h-[180px] max-h-64 overflow-y-auto p-4 space-y-3">
                    {chatMessages.length === 0 && (
                      <div className="text-center py-6">
                        <p className="text-xs text-slate-500">Ask something to see how your assistant responds.</p>
                        <button
                          onClick={() => setChatInput(selectedUseCase.sampleQuestion)}
                          className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors underline underline-offset-2"
                        >
                          Try: "{selectedUseCase.sampleQuestion}"
                        </button>
                      </div>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-cyan-600/80 text-white rounded-tr-sm'
                            : 'bg-slate-800 text-slate-200 border border-white/[0.06] rounded-tl-sm'
                        }`}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    {chatBusy && (
                      <div className="flex justify-start">
                        <div className="bg-slate-800 border border-white/[0.06] rounded-2xl rounded-tl-sm px-4 py-3">
                          <div className="flex gap-1">
                            {[0, 1, 2].map((i) => (
                              <span key={i} className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input */}
                  <div className="border-t border-white/[0.06] px-3 py-3 flex gap-2">
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendDemo()}
                      placeholder={`Ask your ${selectedUseCase.agentName}…`}
                      className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/40"
                    />
                    <button
                      onClick={handleSendDemo}
                      disabled={!chatInput.trim() || chatBusy}
                      className="flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button onClick={goBack} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">← Back</button>
                    <button onClick={skip} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">Skip →</button>
                  </div>
                  <button
                    onClick={handleGoLive}
                    disabled={creatingAgent}
                    className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-60"
                  >
                    {creatingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {creatingAgent ? 'Setting up…' : "Go live →"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 5: Done ─────────────────────────────────── */}
            {step === 'done' && (
              <div className="text-center space-y-8">
                <div className="flex flex-col items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-bold text-white">You're live!</h1>
                    <p className="mt-2 text-slate-400">
                      Your {selectedUseCase.agentName} is set up and ready to help your team.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    {
                      label: 'View your assistants',
                      sub: 'See all active AI assistants',
                      icon: <Bot className="h-5 w-5 text-cyan-400" />,
                      action: () => onNavigate('agents'),
                    },
                    {
                      label: 'Invite your team',
                      sub: 'Add managers and viewers',
                      icon: <Users className="h-5 w-5 text-violet-400" />,
                      action: () => onNavigate('settings'),
                    },
                    {
                      label: 'Go to dashboard',
                      sub: 'See your live overview',
                      icon: <ArrowRight className="h-5 w-5 text-emerald-400" />,
                      action: () => onNavigate('overview'),
                    },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={item.action}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-5 hover:border-white/20 hover:bg-white/[0.06] transition-all group"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-slate-800/60">
                        {item.icon}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{item.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{item.sub}</p>
                      </div>
                    </button>
                  ))}
                </div>

                <p className="text-xs text-slate-600">
                  Need to add another assistant?{' '}
                  <button onClick={() => onNavigate('agent-studio')} className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors">
                    Create another →
                  </button>
                </p>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
