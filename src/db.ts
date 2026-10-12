// The slice of Firestore the domain code needs. firebase-admin's Firestore
// satisfies it as-is (see firebase.ts, checked by the compiler), and the tests
// use an in-memory implementation with the same transaction semantics.

export type Data = Record<string, unknown>;

export interface DocRef {
  readonly path: string;
}

export interface Snapshot {
  readonly exists: boolean;
  get(field: string): any;
}

export interface Tx {
  get(ref: DocRef): Promise<Snapshot>;
  getAll(...refs: DocRef[]): Promise<Snapshot[]>;
  create(ref: DocRef, data: Data): unknown;
  update(ref: DocRef, data: Data): unknown;
}

export interface Db {
  doc(path: string): DocRef;
  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Thrown by domain code; the callable layer maps `code` to an HTTPS error. */
export class DomainError extends Error {
  constructor(
    readonly code: 'not-found' | 'permission-denied' | 'failed-precondition' | 'resource-exhausted',
    message: string,
  ) {
    super(message);
  }
}

/** Firestore Timestamps, Dates and epoch millis all compare the same way. */
export function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis();
  }
  throw new TypeError('not a timestamp');
}
