import { useEffect } from 'react';
import type { MarketplaceApp } from '../../../lib/api-client';
import type { UnifiedConnectorEntry } from '../../../lib/api/connectors';
import type { UnifiedApp, TrustTier, Maturity, GuardrailStatus, AppSetupMode } from './types';
import { LOGO_DOMAINS } from './constants';

// ─── Color helpers ──────────────────────────────────────────────────────────

function hashColor(s: string): string {
  const P = ['#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#06B6D4','#EC4899','#6366F1','#84CC16','#F97316'];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return P[h % P.length];
}

export function appColor(id: string, raw?: string): string {
  if (raw && /^#[0-9a-f]{3,6}$/i.test(raw)) return raw;
  const k = id.toLowerCase();
  if (k.includes('slack'))                              return '#4A154B';
  if (k.includes('linkedin'))                          return '#0A66C2';
  if (k.includes('google') || k.includes('gmail'))     return '#EA4335';
  if (k.includes('microsoft') || k.includes('teams'))  return '#0078D4';
  if (k.includes('hubspot'))                           return '#FF7A59';
  if (k.includes('jira') || k.includes('atlassian'))   return '#0052CC';
  if (k.includes('zendesk'))                           return '#03363D';
  if (k.includes('freshdesk'))                         return '#0070C0';
  if (k.includes('naukri'))                            return '#FF7555';
  if (k.includes('stripe'))                            return '#635BFF';
  if (k.includes('cashfree'))                          return '#2D81E0';
  if (k.includes('paytm'))                             return '#002970';
  if (k.includes('salesforce'))                        return '#00A1E0';
  if (k.includes('quickbooks'))                        return '#2CA01C';
  if (k.includes('zoho'))                              return '#E42527';
  if (k.includes('tally'))                             return '#FF6600';
  if (k.includes('mailchimp'))                         return '#FFE01B';
  return hashColor(id);
}

// ─── Logo URL ───────────────────────────────────────────────────────────────

export function getLogoUrl(appId: string): string | null {
  const normalized = appId.toLowerCase();
  const candidates = [
    normalized,
    normalized.replace(/_/g, '-'),
    normalized.replace(/-/g, '_'),
    normalized.replace(/_/g, '-').replace(/-ai$/i, ''),
  ];
  const domain = candidates.map((key) => LOGO_DOMAINS[key]).find(Boolean);
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null;
}

// ─── Data transforms ────────────────────────────────────────────────────────

export function fromMarketplaceApp(app: MarketplaceApp): UnifiedApp {
  const status =
    app.connectionStatus === 'error'   ? 'error'
    : app.connectionStatus === 'expired' ? 'expired'
    : app.connectionStatus === 'syncing' ? 'syncing'
    : app.installed                      ? 'connected'
    : 'disconnected' as const;
  return {
    id: `app:${app.id}`,
    appId: app.id,
    name: app.name,
    description: app.description,
    category: app.category,
    source: 'marketplace',
    connectionType: app.installMethod === 'oauth2' ? 'oauth_connector' : 'native_connector',
    logoLetter: app.logoLetter,
    colorHex: app.colorHex,
    badge: app.badge,
    installCount: app.installCount,
    comingSoon: !!app.comingSoon,
    connected: !!app.installed,
    status,
    lastErrorMsg: app.lastErrorMsg,
    authType: app.installMethod,
    requiredFields: app.requiredFields,
    permissions: app.permissions,
    actionsUnlocked: app.actionsUnlocked,
    setupTimeMinutes: app.setupTimeMinutes,
    developer: app.developer,
    featured: app.featured,
    trustTier: app.category === 'finance' || app.category === 'it' || app.category === 'compliance'
      ? 'high-trust-operational'
      : app.actionsUnlocked?.length
        ? 'controlled-write'
        : 'observe-only',
    maturity: app.installed ? (app.actionsUnlocked?.length ? 'action-ready' : 'read-ready') : 'connected',
    governanceSummary: {
      readCount: app.permissions?.length || 0,
      actionCount: app.actionsUnlocked?.length || 0,
      enabledActionCount: app.actionsUnlocked?.length || 0,
    },
    appData: app,
  };
}

export function fromIntegration(row: any): UnifiedApp {
  const raw = row.lifecycleStatus || row.status || 'disconnected';
  const status =
    raw === 'connected'                      ? 'connected'
    : raw === 'syncing'                      ? 'syncing'
    : raw === 'error'                        ? 'error'
    : raw === 'expired' || row.tokenExpired  ? 'expired'
    : 'disconnected' as const;
  return {
    id: `int:${row.id}`,
    appId: row.id,
    name: row.name,
    description: row.description || '',
    category: row.category || 'it',
    source: 'integration',
    connectionType: row.connectionType || (row.authType === 'oauth2' ? 'oauth_connector' : 'native_connector'),
    logoLetter: (row.name || '?')[0].toUpperCase(),
    colorHex: appColor(row.id, row.color),
    badge: row.specStatus === 'COMING_SOON' ? undefined : row.badge,
    installCount: 0,
    comingSoon: row.specStatus === 'COMING_SOON',
    connected: status === 'connected',
    status,
    lastErrorMsg: row.lastErrorMsg,
    authType: row.authType === 'oauth2' ? 'oauth2' : 'api_key',
    requiredFields: row.requiredFields,
    permissions: row.capabilities?.reads?.map((r: string) => `Read: ${r}`) || [],
    actionsUnlocked: row.capabilities?.writes?.map((w: any) => w.label) || [],
    trustTier: row.trustTier || 'observe-only',
    maturity: row.maturity || 'connected',
    governanceSummary: row.governanceSummary,
    wave: row.wave,
    wave1GuardrailsStatus: row.wave1GuardrailsStatus,
    wave1GuardrailsApplied: row.wave1GuardrailsApplied,
    wave1GuardrailsTotal: row.wave1GuardrailsTotal,
    integrationData: row,
  };
}

function deriveTrustTier(category: string, capabilityPolicies: Array<{ requires_human_approval: boolean }> = []): TrustTier {
  if (category === 'finance' || category === 'it' || category === 'compliance') return 'high-trust-operational';
  if (capabilityPolicies.some((item) => item.requires_human_approval)) return 'controlled-write';
  return capabilityPolicies.length > 0 ? 'controlled-write' : 'observe-only';
}

function deriveMaturity(connected: boolean, capabilityPolicies: Array<{ enabled: boolean; requires_human_approval: boolean }> = []): Maturity {
  if (!connected) return 'connected';
  const enabledCount = capabilityPolicies.filter((item) => item.enabled).length;
  const governedCount = capabilityPolicies.filter((item) => item.enabled && item.requires_human_approval).length;
  if (governedCount > 0) return 'governed';
  if (enabledCount > 0) return 'action-ready';
  return 'read-ready';
}

export function fromUnifiedConnectorEntry(entry: UnifiedConnectorEntry): UnifiedApp {
  const statusRaw = entry.connection_status || entry.connectionStatus || (entry.is_connected || entry.installed ? 'connected' : 'disconnected');
  const status =
    statusRaw === 'connected' ? 'connected'
    : statusRaw === 'syncing' ? 'syncing'
    : statusRaw === 'error' ? 'error'
    : statusRaw === 'expired' ? 'expired'
    : 'disconnected';
  const capabilityPolicies = entry.capability_policies || [];
  const connected = Boolean(entry.is_connected ?? entry.installed);
  const appId = entry.app_key || entry.id;
  const authType = entry.auth_type || entry.authType || 'api_key';
  const primarySetupMode: AppSetupMode =
    entry.primary_setup_mode
    || (authType === 'oauth' || authType === 'oauth2'
      ? 'oauth'
      : authType === 'api_key'
        ? 'api_key'
        : 'direct');
  return {
    id: `${entry.source}:${appId}`,
    appId,
    name: entry.display_name || entry.name,
    description: entry.description || '',
    category: entry.category || 'productivity',
    source: entry.source,
    connectionType: entry.connection_type || (authType === 'oauth2' || authType === 'oauth' ? 'oauth_connector' : 'native_connector'),
    primarySetupMode,
    advancedSetupModes: entry.advanced_setup_modes || [primarySetupMode],
    logoLetter: entry.logoLetter || entry.logo_fallback || (entry.display_name || entry.name || '?')[0].toUpperCase(),
    colorHex: appColor(appId, entry.colorHex),
    badge: entry.badge,
    installCount: entry.installCount || 0,
    comingSoon: Boolean(entry.comingSoon),
    connected,
    status,
    lastErrorMsg: entry.lastErrorMsg,
    authType: authType === 'free' ? 'free' : authType === 'oauth' || authType === 'oauth2' ? 'oauth2' : 'api_key',
    requiredFields: entry.requiredFields,
    permissions: entry.permissions || [],
    actionsUnlocked: capabilityPolicies.map((item) => item.capability),
    setupTimeMinutes: entry.setupTimeMinutes,
    developer: entry.developer,
    featured: Boolean(entry.featured),
    trustTier: deriveTrustTier(entry.category, capabilityPolicies),
    maturity: deriveMaturity(connected, capabilityPolicies),
    governanceSummary: {
      readCount: capabilityPolicies.filter((item) => !item.requires_human_approval).length,
      actionCount: capabilityPolicies.length,
      enabledActionCount: capabilityPolicies.filter((item) => item.enabled).length,
    },
    appData: entry.source === 'marketplace' ? ({
      id: appId,
      name: entry.display_name || entry.name,
      developer: entry.developer || '',
      category: entry.category,
      description: entry.description,
      permissions: entry.permissions || [],
      relatedAgentIds: [],
      actionsUnlocked: capabilityPolicies.map((item) => item.capability),
      setupTimeMinutes: entry.setupTimeMinutes || 0,
      bundleIds: entry.bundles || [],
      installMethod: authType === 'free' ? 'free' : authType === 'oauth' || authType === 'oauth2' ? 'oauth2' : 'api_key',
      requiredFields: entry.requiredFields,
      installCount: entry.installCount || 0,
      featured: Boolean(entry.featured),
      badge: entry.badge,
      colorHex: entry.colorHex || appColor(appId),
      logoLetter: entry.logoLetter || (entry.display_name || entry.name || '?')[0].toUpperCase(),
      installed: connected,
      connectionStatus: status,
      lastErrorMsg: entry.lastErrorMsg,
      comingSoon: Boolean(entry.comingSoon),
      connectionSource: entry.source,
    } as MarketplaceApp) : undefined,
    integrationData: entry.source === 'integration' ? entry : undefined,
    rawCatalogData: entry,
    primaryServiceId: entry.primary_service_id || entry.id,
    linkedAgentCount: entry.linked_agent_count ?? entry.agentCount ?? 0,
    supportsHealthTest: Boolean(entry.supports_health_test),
    healthStatus: (entry.health_status as any) || 'unknown',
    healthTestMode: entry.health_test_mode || 'unsupported',
    logoUrl: entry.logo_url || getLogoUrl(appId),
    logoFallback: entry.logo_fallback || (entry.display_name || entry.name || '?')[0].toUpperCase(),
    agentCapabilities: entry.agent_capabilities || capabilityPolicies.map((item) => item.capability),
    capabilityPolicies,
    mcpTools: entry.mcp_tools || [],
    secureCredentialHandling: entry.credential_handling,
  };
}

export function getAppServiceId(app: UnifiedApp) {
  return app.primaryServiceId || app.rawCatalogData?.primary_service_id || app.rawCatalogData?.id || app.integrationData?.id || app.appData?.id || app.appId;
}

export function getSetupModeLabel(mode?: AppSetupMode, connectionType?: UnifiedApp['connectionType']) {
  if (mode === 'oauth') return 'OAuth setup';
  if (mode === 'api_key') return 'API key setup';
  if (mode === 'direct') return 'Direct setup';
  if (connectionType === 'mcp_server') return 'Agent tools ready';
  if (connectionType === 'oauth_connector') return 'OAuth setup';
  return 'Direct setup';
}

export function getSetupModeSummary(mode?: AppSetupMode, connectionType?: UnifiedApp['connectionType']) {
  if (mode === 'oauth') return 'OAuth';
  if (mode === 'api_key') return 'API key';
  if (mode === 'direct') return 'Direct credentials';
  if (connectionType === 'mcp_server') return 'MCP server';
  if (connectionType === 'oauth_connector') return 'OAuth';
  return 'Direct credentials';
}

// ─── Date formatting ────────────────────────────────────────────────────────

export function fmtDate(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString();
}

// ─── Tone helpers (badge styling) ───────────────────────────────────────────

export function trustTierTone(tier?: TrustTier) {
  if (tier === 'high-trust-operational') return 'border-rose-400/25 bg-rose-500/10 text-rose-200';
  if (tier === 'controlled-write') return 'border-amber-400/25 bg-amber-500/10 text-amber-200';
  return 'border-white/10 bg-white/5 text-slate-300';
}

export function getTrustTierLabel(tier?: TrustTier) {
  if (tier === 'high-trust-operational') return 'Needs approval';
  if (tier === 'controlled-write') return 'Can write';
  return 'Read only';
}

export function maturityTone(maturity?: Maturity) {
  if (maturity === 'governed') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  if (maturity === 'action-ready') return 'border-blue-400/25 bg-blue-500/10 text-blue-200';
  if (maturity === 'read-ready') return 'border-violet-400/25 bg-violet-500/10 text-violet-200';
  return 'border-white/10 bg-white/5 text-slate-300';
}

export function getMaturityLabel(maturity?: Maturity) {
  if (maturity === 'governed') return 'Ready for agents';
  if (maturity === 'action-ready') return 'Actions available';
  if (maturity === 'read-ready') return 'Read access ready';
  return 'Connected';
}

export function guardrailTone(status?: GuardrailStatus) {
  if (status === 'applied') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  if (status === 'partial') return 'border-amber-400/25 bg-amber-500/10 text-amber-200';
  if (status === 'missing') return 'border-rose-400/25 bg-rose-500/10 text-rose-200';
  return 'border-white/10 bg-white/5 text-slate-300';
}

// ─── Outside click hook ─────────────────────────────────────────────────────

export function useOutsideClick(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [ref, cb]);
}

