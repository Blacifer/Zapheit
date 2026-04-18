import { useState, useMemo } from 'react';
import { Search, Mail, Phone, Building2, User, Plus, ChevronRight, Briefcase, StickyNote } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { WriteForm, type WriteFormField } from '../shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    company?: string;
    jobtitle?: string;
    lifecyclestage?: string;
    createdate?: string;
    lastmodifieddate?: string;
  };
}

interface ContactListProps {
  contacts: HubSpotContact[];
  loading: boolean;
  onCreate: (data: Record<string, string>) => void;
  onAddNote: (contactId: string, body: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const STAGE_COLORS: Record<string, string> = {
  subscriber:             'bg-slate-500',
  lead:                   'bg-cyan-400',
  marketingqualifiedlead: 'bg-blue-400',
  salesqualifiedlead:     'bg-violet-400',
  opportunity:            'bg-amber-400',
  customer:               'bg-emerald-400',
  evangelist:             'bg-pink-400',
  other:                  'bg-slate-400',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ContactList({ contacts, loading, onCreate, onAddNote }: ContactListProps) {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  const createFields: WriteFormField[] = [
    { name: 'email', label: 'Email', type: 'text', required: true, placeholder: 'contact@example.com' },
    { name: 'firstname', label: 'First Name', type: 'text', placeholder: 'Jane' },
    { name: 'lastname', label: 'Last Name', type: 'text', placeholder: 'Doe' },
    { name: 'phone', label: 'Phone', type: 'text', placeholder: '+1 555 0123' },
    { name: 'company', label: 'Company', type: 'text', placeholder: 'Acme Inc' },
    { name: 'jobtitle', label: 'Job Title', type: 'text', placeholder: 'VP of Sales' },
  ];

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter((c) => {
      const p = c.properties;
      return (
        (p.firstname || '').toLowerCase().includes(q) ||
        (p.lastname || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q) ||
        (p.company || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
          />
        </div>
        <span className="text-[11px] text-slate-600">{filtered.length} contacts</span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-600/20 text-orange-300 text-[11px] font-medium hover:bg-orange-600/30 transition-colors"
        >
          <Plus className="w-3 h-3" /> Add Contact
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <WriteForm
            title="New Contact"
            fields={createFields}
            onSubmit={async (values) => {
              onCreate(values);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Contact"
          />
        </div>
      )}

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <User className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No contacts found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((c) => {
              const p = c.properties;
              const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || 'Unknown';
              const stage = p.lifecyclestage?.toLowerCase() || 'other';
              const expanded = expandedId === c.id;

              return (
                <div key={c.id} className="hover:bg-white/[0.02] transition-colors">
                  <button
                    onClick={() => setExpandedId(expanded ? null : c.id)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar placeholder */}
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500/30 to-orange-600/30 flex items-center justify-center text-orange-300 text-xs font-semibold shrink-0">
                        {(p.firstname?.[0] || p.email?.[0] || '?').toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-slate-200 truncate">{name}</span>
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full shrink-0',
                              STAGE_COLORS[stage] || STAGE_COLORS.other,
                            )}
                            title={stage}
                          />
                          <span className="text-[9px] text-slate-600 uppercase">{stage}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          {p.email && (
                            <span className="flex items-center gap-0.5 truncate">
                              <Mail className="w-2.5 h-2.5" /> {p.email}
                            </span>
                          )}
                          {p.company && (
                            <span className="flex items-center gap-0.5">
                              <Building2 className="w-2.5 h-2.5" /> {p.company}
                            </span>
                          )}
                          {p.jobtitle && (
                            <span className="flex items-center gap-0.5">
                              <Briefcase className="w-2.5 h-2.5" /> {p.jobtitle}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {p.lastmodifieddate && (
                          <span className="text-[10px] text-slate-600">{timeAgo(p.lastmodifieddate)}</span>
                        )}
                        <ChevronRight className={cn(
                          'w-3.5 h-3.5 text-slate-600 transition-transform',
                          expanded && 'rotate-90',
                        )} />
                      </div>
                    </div>
                  </button>

                  {/* Expanded — add note */}
                  {expanded && (
                    <div className="px-4 pb-3 ml-11 space-y-2">
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        {p.phone && (
                          <span className="flex items-center gap-0.5">
                            <Phone className="w-2.5 h-2.5" /> {p.phone}
                          </span>
                        )}
                        {p.createdate && <span>Created {timeAgo(p.createdate)}</span>}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Add a note…"
                          className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-orange-500/30"
                        />
                        <button
                          onClick={() => {
                            if (noteText.trim()) {
                              onAddNote(c.id, noteText.trim());
                              setNoteText('');
                            }
                          }}
                          disabled={!noteText.trim()}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 text-xs text-white disabled:opacity-40 hover:bg-white/20 transition-colors"
                        >
                          <StickyNote className="w-3 h-3" /> Note
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
