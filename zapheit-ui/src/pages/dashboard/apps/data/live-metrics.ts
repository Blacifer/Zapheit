export type LiveMetricConfig = {
  action: string;
  params: Record<string, unknown>;
  extract: (data: unknown) => string | null;
};

export const LIVE_METRICS: Record<string, LiveMetricConfig> = {
  greythr: {
    action: 'list_leave_requests',
    params: { status: 'pending', limit: 50 },
    extract: (d: any) => {
      const n = d?.total ?? d?.requests?.length ?? (Array.isArray(d) ? d.length : null);
      return n != null ? `${n} pending leave request${n !== 1 ? 's' : ''}` : null;
    },
  },
  tally: {
    action: 'list_invoices',
    params: { status: 'overdue', limit: 50 },
    extract: (d: any) => {
      const n = d?.total ?? d?.invoices?.length ?? (Array.isArray(d) ? d.length : null);
      return n != null ? `${n} overdue invoice${n !== 1 ? 's' : ''}` : null;
    },
  },
  freshdesk: {
    action: 'list_tickets',
    params: { filter: 'open', per_page: 30 },
    extract: (d: any) => {
      const n = d?.total ?? (Array.isArray(d) ? d.length : null);
      return n != null ? `${n} open ticket${n !== 1 ? 's' : ''}` : null;
    },
  },
  naukri: {
    action: 'list_applications',
    params: { status: 'new', limit: 50 },
    extract: (d: any) => {
      const n = d?.total ?? d?.applications?.length ?? (Array.isArray(d) ? d.length : null);
      return n != null ? `${n} new applicant${n !== 1 ? 's' : ''}` : null;
    },
  },
  github: {
    action: 'list_pull_requests',
    params: { state: 'open', limit: 25 },
    extract: (d: any) => {
      const n = d?.total ?? (Array.isArray(d) ? d.length : null);
      return n != null ? `${n} open PR${n !== 1 ? 's' : ''}` : null;
    },
  },
  jira: {
    action: 'list_issues',
    params: { status: 'open', limit: 25 },
    extract: (d: any) => {
      const n = d?.total ?? d?.total_count ?? (Array.isArray(d) ? d.length : null);
      return n != null ? `${n} open issue${n !== 1 ? 's' : ''}` : null;
    },
  },
  slack: {
    action: 'list_channels',
    params: { limit: 50 },
    extract: (d: any) => {
      const n = d?.total ?? (Array.isArray(d) ? d.length : null);
      return n != null ? `${n} channel${n !== 1 ? 's' : ''}` : null;
    },
  },
  hubspot: {
    action: 'list_contacts',
    params: { limit: 1 },
    extract: (d: any) => {
      const n = d?.total ?? (Array.isArray(d) ? d.length : null);
      return n != null ? `${n} contact${n !== 1 ? 's' : ''}` : null;
    },
  },
  cashfree: {
    action: 'list_transactions',
    params: { limit: 30 },
    extract: (d: any) => {
      const list = Array.isArray(d) ? d : (d as any)?.orders ?? [];
      const n = list.length;
      return n > 0 ? `${n} recent transaction${n !== 1 ? 's' : ''}` : null;
    },
  },
  'google-workspace': {
    action: 'list_files',
    params: { pageSize: 5 },
    extract: (d: any) => {
      const n = Array.isArray(d) ? d.length : (d?.files?.length ?? null);
      return n != null ? `${n} file${n !== 1 ? 's' : ''} in Drive` : null;
    },
  },
};
