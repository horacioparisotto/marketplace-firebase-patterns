import { DomainError, toMillis, type Db } from './db';
import { transition } from './stateMachine';

/**
 * Brands pay for plans that set how many creators they can work with and for
 * how long; gift keys (giftKeys.ts) unlock collaborations without a payment.
 * Both add to the same allowance, so this single server-side check enforces
 * both. A limit enforced on the phone is a limit anyone can skip.
 */
export function approveCreator(db: Db, brandId: string, applicationId: string, now: Date): Promise<void> {
  const brandRef = db.doc(`brands/${brandId}`);
  const appRef = db.doc(`applications/${applicationId}`);

  return db.runTransaction(async (tx) => {
    const [brand, app] = await tx.getAll(brandRef, appRef);
    if (!brand?.exists || !app?.exists) {
      throw new DomainError('not-found', 'Unknown brand or application');
    }
    if (app.get('brandId') !== brandId) {
      throw new DomainError('permission-denied', 'Not your offer');
    }

    const used: number = brand.get('access.used') ?? 0;
    const allowed: number = brand.get('access.allowed') ?? 0;
    const endsAt = brand.get('access.endsAt');
    if (!endsAt || toMillis(endsAt) < now.getTime()) {
      throw new DomainError('failed-precondition', 'Plan expired');
    }
    if (used >= allowed) {
      throw new DomainError('resource-exhausted', 'Plan limit reached');
    }

    tx.update(brandRef, { 'access.used': used + 1 });
    tx.update(appRef, { status: transition(app.get('status'), 'scheduled') });
  });
}
