import type { MemoryExtractor, ExtractedMemory } from './extractor.js';
import type { TurnContext } from '../types.js';

interface Pattern {
  type: 'semantic' | 'procedural' | 'episodic';
  weight: number;
  label: string;
  memoryKey?: string;
  re: RegExp;
  /** Turn the match result into memory content + a summary used for the memory text. */
  facts: (match: RegExpMatchArray) => string[];
}

const USER_PATTERNS: Pattern[] = [
  {
    type: 'semantic',
    weight: 0.9,
    label: 'identity',
    memoryKey: 'semantic:identity:name',
    re: /\bmy name is\s+([A-Z][a-z]+(?:\s+(?!and\b|but\b|because\b|i\b|am\b|is\b|my\b|at\b|in\b|the\b|a\b)[A-Z][a-z]+)?)/i,
    facts: (m) => [`The user's name is ${m[1]}.`],
  },
  {
    type: 'semantic',
    weight: 0.8,
    label: 'identity',
    memoryKey: 'semantic:identity:name',
    re: /\bi(?:["'\u2019]m| am)\s+(?!(?:currently|just|now|really|very|trying|hoping|planning|working|building|going|about|not|always|usually|typically|here|afraid)\b)([A-Z][a-z]+(?:\s+(?!and\b|but\b|because\b|i\b|am\b|is\b|my\b|at\b|in\b|the\b|a\b)[A-Z][a-z]+)?)\b/i,
    facts: (m) => [`The user's name is ${m[1]}.`],
  },
  {
    type: 'semantic',
    weight: 0.7,
    label: 'preference',
    re: /\bi (?:prefer|like|love|enjoy)\s+([^.,!?]+?)(?:\s+over\s+([^.,!?]+))?[.,!?]?$/i,
    facts: (m) => {
      const thing = m[1]?.trim();
      const over = m[2]?.trim();
      if (!thing) {
        return [];
      }
      return [over ? `The user prefers ${thing} over ${over}.` : `The user likes ${thing}.`];
    },
  },
  {
    type: 'semantic',
    weight: 0.6,
    label: 'skill',
    re: /\bi (?:use|write|code|work with)\s+(?:in|with)?\s*([^.,!?]+)/i,
    facts: (m) => [`The user works with ${m[1]?.trim()}.`],
  },
  {
    type: 'semantic',
    weight: 0.8,
    label: 'project',
    memoryKey: 'semantic:project',
    re: /\bmy (?:project|startup|company|app|site|website) is\s+([^.,!?]+)/i,
    facts: (m) => [`The user's project is ${m[1]?.trim()}.`],
  },
  {
    type: 'semantic',
    weight: 0.55,
    label: 'language',
    re: /\bi speak\s+([^.,!?]+)/i,
    facts: (m) => [`The user speaks ${m[1]?.trim()}.`],
  },
  {
    type: 'procedural',
    weight: 0.6,
    label: 'procedure',
    re: /\bi (?:always|usually|typically)\s+([^.,!?]+)/i,
    facts: (m) => [`The user usually ${m[1]?.trim()}.`],
  },
];

const TASK_PATTERNS: Pattern[] = [
  {
    type: 'episodic',
    weight: 0.75,
    label: 'task',
    re: /\bi (?:need|want|would like)\s+to\s+([^.,!?]+)/i,
    facts: (m) => [`The user needs to ${m[1]?.trim()}.`],
  },
  {
    type: 'episodic',
    weight: 0.7,
    label: 'active-task',
    re: /\bi(?:'?m| am) currently (?:working on|building|fixing|debugging|writing)\s+([^.,!?]+)/i,
    facts: (m) => [`The user is working on ${m[1]?.trim()}.`],
  },
  {
    type: 'semantic',
    weight: 0.55,
    label: 'fact',
    re: /\bmy (?:favorite|best|top)\s+([^.]+?)\s+is\s+([^.,!?]+)/i,
    facts: (m) => [`The user's favorite ${m[1]?.trim()} is ${m[2]?.trim()}.`],
  },
  {
    type: 'episodic',
    weight: 0.55,
    label: 'achievement',
    re: /\bi (?:just|finally|managed to) (?:finished|completed|shipped|deployed|launched)\s+([^.,!?]+)/i,
    facts: (m) => [`The user ${m[1] ? 'recently finished ' + m[1].trim() : 'recently completed a task'}.`],
  },
];

/**
 * Deterministic, no-LLM extractor. Evaluates the user's text with a small set
 * of hand-written patterns covering identity, preferences, skills, projects,
 * tasks, and favorite facts. Returns zero extractions for ordinary utterances
 * so the conversation memory stays the only record of those.
 */
export class RuleBasedExtractor implements MemoryExtractor {
  async extract(turn: TurnContext): Promise<ExtractedMemory[]> {
    const text = (turn.userText ?? '').trim();
    if (!text) {
      return [];
    }

    const patterns = [...USER_PATTERNS, ...TASK_PATTERNS];
    const seenLabels = new Set<string>();
    const results: ExtractedMemory[] = [];

    for (const pattern of patterns) {
      const match = pattern.re.exec(text);
      if (!match) {
        continue;
      }
      if (seenLabels.has(pattern.label) && pattern.type !== 'semantic') {
        continue;
      }
      seenLabels.add(pattern.label);

      const facts = pattern.facts(match as RegExpMatchArray);
      for (const fact of facts) {
        results.push({
          content: fact,
          type: pattern.type,
          confidence: pattern.weight,
          importance: pattern.weight,
          memoryKey: pattern.memoryKey,
          evidence: text,
          metadata: {
            pattern: pattern.label,
            extractedBy: 'rule-based',
            explicit: true,
          },
        });
      }
    }
    return results;
  }
}