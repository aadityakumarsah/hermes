import type { EmbeddingProvider } from './embedding-provider.js';

export interface OpenAiEmbeddingProviderOptions {
  apiKey: string;
  model?: string;
  dimensions?: number;
}

/**
 * Real embedding provider backed by OpenAI's embeddings API. Uses the global
 * fetch (Node >= 20) so no extra HTTP dependency is required.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;

  constructor(options: OpenAiEmbeddingProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'text-embedding-3-small';
    // text-embedding-3-small defaults to 1536 dimensions.
    this.dimensions = options.dimensions ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI embeddings request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };
    const byIndex = new Map(data.data.map((entry) => [entry.index, entry.embedding]));
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 1) {
      const embedding = byIndex.get(i);
      if (!embedding) {
        throw new Error('OpenAI embeddings response missing an index entry');
      }
      out.push(embedding);
    }
    return out;
  }
}