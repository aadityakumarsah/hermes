import type { MemoryRecord } from './types.js';

export interface ScoreInput {
  importance: number;
  confidence: number;
  explicit: boolean;
  /** Semantic relevance in [0, 1]; 0 when there was no vector query. */
  relevance: number;
  recencyHours: number;
  accessCount: number;
}

/** How quickly inferred (non-explicit) memories fade. */
export const RECENCY_DECAY = 0.92;

export function recencyHours(createdAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
}

/**
 * Combined importance metric for ranking recalled memories. Latent (i.e.
 * only matters when the user hasn't explicitly stated a value): older,
 * confidently-inferred memories with high semantic relevance outrank new ones.
 */
export function scoreMemory(input: ScoreInput): number {
  const base = input.importance * 0.5 + input.relevance * 0.5;
  const decay = input.explicit ? 1 : Math.pow(RECENCY_DECAY, Math.min(input.recencyHours, 24 * 365));
  const confidenceBoost = 0.5 + input.confidence * 0.5;
  const accessBump = Math.min(input.accessCount, 5) * 0.02;
  return base * decay * confidenceBoost + accessBump;
}

export function scoreMemoryRecord(
  memory: MemoryRecord,
  relevance: number,
  now: Date,
): number {
  return scoreMemory({
    importance: memory.importance,
    confidence: memory.confidence,
    explicit: memory.explicit,
    relevance,
    recencyHours: recencyHours(memory.createdAt, now),
    accessCount: memory.accessCount,
  });
}