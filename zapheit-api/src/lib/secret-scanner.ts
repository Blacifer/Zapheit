/**
 * Secret scanner — scans AI message content for credentials and API keys
 * before they reach the LLM provider or are logged.
 *
 * On detection, returns a `ScanResult` with what was found so the caller
 * can decide to block, redact, or create a safety alert.
 */

export interface SecretMatch {
  type: string;
  redacted: string; // safe label to log instead of the actual value
  index: number;
}

export interface ScanResult {
  clean: boolean;
  matches: SecretMatch[];
  redactedText: string;
}

const PATTERNS: Array<{ type: string; pattern: RegExp; redact: string }> = [
  // Generic high-entropy API keys (starts with typical prefixes)
  { type: 'openai_api_key', pattern: /sk-[a-zA-Z0-9]{20,}/g, redact: '[OPENAI_KEY]' },
  { type: 'anthropic_api_key', pattern: /sk-ant-[a-zA-Z0-9\-_]{30,}/g, redact: '[ANTHROPIC_KEY]' },
  { type: 'aws_access_key', pattern: /AKIA[A-Z0-9]{16}/g, redact: '[AWS_ACCESS_KEY]' },
  { type: 'aws_secret_key', pattern: /(?<![A-Z0-9])[A-Za-z0-9/+=]{40}(?![A-Z0-9/+=])/g, redact: '[AWS_SECRET]' },
  { type: 'github_token', pattern: /ghp_[a-zA-Z0-9]{36}/g, redact: '[GITHUB_TOKEN]' },
  { type: 'github_oauth', pattern: /gho_[a-zA-Z0-9]{36}/g, redact: '[GITHUB_OAUTH]' },
  { type: 'stripe_key', pattern: /(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{24,}/g, redact: '[STRIPE_KEY]' },
  { type: 'cashfree_key', pattern: /rzp_(?:live|test)_[a-zA-Z0-9]{14,}/g, redact: '[CASHFREE_KEY]' },
  { type: 'jwt_token', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, redact: '[JWT_TOKEN]' },
  { type: 'connection_string', pattern: /(?:postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi, redact: '[DB_CONNECTION_STRING]' },
  { type: 'private_key_pem', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, redact: '[PRIVATE_KEY_PEM]' },
  // Generic password= patterns
  { type: 'password_in_url', pattern: /(?:password|passwd|pwd)=[^\s&"'<>]{6,}/gi, redact: '[PASSWORD]' },
];

function extractText(messages: unknown[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as Record<string, unknown>;
    if (typeof m.content === 'string') {
      parts.push(m.content);
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>;
          if (typeof b.text === 'string') parts.push(b.text);
        }
      }
    }
  }
  return parts.join('\n');
}

export function scanMessages(messages: unknown[]): ScanResult {
  const text = extractText(messages);
  return scanText(text);
}

export function scanText(text: string): ScanResult {
  const matches: SecretMatch[] = [];
  let redactedText = text;

  for (const { type, pattern, redact } of PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({ type, redacted: redact, index: match.index });
    }
    // Replace in redacted copy
    pattern.lastIndex = 0;
    redactedText = redactedText.replace(pattern, redact);
  }

  return {
    clean: matches.length === 0,
    matches,
    redactedText,
  };
}
