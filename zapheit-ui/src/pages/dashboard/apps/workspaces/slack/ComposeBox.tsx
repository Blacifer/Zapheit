import { useState, useRef, useEffect } from 'react';
import { Loader2, Send } from 'lucide-react';

interface ComposeBoxProps {
  channelName: string;
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
}

export function ComposeBox({ channelName, onSend, disabled }: ComposeBoxProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [channelName]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="border-t border-white/8 px-4 py-3">
      <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 focus-within:border-cyan-500/30 transition-colors">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${channelName}`}
          rows={1}
          disabled={disabled || sending}
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 outline-none resize-none max-h-32 min-h-[24px] disabled:opacity-50"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!text.trim() || sending || disabled}
          className="shrink-0 p-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
      <p className="text-[10px] text-slate-600 mt-1.5 px-1">
        Press Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
