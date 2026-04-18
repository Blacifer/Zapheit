import type { SupabaseClient } from '@supabase/supabase-js';
import { getFrontendConfig } from './config';
import { supabase as sharedSupabase } from './supabase-client';

const config = getFrontendConfig();
const supabaseUrl = config.supabaseUrl;
const supabaseAnonKey = config.supabaseAnonKey;

// Supabase is only available if both env vars are properly configured
const isSupabaseConfigured = (): boolean => {
  return !!(supabaseUrl && supabaseAnonKey);
};

export const isSupabaseAvailable = (): boolean => {
  if (!isSupabaseConfigured()) {
    console.info('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
    return false;
  }
  return true;
};

export const getSupabase = (): SupabaseClient | null => {
  return isSupabaseAvailable() ? sharedSupabase : null;
};

export const getSupabaseClient = (): SupabaseClient | null => {
  return isSupabaseAvailable() ? sharedSupabase : null;
};

export const supabase = sharedSupabase;

// Database types (kept for reference, not used)
export interface Organization {
  id: string;
  name: string;
  plan: 'starter' | 'pro' | 'enterprise';
  industry: string;
  created_at: string;
}

export interface AIAgent {
  id: string;
  org_id: string;
  name: string;
  description: string;
  agent_type: string;
  platform: string;
  model_name: string;
  status: 'active' | 'paused' | 'terminated';
  risk_level: 'low' | 'medium' | 'high';
  risk_score: number;
  created_at: string;
  conversations: number;
  satisfaction: number;
  uptime: number;
}

export interface Incident {
  id: string;
  org_id: string;
  agent_id: string;
  agent_name: string;
  incident_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  title: string;
  description: string;
  created_at: string;
  resolved_at?: string;
}

export interface CostData {
  id: string;
  org_id: string;
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface ApiKey {
  id: string;
  org_id: string;
  name: string;
  key: string;
  created: string;
  lastUsed: string;
  permissions: string[];
}
