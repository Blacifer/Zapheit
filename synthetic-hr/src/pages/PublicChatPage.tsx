import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getFrontendConfig } from '../lib/config';

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type PendingAction = {
  approvalId: string;
  to: string;
  subject: string;
};

type AgentInfo = {
  name: string;
  description: string;
  agent_type: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPortalBase(): string {
  const apiUrl = getFrontendConfig().apiUrl || 'http://localhost:3001/api';
  // Portal routes are at /portal/*, not under /api
  return apiUrl.replace(/\/api\/?$/, '') + '/portal';
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Inline markdown renderer (reused from Share.tsx) ─────────────────────────

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++} className="font-semibold">{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++} className="italic">{m[3]}</em>);
    else if (m[4]) parts.push(<code key={key++} className="bg-slate-100 px-1 rounded text-[11px] font-mono text-blue-700">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(text: string): JSX.Element {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-sm font-semibold text-slate-800 mt-3 mb-1">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-base font-bold text-slate-900 mt-4 mb-1">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: JSX.Element[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(<li key={i} className="ml-4">{renderInline(lines[i].slice(2))}</li>);
        i++;
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1.5 text-slate-700">{items}</ul>);
      continue;
    } else if (/^\d+\.\s/.test(line)) {
      const items: JSX.Element[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i} className="ml-4">{renderInline(lines[i].replace(/^\d+\.\s/, ''))}</li>);
        i++;
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-1.5 text-slate-700">{items}</ol>);
      continue;
    } else if (line.trim() === '') {
      if (elements.length > 0) elements.push(<div key={i} className="h-1.5" />);
    } else {
      elements.push(<p key={i} className="leading-relaxed text-slate-700">{renderInline(line)}</p>);
    }
    i++;
  }
  return <div className="space-y-0.5 text-sm">{elements}</div>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PublicChatPage() {
  const { token } = useParams<{ token: string }>();
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(true);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const portalBase = getPortalBase();

  // Load agent info on mount
  useEffect(() => {
    if (!token) { setPortalError('Invalid link.'); setLoadingAgent(false); return; }
    fetch(`${portalBase}/${token}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok || !body.success) throw new Error(body.error || 'Portal unavailable.');
        setAgentInfo(body.data);
        // Greet on load
        setMessages([{
          id: uid(),
          role: 'assistant',
          content: `Hi! I'm **${body.data.name}**. ${body.data.description ? body.data.description + ' ' : ''}How can I help you today?`,
        }]);
      })
      .catch((err) => setPortalError(err.message))
      .finally(() => setLoadingAgent(false));
  }, [token, portalBase]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || streaming || !token) return;
    setStreamError(null);

    const userMsg: Message = { id: uid(), role: 'user', content: input.trim() };
    const assistantId = uid();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    // Build history (last 10 turns, exclude the empty assistant placeholder)
    const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));

    abortRef.current = new AbortController();

    try {
      const response = await fetch(`${portalBase}/${token}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.content, history }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';

        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          if (payload.startsWith('[ERROR]')) {
            setStreamError(payload.replace('[ERROR]', '').trim() || 'Something went wrong.');
            break;
          }
          if (payload.startsWith('[ACTION_PENDING:')) {
            try {
              const action: PendingAction = JSON.parse(payload.slice('[ACTION_PENDING:'.length));
              setPendingAction(action);
              setMessages(prev =>
                prev.map(m => m.id === assistantId
                  ? { ...m, content: `I've submitted a request to send your email to **${action.to}** with subject **"${action.subject}"**. An HR admin will review and approve it shortly.` }
                  : m
                )
              );
            } catch { /* ignore parse errors */ }
            continue;
          }
          accumulated += payload;
          setMessages((prev) =>
            prev.map((m) => m.id === assistantId ? { ...m, content: accumulated } : m)
          );
        }
      }

      // Finalise — if nothing came back show a fallback
      if (!accumulated) {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, content: 'Sorry, I couldn\'t generate a response. Please try again.' } : m)
        );
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setStreamError(err.message || 'Network error.');
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: '⚠️ Connection lost. Please try again.' } : m)
      );
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ─── Loading / error states ────────────────────────────────────────────────

  if (loadingAgent) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
      </div>
    );
  }

  if (portalError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-center px-4">
        <div className="text-5xl mb-5">🔒</div>
        <h2 className="text-xl font-semibold text-slate-800 mb-2">Portal unavailable</h2>
        <p className="text-sm text-slate-500 max-w-xs">{portalError}</p>
        <p className="text-xs text-slate-400 mt-4">This link may have been disabled by your administrator.</p>
      </div>
    );
  }

  // ─── Chat UI ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/70 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-bold">R</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-slate-900 truncate">{agentInfo?.name}</h1>
          <p className="text-[11px] text-slate-400">Powered by Rasi AI</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-[11px] text-slate-400">Online</span>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {/* Avatar */}
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-white text-[10px] font-bold">R</span>
                </div>
              )}

              {/* Bubble */}
              <div
                className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-slate-800 to-slate-900 text-white border border-white/10 rounded-tr-sm shadow-sm'
                    : 'bg-white/90 backdrop-blur-sm border border-slate-200/80 border-l-2 border-l-cyan-400/40 shadow-sm rounded-tl-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                ) : msg.content === '' ? (
                  // Streaming cursor
                  <span className="inline-block w-2 h-4 bg-cyan-400 animate-pulse rounded-sm" />
                ) : (
                  <>
                    {renderMarkdown(msg.content)}
                    {streaming && msg.id === messages[messages.length - 1]?.id && (
                      <span className="inline-block w-1.5 h-3.5 bg-cyan-400 animate-pulse rounded-sm ml-0.5 align-middle" />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {streamError && (
            <div className="text-center">
              <span className="text-xs text-rose-500 bg-rose-50 border border-rose-200 rounded-full px-3 py-1">
                {streamError}
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* Pending approval banner */}
      {pendingAction && (
        <div className="bg-amber-50 border-t border-amber-200 px-4 py-3 shrink-0">
          <div className="max-w-2xl mx-auto flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-amber-600 text-sm">⏳</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">Waiting for admin approval</p>
              <p className="text-xs text-amber-600 mt-0.5 truncate">
                Email to {pendingAction.to} · "{pendingAction.subject}"
              </p>
            </div>
            <button
              onClick={() => setPendingAction(null)}
              className="text-amber-400 hover:text-amber-600 transition-colors mt-0.5 text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="bg-white border-t border-slate-200 px-4 py-3 shrink-0">
        <div className="max-w-2xl mx-auto flex items-end gap-3">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Type your question…"
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50 transition-colors"
            style={{ minHeight: '44px', maxHeight: '160px' }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || streaming}
            className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white hover:shadow-[0_0_12px_rgba(34,211,238,0.35)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label="Send"
          >
            {streaming ? (
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-center text-[10px] text-slate-300 mt-2">
          Shift+Enter for new line · Enter to send
        </p>
      </div>

    </div>
  );
}
