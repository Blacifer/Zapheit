import { useState } from 'react';
import { Calendar, Clock, MapPin, Users, Plus } from 'lucide-react';
import { WriteForm, PendingApprovalRow, type WriteFormField } from '../shared';
import type { ApprovalRequest } from '../../../../../lib/api/approvals';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  attendees?: { email: string; responseStatus?: string }[];
  status?: string;
  organizer?: { email: string };
}

interface CalendarViewProps {
  events: CalendarEvent[];
  loading: boolean;
  onCreate: (data: Record<string, string>) => void;
  pendingApprovals?: ApprovalRequest[];
  onApprovalResolved?: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(dt?: { dateTime?: string; date?: string }): string {
  if (!dt) return '';
  if (dt.dateTime) {
    const d = new Date(dt.dateTime);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (dt.date) return new Date(dt.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return '';
}

function isUpcoming(dt?: { dateTime?: string; date?: string }): boolean {
  if (!dt) return false;
  const d = dt.dateTime || dt.date;
  if (!d) return false;
  return new Date(d) >= new Date();
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CalendarView({ events, loading, onCreate, pendingApprovals = [], onApprovalResolved }: CalendarViewProps) {
  const [showCreate, setShowCreate] = useState(false);

  const createFields: WriteFormField[] = [
    { name: 'summary', label: 'Title', type: 'text', required: true, placeholder: 'Meeting title' },
    { name: 'startDateTime', label: 'Start', type: 'text', required: true, placeholder: 'YYYY-MM-DDTHH:mm:ss' },
    { name: 'endDateTime', label: 'End', type: 'text', required: true, placeholder: 'YYYY-MM-DDTHH:mm:ss' },
    { name: 'location', label: 'Location', type: 'text', placeholder: 'Conference Room A' },
    { name: 'attendees', label: 'Attendees', type: 'text', placeholder: 'email1@co.com, email2@co.com' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Meeting notes…' },
  ];

  const upcoming = events.filter((e) => isUpcoming(e.start));
  const past = events.filter((e) => !isUpcoming(e.start));

  return (
    <div className="flex flex-col h-full">
      {/* Pending approvals */}
      {pendingApprovals.length > 0 && (
        <div className="px-4 py-3 border-b border-amber-500/15 bg-amber-500/[0.03] space-y-1.5 shrink-0">
          <p className="text-[10px] text-amber-400/80 font-semibold uppercase tracking-wider mb-2">
            Awaiting your approval — {pendingApprovals.length} event{pendingApprovals.length !== 1 ? 's' : ''} to create
          </p>
          {pendingApprovals.map((a) => (
            <PendingApprovalRow key={a.id} approval={a} onResolved={onApprovalResolved ?? (() => {})} />
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        <span className="text-[11px] text-slate-600">{events.length} events</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 text-[11px] font-medium hover:bg-blue-600/30 transition-colors"
        >
          <Plus className="w-3 h-3" /> New Event
        </button>
      </div>

      {showCreate && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <WriteForm
            title="New Event"
            fields={createFields}
            onSubmit={async (values) => {
              onCreate(values);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Event"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-16">
            <Calendar className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No events found</p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {/* Upcoming */}
            {upcoming.length > 0 && (
              <div>
                <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Upcoming</h3>
                <div className="space-y-1.5">
                  {upcoming.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              </div>
            )}

            {/* Past */}
            {past.length > 0 && (
              <div>
                <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Past</h3>
                <div className="space-y-1.5 opacity-60">
                  {past.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Event Card                                                         */
/* ------------------------------------------------------------------ */

function EventCard({ event }: { event: CalendarEvent }) {
  return (
    <div className="px-4 py-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
      <div className="flex items-start gap-3">
        <Calendar className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-200 truncate">
            {event.summary || 'Untitled Event'}
          </p>
          <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
            {event.start && (
              <span className="flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" /> {formatTime(event.start)}
                {event.end && ` – ${formatTime(event.end)}`}
              </span>
            )}
            {event.location && (
              <span className="flex items-center gap-0.5">
                <MapPin className="w-2.5 h-2.5" /> {event.location}
              </span>
            )}
            {event.attendees && event.attendees.length > 0 && (
              <span className="flex items-center gap-0.5">
                <Users className="w-2.5 h-2.5" /> {event.attendees.length}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
