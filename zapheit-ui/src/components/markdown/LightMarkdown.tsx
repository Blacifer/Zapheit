interface LightMarkdownProps {
  text: string;
  /** 'dark' = dashboard (dark bg), 'light' = public portal (light bg) */
  tone: 'dark' | 'light';
}

function renderInline(text: string, tone: 'dark' | 'light'): (string | JSX.Element)[] {
  const codeClass = tone === 'dark'
    ? 'bg-slate-800 px-1 rounded text-[11px] font-mono text-cyan-300'
    : 'bg-slate-100 px-1 rounded text-[11px] font-mono text-blue-700';

  const parts: (string | JSX.Element)[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++} className="font-semibold">{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++} className="italic">{m[3]}</em>);
    else if (m[4]) parts.push(<code key={key++} className={codeClass}>{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function LightMarkdown({ text, tone }: LightMarkdownProps): JSX.Element {
  const prose = tone === 'dark'
    ? { p: 'leading-relaxed text-slate-100', h2: 'text-base font-bold text-white mt-4 mb-1', h3: 'text-sm font-semibold text-slate-200 mt-3 mb-1', ul: 'list-disc list-inside space-y-0.5 my-1.5 text-slate-200', ol: 'list-decimal list-inside space-y-0.5 my-1.5 text-slate-200' }
    : { p: 'leading-relaxed text-slate-700', h2: 'text-base font-bold text-slate-900 mt-4 mb-1', h3: 'text-sm font-semibold text-slate-800 mt-3 mb-1', ul: 'list-disc list-inside space-y-0.5 my-1.5 text-slate-700', ol: 'list-decimal list-inside space-y-0.5 my-1.5 text-slate-700' };

  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className={prose.h3}>{renderInline(line.slice(4), tone)}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className={prose.h2}>{renderInline(line.slice(3), tone)}</h2>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: JSX.Element[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(<li key={i}>{renderInline(lines[i].slice(2), tone)}</li>);
        i++;
      }
      elements.push(<ul key={`ul-${i}`} className={prose.ul}>{items}</ul>);
      continue;
    } else if (/^\d+\.\s/.test(line)) {
      const items: JSX.Element[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i}>{renderInline(lines[i].replace(/^\d+\.\s/, ''), tone)}</li>);
        i++;
      }
      elements.push(<ol key={`ol-${i}`} className={prose.ol}>{items}</ol>);
      continue;
    } else if (line.trim() === '') {
      if (elements.length > 0) elements.push(<div key={i} className="h-1.5" />);
    } else {
      elements.push(<p key={i} className={prose.p}>{renderInline(line, tone)}</p>);
    }
    i++;
  }
  return <div className="space-y-0.5 text-sm">{elements}</div>;
}
