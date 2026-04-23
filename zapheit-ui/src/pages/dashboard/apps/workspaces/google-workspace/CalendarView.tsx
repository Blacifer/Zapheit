import { useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, MapPin, Users, Plus, X, Mail, Calendar } from 'lucide-react';
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
  attendees?: { email: string; responseStatus?: string; displayName?: string }[];
  status?: string;
  organizer?: { email: string; displayName?: string };
  htmlLink?: string;
}

interface CalendarViewProps {
  events: CalendarEvent[];
  loading: boolean;
  onCreate: (data: Record<string, string>) => void;
  onUpdate: (data: Record<string, string>) => void;
  onCancelEvent: (eventId: string) => void;
  pendingApprovals?: ApprovalRequest[];
  onApprovalResolved?: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function eventDate(e: CalendarEvent): Date | null {
  const dt = e.start?.dateTime || e.start?.date;
  return dt ? new Date(dt) : null;
}

function formatTime(dt?: { dateTime?: string; date?: string }): string {
  if (!dt) return '';
  if (dt.dateTime) return new Date(dt.dateTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (dt.date) return new Date(dt.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return '';
}

function formatFull(dt?: { dateTime?: string; date?: string }): string {
  if (!dt) return '';
  if (dt.dateTime) return new Date(dt.dateTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (dt.date) return new Date(dt.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return '';
}

function rsvpLabel(s?: string) {
  if (s === 'accepted') return { label: 'Accepted', cls: 'text-emerald-400' };
  if (s === 'declined') return { label: 'Declined', cls: 'text-rose-400' };
  if (s === 'tentative') return { label: 'Tentative', cls: 'text-amber-400' };
  return { label: 'Invited', cls: 'text-slate-500' };
}

/* ------------------------------------------------------------------ */
/*  Event detail modal                                                 */
/* ------------------------------------------------------------------ */

function EventModal({
  event,
  onClose,
  onUpdate,
  onCancelEvent,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onUpdate: (values: Record<string, string>) => void;
  onCancelEvent: (eventId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateFields: WriteFormField[] = [
    { name: 'eventId', label: 'Event ID', type: 'hidden', defaultValue: event.id },
    { name: 'summary', label: 'Title', type: 'text', required: true, defaultValue: event.summary || '' },
    { name: 'startDateTime', label: 'Start', type: 'text', placeholder: 'YYYY-MM-DDTHH:mm:ss', defaultValue: event.start?.dateTime || '' },
    { name: 'endDateTime', label: 'End', type: 'text', placeholder: 'YYYY-MM-DDTHH:mm:ss', defaultValue: event.end?.dateTime || '' },
    { name: 'location', label: 'Location', type: 'text', defaultValue: event.location || '' },
    { name: 'attendees', label: 'Attendees', type: 'text', defaultValue: event.attendees?.map((attendee) => attendee.email).join(', ') || '' },
    { name: 'description', label: 'Description', type: 'textarea', defaultValue: event.description || '' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0f1117] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex-1 min-w-0 pr-3">
            <h2 className="text-base font-bold text-white leading-snug">{event.summary || 'Untitled Event'}</h2>
            {event.status && event.status !== 'confirmed' && (
              <span className="text-[10px] text-amber-400 mt-0.5">{event.status}</span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing((value) => !value)}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/25"
            >
              {editing ? 'Close edit' : 'Edit event'}
            </button>
            <button
              onClick={() => onCancelEvent(event.id)}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-500/12 px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20"
            >
              Cancel event
            </button>
          </div>

          {editing && (
            <WriteForm
              title="Edit Event"
              fields={updateFields}
              onSubmit={async (values) => { onUpdate(values); setEditing(false); }}
              submitLabel="Save changes"
              onCancel={() => setEditing(false)}
              compact
            />
          )}

          {/* Time */}
          {event.start && (
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-slate-200">{formatFull(event.start)}</p>
                {event.end && <p className="text-xs text-slate-500">{formatFull(event.end)}</p>}
              </div>
            </div>
          )}

          {/* Location */}
          {event.location && (
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-200">{event.location}</p>
            </div>
          )}

          {/* Organizer */}
          {event.organizer && (
            <div className="flex items-start gap-3">
              <Mail className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-200">{event.organizer.displayName || event.organizer.email}</p>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Description</p>
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{event.description}</p>
            </div>
          )}

          {/* Attendees */}
          {event.attendees && event.attendees.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="w-4 h-4 text-slate-400" />
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                  {event.attendees.length} Attendees
                </p>
              </div>
              <div className="space-y-2">
                {event.attendees.map((a, i) => {
                  const { label, cls } = rsvpLabel(a.responseStatus);
                  return (
                    <div key={i} className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center text-xs font-semibold text-slate-300 shrink-0">
                        {(a.displayName?.[0] || a.email[0]).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-200 truncate">{a.displayName || a.email}</p>
                        {a.displayName && <p className="text-[10px] text-slate-600 truncate">{a.email}</p>}
                      </div>
                      <span className={`text-[10px] font-medium shrink-0 ${cls}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {event.htmlLink && (
            <p className="text-[11px] text-slate-500">
              External Google link remains available, but everyday scheduling is expected to happen from Zapheit.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Calendar grid                                                      */
/* ------------------------------------------------------------------ */

const EVENT_COLORS = [
  'bg-blue-500/25 text-blue-200 hover:bg-blue-500/40',
  'bg-violet-500/25 text-violet-200 hover:bg-violet-500/40',
  'bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/40',
  'bg-amber-500/25 text-amber-200 hover:bg-amber-500/40',
];

function MonthGrid({ year, month, events, onEventClick }: {
  year: number; month: number;
  events: CalendarEvent[];
  onEventClick: (e: CalendarEvent) => void;
}) {
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const startOffset = (firstDow + 6) % 7; // shift to Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // Map events to day-of-month
  const byDay = new Map<number, CalendarEvent[]>();
  for (const ev of events) {
    const d = eventDate(ev);
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) continue;
    const day = d.getDate();
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(ev);
  }

  const today = new Date();
  const isToday = (d: number) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="flex-1 overflow-auto">
      {/* Day labels */}
      <div className="grid grid-cols-7 border-b border-white/[0.06] sticky top-0 bg-[#0a0a0f] z-10">
        {DAY_LABELS.map((d) => (
          <div key={d} className="py-2 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{d}</div>
        ))}
      </div>

      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-white/[0.04]" style={{ minHeight: 88 }}>
          {week.map((day, di) => {
            const dayEvs = day ? (byDay.get(day) ?? []) : [];
            const past = day ? new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate()) : false;
            return (
              <div key={di} className={`border-r border-white/[0.03] last:border-r-0 p-1 ${!day ? 'bg-white/[0.01]' : ''}`}>
                {day && (
                  <>
                    <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold mb-1 ${
                      isToday(day) ? 'bg-blue-500 text-white' : past ? 'text-slate-600' : 'text-slate-400'
                    }`}>
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvs.slice(0, 3).map((ev, i) => (
                        <button
                          key={ev.id}
                          onClick={() => onEventClick(ev)}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] font-medium truncate transition-colors ${EVENT_COLORS[i % EVENT_COLORS.length]}`}
                          title={ev.summary}
                        >
                          {formatTime(ev.start) && <span className="opacity-70 mr-1">{formatTime(ev.start)}</span>}
                          {ev.summary || 'Event'}
                        </button>
                      ))}
                      {dayEvs.length > 3 && (
                        <p className="text-[9px] text-slate-500 px-1.5">+{dayEvs.length - 3} more</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function CalendarView({ events, loading, onCreate, onUpdate, onCancelEvent, pendingApprovals = [], onApprovalResolved }: CalendarViewProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const createFields: WriteFormField[] = [
    { name: 'summary', label: 'Title', type: 'text', required: true, placeholder: 'Meeting title' },
    { name: 'startDateTime', label: 'Start', type: 'text', required: true, placeholder: 'YYYY-MM-DDTHH:mm:ss' },
    { name: 'endDateTime', label: 'End', type: 'text', required: true, placeholder: 'YYYY-MM-DDTHH:mm:ss' },
    { name: 'location', label: 'Location', type: 'text', placeholder: 'Room / link' },
    { name: 'attendees', label: 'Attendees', type: 'text', placeholder: 'email1@co.com, email2@co.com' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Agenda…' },
  ];

  const totalThisMonth = events.filter((e) => {
    const d = eventDate(e);
    return d && d.getFullYear() === viewYear && d.getMonth() === viewMonth;
  }).length;

  return (
    <div className="flex flex-col h-full">
      {/* Pending approvals */}
      {pendingApprovals.length > 0 && (
        <div className="px-4 py-3 border-b border-amber-500/15 bg-amber-500/[0.03] space-y-1.5 shrink-0">
          <p className="text-[10px] text-amber-400/80 font-semibold uppercase tracking-wider mb-2">
            Awaiting your approval — {pendingApprovals.length} calendar action{pendingApprovals.length !== 1 ? 's' : ''}
          </p>
          {pendingApprovals.map((a) => (
            <PendingApprovalRow key={a.id} approval={a} onResolved={onApprovalResolved ?? (() => {})} />
          ))}
        </div>
      )}

      {/* Month nav */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] shrink-0">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center">
          <span className="text-sm font-semibold text-white">{MONTHS[viewMonth]} {viewYear}</span>
          {totalThisMonth > 0 && (
            <span className="ml-2 text-[10px] text-slate-500">{totalThisMonth} events</span>
          )}
        </div>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 text-xs font-medium hover:bg-blue-600/30 transition-colors"
        >
          {showCreate ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {showCreate ? 'Cancel' : 'New'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02] shrink-0">
          <WriteForm
            title="New Event"
            fields={createFields}
            onSubmit={async (values) => { onCreate(values); setShowCreate(false); }}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Event"
          />
        </div>
      )}

      {/* Grid or loading */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Calendar className="w-8 h-8 text-slate-700 mx-auto mb-2 animate-pulse" />
            <p className="text-xs text-slate-600">Loading events…</p>
          </div>
        </div>
      ) : (
        <MonthGrid
          year={viewYear}
          month={viewMonth}
          events={events}
          onEventClick={setSelectedEvent}
        />
      )}

      {/* Event modal */}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onUpdate={onUpdate}
          onCancelEvent={onCancelEvent}
        />
      )}
    </div>
  );
}
