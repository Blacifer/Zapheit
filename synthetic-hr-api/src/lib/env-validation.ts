import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().optional(),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_KEY: z.string().min(1, 'SUPABASE_SERVICE_KEY is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').optional(),
  API_URL: z.string().url('API_URL must be a valid URL').optional(),
  OTEL_ENABLED: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  EMAIL_PROVIDER: z.enum(['resend', 'webhook']).optional(),
  EMAIL_FROM: z.string().email('EMAIL_FROM must be a valid email').optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_WEBHOOK_URL: z.string().url('EMAIL_WEBHOOK_URL must be a valid URL').optional(),
  ALERT_EMAIL_TO: z.string().email('ALERT_EMAIL_TO must be a valid email').optional(),
  SLACK_WEBHOOK_URL: z.string().url('SLACK_WEBHOOK_URL must be a valid URL').optional(),
  PAGERDUTY_API_TOKEN: z.string().optional(),
  PAGERDUTY_SERVICE_ID: z.string().optional(),
  PAGERDUTY_INTEGRATION_KEY: z.string().optional(),
});

export function validateEnvironment(): void {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${issues}`);
  }

  if (result.data.NODE_ENV === 'production') {
    const required = [];
    
    if (!result.data.FRONTEND_URL) required.push('FRONTEND_URL');
    if (!result.data.API_URL) required.push('API_URL');
    if (!result.data.EMAIL_FROM) required.push('EMAIL_FROM');
    if (!result.data.ALERT_EMAIL_TO) required.push('ALERT_EMAIL_TO');
    
    if (required.length > 0) {
      throw new Error(`Environment validation failed: Production requires [${required.join(', ')}]`);
    }

    const provider = result.data.EMAIL_PROVIDER || 'resend';
    if (provider === 'resend' && !result.data.RESEND_API_KEY) {
      throw new Error('Environment validation failed: RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
    }

    if (provider === 'webhook' && !result.data.EMAIL_WEBHOOK_URL) {
      throw new Error('Environment validation failed: EMAIL_WEBHOOK_URL is required when EMAIL_PROVIDER=webhook');
    }

    // Verify observability is configured in production
    if (result.data.OTEL_ENABLED !== 'false') {
      if (!result.data.OTEL_EXPORTER_OTLP_ENDPOINT) {
        console.warn('WARNING: OTEL_EXPORTER_OTLP_ENDPOINT not configured, observability traces will not be exported');
      }
    }
  }
}
