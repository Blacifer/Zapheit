import { useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, MapPin, Users, Plus, X, Calendar } from 'lucide-react';
import { WriteForm, PendingApprovalRow, type WriteFormField } from '../shared';
import type { ApprovalRequest } from '../../../../../lib/api/approvals';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OutlookEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: { displayName?: string };
  attendees?: { emailAddress: { address: string; name?: string }; status?: { response?: string } }[];
  organizer?: { emailAddress: { address: string; name?: string } };
  webLink?: string;
  isCancelled?: boolean;
}

interface OutlookCalendarProps {
  events: OutlookEvent[];
  loading: boolean;
  onCreate: (data: Record<string, string>) => void | Promise<void>;
  pendingApprovals?: ApprovalRequest[];
  onApprovalResolved?: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function eventDate(e: OutlookEvent): Date | null {
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
  if (s === 'tentativelyAccepted') return { label: 'Tentative', cls: 'text-amber-400' };
  return { label: 'Invited', cls: 'text-slate-500' };
}

/* ------------------------------------------------------------------ */
/*  Event detail modal                                                 */
/* ------------------------------------------------------------------ */

function EventModal({ event, onClose }: { event: OutlookEvent; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0f1117] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex-1 min-w-0 pr-3">
            <h2 className="text-base font-bold text-white leading-snug">{event.subject || 'Untitled Event'}</h2>
            {event.isCancelled && (
              <span className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-medium">Cancelled</span>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-300 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2">
            <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-slate-300">{formatFull(event.start)}</p>
              {event.end && <p className="text-[11px] text-slate-500 mt-0.5">Ends {formatFull(event.end)}</p>}
            </div>
          </div>

          {event.location?.displayName && (
            <div className="flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-300">{event.location.displayName}</p>
            </div>
          )}

          {event.bodyPreview && (
            <p className="text-xs text-slate-400 leading-relaxed">{event.bodyPreview}</p>
          )}

          {event.organizer && (
            <div className="flex items-start gap-2">
              <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <p className="text-xs text-slate-400">
                Organized by <span className="text-slate-300">{event.organizer.emailAddress.name || event.organizer.emailAddress.address}</span>
              </p>
            </div>
          )}

          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-start gap-2">
              <Users className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                {event.attendees.slice(0, 6).map((a, i) => {
                  const { label, cls } = rsvpLabel(a.status?.response);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-slate-300">{a.emailAddress.name || a.emailAddress.address}</span>
                      <span className={`text-[10px] ${cls}`}>{label}</span>
                    </div>
                  );
                })}
                {event.attendees.length > 6 && (
                  <p className="text-[11px] text-slate-500">+{event.attendees.length - 6} more</p>
                )}
              </div>
            </div>
          )}

