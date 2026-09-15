import { describe, expect, it } from 'vitest';
import { scoreMemory, recencyHours } from '../../src/scoring.js';

describe('scoreMemory', () => {
  const base = { importance: 0.5, confidence: 0.8, explicit: true, relevance: 0, recencyHours: 0, accessCount: 0 };

  it('scores explicit memories higher than equally relevant implicit ones', () => {
    const explicit = scoreMemory({ ...base, explicit: true });
    const implicit = scoreMemory({ ...base, explicit: false, recencyHours: 24 * 30 });
    expect(explicit).toBeGreaterThan(implicit);
  });

  it('penalizes old implicit memories (recency decay) but not explicit facts', () => {
    const fresh = scoreMemory({ ...base, explicit: false, recencyHours: 1 });
    const stale = scoreMemory({ ...base, explicit: false, recencyHours: 24 * 90 });
    expect(stale).toBeLessThan(fresh);

    const explicitFresh = scoreMemory({ ...base, explicit: true, recencyHours: 1 });
    const explicitStale = scoreMemory({ ...base, explicit: true, recencyHours: 24 * 365 });
    expect(explicitStale).toBeCloseTo(explicitFresh, 5);
  });

  it('rewards semantic relevance', () => {
    const relevant = scoreMemory({ ...base, relevance: 0.9 });
    const irrelevant = scoreMemory({ ...base, relevance: 0.1 });
    expect(relevant).toBeGreaterThan(irrelevant);
  });

  it('recognizes frequently-accessed memories (strong consolidation signal)', () => {
    const frequent = scoreMemory({ ...base, accessCount: 5 });
    const lonely = scoreMemory({ ...base, accessCount: 0 });
    expect(frequent).toBeGreaterThan(lonely);
  });

  it('never returns NaN for extreme inputs', () => {
    const value = scoreMemory({ ...base, recencyHours: 1e9, importance: 1, relevance: 1, confidence: 1 });
    expect(Number.isFinite(value)).toBe(true);
  });
});

describe('recencyHours', () => {
  it('measures hours between dates', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-02T12:00:00Z');
    expect(recencyHours(start, end)).toBe(36);
  });

  it('clamps to zero for future timestamps', () => {
    expect(recencyHours(new Date('2025-01-02T00:00:00Z'), new Date('2025-01-01T00:00:00Z'))).toBe(0);
  });
});