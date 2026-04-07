import { useState, useMemo } from 'react';
import { Search, FileText, Plus, Send, Ban, DollarSign, Clock, ChevronRight } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { WriteForm, type WriteFormField } from '../shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QBInvoice {
  Id?: string;
  id?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: { value: string; name: string };
  EmailStatus?: string;
  status?: string;
}

interface InvoiceListProps {
  invoices: QBInvoice[];
  loading: boolean;
  onCreate: (data: Record<string, string>) => void;
  onSend: (invoiceId: string) => void;
  onVoid: (invoiceId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  paid:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  overdue: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  sent:    'text-blue-400 bg-blue-500/10 border-blue-500/20',
  draft:   'text-slate-400 bg-white/5 border-white/10',
  voided:  'text-slate-500 bg-white/5 border-white/10',
};

function invoiceStatus(inv: QBInvoice): string {
  if (inv.status) return inv.status.toLowerCase();
  if (inv.Balance === 0 && (inv.TotalAmt ?? 0) > 0) return 'paid';
  if (inv.DueDate && new Date(inv.DueDate) < new Date()) return 'overdue';
  if (inv.EmailStatus === 'EmailSent') return 'sent';
  return 'draft';
}

function fmtCurrency(val?: number) {
  if (val == null) return '';
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function InvoiceList({ invoices, loading, onCreate, onSend, onVoid }: InvoiceListProps) {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const createFields: WriteFormField[] = [
    { name: 'customerRef', label: 'Customer ID', type: 'text', required: true, placeholder: 'Customer reference ID' },
    { name: 'amount', label: 'Amount', type: 'text', required: true, placeholder: '1500.00' },
    { name: 'dueDate', label: 'Due Date', type: 'text', placeholder: 'YYYY-MM-DD' },
    { name: 'description', label: 'Description', type: 'text', placeholder: 'Service description' },
  ];

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter((inv) =>
      (inv.DocNumber || '').toLowerCase().includes(q) ||
      (inv.CustomerRef?.name || '').toLowerCase().includes(q),
    );
  }, [invoices, search]);

  const totals = useMemo(() => ({
    total: invoices.reduce((s, i) => s + (i.TotalAmt || 0), 0),
    outstanding: invoices.reduce((s, i) => s + (i.Balance || 0), 0),
  }), [invoices]);

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
            placeholder="Search invoices…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-green-500/30"
          />
        </div>
        <span className="text-[11px] text-slate-600">
          {filtered.length} invoices · {fmtCurrency(totals.outstanding)} outstanding
        </span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600/20 text-green-300 text-[11px] font-medium hover:bg-green-600/30 transition-colors"
        >
          <Plus className="w-3 h-3" /> New Invoice
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <WriteForm
            title="New Invoice"
            fields={createFields}
            onSubmit={async (values) => {
              onCreate(values);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Invoice"
          />
        </div>
      )}

      {/* Invoice list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="animate-pulse space-y-1 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No invoices found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((inv) => {
              const invId = inv.Id || inv.id || '';
              const status = invoiceStatus(inv);
              const expanded = expandedId === invId;

              return (
                <div key={invId} className="hover:bg-white/[0.02] transition-colors">
                  <button
                    onClick={() => setExpandedId(expanded ? null : invId)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-green-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-slate-200">
                            INV-{inv.DocNumber || invId}
                          </span>
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[9px] font-medium border capitalize',
                            STATUS_COLORS[status] || STATUS_COLORS.draft,
                          )}>
                            {status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500">
                          {inv.CustomerRef?.name && <span>{inv.CustomerRef.name}</span>}
                          {inv.TotalAmt != null && (
                            <span className="text-green-400 font-medium">{fmtCurrency(inv.TotalAmt)}</span>
                          )}
                          {inv.Balance != null && inv.Balance > 0 && (
                            <span className="text-amber-400">Balance: {fmtCurrency(inv.Balance)}</span>
                          )}
                          {inv.DueDate && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" /> Due {inv.DueDate}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className={cn(
                        'w-3.5 h-3.5 text-slate-600 transition-transform',
                        expanded && 'rotate-90',
                      )} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-3 ml-7 flex gap-2">
                      {status !== 'sent' && status !== 'paid' && status !== 'voided' && (
                        <button
                          onClick={() => onSend(invId)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 text-[10px] font-medium hover:bg-blue-500/30 transition-colors"
                        >
                          <Send className="w-3 h-3" /> Send
                        </button>
                      )}
                      {status !== 'voided' && status !== 'paid' && (
                        <button
                          onClick={() => onVoid(invId)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 text-[10px] font-medium hover:bg-rose-500/30 transition-colors"
                        >
                          <Ban className="w-3 h-3" /> Void
                        </button>
                      )}
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
