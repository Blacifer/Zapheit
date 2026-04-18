// Form Validation Utilities
// Provides validation helpers for forms using security.ts utilities

import {
  sanitizeString,
  isValidEmail,
  isValidUrl,
  isValidAgentName,
  isInRange,
} from '../lib/security';

// ==================== AGENT FORM VALIDATION ====================

export interface AgentValidationError {
  name?: string;
  description?: string;
  agent_type?: string;
  platform?: string;
  model_name?: string;
  system_prompt?: string;
  budget_limit?: string;
}

export const validateAgentForm = (data: {
  name: string;
  description: string;
  agent_type: string;
  platform: string;
  model_name: string;
  system_prompt?: string;
  budget_limit?: number;
}): { isValid: boolean; errors: AgentValidationError } => {
  const errors: AgentValidationError = {};

  // Name validation
  if (!data.name || data.name.trim().length === 0) {
    errors.name = 'Agent name is required';
  } else if (!isValidAgentName(data.name)) {
    errors.name = 'Name must be 3-50 characters (letters, numbers, spaces, hyphens, underscores)';
  }

  // Description validation
  if (!data.description || data.description.trim().length === 0) {
    errors.description = 'Description is required';
  } else if (data.description.length > 500) {
    errors.description = 'Description must be less than 500 characters';
  }

  // Agent type validation
  if (!data.agent_type || data.agent_type.trim().length === 0) {
    errors.agent_type = 'Agent type is required';
  }

  // Platform validation
  if (!data.platform || data.platform.trim().length === 0) {
    errors.platform = 'Platform is required';
  }

  // Model name validation
  if (!data.model_name || data.model_name.trim().length === 0) {
    errors.model_name = 'Model is required';
  }

  // System prompt sanitization (optional field)
  if (data.system_prompt && data.system_prompt.length > 5000) {
    errors.system_prompt = 'System prompt must be less than 5000 characters';
  }

  // Budget validation
  if (data.budget_limit !== undefined) {
    if (data.budget_limit < 0) {
      errors.budget_limit = 'Budget cannot be negative';
    } else if (data.budget_limit > 1000000) {
      errors.budget_limit = 'Budget cannot exceed 1,000,000';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

// ==================== COST FORM VALIDATION ====================

export interface CostValidationError {
  date?: string;
  cost?: string;
  tokens?: string;
  requests?: string;
  agent_id?: string;
}

export const validateCostForm = (data: {
  date: string;
  cost?: number;
  tokens?: number;
  requests?: number;
  agent_id?: string;
}): { isValid: boolean; errors: CostValidationError } => {
  const errors: CostValidationError = {};

  // Date validation
  if (!data.date || data.date.trim().length === 0) {
    errors.date = 'Date is required';
  } else {
    const dateObj = new Date(data.date);
    if (isNaN(dateObj.getTime())) {
      errors.date = 'Invalid date format';
    } else if (dateObj > new Date()) {
      errors.date = 'Date cannot be in the future';
    }
  }

  // Cost validation
  if (data.cost === undefined || data.cost === null) {
    errors.cost = 'Cost is required';
  } else if (typeof data.cost !== 'number' || isNaN(data.cost)) {
    errors.cost = 'Cost must be a valid number';
  } else if (data.cost < 0) {
    errors.cost = 'Cost cannot be negative';
  } else if (data.cost > 1000000) {
    errors.cost = 'Cost seems unusually high';
  }

  // Tokens validation
  if (data.tokens === undefined || data.tokens === null) {
    errors.tokens = 'Tokens is required';
  } else if (!Number.isInteger(data.tokens)) {
    errors.tokens = 'Tokens must be a whole number';
  } else if (data.tokens < 0) {
    errors.tokens = 'Tokens cannot be negative';
  }

  // Requests validation
  if (data.requests === undefined || data.requests === null) {
    errors.requests = 'Requests is required';
  } else if (!Number.isInteger(data.requests)) {
    errors.requests = 'Requests must be a whole number';
  } else if (data.requests < 0) {
    errors.requests = 'Requests cannot be negative';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

// ==================== INCIDENT FORM VALIDATION ====================

export interface IncidentValidationError {
  agent_id?: string;
  incident_type?: string;
  severity?: string;
  title?: string;
  description?: string;
}

export const validateIncidentForm = (data: {
  agent_id: string;
  incident_type: string;
  severity: string;
  title: string;
  description: string;
}): { isValid: boolean; errors: IncidentValidationError } => {
  const errors: IncidentValidationError = {};

  // Agent ID validation
  if (!data.agent_id || data.agent_id.trim().length === 0) {
    errors.agent_id = 'Agent is required';
  }

  // Incident type validation
  if (!data.incident_type || data.incident_type.trim().length === 0) {
    errors.incident_type = 'Incident type is required';
  }

  // Severity validation
  const validSeverities = ['low', 'medium', 'high', 'critical'];
  if (!data.severity || !validSeverities.includes(data.severity)) {
    errors.severity = 'Invalid severity level';
  }

  // Title validation
  if (!data.title || data.title.trim().length === 0) {
    errors.title = 'Title is required';
  } else if (data.title.length < 5) {
    errors.title = 'Title must be at least 5 characters';
  } else if (data.title.length > 200) {
    errors.title = 'Title must be less than 200 characters';
  }

  // Description validation
  if (!data.description || data.description.trim().length === 0) {
    errors.description = 'Description is required';
  } else if (data.description.length < 10) {
    errors.description = 'Description must be at least 10 characters';
  } else if (data.description.length > 2000) {
    errors.description = 'Description must be less than 2000 characters';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

// ==================== WEBHOOK FORM VALIDATION ====================

export interface WebhookValidationError {
  slackWebhook?: string;
  pagerDutyKey?: string;
}

export const validateWebhookForm = (data: {
  slackEnabled: boolean;
  slackWebhook?: string;
  pagerDutyEnabled: boolean;
  pagerDutyKey?: string;
}): { isValid: boolean; errors: WebhookValidationError } => {
  const errors: WebhookValidationError = {};

  if (data.slackEnabled) {
    if (!data.slackWebhook || data.slackWebhook.trim().length === 0) {
      errors.slackWebhook = 'Slack webhook URL is required when enabled';
    } else if (!isValidUrl(data.slackWebhook) || !data.slackWebhook.includes('hooks.slack.com')) {
      errors.slackWebhook = 'Invalid Slack webhook URL';
    }
  }

  if (data.pagerDutyEnabled) {
    if (!data.pagerDutyKey || data.pagerDutyKey.trim().length === 0) {
      errors.pagerDutyKey = 'PagerDuty key is required when enabled';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

// ==================== UTILITY FUNCTIONS ====================

// Sanitize user input for safe storage/display
export const sanitizeInput = (input: string): string => {
  return sanitizeString(input);
};

// Format validation error for display
export const formatError = (error: string | undefined): string => {
  return error || '';
};

// Check if form has any errors
export const hasErrors = (errors: Record<string, string | undefined>): boolean => {
  return Object.values(errors).some((error) => error !== undefined);
};
