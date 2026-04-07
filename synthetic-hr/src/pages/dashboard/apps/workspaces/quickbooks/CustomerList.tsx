import { useState, useMemo } from 'react';
import { Search, Plus, User, Mail, Phone, Building2, ChevronRight } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { WriteForm, type WriteFormField } from '../shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QBCustomer {
  Id?: string;
  id?: string;
  DisplayName?: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  CompanyName?: string;
  Balance?: number;
  Active?: boolean;
  MetaData?: { CreateTime?: string; LastUpdatedTime?: string };
}

interface CustomerListProps {
  customers: QBCustomer[];
  loading: boolean;
  onCreate: (data: Record<string, string>) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CustomerList({ customers, loading, onCreate }: CustomerListProps) {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const createFields: WriteFormField[] = [
    { name: 'displayName', label: 'Display Name', type: 'text', required: true, placeholder: 'Jane Doe or Acme Inc' },
    { name: 'email', label: 'Email', type: 'text', placeholder: 'contact@example.com' },
    { name: 'phone', label: 'Phone', type: 'text', placeholder: '+1 555 0123' },
    { name: 'companyName', label: 'Company', type: 'text', placeholder: 'Acme Inc' },
  ];

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter((c) =>
      (c.DisplayName || '').toLowerCase().includes(q) ||
      (c.CompanyName || '').toLowerCase().includes(q) ||
      (c.PrimaryEmailAddr?.Address || '').toLowerCase().includes(q),
    );
  }, [customers, search]);

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
            placeholder="Search customers…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-green-500/30"
          />
        </div>
        <span className="text-[11px] text-slate-600">{filtered.length} customers</span>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600/20 text-green-300 text-[11px] font-medium hover:bg-green-600/30 transition-colors"
        >
          <Plus className="w-3 h-3" /> Add Customer
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <WriteForm
            title="New Customer"
            fields={createFields}
            onSubmit={async (values) => {
              onCreate(values);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create Customer"
          />
        </div>
      )}

      {/* Customer list */}
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
            <p className="text-sm text-slate-500">No customers found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((c) => {
              const cId = c.Id || c.id || '';
              return (
                <div key={cId} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500/30 to-green-600/30 flex items-center justify-center text-green-300 text-xs font-semibold shrink-0">
                      {(c.DisplayName?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-slate-200 truncate">
                          {c.DisplayName || 'Unnamed'}
                        </span>
                        {c.Active === false && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium border border-white/10 bg-white/5 text-slate-500">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        {c.PrimaryEmailAddr?.Address && (
                          <span className="flex items-center gap-0.5 truncate">
                            <Mail className="w-2.5 h-2.5" /> {c.PrimaryEmailAddr.Address}
                          </span>
                        )}
                        {c.PrimaryPhone?.FreeFormNumber && (
                          <span className="flex items-center gap-0.5">
                            <Phone className="w-2.5 h-2.5" /> {c.PrimaryPhone.FreeFormNumber}
                          </span>
                        )}
                        {c.CompanyName && (
                          <span className="flex items-center gap-0.5">
                            <Building2 className="w-2.5 h-2.5" /> {c.CompanyName}
                          </span>
                        )}
                      </div>
                    </div>
                    {c.Balance != null && c.Balance > 0 && (
                      <span className="text-xs text-amber-400 font-medium shrink-0">
                        ${c.Balance.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
