import { describe, expect, it } from 'vitest';
import { contentHash, isNearDuplicate, normalizeContent } from '../../src/dedup.js';
import { type MemoryRecord } from '../../src/types.js';
import type { MemoryType, TenantId } from '@hermes/core';

const TENANT = 't1' as TenantId;

const record = (contentHashValue: string) =>
  ({
    id: 'm',
    tenantId: TENANT,
    userId: 'u',
    type: 'semantic' as MemoryType,
    content: 'x',
    contentHash: contentHashValue,
    status: 'active',
  }) as MemoryRecord;

describe('normalizeContent', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeContent('  I LOVE  TypeScript!!  ')).toBe('i love typescript');
  });

  it('keeps characters that matter for code-like content', () => {
    expect(normalizeContent('uses pnpm@9.1.0')).toBe('uses pnpm@9.1.0');
  });
});

describe('contentHash', () => {
  it('is stable across calls for the same fact', () => {
    const a = contentHash({ tenantId: TENANT, userId: 'u1', type: 'semantic', content: 'The user likes tea.' });
    const b = contentHash({ tenantId: TENANT, userId: 'u1', type: 'semantic', content: 'The user likes tea.' });
    expect(a).toBe(b);
  });

  it('differs when the owner or memory type changes', () => {
    const base = contentHash({ tenantId: TENANT, userId: 'u1', type: 'semantic', content: 'The user likes tea.' });
    const otherUser = contentHash({ tenantId: TENANT, userId: 'u2', type: 'semantic', content: 'The user likes tea.' });
    const otherType = contentHash({ tenantId: TENANT, userId: 'u1', type: 'procedural', content: 'The user likes tea.' });
    expect(otherUser).not.toBe(base);
    expect(otherType).not.toBe(base);
  });
});

describe('isNearDuplicate', () => {
  it('flags identical hashes', () => {
    const hash = contentHash({ tenantId: TENANT, userId: 'u1', type: 'semantic', content: 'A fact.' });
    expect(isNearDuplicate(record(hash), record(hash))).toBe(true);
  });

  it('flags near-identical hashes as duplicates', () => {
    const a = contentHash({ tenantId: TENANT, userId: 'u1', type: 'semantic', content: 'The user prefers tea over coffee.' });
    const b = contentHash({ tenantId: TENANT, userId: 'u1', type: 'semantic', content: 'The user prefers tea over coffee.' });
    expect(isNearDuplicate(record(a), record(b))).toBe(true);
  });

  it('does not flag unrelated facts', () => {
    const a = contentHash({ tenantId: TENANT, userId: 'u1', type: 'semantic', content: 'The user prefers tea over coffee.' });
    const b = contentHash({ tenantId: TENANT, userId: 'u1', type: 'semantic', content: 'The user project is a rocket.' });
    expect(isNearDuplicate(record(a), record(b))).toBe(false);
  });
});