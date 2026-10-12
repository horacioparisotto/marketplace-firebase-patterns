import { beforeEach, describe, expect, it } from 'vitest';
import { checkIn } from '../src/checkIn';
import { DomainError } from '../src/db';
import { normalizeKey, redeemGiftKey } from '../src/giftKeys';
import { approveCreator } from '../src/plans';
import { readVote, recordVote, signVote, type Vote } from '../src/ratings';
import { InvalidTransition, nextSteps, transition } from '../src/stateMachine';
import { MemoryDb } from './memoryDb';

const NOW = new Date('2026-03-14T20:00:00Z');
const LATER = new Date('2026-12-31T00:00:00Z');

describe('state machine', () => {
  it('follows the main path', () => {
    expect(transition('requested', 'scheduled')).toBe('scheduled');
    expect(nextSteps('submitted')).toEqual(['completed', 'changes_requested']);
  });

  it('rejects skipped steps and unknown states', () => {
    expect(() => transition('requested', 'completed')).toThrow(InvalidTransition);
    expect(() => transition('completed', 'submitted')).toThrow(InvalidTransition);
    expect(() => transition('archived', 'scheduled')).toThrow(InvalidTransition);
  });
});

describe('QR check-in', () => {
  let db: MemoryDb;
  beforeEach(() => {
    db = new MemoryDb();
    db.set('checkinCodes/ABC123XY', { brandId: 'brand-1', applicationId: 'app-1' });
    db.set('applications/app-1', { brandId: 'brand-1', status: 'scheduled', creatorName: 'Sofi' });
  });

  it('checks the creator in once', async () => {
    expect(await checkIn(db, 'brand-1', 'abc123xy', NOW)).toEqual({ ok: true, creator: 'Sofi' });
    expect(db.read('applications/app-1')?.status).toBe('subscribed');
    expect(await checkIn(db, 'brand-1', 'ABC123XY', NOW)).toEqual({ ok: false, reason: 'already_checked_in' });
  });

  it("rejects another brand's code", async () => {
    expect(await checkIn(db, 'brand-2', 'ABC123XY', NOW)).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('lets only one of two simultaneous scans succeed', async () => {
    const results = await Promise.all([
      checkIn(db, 'brand-1', 'ABC123XY', NOW),
      checkIn(db, 'brand-1', 'ABC123XY', NOW),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results).toContainEqual({ ok: false, reason: 'already_checked_in' });
  });

  it('never builds a document path from raw input', async () => {
    expect(await checkIn(db, 'brand-1', '../brands/x', NOW)).toEqual({ ok: false, reason: 'invalid_code' });
  });
});

describe('plan limits', () => {
  let db: MemoryDb;
  beforeEach(() => {
    db = new MemoryDb();
    db.set('brands/brand-1', { access: { used: 1, allowed: 2, endsAt: LATER } });
    for (const id of ['app-1', 'app-2']) {
      db.set(`applications/${id}`, { brandId: 'brand-1', status: 'requested' });
    }
  });

  it('approves within the allowance and counts it', async () => {
    await approveCreator(db, 'brand-1', 'app-1', NOW);

    expect(db.read('brands/brand-1')).toMatchObject({ access: { used: 2 } });
    expect(db.read('applications/app-1')?.status).toBe('scheduled');
  });

  it('stops at the limit, even with two approvals at once', async () => {
    const results = await Promise.allSettled([
      approveCreator(db, 'brand-1', 'app-1', NOW),
      approveCreator(db, 'brand-1', 'app-2', NOW),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(db.read('brands/brand-1')).toMatchObject({ access: { used: 2 } });
  });

  it('refuses after the plan ends', async () => {
    db.set('brands/brand-1', { access: { used: 0, allowed: 5, endsAt: new Date('2026-01-01') } });

    await expect(approveCreator(db, 'brand-1', 'app-1', NOW)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it("refuses another brand's application", async () => {
    await expect(approveCreator(db, 'brand-2', 'app-1', NOW)).rejects.toBeInstanceOf(DomainError);
  });
});

describe('gift keys', () => {
  let db: MemoryDb;
  beforeEach(() => {
    db = new MemoryDb();
    db.set('giftKeys/PARTNER2026', { collaborations: 3 });
    db.set('brands/brand-1', { access: { used: 0, allowed: 1, endsAt: LATER } });
    db.set('brands/brand-2', { access: { used: 0, allowed: 0, endsAt: LATER } });
  });

  it('adds collaborations once', async () => {
    expect(await redeemGiftKey(db, 'brand-1', 'partner-2026', NOW)).toEqual({ added: 3 });
    expect(db.read('brands/brand-1')).toMatchObject({ access: { allowed: 4 } });
    await expect(redeemGiftKey(db, 'brand-1', 'PARTNER2026', NOW)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('can be redeemed by only one of two brands racing for it', async () => {
    const results = await Promise.allSettled([
      redeemGiftKey(db, 'brand-1', 'PARTNER2026', NOW),
      redeemGiftKey(db, 'brand-2', 'PARTNER2026', NOW),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('answers the same for unknown and used keys', async () => {
    const unknown = await redeemGiftKey(db, 'brand-1', 'NOSUCHKEY1', NOW).catch((e) => e.message);
    await redeemGiftKey(db, 'brand-1', 'PARTNER2026', NOW);
    const used = await redeemGiftKey(db, 'brand-2', 'PARTNER2026', NOW).catch((e) => e.message);

    expect(unknown).toBe(used);
  });

  it('normalizes what people type and rejects anything path-like', () => {
    expect(normalizeKey(' partner-2026 ')).toBe('PARTNER2026');
    expect(normalizeKey('../brands')).toBeNull();
  });
});

describe('one-tap ratings', () => {
  const secret = 'test-secret';
  let db: MemoryDb;
  beforeEach(() => {
    db = new MemoryDb();
    db.set('creators/c-1', { rating: 4, ratingCount: 2 });
  });

  it('updates the running average', async () => {
    await recordVote(db, { id: 'v-1', creatorId: 'c-1', value: 5 }, NOW);

    expect(db.read('creators/c-1')).toMatchObject({ ratingCount: 3, rating: 13 / 3 });
  });

  it('counts a second tap on the same link once', async () => {
    const vote: Vote = { id: 'v-1', creatorId: 'c-1', value: 1 };

    expect(await recordVote(db, vote, NOW)).toBe('recorded');
    expect(await recordVote(db, vote, NOW)).toBe('duplicate');
    expect(db.read('creators/c-1')?.ratingCount).toBe(3);
  });

  it('keeps every rating when two arrive at once', async () => {
    await Promise.all([
      recordVote(db, { id: 'v-1', creatorId: 'c-1', value: 5 }, NOW),
      recordVote(db, { id: 'v-2', creatorId: 'c-1', value: 3 }, NOW),
    ]);

    expect(db.read('creators/c-1')).toMatchObject({ ratingCount: 4, rating: 4 });
  });

  it('rejects tampered links', () => {
    const token = signVote({ id: 'v-1', creatorId: 'c-1', value: 1 }, secret);
    const forged = signVote({ id: 'v-1', creatorId: 'c-1', value: 5 }, 'wrong-secret');

    expect(readVote(token, secret)).toEqual({ id: 'v-1', creatorId: 'c-1', value: 1 });
    expect(readVote(forged, secret)).toBeNull();
    expect(readVote('garbage', secret)).toBeNull();
  });
});
