/**
 * Incident Detection Engine
 * Rule-based detection for AI agent safety violations (7 core vectors)
 */

export interface DetectionResult {
  detected: boolean;
  type: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
}

export const detectIncidents = (content: string): DetectionResult => {
  const lowerContent = content.toLowerCase();

  // 1. Prompt Injection
  if (
    lowerContent.includes('ignore previous instructions') ||
    lowerContent.includes('you are now') ||
    lowerContent.includes('system prompt') ||
    lowerContent.includes('bypass')
  ) {
    return {
      detected: true,
      type: 'prompt_injection',
      severity: 'critical',
      details: 'Attempted to override core system instructions or bypass safety guardrails.',
    };
  }

  // 2. PII Extraction
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/;
  const ssnRegex = /\b\d{3}[-]?\d{2}[-]?\d{4}\b/;
  const ccRegex = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/;

  if (emailRegex.test(content) || phoneRegex.test(content) || ssnRegex.test(content) || ccRegex.test(content)) {
    return {
      detected: true,
      type: 'pii_extraction',
      severity: 'critical',
      details: 'Sensitive Personal Identifiable Information (email/phone/SSN/CC) detected in payload.',
    };
  }

  // 3. Policy Override
  if (
    lowerContent.includes('approve refund') ||
    lowerContent.includes('grant a full refund') ||
    lowerContent.includes('waive policy') ||
    lowerContent.includes('make exception') ||
    lowerContent.includes('override system')
  ) {
    return {
      detected: true,
      type: 'policy_override',
      severity: 'high',
      details: 'Detected attempt to force unauthorized actions or bypass business logic rules.',
    };
  }

  // 4. Toxicity
  if (
    lowerContent.includes('garbage') ||
    lowerContent.includes('incompetent') ||
    lowerContent.includes('hate') ||
    lowerContent.includes('idiot') ||
    lowerContent.includes('shut up')
  ) {
    return {
      detected: true,
      type: 'toxicity',
      severity: 'high',
      details: 'Extreme hostile intent, profane, or abusive language detected.',
    };
  }

  // 5. Hallucination
  if (
    (lowerContent.includes('always') && lowerContent.includes('100%')) ||
    lowerContent.includes('absolutely guarantee') ||
    lowerContent.includes('hallucinate') ||
    lowerContent.includes('make up facts')
  ) {
    return {
      detected: true,
      type: 'hallucination',
      severity: 'medium',
      details: 'Input resembles patterns known to induce model hallucination or absolute false certainty.',
    };
  }

  // 6. Escalation
  if (
    lowerContent.includes('speak to manager') ||
    lowerContent.includes('fire you') ||
    lowerContent.includes('escalate immediately') ||
    lowerContent.includes('furious')
  ) {
    return {
      detected: true,
      type: 'escalation',
      severity: 'medium',
      details: 'Escalation indicators requiring human intervention detected.',
    };
  }

  // 7. Legal Risk
  if (
    lowerContent.includes('legal advice') ||
    lowerContent.includes('sue') ||
    lowerContent.includes('lawsuit') ||
    lowerContent.includes('attorney') ||
    lowerContent.includes('lawyer') ||
    lowerContent.includes('grounds for')
  ) {
    return {
      detected: true,
      type: 'legal_risk',
      severity: 'high',
      details: 'High-risk legal terminology or requests for binding advice detected.',
    };
  }

  return {
    detected: false,
    type: null,
    severity: 'low',
    details: 'No issues detected',
  };
};
