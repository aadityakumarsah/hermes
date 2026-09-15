import { createHash } from 'node:crypto';
import type { MemoryType, TenantId, UserId } from '@hermes/core';
import type { MemoryRecord } from './types.js';

export interface NormalizeOptions {
  lower?: boolean;
  stripPunctuation?: boolean;
  collapseWhitespace?: boolean;
  maxLength?: number;
}

const DEFAULT_OPTIONS: NormalizeOptions = {
  lower: true,
  stripPunctuation: true,
  collapseWhitespace: true,
  maxLength: 512,
};

export function normalizeContent(content: string, options: NormalizeOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let out = content.trim();
  if (opts.lower) {
    out = out.toLowerCase();
  }
  if (opts.stripPunctuation) {
    out = out.replace(/[^\p{L}\p{N}\s@._/#+~= -]/gu, '');
  }
  if (opts.collapseWhitespace) {
    out = out.replace(/\s+/g, ' ').trim();
  }
  return out.slice(0, opts.maxLength);
}

/**
 * Stable idempotency key for one memory. Two identical facts stated to the
 * same owner in the same conversation type collapse to the same hash.
 */
export function contentHash(input: {
  tenantId: TenantId;
  userId?: UserId | null;
  type: MemoryType;
  content: string;
  memoryKey?: string;
}): string {
  const key = input.memoryKey ?? input.type;
  const owner = input.userId?.toLowerCase() ?? 'global';
  const digest = createHash('sha256')
    .update(`${input.tenantId.toLowerCase()}|${owner}|${key}|${normalizeContent(input.content)}`)
    .digest('hex');
  return digest;
}

/** Memories whose normalized text is this similar are treated as one fact. */
export const NEAR_DUPLICATE_THRESHOLD = 0.965;

export function isNearDuplicate(left: MemoryRecord, right: MemoryRecord): boolean {
  return confidenceFromHash(left.contentHash, right.contentHash) >= NEAR_DUPLICATE_THRESHOLD;
}

/** Structural similarity 0..1 derived from the hashes (no embeddings needed). */
function confidenceFromHash(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  let score = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] === right[i]) {
      score += 1;
    }
  }
  return score / left.length;
}