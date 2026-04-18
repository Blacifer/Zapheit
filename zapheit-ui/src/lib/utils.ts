import { clsx, ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { webhookRateLimiter } from './security';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ==================== STORAGE HELPERS ====================
export const STORAGE_KEYS = {
  AGENTS: 'synthetic_hr_agents',
  INCIDENTS: 'synthetic_hr_incidents',
  COST_DATA: 'synthetic_hr_cost_data',
  API_KEYS: 'synthetic_hr_api_keys',
  NOTIFICATIONS: 'synthetic_hr_notifications',
};

export const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

export const saveToStorage = <T,>(key: string, data: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    // Handle quota exceeded errors (private browsing, storage full)
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please clear some data.');
    }
    console.error('Failed to save to storage:', e);
    throw e;
  }
};

// ==================== WEBHOOK UTILITIES ====================
export const sendWebhookAlert = async (incident: {
  title: string;
  description: string;
  severity: string;
  incident_type: string;
  agent_name?: string;
}) => {
  // Rate limiting check - prevent webhook spam
  const rateLimitKey = 'webhook_incident';
  if (!webhookRateLimiter.isAllowed(rateLimitKey)) {
    console.warn('Webhook rate limit exceeded, skipping alert');
    return;
  }

  // Security hard-stop: never send webhooks directly from client.
  // This must be handled server-side where secrets are not exposed to browsers.
  console.warn('Client-side webhook dispatch disabled. Route alerts through backend endpoint.');
  return;
};

// ==================== INCIDENT DETECTION ENGINE ====================
export const detectIncidents = (content: string): { detected: boolean; type: string | null; severity: string; details: string } => {
  const lowerContent = content.toLowerCase();

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/;
  const ssnRegex = /\b\d{3}[-]?\d{2}[-]?\d{4}\b/;
  const ccRegex = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/;

  if (emailRegex.test(content) || phoneRegex.test(content) || ssnRegex.test(content) || ccRegex.test(content)) {
    return { detected: true, type: 'pii_leak', severity: 'critical', details: 'PII detected (email/phone/SSN/credit card)' };
  }

  if (lowerContent.includes('approve refund') || lowerContent.includes('waive policy') ||
      lowerContent.includes('make exception') || lowerContent.includes('override system')) {
    return { detected: true, type: 'refund_abuse', severity: 'critical', details: 'Refund abuse indicators detected' };
  }

  if (lowerContent.includes('legal advice') || lowerContent.includes('court') ||
      lowerContent.includes('lawsuit') || lowerContent.includes('attorney')) {
    return { detected: true, type: 'legal_advice', severity: 'high', details: 'Legal terminology detected' };
  }

  if (lowerContent.includes('angry') || lowerContent.includes('furious') ||
      lowerContent.includes('complaint') || lowerContent.includes('speak to manager')) {
    return { detected: true, type: 'angry_user', severity: 'high', details: 'Escalation indicators detected' };
  }

  if (lowerContent.includes('hate') || lowerContent.includes('violent') ||
      lowerContent.includes('racist') || lowerContent.includes('sexist')) {
    return { detected: true, type: 'toxic_output', severity: 'critical', details: 'Toxic content detected' };
  }

  if (lowerContent.includes('always') && (lowerContent.includes('never') || lowerContent.includes('100%'))) {
    return { detected: true, type: 'hallucination', severity: 'medium', details: 'Potential hallucination patterns' };
  }

  return { detected: false, type: null, severity: 'low', details: 'No issues detected' };
};

// ==================== COST CALCULATOR ====================
export const calculateCost = (tokens: number, model: string): number => {
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4o': { input: 0.005, output: 0.015 },
    'claude-3-opus': { input: 0.015, output: 0.075 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  };
  const rates = pricing[model] || { input: 0.01, output: 0.03 };
  const inputTokens = Math.floor(tokens * 0.4);
  const outputTokens = Math.floor(tokens * 0.6);
  return (inputTokens / 1000000 * rates.input) + (outputTokens / 1000000 * rates.output);
};
