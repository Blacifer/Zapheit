// ---------------------------------------------------------------------------
// Shared embedding utilities
// Extracted from gateway.ts so that correction-memory and other services
// can generate embeddings without importing the entire gateway route.
// ---------------------------------------------------------------------------

/**
 * Deterministic fallback embedding — no API call required.
 * Produces a normalized 1536-dim vector from character codes.
 * Similarity is approximate but consistent for identical strings.
 */
export function createSimpleEmbedding(text: string, dimensions = 1536): number[] {
  const vector = new Array(dimensions).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    vector[i % dimensions] += (code % 97) / 97;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + (v * v), 0)) || 1;
  return vector.map((v) => v / magnitude);
}

/**
 * Real OpenAI text embedding via the embeddings API.
 */
export async function fetchOpenAIEmbeddings(
  apiKey: string,
  model: string,
  input: string[],
): Promise<{ embeddings: number[][]; promptTokens: number; totalTokens: number }> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI embeddings failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as any;
  const embeddings = (data?.data || []).map((item: any) => item.embedding as number[]);
  const promptTokens = data?.usage?.prompt_tokens || 0;
  const totalTokens = data?.usage?.total_tokens || promptTokens;
  return { embeddings, promptTokens, totalTokens };
}

/**
 * Embed a single text string using OpenAI if a key is available,
 * otherwise fall back to the deterministic embedding.
 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.RASI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (apiKey) {
    try {
      const result = await fetchOpenAIEmbeddings(apiKey, 'text-embedding-3-small', [text]);
      if (result.embeddings[0]) return result.embeddings[0];
    } catch {
      // fall through to deterministic fallback
    }
  }
  return createSimpleEmbedding(text);
}

/**
 * Cosine similarity between two vectors. Returns a value in [-1, 1].
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
