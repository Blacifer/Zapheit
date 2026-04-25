import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, DollarSign, Building2,
  Activity, Bot, RefreshCw, Loader2,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState } from '../shared';
import AgentSuggestionBanner from '../../../../../components/AgentSuggestionBanner';
import { ContactList, type HubSpotContact } from './ContactList';
import { DealPipeline, type HubSpotDeal } from './DealPipeline';
import { HubSpotActivityTab } from './HubSpotActivityTab';
import { HubSpotAutomationTab } from './HubSpotAutomationTab';

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'contacts',   label: 'Contacts',   Icon: Users },
  { id: 'deals',      label: 'Deals',      Icon: DollarSign },
  { id: 'companies',  label: 'Companies',  Icon: Building2 },
  { id: 'activity',   label: 'Activity',   Icon: Activity },
  { id: 'automation', label: 'Automation', Icon: Bot },
] as const;

type TabId = (typeof TABS)[number]['id'];

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function HubSpotWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('contacts');
  const [showBanner, setShowBanner] = useState(true);

  /* Data state */
  const [contacts, setContacts] = useState<HubSpotContact[]>([]);
  const [deals, setDeals] = useState<HubSpotDeal[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  /* Loading */
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingDeals, setLoadingDeals] = useState(false);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  /* --------------------------------------------------------------- */
  /*  Data loaders                                                     */
  /* --------------------------------------------------------------- */

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const res = await api.unifiedConnectors.executeAction('hubspot', 'list_contacts', { limit: 50 });
      if (res.success && res.data?.data) setContacts(res.data.data);
      setConnectionStatus('connected');
    } catch {
      setConnectionStatus('disconnected');
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  const loadDeals = useCallback(async () => {
    setLoadingDeals(true);
    try {
      const res = await api.unifiedConnectors.executeAction('hubspot', 'list_deals', { limit: 50 });
      if (res.success && res.data?.data) setDeals(res.data.data);
    } catch { /* empty */ }
    finally { setLoadingDeals(false); }
  }, []);

  const loadCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    try {
      const res = await api.unifiedConnectors.executeAction('hubspot', 'list_companies', { limit: 50 });
      if (res.success && res.data?.data) setCompanies(res.data.data);
    } catch { /* empty */ }
    finally { setLoadingCompanies(false); }
  }, []);

  /* --------------------------------------------------------------- */
  /*  Write actions                                                    */
  /* --------------------------------------------------------------- */

  const createContact = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('hubspot', 'create_contact', data);
      if (res.success) {
        toast.success('Contact created');
        void loadContacts();
      } else {
        toast.error(res.error || 'Failed to create contact');
      }
    } catch { toast.error('Network error'); }
  }, [loadContacts]);

  const createDeal = useCallback(async (data: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('hubspot', 'create_deal', data);
      if (res.success) {
        toast.success('Deal created');
        void loadDeals();
      } else {
        toast.error(res.error || 'Failed to create deal');
      }
    } catch { toast.error('Network error'); }
  }, [loadDeals]);

  const updateDeal = useCallback(async (dealId: string, properties: Record<string, string>) => {
    try {
      const res = await api.unifiedConnectors.executeAction('hubspot', 'update_deal', { dealId, ...properties });
      if (res.success) {
        toast.success('Deal updated');
        void loadDeals();
      } else {
        toast.error(res.error || 'Failed to update deal');
      }
    } catch { toast.error('Network error'); }
  }, [loadDeals]);

  const addNote = useCallback(async (contactId: string, body: string) => {
    try {
      const res = await api.unifiedConnectors.executeAction('hubspot', 'add_note', { contactId, body });
      if (res.success) {
        toast.success('Note added');
      } else {
        toast.error(res.error || 'Failed to add note');
      }
    } catch { toast.error('Network error'); }
  }, []);

  /* Auto-load on mount */
  useEffect(() => { void loadContacts(); }, [loadContacts]);

  /* Load tab data on switch */
  useEffect(() => {
    if (activeTab === 'deals' && deals.length === 0) void loadDeals();
    if (activeTab === 'companies' && companies.length === 0) void loadCompanies();
  }, [activeTab, deals.length, companies.length, loadDeals, loadCompanies]);

  /* --------------------------------------------------------------- */
  /*  Refresh                                                          */
  /* --------------------------------------------------------------- */

  const refreshCurrent = useCallback(() => {
    if (activeTab === 'contacts') void loadContacts();
    else if (activeTab === 'deals') void loadDeals();
    else if (activeTab === 'companies') void loadCompanies();
  }, [activeTab, loadContacts, loadDeals, loadCompanies]);

  const isLoading = loadingContacts || loadingDeals || loadingCompanies;

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

        {/* HubSpot logo */}
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm">
          H
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">HubSpot</h1>
            <StatusBadge status={connectionStatus} />
          </div>
          <p className="text-[10px] text-slate-500">CRM — Contacts, Deals &amp; Companies</p>
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
          <AgentSuggestionBanner serviceId="hubspot" onDismiss={() => setShowBanner(false)} />
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'contacts' ? (
        <div className="flex-1 overflow-hidden">
          <ContactList
            contacts={contacts}
            loading={loadingContacts}
            onCreate={createContact}
            onAddNote={addNote}
          />
        </div>
      ) : activeTab === 'deals' ? (
        <div className="flex-1 overflow-hidden">
          <DealPipeline
            deals={deals}
            loading={loadingDeals}
            onCreate={createDeal}
            onUpdateStage={updateDeal}
          />
        </div>
      ) : activeTab === 'companies' ? (
        <div className="flex-1 overflow-hidden">
          {loadingCompanies ? (
            <div className="animate-pulse space-y-1 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-white/[0.03] rounded-lg" />
              ))}
            </div>
          ) : companies.length === 0 ? (
            <EmptyState type="no-data" description="No companies found" />
          ) : (
            <div className="divide-y divide-white/[0.04] overflow-y-auto h-full">
              {companies.map((c: any) => (
                <div key={c.id} className="px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="w-4 h-4 text-orange-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      {c.properties?.name || 'Unnamed'}
                    </span>
                    {c.properties?.domain && (
                      <span className="text-[10px] text-slate-500">{c.properties.domain}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-6 text-[10px] text-slate-500">
                    {c.properties?.industry && <span>{c.properties.industry}</span>}
                    {c.properties?.city && <span>{c.properties.city}{c.properties?.state ? `, ${c.properties.state}` : ''}</span>}
                    {c.properties?.numberofemployees && <span>{c.properties.numberofemployees} employees</span>}
                    {c.properties?.annualrevenue && <span>${Number(c.properties.annualrevenue).toLocaleString()} revenue</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'activity' ? (
        <div className="flex-1 overflow-y-auto">
          <HubSpotActivityTab />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <HubSpotAutomationTab />
        </div>
      )}
    </div>
  );
}
