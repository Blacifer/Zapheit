import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MessageCircle, Phone, Users, Activity, RefreshCw, Loader2,
  Send, Search, CheckCheck, Clock, Bot, User, Filter, Plus,
} from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { api } from '../../../../../lib/api-client';
import { toast } from '../../../../../lib/toast';
import { StatusBadge, EmptyState, ProductionTruthBanner } from '../shared';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = 'conversations' | 'contacts' | 'templates' | 'activity' | 'automation';

interface WhatsAppConversation {
  id: string;
  phone: string;
  name: string;
  lastMessage: string;
  lastTs: string;
  unread: number;
  status: 'active' | 'resolved' | 'pending';
  assignedAgent?: string;
}

interface WhatsAppMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  ts: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  sender: string;
  isAgent?: boolean;
}

interface WhatsAppTemplate {
  id: string;
  name: string;
  category: string;
  language: string;
  status: 'approved' | 'pending' | 'rejected';
  body: string;
}

interface WhatsAppContact {
  id: string;
  phone: string;
  name: string;
  labels: string[];
  lastSeen: string;
  optedIn: boolean;
}

const CONNECTOR_ID = 'whatsapp';

/* ------------------------------------------------------------------ */
/*  Sample data (shown when connector is not yet live)                 */
/* ------------------------------------------------------------------ */

const DEMO_CONVERSATIONS: WhatsAppConversation[] = [
  { id: '1', phone: '+91 98765 43210', name: 'Rajesh Kumar', lastMessage: 'Kya mera order dispatch hua?', lastTs: '2 min ago', unread: 2, status: 'active', assignedAgent: 'Support Agent' },
  { id: '2', phone: '+91 87654 32109', name: 'Priya Sharma', lastMessage: 'I need a quotation for 500 units', lastTs: '15 min ago', unread: 1, status: 'active', assignedAgent: 'Sales Agent' },
  { id: '3', phone: '+91 76543 21098', name: 'Amit Patel', lastMessage: 'Thank you for the update!', lastTs: '1 hr ago', unread: 0, status: 'resolved' },
  { id: '4', phone: '+91 65432 10987', name: 'Sunita Mehta', lastMessage: 'Payment reference: UTR123456789', lastTs: '2 hr ago', unread: 0, status: 'resolved', assignedAgent: 'Payment Agent' },
  { id: '5', phone: '+91 96543 21098', name: 'Vikram Singh', lastMessage: 'Site visit kab schedule hoga?', lastTs: '3 hr ago', unread: 1, status: 'pending', assignedAgent: 'Site Visit Agent' },
  { id: '6', phone: '+91 88765 43210', name: 'Neha Gupta', lastMessage: 'CV attached for the developer role', lastTs: '5 hr ago', unread: 0, status: 'active', assignedAgent: 'Recruitment Agent' },
];

const DEMO_MESSAGES: WhatsAppMessage[] = [
  { id: 'm1', direction: 'inbound', content: 'Hi, mujhe apne order ke baare mein jaankari chahiye', ts: '10:30 AM', status: 'read', sender: 'Rajesh Kumar' },
  { id: 'm2', direction: 'outbound', content: 'Namaste Rajesh ji! Main aapka order check karta hoon. Kya aap apna order number bata sakte hain?', ts: '10:30 AM', status: 'read', sender: 'Support Agent', isAgent: true },
  { id: 'm3', direction: 'inbound', content: 'ORD-2024-5678', ts: '10:31 AM', status: 'read', sender: 'Rajesh Kumar' },
  { id: 'm4', direction: 'outbound', content: '📦 **Order #ORD-2024-5678**\n\n• Status: Shipped\n• Carrier: BlueDart (AWB: BD987654321)\n• Expected Delivery: 10 April 2026\n\nAapka order kal tak deliver ho jayega! Koi aur sawal ho toh bataiye.', ts: '10:31 AM', status: 'delivered', sender: 'Support Agent', isAgent: true },
  { id: 'm5', direction: 'inbound', content: 'Kya mera order dispatch hua?', ts: '10:32 AM', status: 'read', sender: 'Rajesh Kumar' },
  { id: 'm6', direction: 'outbound', content: 'Ji haan, aapka order kal dispatch ho gaya hai! Tracking link: https://track.bluedart.com/BD987654321\n\n✅ Dispatch: 7 April 2026\n🚚 In Transit: BlueDart\n📍 Expected: 10 April 2026', ts: '10:32 AM', status: 'sent', sender: 'Support Agent', isAgent: true },
];

