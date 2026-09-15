import { HashEmbeddingProvider } from './hashing.js';
import { OpenAiEmbeddingProvider } from './openai.js';

export interface EmbeddingProvider {
  /** Identifier recorded in memory_embeddings (e.g. 'text-embedding-3-small'). */
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingProviderOptions {
  /** OpenAI-compatible API key. When absent, the deterministic hash provider is used. */
  openAiApiKey?: string;
  openAiModel?: string;
  openAiDimensions?: number;
}

export function createEmbeddingProvider(options: EmbeddingProviderOptions = {}): EmbeddingProvider {
  if (options.openAiApiKey) {
    return new OpenAiEmbeddingProvider({
      apiKey: options.openAiApiKey,
      model: options.openAiModel,
      dimensions: options.openAiDimensions,
    });
  }
  return new HashEmbeddingProvider();
}

export { HashEmbeddingProvider, OpenAiEmbeddingProvider };
export type { OpenAiEmbeddingProviderOptions } from './openai.js';