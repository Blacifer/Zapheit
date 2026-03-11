import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Types for our database
export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  role: string;
  avatar_url: string | null;
  last_login: string | null;
}

export interface AIAgent {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  agent_type: string;
  platform: string;
  model_name: string;
  system_prompt: string | null;
  status: string;
  risk_level: string;
  risk_score: number;
  config: Record<string, any>;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  organization_id: string;
  agent_id: string | null;
  user_id: string | null;
  external_conversation_id: string | null;
  platform: string | null;
  status: string;
  metadata: Record<string, any>;
  started_at: string;
  ended_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  token_count: number | null;
  cost_usd: number | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface Incident {
  id: string;
  organization_id: string;
  agent_id: string | null;
  conversation_id: string | null;
  incident_type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  trigger_content: string | null;
  ai_response: string | null;
  resolution_notes: string | null;
  escalated_to: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface CostTracking {
  id: string;
  organization_id: string;
  agent_id: string | null;
  conversation_id: string | null;
  date: string;
  model_name: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  request_count: number;
  avg_latency_ms: number | null;
  metadata: Record<string, any>;
}

// Initialize Supabase clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required Supabase environment variables');
}

// Anon client for frontend/public queries
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

// Service role client for backend operations (bypasses RLS)
export const supabaseAdmin: SupabaseClient = (() => {
  if (supabaseServiceKey) {
    return createClient(supabaseUrl, supabaseServiceKey);
  }
  // In production, missing service-role key is a hard misconfiguration that will
  // cause silent partial failures (provisioning, background jobs, gateway writes).
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Missing SUPABASE_SERVICE_KEY for server-side operations');
  }
  return supabase;
})();

// Demo organization ID (for development)
export const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000000';

export default supabase;