          {event.webLink && (
            <a
              href={event.webLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Open in Outlook →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Create event form fields                                           */
/* ------------------------------------------------------------------ */

const CREATE_FIELDS: WriteFormField[] = [
  { name: 'subject',     label: 'Subject',     type: 'text',     required: true },
  { name: 'start',       label: 'Start (ISO)', type: 'text',     required: true, placeholder: '2025-06-01T10:00:00' },
  { name: 'end',         label: 'End (ISO)',   type: 'text',     required: true, placeholder: '2025-06-01T11:00:00' },
  { name: 'location',    label: 'Location',    type: 'text',     required: false },
  { name: 'description', label: 'Description', type: 'textarea', required: false },
  { name: 'attendees',   label: 'Attendees (comma-separated emails)', type: 'text', required: false },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function OutlookCalendar({ events, loading, onCreate, pendingApprovals = [], onApprovalResolved }: OutlookCalendarProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<OutlookEvent | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Mon-start

  const eventsByDate = events.reduce<Record<number, OutlookEvent[]>>((acc, ev) => {
    const d = eventDate(ev);
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) return acc;
    const day = d.getDate();
    if (!acc[day]) acc[day] = [];
    acc[day].push(ev);
    return acc;
  }, {});

  const dayEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];

  const prev = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
    setSelectedDate(null);
  };
  const next = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
    setSelectedDate(null);
  };

  const handleCreate = async (data: Record<string, string>) => {
    const attendees = data.attendees
      ? data.attendees.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    await onCreate({ ...data, ...(attendees.length ? { attendees: JSON.stringify(attendees) } : {}) });
    setShowCreate(false);
  };

  return (
    <div className="flex flex-col h-full">
      {pendingApprovals.length > 0 && (
        <div className="px-4 py-3 border-b border-amber-500/15 bg-amber-500/[0.03] space-y-1.5 shrink-0">
          <p className="text-[10px] text-amber-400/80 font-semibold uppercase tracking-wider mb-2">
            {pendingApprovals.length} pending calendar action{pendingApprovals.length !== 1 ? 's' : ''}
          </p>
          {pendingApprovals.map((a) => (
            <PendingApprovalRow key={a.id} approval={a} onResolved={onApprovalResolved ?? (() => {})} />
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Month nav */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <button onClick={prev} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-white">{MONTHS[month]} {year}</span>
          <button onClick={next} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day labels */}
        <div className="grid grid-cols-7 px-2 pt-2 pb-1">
          {DAY_LABELS.map((d) => (
            <div key={d} className="text-center text-[10px] text-slate-600 font-medium py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="px-2 pb-2">
            <div className="grid grid-cols-7 gap-px">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-10 bg-white/[0.02] rounded animate-pulse" />
              ))}
            </div>
          </div>
        ) : (
          <div className="px-2 pb-2">
            <div className="grid grid-cols-7 gap-px">
              {Array.from({ length: startOffset }).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                const evts = eventsByDate[day] || [];
                const isSelected = selectedDate === day;
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(isSelected ? null : day)}
                    className={`relative flex flex-col items-center p-1 rounded-lg transition-colors min-h-[2.5rem] ${
                      isSelected ? 'bg-blue-500/20 text-white' :
                      isToday ? 'bg-white/[0.06] text-white' :
                      'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                    }`}
                  >
                    <span className={`text-[11px] font-medium ${isToday ? 'text-blue-400' : ''}`}>{day}</span>
                    {evts.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5">
                        {evts.slice(0, 3).map((_, j) => (
                          <span key={j} className="w-1 h-1 rounded-full bg-blue-400" />
                        ))}
                        {evts.length > 3 && <span className="text-[8px] text-blue-400">+</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Day event list */}
        {selectedDate !== null && (
          <div className="border-t border-white/[0.06] px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-300">
                {MONTHS[month]} {selectedDate} — {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-300 text-xs font-medium hover:bg-blue-600/30 transition-colors"
              >
                <Plus className="w-3 h-3" /> New event
              </button>
            </div>

            {dayEvents.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-4">No events on this day</p>
            ) : (
              <div className="space-y-2">
                {dayEvents.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => setSelectedEvent(ev)}
                    className="w-full text-left p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.05] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-semibold leading-snug ${ev.isCancelled ? 'line-through text-slate-500' : 'text-white'}`}>
                        {ev.subject || 'Untitled Event'}
                      </p>
                      <span className="text-[10px] text-slate-500 shrink-0">{formatTime(ev.start)}</span>
                    </div>
                    {ev.location?.displayName && (
                      <p className="flex items-center gap-1 mt-1 text-[11px] text-slate-500">
                        <MapPin className="w-3 h-3" />{ev.location.displayName}
                      </p>
                    )}
                    {ev.attendees && ev.attendees.length > 0 && (
                      <p className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-500">
                        <Users className="w-3 h-3" />{ev.attendees.length} attendee{ev.attendees.length !== 1 ? 's' : ''}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="border-t border-white/[0.06] px-4 py-4">
            <WriteForm
              title="New Calendar Event"
              fields={CREATE_FIELDS}
              onSubmit={handleCreate}
              onCancel={() => setShowCreate(false)}
            />
          </div>
        )}
      </div>

      {/* Event detail modal */}
      {selectedEvent && (
        <EventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
