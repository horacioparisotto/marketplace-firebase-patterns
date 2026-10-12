// Callable Cloud Functions: the only way the app changes a collaboration,
// a plan or a gift key. The client can't write these documents directly
// (Firestore rules deny it), so the checks in the domain code can't be skipped.
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { checkIn } from './checkIn';
import { DomainError } from './db';
import { adminDb } from './firebase';
import { redeemGiftKey } from './giftKeys';
import { approveCreator } from './plans';
import { InvalidTransition } from './stateMachine';

/** The brand comes from the signed-in session's custom claims, never from the request. */
function brandOf(req: CallableRequest): string {
  const brandId = req.auth?.token.brandId;
  if (typeof brandId !== 'string') {
    throw new HttpsError('permission-denied', 'Brand staff only');
  }
  return brandId;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) throw new HttpsError(err.code, err.message);
    if (err instanceof InvalidTransition) throw new HttpsError('failed-precondition', err.message);
    throw err;
  }
}

export const checkInCreator = onCall((req) =>
  run(() => checkIn(adminDb(), brandOf(req), String(req.data?.code ?? ''), new Date())),
);

export const approve = onCall((req) =>
  run(() => approveCreator(adminDb(), brandOf(req), String(req.data?.applicationId ?? ''), new Date())),
);

export const redeemKey = onCall((req) =>
  run(() => redeemGiftKey(adminDb(), brandOf(req), String(req.data?.key ?? ''), new Date())),
);
