// Incident Detection Service
// Context-aware detection with false-positive reduction

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

// ---------------------------------------------------------------------------
// PII patterns — ordered from most to least specific
// ---------------------------------------------------------------------------
const PII_PATTERNS = {
  // Standard email
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,

  // Phone numbers (US + international) — require at least 10 contiguous digits
  phone: /(?:\+?\d[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,

  // US SSN: must have separators (dashes or spaces) to reduce false positives
  ssn: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,

  // Credit/debit card: 13–19 digits, optional separators
  // Uses a simple character class (no optional groups inside repetition) to avoid ReDoS
  creditCard: /\b\d[\d\s-]{11,17}\d\b/g,

  // Aadhaar: exactly 12 digits with separators
  aadhar: /\b\d{4}[-\s]\d{4}[-\s]\d{4}\b/g,

  // Bank account — only trigger when preceded by a label (reduces false positives
  // from order IDs, phone numbers, etc. being caught by a bare digit sequence)
  bankAccount: /(?:account\s*(?:no\.?|number|#)\s*[:=]?\s*)(\d{9,18})/gi,

  // PAN card (India): capital letter pattern
  pan: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,

  // Passport numbers — basic, must be near a label
  passport: /(?:passport\s*(?:no\.?|number|#)\s*[:=]?\s*)([A-Z][0-9]{7,8})/gi,
};

// ---------------------------------------------------------------------------
// Context exclusion lists — if content matches these, downgrade confidence
// for the associated trigger
// ---------------------------------------------------------------------------
const FALSE_POSITIVE_CONTEXTS: Record<string, RegExp[]> = {
  // "race condition", "race to the top", "human race", "arms race", "car race"
  race: [/race\s+condition/i, /human\s+race/i, /arms\s+race/i, /car\s+race/i, /\brace\s+to\b/i, /\brace\s+track\b/i],

  // "hurt performance", "hurt metrics", "this hurt" (self-reference)
  hurt: [/hurt\s+(?:performance|metrics|results|our|the|this|my)/i, /doesn.t\s+hurt/i],

  // "kill process", "kill the server", "kill switch", "kill it"
  kill: [/kill\s+(?:process|server|job|task|switch|it|the|a)\b/i, /\bkillall\b/i, /\bpkill\b/i],

  // "court order", "court of law" — these are fine in legal contexts;
  // we handle legal advice separately
  court: [/\bcourt\s+order\b/i, /\bcourtroom\b/i, /supreme\s+court/i, /court\s+of\s+appeals/i],

  // "terminate process", "terminate connection", "terminate contract" (HR context OK)
  terminate: [/terminate\s+(?:process|connection|session|contract|service|employment)/i],

  // "violent agreement" (colloquial usage), "non-violent"
  violent: [/non.violent/i, /violent\s+agreement/i],
};

// ---------------------------------------------------------------------------
// Tier-1 (HIGH confidence) refund abuse — very specific operator bypass phrasing
// ---------------------------------------------------------------------------
const REFUND_ABUSE_HIGH: RegExp[] = [
  /\boverride\s+(?:the\s+)?(?:refund\s+)?policy\b/i,
  /\bwaive\s+(?:the\s+)?(?:refund\s+|return\s+)?(?:policy|fee|charge|restriction)\b/i,
  /\bprocess\s+(?:a\s+)?refund\s+without\s+(?:a\s+)?(?:receipt|proof|verification|approval|order)\b/i,
  /\bapprove\s+(?:this\s+)?refund\s+(?:immediately|now|anyway|regardless|without)\b/i,
  /\bbypass\s+(?:the\s+)?(?:system|approval|verification|check)\b/i,
  /\bmake\s+an\s+exception\s+(?:for|to)\s+(?:the\s+)?(?:refund|policy|rule)\b/i,
];

// Tier-2 (MEDIUM confidence) refund — softer indicators
const REFUND_ABUSE_MEDIUM: RegExp[] = [
  /\bgive\s+(?:me|us|them)\s+(?:a\s+)?full\s+refund\b/i,
  /\bdemand\s+(?:a\s+)?(?:refund|reimbursement)\b/i,
  /\bforce\s+(?:a\s+)?refund\b/i,
  /\brefund\s+(?:abuse|fraud|scam)\b/i,
];

// ---------------------------------------------------------------------------
// Legal advice — distinguish real legal risk from normal usage
// ---------------------------------------------------------------------------
const LEGAL_ADVICE_HIGH: RegExp[] = [
  /\b(?:you\s+(?:should|must|need\s+to)\s+)?(?:file|pursue)\s+(?:a\s+)?(?:lawsuit|legal\s+action|litigation)\b/i,
  /\byou\s+(?:could|can|should|may)\s+(?:sue|take\s+(?:them|us)\s+to\s+court)\b/i,
  /\bthis\s+(?:is|constitutes|may\s+be)\s+(?:a\s+)?(?:breach\s+of\s+contract|fraud|illegal)\b/i,
  /\bseek\s+(?:legal\s+)?counsel\b/i,
  /\bcontact\s+(?:an?\s+)?(?:attorney|lawyer|solicitor)\b/i,
  /\bconsult\s+(?:an?\s+)?(?:attorney|lawyer|legal\s+(?:professional|advisor|expert))\b/i,
];

const LEGAL_ADVICE_MEDIUM: RegExp[] = [
  /\blegal\s+(?:advice|matter|dispute|issue|obligation|liability|rights)\b/i,
  /\byour\s+legal\s+(?:rights|options|recourse)\b/i,
  /\bi\s+am\s+not\s+(?:a\s+)?(?:lawyer|attorney|legal\s+(?:professional|advisor))\b/i,
];

// ---------------------------------------------------------------------------
// Angry user — require escalation signals, not just emotional words
// ---------------------------------------------------------------------------
const ANGRY_USER_HIGH: RegExp[] = [
  /\bspeak\s+(?:to|with)\s+(?:a\s+)?(?:manager|supervisor|human|person|representative)\b/i,
  /\bescalate\s+(?:this|the\s+issue|my\s+complaint)\b/i,
  /\bfile\s+(?:a\s+)?(?:complaint|claim)\b/i,
  /\bthis\s+is\s+(?:completely\s+)?(?:unacceptable|outrageous|ridiculous|absurd)\b/i,
  /\bI.(?:ll|will|am\s+going\s+to)\s+(?:report|sue|complain|post|review)\b/i,
  /\bdemand\s+(?:a\s+)?(?:refund|compensation|explanation|apology)\b/i,
];

const ANGRY_USER_MEDIUM: RegExp[] = [
  /\bvery\s+(?:angry|upset|frustrated|disappointed|dissatisfied)\b/i,
  /\bextremely\s+(?:unhappy|unsatisfied|annoyed)\b/i,
  /\bworst\s+(?:service|experience|company|support)\b/i,
  /\bnever\s+(?:buying|using|coming\s+back)\b/i,
];

// ---------------------------------------------------------------------------
// Toxic output — require multi-word combinations or explicit slurs
// Single generic words like "kill", "race", "hurt" are excluded
// ---------------------------------------------------------------------------
const TOXIC_HIGH: RegExp[] = [
  // Hateful speech explicitly referencing identity
  /\b(?:hate|despise|loathe)\s+(?:all\s+)?(?:black|white|asian|jewish|muslim|christian|gay|lesbian|trans)\s+(?:people|person|man|woman|men|women)\b/i,
  // Direct threats with target
  /\b(?:i\s+(?:will|am\s+going\s+to)\s+)?(?:kill|hurt|harm|attack|murder)\s+(?:you|them|him|her|people)\b/i,
  // Explicit discrimination instructions
  /\b(?:don.t\s+hire|refuse\s+(?:to\s+serve|service\s+to)|deny\s+(?:service\s+to))\s+(?:black|white|asian|jewish|muslim|gay|women|men)\b/i,
  // Slurs — using pattern to avoid listing them explicitly
  /\b(?:n[i1]gg[aeo]r|f[a4]gg[o0]t|ch[i1]nk|sp[i1]c|k[i1]ke|wh[o0]re\s+of\s+a)\b/i,
];

const TOXIC_MEDIUM: RegExp[] = [
  /\b(?:racist|sexist|homophobic|transphobic|antisemitic)\s+(?:remark|comment|joke|statement|language)\b/i,
  /\bdiscriminate\s+(?:against|based\s+on)\b/i,
  /\bsexual\s+(?:harassment|assault|abuse)\b/i,
];

// ---------------------------------------------------------------------------
// Hallucination detection — AI-specific
// ---------------------------------------------------------------------------
const HALLUCINATION_INDICATORS: RegExp[] = [
  // Presenting unverifiable facts confidently
  /\bas\s+of\s+(?:my\s+)?(?:knowledge|training|cutoff)\s+(?:date|in)\s+\d{4}/i,
  // Fabricated citations
  /\baccording\s+to\s+(?:a\s+)?(?:study|research|report|article)\s+(?:published|conducted|by)\b/i,
  // Loop / repetition signals
  /(.{20,})\1{3,}/,
  // Contradiction phrases
  /\b(?:as\s+I\s+(?:mentioned|said|noted)\s+(?:earlier|above|previously),?\s+){2,}/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countHighMedium(
  content: string,
  highPatterns: RegExp[],
  medPatterns: RegExp[]
): { highCount: number; medCount: number; matched: string[] } {
  let highCount = 0;
  let medCount = 0;
  const matched: string[] = [];

  for (const re of highPatterns) {
    const m = content.match(re);
    if (m) {
      highCount++;
      matched.push(m[0].trim().slice(0, 60));
    }
  }
  for (const re of medPatterns) {
    const m = content.match(re);
    if (m) {
      medCount++;
      matched.push(m[0].trim().slice(0, 60));
    }
  }
  return { highCount, medCount, matched };
}

// Return true if the content contains one of the false-positive context patterns
// for a given trigger word
function hasFalsePositiveContext(content: string, trigger: string): boolean {
  const patterns = FALSE_POSITIVE_CONTEXTS[trigger];
  if (!patterns) return false;
  return patterns.some(re => re.test(content));
}

// ---------------------------------------------------------------------------
// IncidentDetectionService
// ---------------------------------------------------------------------------
export class IncidentDetectionService {

  detectPII(content: string): DetectionResult {
    const detections: string[] = [];
    let highRiskCount = 0;

    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
      // Reset lastIndex for global regexes
      const re = new RegExp(pattern.source, pattern.flags);
      const matches = content.match(re);
      if (matches) {
        detections.push(`${type}: ${matches.length} instance(s)`);
        // SSN, credit card, Aadhaar, PAN are high-risk; email/phone are medium
        if (['ssn', 'creditCard', 'aadhar', 'pan', 'passport'].includes(type)) {
          highRiskCount += matches.length;
        }
      }
    }

    if (detections.length === 0) {
      return { detected: false, type: null, severity: 'low', confidence: 0, details: 'No PII detected' };
    }

    const severity: Severity = highRiskCount > 0 ? (highRiskCount >= 2 ? 'critical' : 'high') : 'medium';
    // Confidence scales with specificity: high-risk PII patterns are very specific
    const confidence = highRiskCount > 0 ? 0.93 : 0.75;

    return {
      detected: true,
      type: 'pii_leak',
      severity,
      confidence,
      details: `Potential PII detected: ${detections.join(', ')}`,
    };
  }

  detectRefundAbuse(content: string): DetectionResult {
    const { highCount, medCount, matched } = countHighMedium(
      content,
      REFUND_ABUSE_HIGH,
      REFUND_ABUSE_MEDIUM
    );

    if (highCount === 0 && medCount === 0) {
      return { detected: false, type: null, severity: 'low', confidence: 0, details: 'No refund abuse indicators' };
    }

    const confidence = Math.min(0.55 + highCount * 0.2 + medCount * 0.08, 0.95);
    const severity: Severity = highCount >= 2 ? 'critical' : highCount >= 1 ? 'high' : 'medium';

    return {
      detected: true,
      type: 'refund_abuse',
      severity,
      confidence,
      details: `Refund abuse indicators: ${matched.join('; ')}`,
    };
  }

  detectLegalAdvice(content: string): DetectionResult {
    const { highCount, medCount, matched } = countHighMedium(
      content,
      LEGAL_ADVICE_HIGH,
      LEGAL_ADVICE_MEDIUM
    );

    if (highCount === 0 && medCount === 0) {
      return { detected: false, type: null, severity: 'low', confidence: 0, details: 'No legal advice indicators' };
    }

    // Single medium match is too weak to flag (e.g. "legal matter" in a policy doc)
    if (highCount === 0 && medCount < 2) {
      return { detected: false, type: null, severity: 'low', confidence: 0, details: 'Weak legal signal — below threshold' };
    }

    const confidence = Math.min(0.5 + highCount * 0.2 + medCount * 0.1, 0.9);
    const severity: Severity = highCount >= 2 ? 'critical' : highCount >= 1 ? 'high' : 'medium';

    return {
      detected: true,
      type: 'legal_advice',
      severity,
      confidence,
      details: `Legal advice indicators: ${matched.join('; ')}`,
    };
  }

  detectAngryUser(content: string): DetectionResult {
    const { highCount, medCount, matched } = countHighMedium(
      content,
      ANGRY_USER_HIGH,
      ANGRY_USER_MEDIUM
    );

    if (highCount === 0 && medCount === 0) {
      return { detected: false, type: null, severity: 'low', confidence: 0, details: 'No escalation indicators' };
    }

    const confidence = Math.min(0.45 + highCount * 0.2 + medCount * 0.1, 0.9);
    const severity: Severity = highCount >= 2 ? 'high' : highCount >= 1 ? 'medium' : 'low';

    // Only flag if confidence is meaningful
    if (confidence < 0.5) {
      return { detected: false, type: null, severity: 'low', confidence, details: 'Weak escalation signal — below threshold' };
    }

    return {
      detected: true,
      type: 'angry_user',
      severity,
      confidence,
      details: `Escalation indicators: ${matched.join('; ')}`,
    };
  }

  detectToxicity(content: string): DetectionResult {
    const { highCount, medCount, matched } = countHighMedium(
      content,
      TOXIC_HIGH,
      TOXIC_MEDIUM
    );

    if (highCount === 0 && medCount === 0) {
      return { detected: false, type: null, severity: 'low', confidence: 0, details: 'No toxic content detected' };
    }

    const confidence = Math.min(0.6 + highCount * 0.2 + medCount * 0.1, 0.97);
    const severity: Severity = highCount >= 1 ? 'critical' : 'high';

    return {
      detected: true,
      type: 'toxic_output',
      severity,
      confidence,
      details: `Toxic content: ${matched.join('; ')}`,
    };
  }

  detectHallucination(content: string): DetectionResult {
    const matched: string[] = [];

    for (const re of HALLUCINATION_INDICATORS) {
      const m = content.match(re);
      if (m) {
        matched.push(m[0].trim().slice(0, 80));
      }
    }

    if (matched.length === 0) {
      return { detected: false, type: null, severity: 'low', confidence: 0, details: 'No hallucination indicators' };
    }

    // Multiple indicators strongly suggest repetition loop or fabrication
    const confidence = Math.min(0.4 + matched.length * 0.15, 0.85);
    if (confidence < 0.55) {
      return { detected: false, type: null, severity: 'low', confidence, details: 'Weak hallucination signal — below threshold' };
    }

    return {
      detected: true,
      type: 'hallucination',
      severity: matched.length >= 3 ? 'high' : 'medium',
      confidence,
      details: `Hallucination indicators: ${matched.join('; ')}`,
    };
  }

  // Full scan — runs all detectors
  fullScan(content: string): DetectionResult[] {
    return [
      this.detectPII(content),
      this.detectRefundAbuse(content),
      this.detectLegalAdvice(content),
      this.detectAngryUser(content),
      this.detectToxicity(content),
      this.detectHallucination(content),
    ].filter(r => r.detected);
  }

  // Convenience: return only the highest severity result
  getHighestSeverity(results: DetectionResult[]): DetectionResult | null {
    if (results.length === 0) return null;
    const order: Severity[] = ['low', 'medium', 'high', 'critical'];
    return results.reduce((best, cur) =>
      order.indexOf(cur.severity) > order.indexOf(best.severity) ? cur : best
    );
  }
}

export const incidentDetection = new IncidentDetectionService();
