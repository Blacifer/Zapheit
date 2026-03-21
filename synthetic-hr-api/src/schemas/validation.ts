import { z } from 'zod';

/**
 * Authentication Schemas
 */
export const authSchemas = {
  signUp: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain uppercase letter')
      .regex(/[a-z]/, 'Password must contain lowercase letter')
      .regex(/[0-9]/, 'Password must contain number')
      .regex(/[^A-Za-z0-9]/, 'Password must contain special character'),
    organizationName: z.string().min(1, 'Organization name required'),
  }),

  signIn: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password required'),
  }),

  resetPassword: z.object({
    email: z.string().email('Invalid email address'),
  }),

  updatePassword: z.object({
    newPassword: z.string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain uppercase letter')
      .regex(/[a-z]/, 'Password must contain lowercase letter')
      .regex(/[0-9]/, 'Password must contain number'),
  }),
};

/**
 * AI Agent Schemas
 */
export const agentSchemas = {
  create: z.object({
    name: z.string().min(1, 'Agent name required').max(255),
    description: z.string().optional(),
    agent_type: z.string().min(1),
    platform: z.string().min(1),
    model_name: z.string().min(1, 'Model name required'),
    system_prompt: z.string().optional(),
    budget_limit: z.number().nonnegative().optional(),
    auto_throttle: z.boolean().optional(),
    publish_status: z.enum(['not_live', 'ready', 'live']).optional(),
    primary_pack: z.enum(['recruitment', 'support', 'sales', 'it', 'finance', 'compliance']).optional(),
    integration_ids: z.array(z.string().min(1)).max(50).optional(),
    config: z.record(z.any()).optional(),
  }),

  update: z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'paused', 'terminated', 'killed']).optional(),
    model_name: z.string().optional(),
    system_prompt: z.string().optional(),
    budget_limit: z.number().nonnegative().optional(),
    current_spend: z.number().nonnegative().optional(),
    auto_throttle: z.boolean().optional(),
    publish_status: z.enum(['not_live', 'ready', 'live']).optional(),
    primary_pack: z.enum(['recruitment', 'support', 'sales', 'it', 'finance', 'compliance']).optional(),
    integration_ids: z.array(z.string().min(1)).max(50).optional(),
    config: z.record(z.any()).optional(),
  }),

  publish: z.object({
    publish_status: z.enum(['not_live', 'ready', 'live']).optional(),
    primary_pack: z.enum(['recruitment', 'support', 'sales', 'it', 'finance', 'compliance']).nullable().optional(),
    integration_ids: z.array(z.string().min(1)).max(50).optional(),
    deploy_method: z.enum(['website', 'api', 'terminal']).nullable().optional(),
  }),

  filter: z.object({
    status: z.enum(['active', 'paused', 'terminated']).optional(),
    agent_type: z.string().optional(),
    page: z.number().optional(),
    limit: z.number().optional(),
  }),
};

/**
 * Incident Schemas
 */
export const incidentSchemas = {
  create: z.object({
    agent_id: z.string().uuid('Invalid agent ID'),
    conversation_id: z.string().uuid('Invalid conversation ID').optional(),
    incident_type: z.enum([
      'pii_leak',
      'pii_extraction',
      'hallucination',
      'refund_abuse',
      'legal_advice',
      'legal_risk',
      'infinite_loop',
      'angry_user',
      'toxic_output',
      'toxicity',
      'prompt_injection',
      'policy_override',
      'escalation',
    ]),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    title: z.string().min(1).max(255),
    description: z.string(),
    trigger_content: z.string().optional(),
    ai_response: z.string().optional(),
  }),

  update: z.object({
    status: z.enum(['open', 'investigating', 'resolved', 'false_positive']).optional(),
    resolution_notes: z.string().optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  }),

  filter: z.object({
    status: z.enum(['open', 'investigating', 'resolved', 'false_positive']).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    agent_id: z.string().uuid().optional(),
    page: z.number().optional(),
    limit: z.number().optional(),
  }),
};

/**
 * Cost Tracking Schemas
 */
export const costSchemas = {
  create: z.object({
    agent_id: z.string().uuid('Invalid agent ID'),
    conversation_id: z.string().uuid('Invalid conversation ID').optional(),
    model_name: z.string().min(1, 'Model name required'),
    input_tokens: z.number().min(0),
    output_tokens: z.number().min(0),
    request_count: z.number().min(0).optional(),
    avg_latency_ms: z.number().min(0).optional(),
  }),

  filter: z.object({
    agent_id: z.string().uuid().optional(),
    date_from: z.string().datetime().optional(),
    date_to: z.string().datetime().optional(),
    page: z.number().optional(),
    limit: z.number().optional(),
  }),
};

/**
 * Runtime + Job Orchestration Schemas
 */
export const runtimeSchemas = {
  create: z.object({
    name: z.string().min(1, 'Runtime name required').max(255),
    mode: z.enum(['hosted', 'vpc']).default('vpc').optional(),
  }),

  createDeployment: z.object({
    agent_id: z.string().uuid('Invalid agent ID'),
    runtime_instance_id: z.string().uuid('Invalid runtime instance ID'),
    execution_policy: z.record(z.any()).optional(),
  }),

  createJob: z.object({
    agent_id: z.string().uuid('Invalid agent ID'),
    type: z.enum(['chat_turn', 'workflow_run', 'connector_action']),
    input: z.record(z.any()).optional(),
  }),

  approveJob: z.object({
    decision: z.enum(['approved', 'rejected']),
  }),

  enroll: z.object({
    runtime_id: z.string().uuid('Invalid runtime instance ID'),
    enrollment_token: z.string().min(10, 'Enrollment token required'),
    version: z.string().optional(),
    capabilities: z.record(z.any()).optional(),
  }),

  heartbeat: z.object({
    status: z.enum(['online', 'offline', 'degraded']).optional(),
    version: z.string().optional(),
    capabilities: z.record(z.any()).optional(),
  }),

  completeJob: z.object({
    status: z.enum(['succeeded', 'failed', 'canceled']),
    output: z.record(z.any()).optional(),
    error: z.string().optional(),
  }),

  appendJobLog: z.object({
    line: z.string().min(1).max(4000),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    ts: z.string().datetime().optional(),
  }),
};

/**
 * Helper function to validate and extract user data
 */
export const validateRequestBody = <T,>(schema: z.ZodSchema, data: unknown): { valid: boolean; data?: T; errors?: string[] } => {
  try {
    const validated = schema.parse(data);
    return { valid: true, data: validated as T };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
      return { valid: false, errors };
    }
    return { valid: false, errors: ['Validation failed'] };
  }
};
