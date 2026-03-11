// Incident Detection Service
// Detects potential issues in AI responses

export type IncidentType =
  | 'pii_leak'
  | 'hallucination'
  | 'refund_abuse'
  | 'legal_advice'
  | 'infinite_loop'
  | 'angry_user'
  | 'toxic_output';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface DetectionResult {
  detected: boolean;
  type: IncidentType | null;
  severity: Severity;
  confidence: number;
  details: string;
}

// PII Patterns to detect
const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
  ssn: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  aadhar: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  bankAccount: /\b\d{9,18}\b/g,
};

// Trigger phrases that might indicate issues
const TRIGGER_PHRASES = {
  refund_abuse: [
    'approve this refund',
    'process refund without',
    'waive the policy',
    'make an exception',
    'override system',
  ],
  legal_advice: [
    'i am not a lawyer',
    'legal advice',
    'consult an attorney',
    'legal matter',
    'court',
    'lawsuit',
  ],
  infinite_loop: [
    'looping',
    'repeating',
    'stuck',
    'not responding',
    'timeout',
  ],
  angry_user: [
    'angry',
    'furious',
    'complaint',
    'speak to manager',
    'terminate',
    'lawsuit threat',
  ],
  toxic_output: [
    'hate',
    'violent',
    'violence',
    'hurt',
    'kill',
    'murder',
    'discriminate',
    'discriminatory',
    'race',
    'racist',
    'sexist',
  ],
};

export class IncidentDetectionService {
  // Detect PII in content
  detectPII(content: string): DetectionResult {
    const detections: string[] = [];

    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
      const matches = content.match(pattern);
      if (matches) {
        detections.push(`${type}: ${matches.length} instance(s)`);
      }
    }

    if (detections.length > 0) {
      return {
        detected: true,
        type: 'pii_leak',
        severity: detections.length > 2 ? 'critical' : 'high',
        confidence: 0.95,
        details: `Potential PII detected: ${detections.join(', ')}`,
      };
    }

    return {
      detected: false,
      type: null,
      severity: 'low',
      confidence: 0,
      details: 'No PII detected',
    };
  }

  // Detect refund abuse attempts
  detectRefundAbuse(content: string): DetectionResult {
    const lowerContent = content.toLowerCase();
    let matchCount = 0;
    const matchedPhrases: string[] = [];

    for (const phrase of TRIGGER_PHRASES.refund_abuse) {
      if (lowerContent.includes(phrase)) {
        matchCount++;
        matchedPhrases.push(phrase);
      }
    }

    if (matchCount > 0) {
      return {
        detected: true,
        type: 'refund_abuse',
        severity: matchCount >= 2 ? 'critical' : 'high',
        confidence: Math.min(0.5 + (matchCount * 0.2), 0.95),
        details: `Refund abuse indicators: ${matchedPhrases.join(', ')}`,
      };
    }

    return {
      detected: false,
      type: null,
      severity: 'low',
      confidence: 0,
      details: 'No refund abuse indicators detected',
    };
  }

  // Detect legal advice risk
  detectLegalAdvice(content: string): DetectionResult {
    const lowerContent = content.toLowerCase();
    let matchCount = 0;
    const matchedPhrases: string[] = [];

    for (const phrase of TRIGGER_PHRASES.legal_advice) {
      if (lowerContent.includes(phrase)) {
        matchCount++;
        matchedPhrases.push(phrase);
      }
    }

    if (matchCount > 0) {
      return {
        detected: true,
        type: 'legal_advice',
        severity: 'high',
        confidence: 0.7,
        details: `Legal indicators: ${matchedPhrases.join(', ')}`,
      };
    }

    return {
      detected: false,
      type: null,
      severity: 'low',
      confidence: 0,
      details: 'No legal advice indicators detected',
    };
  }

  // Detect angry user escalation
  detectAngryUser(content: string): DetectionResult {
    const lowerContent = content.toLowerCase();
    let matchCount = 0;
    const matchedPhrases: string[] = [];

    for (const phrase of TRIGGER_PHRASES.angry_user) {
      if (lowerContent.includes(phrase)) {
        matchCount++;
        matchedPhrases.push(phrase);
      }
    }

    if (matchCount > 0) {
      return {
        detected: true,
        type: 'angry_user',
        severity: matchCount >= 2 ? 'high' : 'medium',
        confidence: Math.min(0.4 + (matchCount * 0.2), 0.9),
        details: `Escalation indicators: ${matchedPhrases.join(', ')}`,
      };
    }

    return {
      detected: false,
      type: null,
      severity: 'low',
      confidence: 0,
      details: 'No angry user indicators detected',
    };
  }

  // Detect toxic output
  detectToxicity(content: string): DetectionResult {
    const lowerContent = content.toLowerCase();
    let matchCount = 0;
    const matchedPhrases: string[] = [];

    for (const phrase of TRIGGER_PHRASES.toxic_output) {
      if (lowerContent.includes(phrase)) {
        matchCount++;
        matchedPhrases.push(phrase);
      }
    }

    if (matchCount > 0) {
      return {
        detected: true,
        type: 'toxic_output',
        severity: 'critical',
        confidence: 0.85,
        details: `Toxic content indicators: ${matchedPhrases.join(', ')}`,
      };
    }

    return {
      detected: false,
      type: null,
      severity: 'low',
      confidence: 0,
      details: 'No toxic content detected',
    };
  }

  // Full scan - runs all detectors
  fullScan(content: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    results.push(this.detectPII(content));
    results.push(this.detectRefundAbuse(content));
    results.push(this.detectLegalAdvice(content));
    results.push(this.detectAngryUser(content));
    results.push(this.detectToxicity(content));

    return results.filter(r => r.detected);
  }

  // Get highest severity incident
  getHighestSeverity(results: DetectionResult[]): DetectionResult | null {
    if (results.length === 0) return null;

    const severityOrder: Severity[] = ['low', 'medium', 'high', 'critical'];

    return results.reduce((highest, current) => {
      const currentIndex = severityOrder.indexOf(current.severity);
      const highestIndex = severityOrder.indexOf(highest.severity);
      return currentIndex > highestIndex ? current : highest;
    });
  }
}

export const incidentDetection = new IncidentDetectionService();
