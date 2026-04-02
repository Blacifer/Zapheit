type MaskedMessage = { role: string; content: string };

type MaskTokenMap = Record<string, string>;

const PII_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'aadhaar', regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
  { name: 'pan', regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: 'phone', regex: /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/g },
];

export function applyCrossBorderMasking(messages: Array<{ role: string; content: any }>): {
  maskedMessages: MaskedMessage[];
  tokenMap: MaskTokenMap;
  maskedCount: number;
} {
  const tokenMap: MaskTokenMap = {};
  let counter = 0;

  const maskedMessages = messages.map((message) => {
    let content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '');
    for (const pattern of PII_PATTERNS) {
      content = content.replace(pattern.regex, (match) => {
        const token = `__PII_${pattern.name.toUpperCase()}_${counter++}__`;
        tokenMap[token] = match;
        return token;
      });
    }
    return { role: message.role, content };
  });

  return {
    maskedMessages,
    tokenMap,
    maskedCount: Object.keys(tokenMap).length,
  };
}

export function reinjectMaskedValues(text: string, tokenMap: MaskTokenMap): string {
  if (!text || !tokenMap || Object.keys(tokenMap).length === 0) return text;
  let out = text;
  for (const [token, original] of Object.entries(tokenMap)) {
    out = out.split(token).join(original);
  }
  return out;
}
