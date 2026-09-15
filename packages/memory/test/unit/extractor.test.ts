import { describe, expect, it } from 'vitest';
import { RuleBasedExtractor } from '../../src/extractor/rule-extractor.js';
import type { TurnContext } from '../../src/types.js';
import type { TenantId } from '@hermes/core';

const tenantId = 't1' as TenantId;

function turn(userText: string): TurnContext {
  return { tenantId, userText };
}

describe('RuleBasedExtractor', () => {
  const extractor = new RuleBasedExtractor();

  it('extracts a name from "my name is …"', async () => {
    const facts = await extractor.extract(turn('Hi there, my name is Ada Lovelace.'));
    expect(facts.some((f) => f.content.includes('Ada Lovelace'))).toBe(true);
    expect(facts.every((f) => f.type === 'semantic')).toBe(true);
  });

  it('extracts a name from "i\'m …"', async () => {
    const facts = await extractor.extract(turn('Thanks! I’m Sam.'));
    const names = facts.filter((f) => f.memoryKey === 'semantic:identity:name');
    expect(names.length).toBeGreaterThan(0);
    expect(names[0]?.content).toMatch(/Sam/);
  });

  it('extracts preferences with comparison', async () => {
    const facts = await extractor.extract(turn('For editors I prefer VS Code over Fleet.'));
    expect(facts.some((f) => f.content.includes('VS Code over Fleet'))).toBe(true);
  });

  it('extracts skills', async () => {
    const facts = await extractor.extract(turn('I write TypeScript and Rust for backend services.'));
    expect(facts.some((f) => f.content.toLowerCase().includes('typescript'))).toBe(true);
  });

  it('extracts projects', async () => {
    const facts = await extractor.extract(turn('My project is called Hermes Agent.'));
    expect(facts.some((f) => f.content.includes('Hermes Agent'))).toBe(true);
  });

  it('extracts active tasks as episodic memories', async () => {
    const facts = await extractor.extract(turn("I'm currently working on the reconciliation service."));
    expect(facts.some((f) => f.type === 'episodic' && f.content.includes('reconciliation service'))).toBe(true);
  });

  it('returns nothing for ordinary conversation', async () => {
    const facts = await extractor.extract(turn('That sounds great, thanks for the help!'));
    expect(facts).toHaveLength(0);
  });

  it('ignores empty turns', async () => {
    expect(await extractor.extract(turn('   '))).toHaveLength(0);
  });
});