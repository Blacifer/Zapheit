import { eq, supabaseRest } from './supabase-rest';

const SETTINGS_KEY = 'rasi_api_key_usage';

type ApiKeyDailyUsage = {
  request_count: number;
  error_count: number;
  last_used_at?: string;
};

type ApiKeyUsageMap = Record<string, Record<string, ApiKeyDailyUsage>>;

async function getOrganization(orgId: string) {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  const rows = (await supabaseRest('organizations', query)) as any[];
  return rows?.[0] || null;
}

async function persistOrganizationSettings(orgId: string, settings: Record<string, any>) {
  const query = new URLSearchParams();
  query.set('id', eq(orgId));
  await supabaseRest('organizations', query, {
    method: 'PATCH',
    body: {
      settings,
      updated_at: new Date().toISOString(),
    },
  });
}

export async function getApiKeyUsageState(orgId: string): Promise<ApiKeyUsageMap> {
  const org = await getOrganization(orgId);
  const settings = org?.settings || {};
  return (settings[SETTINGS_KEY] || {}) as ApiKeyUsageMap;
}

export async function recordApiKeyUsage(params: {
  orgId: string;
  apiKeyId: string;
  statusCode: number;
  usedAt?: string;
}) {
  const { orgId, apiKeyId, statusCode, usedAt = new Date().toISOString() } = params;
  const org = await getOrganization(orgId);
  if (!org) {
    return;
  }

  const settings = org.settings || {};
  const usage = (settings[SETTINGS_KEY] || {}) as ApiKeyUsageMap;
  const dateKey = usedAt.split('T')[0];
  const currentKeyUsage = usage[apiKeyId] || {};
  const currentDayUsage = currentKeyUsage[dateKey] || {
    request_count: 0,
    error_count: 0,
  };

  currentKeyUsage[dateKey] = {
    request_count: currentDayUsage.request_count + 1,
    error_count: currentDayUsage.error_count + (statusCode >= 400 ? 1 : 0),
    last_used_at: usedAt,
  };

  const cutoff = new Date(usedAt);
  cutoff.setDate(cutoff.getDate() - 45);
  const cutoffKey = cutoff.toISOString().split('T')[0];

  Object.keys(currentKeyUsage).forEach((day) => {
    if (day < cutoffKey) {
      delete currentKeyUsage[day];
    }
  });

  usage[apiKeyId] = currentKeyUsage;

  await persistOrganizationSettings(orgId, {
    ...settings,
    [SETTINGS_KEY]: usage,
  });
}

export function buildUsageSeries(
  usageMap: ApiKeyUsageMap,
  apiKeyId: string,
  days: number,
  anchor = new Date(),
) {
  const keyUsage = usageMap[apiKeyId] || {};
  const series: Array<{ date: string; requests: number; errors: number; last_used_at?: string }> = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(anchor);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const date = day.toISOString().split('T')[0];
    const entry = keyUsage[date] || { request_count: 0, error_count: 0 };
    series.push({
      date,
      requests: entry.request_count || 0,
      errors: entry.error_count || 0,
      last_used_at: entry.last_used_at,
    });
  }

  return series;
}

export function summarizeUsage(
  usageMap: ApiKeyUsageMap,
  apiKeyId: string,
  days: number,
  anchor = new Date(),
) {
  const series = buildUsageSeries(usageMap, apiKeyId, days, anchor);
  return {
    totalRequests: series.reduce((sum, item) => sum + item.requests, 0),
    totalErrors: series.reduce((sum, item) => sum + item.errors, 0),
    series,
  };
}
