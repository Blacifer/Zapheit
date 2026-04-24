import { useState, useCallback } from 'react';
import { Send, Loader2, AlertTriangle, Info } from 'lucide-react';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';

interface OutreachRecord {
  id: string;
  profile_id: string;
  subject: string;
  timestamp: string;
  status: 'pending_approval' | 'sent' | 'failed';
}

export default function OutreachTab() {
  const [profileId, setProfileId]   = useState('');
  const [subject, setSubject]       = useState('');
  const [body, setBody]             = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory]       = useState<OutreachRecord[]>([]);

  const handleSend = useCallback(async () => {
    if (!profileId.trim() || !subject.trim() || !body.trim()) {
      toast.error('All fields are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.unifiedConnectors.executeAction('linkedin-recruiter', 'send_inmail', {
        profile_id: profileId.trim(),
        subject: subject.trim(),
        body: body.trim(),
      });

      const record: OutreachRecord = {
        id: String(Date.now()),
        profile_id: profileId.trim(),
        subject: subject.trim(),
        timestamp: new Date().toLocaleTimeString(),
        status: 'pending_approval',
      };

      if (res.success) {
        record.status = 'sent';
        toast.success('InMail sent successfully');
      } else if ((res as any).data?.pending) {
        record.status = 'pending_approval';
        toast.info('InMail queued for approval — it will be sent once a manager approves.');
      } else {
        record.status = 'failed';
        toast.error(res.error || 'Failed to send InMail');
      }

      setHistory((prev) => [record, ...prev]);
      if (record.status !== 'failed') {
        setProfileId('');
        setSubject('');
        setBody('');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  }, [profileId, subject, body]);

  const STATUS_STYLE: Record<OutreachRecord['status'], string> = {
    pending_approval: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    sent:             'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    failed:           'bg-rose-500/20 text-rose-400 border-rose-500/30',
  };
  const STATUS_LABEL: Record<OutreachRecord['status'], string> = {
    pending_approval: 'Pending approval',
    sent:             'Sent',
    failed:           'Failed',
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 space-y-4 max-w-xl">
        {/* Governance notice */}
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-400">Governed action — requires approval</p>
            <p className="text-xs text-slate-400 mt-0.5">InMails sent to candidates are external communications. Each message is routed through the approval workflow before being delivered.</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">LinkedIn Profile ID</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="e.g. johnsmith123 or urn:li:person:..."
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="flex-1 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
              />
              <span title="Find in the URL of their LinkedIn profile">
                <Info className="w-4 h-4 text-slate-600" />
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Subject</label>
            <input
              type="text"
              placeholder="Exciting opportunity at your company"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Message body</label>
            <textarea
              placeholder="Hi [Name], I came across your profile and…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50 resize-none"
            />
          </div>

          <button
            onClick={() => void handleSend()}
            disabled={submitting || !profileId.trim() || !subject.trim() || !body.trim()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit for approval
          </button>
        </div>

        {/* Outreach history */}
        {history.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">This session</p>
            {history.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-white/8 bg-white/[0.02]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{r.subject}</p>
                  <p className="text-xs text-slate-500">to {r.profile_id} · {r.timestamp}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${STATUS_STYLE[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
