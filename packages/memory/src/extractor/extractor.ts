import type { MemoryType } from '@hermes/core';
import type { TurnContext } from '../types.js';

export interface ExtractedMemory {
  content: string;
  type: MemoryType;
  confidence: number;
  importance: number;
  memoryKey?: string;
  evidence?: string;
  metadata: Record<string, unknown>;
}

export interface MemoryExtractor {
  /** Extract durable facts/tasks from one conversational turn. */
  extract(turn: TurnContext): Promise<ExtractedMemory[]>;
}

export type MemoryExtractorConstructor = new (...args: never[]) => MemoryExtractor;