import type { ComponentType } from 'react';

export type PlaybookPackId = 'all' | 'hr' | 'support' | 'sales' | 'it';

export type PlaybookField =
  | { key: string; label: string; placeholder?: string; kind: 'text' }
  | { key: string; label: string; placeholder?: string; kind: 'textarea' };

export type PlaybookJob = { type: 'chat_turn' | 'workflow_run' | 'connector_action'; input: any };

export type Playbook = {
  id: string;
  pack: Exclude<PlaybookPackId, 'all'>;
  title: string;
  description: string;
  /** One sentence shown above the form: "You'll get a structured JD with…" */
  outputDescription: string;
  /** Prompt sent to the LLM to extract form fields from free-form user input (Generate feature). */
  fieldExtractorPrompt: string;
  icon: ComponentType<{ className?: string }>;
  recommendedAgentType?: string;
  fields: PlaybookField[];
  buildJob: (input: Record<string, string>) => PlaybookJob;
};

/** A custom playbook created by an org admin (stored in DB). */
export type CustomPlaybook = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  output_description: string | null;
  field_extractor_prompt: string | null;
  category: string;
  icon_name: string | null;
  fields: PlaybookField[];
  workflow: any;
  version: number;
  api_enabled: boolean;
  api_slug: string | null;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaybookPack = {
  id: Exclude<PlaybookPackId, 'all'>;
  label: string;
  description: string;
};

