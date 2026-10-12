import type { Db } from './db';
import { transition } from './stateMachine';

export type CheckInResult =
  | { ok: true; creator: string }
  | { ok: false; reason: 'invalid_code' | 'already_checked_in' };

/**
 * An accepted creator shows a QR code at the door and the brand's staff scan
 * it. A code only works for its own brand and only once: the check and the
 * update run in one transaction, so two phones scanning the same code at the
 * same moment can't both succeed.
 *
 * `brandId` comes from the signed-in session (see functions.ts), never from
 * the request.
 */
export function checkIn(db: Db, brandId: string, rawCode: string, now: Date): Promise<CheckInResult> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,32}$/.test(code)) {
    return Promise.resolve({ ok: false, reason: 'invalid_code' });
  }

  return db.runTransaction(async (tx) => {
    const entry = await tx.get(db.doc(`checkinCodes/${code}`));
    if (!entry.exists || entry.get('brandId') !== brandId) {
      return { ok: false, reason: 'invalid_code' };
    }

    const appRef = db.doc(`applications/${entry.get('applicationId')}`);
    const app = await tx.get(appRef);
    if (app.get('status') !== 'scheduled') {
      return { ok: false, reason: 'already_checked_in' };
    }

    tx.update(appRef, {
      status: transition(app.get('status'), 'subscribed'),
      checkedInAt: now,
    });
    return { ok: true, creator: app.get('creatorName') };
  });
}
