import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

export interface Vote {
  id: string; // one per emailed link
  creatorId: string;
  value: 1 | 2 | 3 | 4 | 5;
}

/**
 * Stores a rating and updates the creator's running average and count.
 *
 * The transaction keeps two ratings arriving at the same moment from
 * overwriting each other, and checking the vote id inside it means a second
 * tap on the same link changes nothing. The average is stored unrounded and
 * rounded only on display, so it never drifts.
 */
export function recordVote(db: Db, vote: Vote, now: Date): Promise<'recorded' | 'duplicate'> {
  const voteRef = db.doc(`ratings/${vote.id}`);
  const creatorRef = db.doc(`creators/${vote.creatorId}`);

  return db.runTransaction(async (tx) => {
    const [already, creator] = await tx.getAll(voteRef, creatorRef);
    if (already?.exists) return 'duplicate';

    const count: number = (creator?.get('ratingCount') ?? 0) + 1;
    const prev: number = creator?.get('rating') ?? 0;
    const avg = (prev * (count - 1) + vote.value) / count;

    tx.create(voteRef, { ...vote, at: now });
    tx.update(creatorRef, { rating: avg, ratingCount: count });
    return 'recorded';
  });
}

// The emailed link carries a signed token, so a vote can't be forged by
// editing the URL.

export function signVote(vote: Vote, secret: string): string {
  const payload = Buffer.from(JSON.stringify(vote)).toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

export function readVote(token: string, secret: string): Vote | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const vote = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Vote;
    return [1, 2, 3, 4, 5].includes(vote.value) && vote.id && vote.creatorId ? vote : null;
  } catch {
    return null;
  }
}

function mac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
