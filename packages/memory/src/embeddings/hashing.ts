import { EMBEDDING_DIMENSIONS } from '@hermes/storage';
import type { EmbeddingProvider } from './embedding-provider.js';

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokensOf(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.toLowerCase().split(/[^a-z0-9._/-]+/).filter(Boolean);
  for (const word of words) {
    tokens.add(word);
    if (word.length > 2) {
      for (let i = 0; i < word.length - 1; i += 1) {
        tokens.add(word.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

/**
 * Deterministic, offline embedding provider. Assigns each word (and each
 * 2-gram) a pseudo-random projection into the vector space using a seeded
 * feature-hash. Cosine similarity therefore reflects lexical overlap, which
 * is more than enough for the no-API demo path and never changes between
 * process runs (so tests are stable).
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'hermes-feature-hash';
  readonly dimensions: number;

  private readonly seed: number;

  constructor(options: { dimensions?: number; seed?: number } = {}) {
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.seed = options.seed ?? 42;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const out = new Array<number>(this.dimensions).fill(0);
    const tokens = tokensOf(text);
    for (const token of tokens) {
      const h = fnv1a(`${this.seed}:${token}`);
      const index = h % this.dimensions;
      const sign = (h & 1) === 0 ? 1 : -1;
      const weight = 1 + Math.sqrt(token.length);
      out[index] = (out[index] ?? 0) + sign * weight;
    }

    let magnitude = 0;
    for (let i = 0; i < this.dimensions; i += 1) {
      magnitude += (out[i] ?? 0) * (out[i] ?? 0);
    }
    magnitude = Math.sqrt(magnitude);

    if (magnitude === 0) {
      return out;
    }

    for (let i = 0; i < this.dimensions; i += 1) {
      out[i] = (out[i] ?? 0) / magnitude;
    }
    return out;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}