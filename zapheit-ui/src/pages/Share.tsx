import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getFrontendConfig } from '../lib/config';

// ─── Minimal markdown renderer (no external deps) ─────────────────────────────

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++} className="font-semibold text-slate-900">{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++} className="italic">{m[3]}</em>);
    else if (m[4]) parts.push(<code key={key++} className="bg-slate-100 px-1 rounded text-blue-700 text-[11px] font-mono">{m[4]}</code>);
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
      elements.push(<h3 key={i} className="text-base font-semibold text-slate-800 mt-5 mb-1">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-bold text-slate-900 mt-6 mb-2 border-b border-slate-200 pb-1">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-2xl font-bold text-slate-900 mt-6 mb-3">{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: JSX.Element[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(<li key={i} className="ml-4 text-slate-700">{renderInline(lines[i].slice(2))}</li>);
        i++;
      }
      elements.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-1 my-2">{items}</ul>);
      continue;
    } else if (/^\d+\.\s/.test(line)) {
      const items: JSX.Element[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i} className="ml-4 text-slate-700">{renderInline(lines[i].replace(/^\d+\.\s/, ''))}</li>);
        i++;
      }
      elements.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-1 my-2">{items}</ol>);
      continue;
    } else if (line.startsWith('```')) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="bg-slate-100 border border-slate-200 rounded-lg p-4 overflow-x-auto text-xs text-slate-700 my-3">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
    } else if (line.trim() === '') {
      if (elements.length > 0) elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-slate-700 leading-relaxed">{renderInline(line)}</p>);
    }
    i++;
  }

  return <div className="space-y-1 text-sm">{elements}</div>;
}

// ─── Share page ───────────────────────────────────────────────────────────────

type ShareData = {
  playbook_id?: string;
  result_text?: string;
  created_at?: string;
  expires_at?: string;
};

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('Invalid share link.');
      setLoading(false);
      return;
    }

    const base = (getFrontendConfig().apiUrl || 'http://localhost:3001/api').replace(/\/+$/, '');
    // The share endpoint is at /share/:token (not under /api)
    const shareBase = base.replace(/\/api$/, '');

    fetch(`${shareBase}/share/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Error ${res.status}`);
        }
        return res.json();
      })
      .then((body) => {
        if (!body.success) throw new Error(body.error || 'Not found');
        setData(body.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const playbookName = data?.playbook_id
    ? data.playbook_id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Playbook Result';

  const expiresAt = data?.expires_at
    ? new Date(data.expires_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
            <span className="text-white text-xs font-bold">Z</span>
          </div>
          <span className="font-semibold text-slate-800 text-sm">Zapheit</span>
          <span className="text-slate-300 text-xs">·</span>
          <span className="text-slate-500 text-xs">Shared result</span>
        </div>
        {expiresAt && (
          <span className="text-xs text-slate-400">Expires {expiresAt}</span>
        )}
      </header>

      {/* Content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-24">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-xl font-semibold text-slate-700 mb-2">Link not available</h2>
            <p className="text-sm text-slate-500">{error}</p>
            <p className="text-xs text-slate-400 mt-4">This link may have expired or been revoked.</p>
          </div>
        ) : data ? (
          <div>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-900">{playbookName}</h1>
              {data.created_at && (
                <p className="text-sm text-slate-500 mt-1">
                  Generated {new Date(data.created_at).toLocaleString(undefined, {
                    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              {data.result_text ? (
                renderMarkdown(data.result_text)
              ) : (
                <p className="text-sm text-slate-400">No content available.</p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Shared via Zapheit · Read-only view
              </p>
              <button
                onClick={() => {
                  if (data.result_text) {
                    navigator.clipboard.writeText(data.result_text).then(() => {
                      // simple visual feedback via title flash
                    });
                  }
                }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Copy text
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
