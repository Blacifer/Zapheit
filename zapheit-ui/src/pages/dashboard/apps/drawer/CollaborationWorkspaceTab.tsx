import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, RefreshCw, Shield, UserCircle2, Users } from 'lucide-react';
import { api } from '../../../../lib/api-client';
import { toast } from '../../../../lib/toast';
import type { UnifiedApp } from '../types';

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

interface WorkspacePreview {
  profile: {
    email?: string | null;
    name?: string | null;
    picture?: string | null;
    title?: string | null;
  } | null;
  events: Array<{
    id: string;
    title: string;
    start?: string | null;
    end?: string | null;
    organizer?: string | null;
  }>;
  users: Array<{
    id: string;
    email?: string | null;
    name: string;
    suspended?: boolean;
  }>;
  notes: string[];
  suggested_next_action?: string | null;
}

interface CollaborationWorkspaceTabProps {
  app: UnifiedApp;
  serviceId: string;
  agentNames: string[];
}

export function CollaborationWorkspaceTab({ app, serviceId, agentNames }: CollaborationWorkspaceTabProps) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<WorkspacePreview | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.integrations.getWorkspacePreview(serviceId);
      if (res.success && res.data) {
        setPreview(res.data as WorkspacePreview);
      } else {
        toast.error((res as any).error || 'Failed to load collaboration workspace');
      }
    } finally {
      setBusy(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nextEvent = useMemo(() => preview?.events?.[0] || null, [preview]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Collaboration workspace</p>
            <h3 className="mt-2 text-lg font-semibold text-white">{app.name} collaboration operations inside Zapheit</h3>
            <p className="mt-1 text-sm text-slate-400">
              Keep identity, calendar, and collaboration context visible to operators and linked agents from one governed workspace.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw className={cx('h-3.5 w-3.5', busy && 'animate-spin')} />
            Refresh
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Linked agents</p>
            <p className="mt-2 text-2xl font-semibold text-white">{agentNames.length}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Upcoming events</p>
            <p className="mt-2 text-2xl font-semibold text-white">{preview?.events?.length || 0}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Directory preview</p>
            <p className="mt-2 text-2xl font-semibold text-white">{preview?.users?.length || 0}</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-[#121826] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Account</p>
            <p className="mt-2 truncate text-sm font-semibold text-white">{preview?.profile?.email || 'Connected'}</p>
          </div>
        </div>
        {preview?.suggested_next_action ? (
          <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-200">Recommended next step</p>
            <p className="mt-2 text-sm text-cyan-50">{preview.suggested_next_action}</p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Account context</h4>
            </div>
            <div className="px-4 py-4">
              {preview?.profile ? (
                <div className="flex items-start gap-3">
                  {preview.profile.picture ? (
                    <img src={preview.profile.picture} alt={preview.profile.name || app.name} className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
                      <UserCircle2 className="h-6 w-6 text-slate-400" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-white">{preview.profile.name || 'Connected account'}</p>
                    <p className="mt-1 text-sm text-slate-400">{preview.profile.email || 'No email returned'}</p>
                    {preview.profile.title ? <p className="mt-1 text-xs text-slate-500">{preview.profile.title}</p> : null}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Profile preview is unavailable for this connection.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Upcoming events</h4>
            </div>
            <div className="divide-y divide-white/6">
              {preview?.events?.length ? preview.events.map((event) => (
                <div key={event.id} className="px-4 py-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-blue-300" />
                    <p className="font-medium text-white">{event.title}</p>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{event.start ? new Date(event.start).toLocaleString() : 'Start time unavailable'}</p>
                  {event.organizer ? <p className="mt-1 text-xs text-slate-500">Organizer: {event.organizer}</p> : null}
                </div>
              )) : (
                <div className="px-4 py-10 text-sm text-slate-500">
                  {nextEvent ? '' : 'No upcoming events available with the current connection scope.'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/8 bg-white/[0.02]">
            <div className="border-b border-white/8 px-4 py-3">
              <h4 className="text-sm font-semibold text-white">Directory preview</h4>
            </div>
            <div className="divide-y divide-white/6">
              {preview?.users?.length ? preview.users.map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{user.name}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{user.email || 'No email available'}</p>
                  </div>
                  {user.suspended ? (
                    <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200">Suspended</span>
                  ) : (
                    <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">Active</span>
                  )}
                </div>
              )) : (
                <div className="px-4 py-10 text-sm text-slate-500">Directory preview is unavailable for this connection.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-cyan-300" />
              <h4 className="text-sm font-semibold text-white">Operator notes</h4>
            </div>
            {preview?.notes?.length ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-400">
                {preview.notes.map((note, index) => (
                  <li key={`${note}-${index}`}>• {note}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-500">This connection is returning the currently supported collaboration preview data successfully.</p>
            )}
            {agentNames.length > 0 ? (
              <div className="mt-4 rounded-xl border border-white/8 bg-[#121826] p-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-300" />
                  <p className="text-sm font-medium text-white">Linked agents</p>
                </div>
                <p className="mt-2 text-sm text-slate-400">{agentNames.join(', ')}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
