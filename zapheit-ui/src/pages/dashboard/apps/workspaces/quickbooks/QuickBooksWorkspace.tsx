import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileText, Users, CreditCard,
  Activity, Bot, RefreshCw, Loader2,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { InvoiceList, type QBInvoice } from './InvoiceList';
import { CustomerList, type QBCustomer } from './CustomerList';
import { QuickBooksActivityTab } from './QuickBooksActivityTab';
import { QuickBooksAutomationTab } from './QuickBooksAutomationTab';

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'invoices',   label: 'Invoices',   Icon: FileText },
  { id: 'customers',  label: 'Customers',  Icon: Users },
  { id: 'payments',   label: 'Payments',   Icon: CreditCard },
  { id: 'activity',   label: 'Activity',   Icon: Activity },
  { id: 'automation', label: 'Automation', Icon: Bot },
] as const;

type TabId = (typeof TABS)[number]['id'];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function QuickBooksWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('invoices');
  const [showBanner, setShowBanner] = useState(true);

  /* Data state */
  const [invoices, setInvoices] = useState<QBInvoice[]>([]);
  const [customers, setCustomers] = useState<QBCustomer[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  /* Loading */
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);

  /* --------------------------------------------------------------- */
  /*  Data loaders                                                     */
  /* --------------------------------------------------------------- */

  const loadInvoices = useCallback(async () => {
    setLoadingInvoices(true);
    try {
      const res = await api.unifiedConnectors.executeAction('quickbooks', 'list_invoices', { limit: 50 });
      const _inner = res.data as any;
      const _list = _inner?.data?.data ?? _inner?.data;
      if (res.success) setInvoices(Array.isArray(_list) ? _list : []);
      setConnectionStatus('connected');
    } catch {
      setConnectionStatus('disconnected');
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      const res = await api.unifiedConnectors.executeAction('quickbooks', 'list_customers', { limit: 50 });
      const _inner = res.data as any;
      const _list = _inner?.data?.data ?? _inner?.data;
      if (res.success) setCustomers(Array.isArray(_list) ? _list : []);
    } catch { /* empty */ }
    finally { setLoadingCustomers(false); }
  }, []);

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    try {
      const res = await api.unifiedConnectors.executeAction('quickbooks', 'list_payments', { limit: 50 });
      const _inner = res.data as any;
      const _list = _inner?.data?.data ?? _inner?.data;
      if (res.success) setPayments(Array.isArray(_list) ? _list : []);
    } catch { /* empty */ }
    finally { setLoadingPayments(false); }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Write actions                                                    */
  /* --------------------------------------------------------------- */

  const createInvoice = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('quickbooks', 'create_invoice', data);
      if (res.success) {
        toast.success('Invoice created');
        void loadInvoices();
      } else {
        toast.error(res.error || 'Failed to create invoice');
      }
    } catch { toast.error('Network error'); }
  }, [loadInvoices]);

  const sendInvoice = useCallback(async (invoiceId: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction('quickbooks', 'send_invoice', { invoiceId });
      if (res.success) {
        toast.success('Invoice sent');
        void loadInvoices();
      } else {
        toast.error(res.error || 'Failed to send invoice');
      }
    } catch { toast.error('Network error'); }
  }, [loadInvoices]);

  const voidInvoice = useCallback(async (invoiceId: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction('quickbooks', 'void_invoice', { invoiceId });
      if (res.success) {
        toast.success('Invoice voided');
        void loadInvoices();
      } else {
        toast.error(res.error || 'Failed to void invoice');
      }
    } catch { toast.error('Network error'); }
  }, [loadInvoices]);

  const createCustomer = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('quickbooks', 'create_customer', data);
      if (res.success) {
        toast.success('Customer created');
        void loadCustomers();
      } else {
        toast.error(res.error || 'Failed to create customer');
      }
    } catch { toast.error('Network error'); }
  }, [loadCustomers]);

  /* Auto-load on mount */
  useEffect(() => { void loadInvoices(); }, [loadInvoices]);

  /* Load tab data on switch */
  useEffect(() => {
    if (activeTab === 'customers' && customers.length === 0) void loadCustomers();
    if (activeTab === 'payments' && payments.length === 0) void loadPayments();
  }, [activeTab, customers.length, payments.length, loadCustomers, loadPayments]);

  /* --------------------------------------------------------------- */
  /*  Refresh                                                          */
  /* --------------------------------------------------------------- */

  const refreshCurrent = useCallback(() => {
    if (activeTab === 'invoices') void loadInvoices();
    else if (activeTab === 'customers') void loadCustomers();
    else if (activeTab === 'payments') void loadPayments();
  }, [activeTab, loadInvoices, loadCustomers, loadPayments]);

  const isLoading = loadingInvoices || loadingCustomers || loadingPayments;

  /* --------------------------------------------------------------- */
  /*  Render                                                           */
  /* --------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
        <button
          onClick={() => navigate('/dashboard/apps')}
          className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white font-bold text-sm">
          QB
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">QuickBooks</h1>
            <StatusBadge status={connectionStatus} />
          </div>
          <p className="text-[10px] text-slate-500">Accounting — Invoices, Customers &amp; Payments</p>
        </div>

        <button
          onClick={refreshCurrent}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors disabled:opacity-40"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-5 py-1.5 border-b border-white/5 shrink-0 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              activeTab === id
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
            )}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Agent suggestion banner */}
      {showBanner && (
        <div className="px-5 pt-3 pb-1 shrink-0">
          <AgentSuggestionBanner serviceId="quickbooks" onDismiss={() => setShowBanner(false)} />
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'invoices' ? (
        <div className="flex-1 overflow-hidden">
          <InvoiceList
            invoices={invoices}
            loading={loadingInvoices}
            onCreate={createInvoice}
            onSend={sendInvoice}
            onVoid={voidInvoice}
          />
        </div>
      ) : activeTab === 'customers' ? (
        <div className="flex-1 overflow-hidden">
          <CustomerList
            customers={customers}
            loading={loadingCustomers}
            onCreate={createCustomer}
          />
        </div>
      ) : activeTab === 'payments' ? (
        <div className="flex-1 overflow-hidden">
          {loadingPayments ? (
            <div className="animate-pulse space-y-1 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <EmptyState type="no-data" description="No payments found" />
          ) : (
            <div className="divide-y divide-white/[0.04] overflow-y-auto h-full">
              {payments.map((p: any) => (
                <div key={p.Id || p.id} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <CreditCard className="w-4 h-4 text-green-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Payment #{p.Id || p.id}
                    </span>
                    {p.TotalAmt && (
                      <span className="text-xs text-green-400 font-medium">${Number(p.TotalAmt).toLocaleString()}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-6 text-[10px] text-slate-500">
                    {p.CustomerRef?.name && <span>{p.CustomerRef.name}</span>}
                    {p.TxnDate && <span>{p.TxnDate}</span>}
                    {p.PaymentMethodRef?.name && <span>via {p.PaymentMethodRef.name}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <QuickBooksActivityTab />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <QuickBooksAutomationTab />
        </div>
      )}
    </div>
  );
}
