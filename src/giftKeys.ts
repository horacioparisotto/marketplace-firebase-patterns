import { DomainError, type Db } from './db';

/**
 * For partnerships and promotions, the team creates gift keys in the admin
 * panel. A key unlocks a set number of collaborations without a payment.
 *
 * Marking the key and adding the allowance happen in one transaction, so a key
 * can never be redeemed twice, or leave a brand with a used key and nothing to
 * show for it. Invalid and used keys get the same answer, so the endpoint
 * can't be used to probe which keys exist.
 */
export function redeemGiftKey(db: Db, brandId: string, rawKey: string, now: Date): Promise<{ added: number }> {
  const key = normalizeKey(rawKey);
  if (!key) return Promise.reject(new DomainError('not-found', 'Invalid or used key'));

  const keyRef = db.doc(`giftKeys/${key}`);
  const brandRef = db.doc(`brands/${brandId}`);

  return db.runTransaction(async (tx) => {
    const [gift, brand] = await tx.getAll(keyRef, brandRef);
    if (!gift?.exists || gift.get('redeemedBy')) {
      throw new DomainError('not-found', 'Invalid or used key');
    }
    if (!brand?.exists) {
      throw new DomainError('not-found', 'Unknown brand');
    }

    const added: number = gift.get('collaborations');
    tx.update(keyRef, { redeemedBy: brandId, redeemedAt: now });
    tx.update(brandRef, { 'access.allowed': (brand.get('access.allowed') ?? 0) + added });
    return { added };
  });
}

/** Keys are typed by people: ignore case, spaces and dashes. Never a path. */
export function normalizeKey(raw: string): string | null {
  const key = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{8,32}$/.test(key) ? key : null;
}