const DEMO_TEMPLATES: WhatsAppTemplate[] = [
  { id: 't1', name: 'order_confirmation', category: 'UTILITY', language: 'hi', status: 'approved', body: 'Namaste {{1}}! Aapka order #{{2}} confirm ho gaya hai. Expected delivery: {{3}}. Track karne ke liye yahan click karein: {{4}}' },
  { id: 't2', name: 'payment_reminder', category: 'UTILITY', language: 'en', status: 'approved', body: 'Hi {{1}}, this is a friendly reminder that your invoice #{{2}} of ₹{{3}} is due on {{4}}. Please make the payment at your earliest convenience.' },
  { id: 't3', name: 'lead_followup', category: 'MARKETING', language: 'en', status: 'approved', body: 'Hi {{1}}, thank you for your interest in {{2}}! Would you like to schedule a quick 15-minute call to discuss your requirements? Reply YES to confirm.' },
  { id: 't4', name: 'interview_scheduled', category: 'UTILITY', language: 'en', status: 'approved', body: 'Dear {{1}}, your interview for the {{2}} position has been scheduled for {{3}} at {{4}}. Please confirm your availability by replying YES.' },
  { id: 't5', name: 'site_visit_reminder', category: 'UTILITY', language: 'hi', status: 'pending', body: 'Namaste {{1}}, aapka site visit {{2}} ko {{3}} baje scheduled hai. Address: {{4}}. Confirm karne ke liye YES reply karein.' },
];

