import { getApps, initializeApp } from 'firebase-admin/app';
import { type DocumentReference, getFirestore } from 'firebase-admin/firestore';
import type { Db } from './db';

/**
 * The production database, adapted to the `Db` port the domain code uses.
 * Every DocRef the domain passes back came from `doc()` below, so the casts
 * only restore the type firebase-admin already gave it.
 */
export function adminDb(): Db {
  if (getApps().length === 0) initializeApp();
  const fs = getFirestore();
  const ref = (r: { path: string }) => r as DocumentReference;

  return {
    doc: (path) => fs.doc(path),
    runTransaction: (fn) =>
      fs.runTransaction((t) =>
        fn({
          get: (r) => t.get(ref(r)),
          getAll: (...rs) => t.getAll(...rs.map(ref)),
          create: (r, data) => t.create(ref(r), data),
          update: (r, data) => t.update(ref(r), data),
        }),
      ),
  };
}