// ─── Domain detector helpers ────────────────────────────────────────────────

export function financeConnectorMode(connectorId?: string | null): 'cashfree' | 'paytm' | null {
  const value = String(connectorId || '').toLowerCase();
  if (value.includes('cashfree')) return 'cashfree';
  if (value.includes('paytm')) return 'paytm';
  return null;
}

export function isTallyConnector(connectorId?: string | null) {
  return String(connectorId || '').toLowerCase().includes('tally');
}

export function isClearTaxConnector(connectorId?: string | null) {
  return String(connectorId || '').toLowerCase().includes('cleartax');
}

export function isNaukriConnector(connectorId?: string | null) {
  return String(connectorId || '').toLowerCase().includes('naukri');
}

export function isHrWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'zoho-people',
    'zoho_people',
    'zoho-learn',
    'zoho_learn',
  ].some((candidate) => value.includes(candidate));
}

export function isCollaborationWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'google-workspace',
    'google_workspace',
    'microsoft-365',
    'microsoft_365',
  ].some((candidate) => value.includes(candidate));
}

export function isRecruitmentWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'zoho-recruit',
    'zoho_recruit',
    'naukri',
  ].some((candidate) => value.includes(candidate));
}

export function isSupportWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'slack',
    'zendesk',
    'freshdesk',
    'intercom',
    'helpscout',
    'kayako',
  ].some((candidate) => value.includes(candidate));
}

