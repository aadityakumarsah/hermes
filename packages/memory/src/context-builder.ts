import type { MemoryType } from '@hermes/core';
import type { ContextBucket, ContextBundle, MemoryWithScore } from './types.js';

export interface ContextBuildOptions {
  /** Rough token budget for the whole context snippet. */
  targetTokens?: number;
  maxItemsPerBucket?: number;
  contentMaxCharacters?: number;
  includeEmptyBuckets?: boolean;
}

const CHARS_PER_TOKEN = 4;

const BUCKET_LABELS: Record<MemoryType, string> = {
  working: 'CURRENT TASK / WORKING MEMORY',
  episodic: 'PAST EVENTS',
  semantic: 'FACTS ABOUT THE USER',
  procedural: 'LEARNED PROCEDURES',
  conversation: 'LAST CONVERSATION EXCERPT',
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Assembles the five memory buckets into a single, token-bounded prompt
 * snippet. Keeps the highest-scored memories per bucket and stops once the
 * budget is exhausted rather than dumping the whole store into the prompt.
 */
export function buildContext(
  buckets: ContextBucket[],
  options: ContextBuildOptions = {},
): ContextBundle {
  const targetTokens = options.targetTokens ?? 1200;
  const maxItems = options.maxItemsPerBucket ?? 8;
  const maxChars = options.contentMaxCharacters ?? 240;
  const includeEmpty = options.includeEmptyBuckets ?? false;

  const used: ContextBucket[] = [];
  let totalTokens = 0;

  for (const bucket of buckets) {
    if (totalTokens >= targetTokens) {
      break;
    }
    const items: MemoryWithScore[] = [];
    for (const entry of bucket.memories.slice(0, maxItems)) {
      const content =
        entry.memory.content.length > maxChars
          ? `${entry.memory.content.slice(0, maxChars)}…`
          : entry.memory.content;
      const line = `- ${content}`;
      const lineTokens = estimateTokens(line) + 1;
      if (totalTokens + lineTokens > targetTokens) {
        break;
      }
      items.push({ ...entry, memory: { ...entry.memory, content } });
      totalTokens += lineTokens;
    }
    if (items.length > 0 || includeEmpty) {
      used.push({ type: bucket.type, memories: items });
    }
  }

  return {
    buckets: used,
    totalTokens,
    toPromptText() {
      const sections: string[] = [];
      for (const bucket of used) {
        if (bucket.memories.length === 0) {
          continue;
        }
        const label = BUCKET_LABELS[bucket.type] ?? bucket.type.toUpperCase();
        const lines = bucket.memories.map((entry) => `- ${entry.memory.content}`).join('\n');
        sections.push(`## ${label}\n${lines}`);
      }
      return sections.join('\n\n');
    },
  };
}