const DEMO_CONTACTS: WhatsAppContact[] = [
  { id: 'c1', phone: '+91 98765 43210', name: 'Rajesh Kumar', labels: ['customer', 'active'], lastSeen: '2 min ago', optedIn: true },
  { id: 'c2', phone: '+91 87654 32109', name: 'Priya Sharma', labels: ['lead', 'enterprise'], lastSeen: '15 min ago', optedIn: true },
  { id: 'c3', phone: '+91 76543 21098', name: 'Amit Patel', labels: ['customer'], lastSeen: '1 hr ago', optedIn: true },
  { id: 'c4', phone: '+91 65432 10987', name: 'Sunita Mehta', labels: ['vendor'], lastSeen: '2 hr ago', optedIn: true },
  { id: 'c5', phone: '+91 96543 21098', name: 'Vikram Singh', labels: ['lead', 'real-estate'], lastSeen: '3 hr ago', optedIn: false },
  { id: 'c6', phone: '+91 88765 43210', name: 'Neha Gupta', labels: ['candidate'], lastSeen: '5 hr ago', optedIn: true },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WhatsAppWorkspace() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<Tab>('conversations');
  const [selectedConvo, setSelectedConvo] = useState<WhatsAppConversation | null>(null);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState('');
  const [search, setSearch] = useState('');

  /* -- Load conversations ------------------------------------------ */
  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_conversations', {});
      if (res.success && res.data?.data) {
        const list = Array.isArray(res.data.data) ? res.data.data : res.data.data?.conversations ?? [];
        setConversations(list);
        setConnected(true);
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  /* -- Load contacts ----------------------------------------------- */
  const loadContacts = useCallback(async () => {
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_contacts', {});
      if (res.success && res.data?.data) {
        const list = Array.isArray(res.data.data) ? res.data.data : res.data.data?.contacts ?? [];
        setContacts(list.map((c: any) => ({
          id: c.id,
          phone: c.phone,
          name: c.name || c.phone,
          labels: c.labels || [],
          lastSeen: c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—',
          optedIn: c.opted_in ?? true,
        })));
      }
    } catch { /* silently fail — will show empty state */ }
  }, []);

  /* -- Load templates ---------------------------------------------- */
  const loadTemplates = useCallback(async () => {
    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'list_templates', {});
      if (res.success && res.data?.data) {
        const list = Array.isArray(res.data.data) ? res.data.data : res.data.data?.templates ?? [];
        setTemplates(list.map((t: any) => ({
          id: t.wa_template_id || t.id,
          name: t.name,
          category: t.category || 'UTILITY',
          language: t.language || 'en',
          status: (t.status || 'pending').toLowerCase(),
          body: t.body || '',
        })));
      }
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => {
    void loadConversations();
    void loadContacts();
    void loadTemplates();
  }, [loadConversations, loadContacts, loadTemplates]);

  /* -- Select conversation ----------------------------------------- */
  const handleSelectConvo = useCallback(async (convo: WhatsAppConversation) => {
    setSelectedConvo(convo);
    setActiveTab('conversations');
    setMessages([]);

    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'get_messages', { phone: convo.phone });
      if (res.success && res.data?.data) {
        const list = Array.isArray(res.data.data) ? res.data.data : res.data.data?.messages ?? [];
        setMessages(list.map((m: any) => ({
          id: m.id || m.wa_message_id,
          direction: m.direction || 'inbound',
          content: m.content || '',
          ts: m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
          status: m.status || 'sent',
          sender: m.direction === 'outbound' ? 'You' : convo.name,
          isAgent: m.direction === 'outbound',
        })));
      }
    } catch {
      // Unable to load messages
    }
  }, []);

  /* -- Send message ------------------------------------------------ */
  const handleSend = useCallback(async () => {
    if (!compose.trim() || !selectedConvo) return;
    const newMsg: WhatsAppMessage = {
      id: `m${Date.now()}`,
      direction: 'outbound',
      content: compose.trim(),
      ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
      sender: 'You',
    };
    setMessages((prev) => [...prev, newMsg]);
    setCompose('');

    try {
      const res = await api.unifiedConnectors.executeAction(CONNECTOR_ID, 'send_message', {
        phone: selectedConvo.phone,
        text: compose.trim(),
      });
      if (res.success) {
        toast.success('Message sent');
        setMessages((prev) => prev.map((m) => m.id === newMsg.id ? { ...m, status: 'delivered' } : m));
      } else {
        toast.error(res.data?.error || 'Failed to send message');
        setMessages((prev) => prev.map((m) => m.id === newMsg.id ? { ...m, status: 'failed' } : m));
      }
    } catch {
      toast.error('Failed to send message');
      setMessages((prev) => prev.map((m) => m.id === newMsg.id ? { ...m, status: 'failed' } : m));
    }
  }, [compose, selectedConvo]);

  /* -- Tabs -------------------------------------------------------- */
  const TABS: { key: Tab; label: string; icon: typeof MessageCircle }[] = [
    { key: 'conversations', label: 'Chats', icon: MessageCircle },
    { key: 'contacts', label: 'Contacts', icon: Users },
    { key: 'templates', label: 'Templates', icon: Phone },
    { key: 'activity', label: 'Activity', icon: Activity },
  ];

  const filteredConvos = conversations.filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="min-h-[600px] flex flex-col bg-slate-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900/60">
        <button onClick={() => navigate('/dashboard/apps')} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-lg bg-green-500/20 border border-green-500/30 flex items-center justify-center">
          <MessageCircle className="w-4 h-4 text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-white">WhatsApp Business</h1>
          <p className="text-[11px] text-slate-400">
            {connected === null ? 'Checking...' : connected ? 'Connected via Meta Cloud API' : 'Meta Cloud API required for production'}
          </p>
        </div>
        <StatusBadge status={connected ? 'active' : 'sample_data'} label={connected ? undefined : 'Sample data'} />
        <button onClick={loadConversations} className="text-slate-400 hover:text-white transition-colors p-1">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Sample data banner — shown when not live-connected */}
      {!connected && (
        <div className="mx-4 mt-3">
          <ProductionTruthBanner title="WhatsApp sample records visible" connectorName="WhatsApp Business">
            Connect and verify Meta Cloud API credentials before sending messages, syncing conversations, or using these records for customer proof.
            Sample conversations are not audit, SLA, or ROI evidence.
          </ProductionTruthBanner>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0.5 px-4 pt-2 border-b border-slate-800 bg-slate-900/40">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors -mb-px border-b-2',
              activeTab === key
                ? 'text-green-400 border-green-400 bg-slate-800/40'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conversations tab */}
        {activeTab === 'conversations' && (
          <>
            {/* Conversation list */}
            <div className="w-80 shrink-0 border-r border-slate-800 flex flex-col overflow-hidden">
              {/* Search */}
              <div className="p-2 border-b border-slate-800/50">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search conversations…"
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-800/60 border border-slate-700/50 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-green-500/50"
                  />
                </div>
              </div>
              {/* List */}
              <div className="flex-1 overflow-y-auto">
                {filteredConvos.map((convo) => (
                  <button
                    key={convo.id}
                    onClick={() => handleSelectConvo(convo)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 border-b border-slate-800/30 hover:bg-slate-800/40 transition-colors',
                      selectedConvo?.id === convo.id && 'bg-slate-800/60'
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-white truncate">{convo.name}</span>
                          <span className="text-[10px] text-slate-500 shrink-0 ml-2">{convo.lastTs}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{convo.lastMessage}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-slate-500">{convo.phone}</span>
                          {convo.unread > 0 && (
                            <span className="text-[9px] bg-green-500 text-white px-1.5 py-0.5 rounded-full font-bold">{convo.unread}</span>
                          )}
                          {convo.assignedAgent && (
                            <span className="text-[9px] bg-blue-500/15 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded">
                              <Bot className="w-2.5 h-2.5 inline mr-0.5" />{convo.assignedAgent}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Message view */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedConvo ? (
                <>
                  {/* Convo header */}
                  <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/40 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                      <User className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{selectedConvo.name}</p>
                      <p className="text-[11px] text-slate-400">{selectedConvo.phone}</p>
                    </div>
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border',
                      selectedConvo.status === 'active' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                      selectedConvo.status === 'pending' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                      'bg-slate-500/10 border-slate-600 text-slate-400'
                    )}>
                      {selectedConvo.status}
                    </span>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {messages.map((msg) => (
                      <div key={msg.id} className={cn('flex', msg.direction === 'outbound' && 'justify-end')}>
                        <div className={cn(
                          'max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm',
                          msg.direction === 'inbound'
                            ? 'bg-slate-800/60 border border-slate-700/50 rounded-tl-sm'
                            : msg.isAgent
                              ? 'bg-green-900/30 border border-green-700/30 rounded-tr-sm'
                              : 'bg-blue-900/30 border border-blue-700/30 rounded-tr-sm'
                        )}>
                          {msg.isAgent && (
                            <div className="flex items-center gap-1 mb-1">
                              <Bot className="w-3 h-3 text-green-400" />
                              <span className="text-[10px] text-green-400 font-medium">{msg.sender}</span>
                            </div>
                          )}
                          <p className="text-slate-200 whitespace-pre-wrap text-[13px] leading-relaxed">{msg.content}</p>
                          <div className="flex items-center justify-end gap-1 mt-1">
                            <span className="text-[10px] text-slate-500">{msg.ts}</span>
                            {msg.direction === 'outbound' && (
                              <span className="text-[10px]">
                                {msg.status === 'read' ? <CheckCheck className="w-3 h-3 text-blue-400" /> :
                                 msg.status === 'delivered' ? <CheckCheck className="w-3 h-3 text-slate-400" /> :
                                 <Clock className="w-3 h-3 text-slate-500" />}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Compose */}
                  <div className="border-t border-slate-800 bg-slate-900/40 px-4 py-2.5">
                    <div className="flex items-end gap-2">
                      <textarea
                        value={compose}
                        onChange={(e) => setCompose(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                        placeholder="Type a message…"
                        rows={1}
                        className="flex-1 resize-none rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500/50"
                      />
                      <button
                        onClick={() => void handleSend()}
                        disabled={!compose.trim()}
                        className="p-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-30 rounded-xl transition-colors"
                      >
                        <Send className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                  <MessageCircle className="w-12 h-12 text-green-500/20 mb-3" />
                  <p className="text-sm text-slate-400">Select a conversation to view messages</p>
                  <p className="text-xs text-slate-500 mt-1">Your AI agents handle WhatsApp conversations 24/7</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Contacts tab */}
        {activeTab === 'contacts' && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-3xl mx-auto space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-white">{contacts.length} Contacts</h3>
                <button className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Import Contacts
                </button>
              </div>
              {contacts.map((c) => (
                <div key={c.id} className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-4 py-3 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.phone}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.labels.map((l) => (
                      <span key={l} className="text-[10px] bg-slate-700/60 text-slate-300 px-1.5 py-0.5 rounded">{l}</span>
                    ))}
                  </div>
                  <span className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full',
                    c.optedIn ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                  )}>
                    {c.optedIn ? 'Opted In' : 'Not Opted In'}
                  </span>
                  <span className="text-[10px] text-slate-500">{c.lastSeen}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Templates tab */}
        {activeTab === 'templates' && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-3xl mx-auto space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-white">Message Templates</h3>
                <button className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Create Template
                </button>
              </div>
              {templates.map((t) => (
                <div key={t.id} className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white font-mono">{t.name}</span>
                      <span className="text-[10px] bg-slate-700/60 text-slate-300 px-1.5 py-0.5 rounded">{t.category}</span>
                      <span className="text-[10px] bg-slate-700/60 text-slate-300 px-1.5 py-0.5 rounded">{t.language.toUpperCase()}</span>
                    </div>
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border',
                      t.status === 'approved' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
                      t.status === 'pending' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                      'bg-red-500/10 border-red-500/30 text-red-400'
                    )}>
                      {t.status}
                    </span>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg px-3 py-2">
                    <p className="text-xs text-slate-300 font-mono whitespace-pre-wrap">{t.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity tab */}
        {activeTab === 'activity' && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-3xl mx-auto space-y-3">
              <h3 className="text-sm font-medium text-white mb-2">Recent Activity</h3>
              {[
                { icon: '📨', text: 'Inbound message from Rajesh Kumar (+91 98765 43210)', time: '2 min ago', agent: 'Support Agent' },
                { icon: '🤖', text: 'Agent auto-replied with order status to Rajesh Kumar', time: '2 min ago', agent: 'Support Agent' },
                { icon: '📊', text: 'Lead qualified: Priya Sharma scored 85/100', time: '15 min ago', agent: 'Sales Agent' },
                { icon: '📅', text: 'Meeting booked: Priya Sharma → 10 April 3:00 PM IST', time: '14 min ago', agent: 'Sales Agent' },
                { icon: '💰', text: 'Payment reminder sent to Sunita Mehta (Invoice #INV-2024-0342)', time: '1 hr ago', agent: 'Payment Agent' },
                { icon: '✅', text: 'Payment confirmed: ₹2,45,000 received from Sunita Mehta', time: '45 min ago', agent: 'Payment Agent' },
                { icon: '📋', text: 'Resume received and screened: Neha Gupta → Score: 78/100', time: '5 hr ago', agent: 'Recruitment Agent' },
                { icon: '⏳', text: 'Approval requested: Discount >15% for Priya Sharma\'s order', time: '12 min ago', agent: 'Sales Agent' },
              ].map((item, i) => (
                <div key={i} className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-4 py-2.5 flex items-start gap-3">
                  <span className="text-sm shrink-0 mt-0.5">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200">{item.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded">
                        <Bot className="w-2.5 h-2.5 inline mr-0.5" />{item.agent}
                      </span>
                      <span className="text-[10px] text-slate-500">{item.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