export function isFinanceWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'stripe',
    'cashfree',
    'paytm',
    'quickbooks',
    'xero',
    'tally',
    'chargebee',
    'cashfree',
    'payu',
  ].some((candidate) => value.includes(candidate));
}

export function isComplianceWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'cleartax',
    'docusign',
    'leegality',
    'zoho-sign',
    'vanta',
    'drata',
    'vakilsearch',
    'idfy',
    'epfo',
    'aadhaar-api',
    'digilocker',
    'signdesk',
    'diligent',
  ].some((candidate) => value.includes(candidate));
}

export function isSalesWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'salesforce',
    'hubspot',
    'zoho-crm',
    'zoho_crm',
    'pipedrive',
    'freshsales',
  ].some((candidate) => value.includes(candidate));
}

export function isMarketingWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'mailchimp',
    'brevo',
    'convertkit',
    'klaviyo',
    'meta-ads',
    'google-ads',
  ].some((candidate) => value.includes(candidate));
}

export function isItWorkspaceApp(connectorId?: string | null) {
  const value = String(connectorId || '').toLowerCase();
  return [
    'okta',
    'jumpcloud',
    'onelogin',
    'jamf',
    'kandji',
    'azure-ad',
    'azure_ad',
  ].some((candidate) => value.includes(candidate));
}

export function isSlackRail(connectorId?: string | null) {
  return String(connectorId || '').toLowerCase().includes('slack');
}
