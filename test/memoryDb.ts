import type { Data, Db, DocRef, Snapshot, Tx } from '../src/db';

/**
 * In-memory Db with Firestore's transaction semantics where they matter here:
 * optimistic concurrency (a transaction whose reads were changed by another
 * commit is retried), create() failing on an existing document, and dotted
 * field paths in get() and update().
 */
export class MemoryDb implements Db {
  private docs = new Map<string, { data: Data; version: number }>();
  commits = 0;

  doc(path: string): DocRef {
    return { path };
  }

  set(path: string, data: Data) {
    this.docs.set(path, { data: structuredClone(data), version: (this.docs.get(path)?.version ?? 0) + 1 });
  }

  read(path: string): Data | undefined {
    return this.docs.get(path)?.data;
  }

  async runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const seen = new Map<string, number>();
      const writes: Array<() => void> = [];
      const snap = (path: string): Snapshot => {
        const entry = this.docs.get(path);
        seen.set(path, entry?.version ?? 0);
        const data = entry ? structuredClone(entry.data) : undefined;
        return { exists: !!entry, get: (field) => (data ? getPath(data, field) : undefined) };
      };
      const tx: Tx = {
        // Snapshots are taken when the read starts and delivered later, like a
        // network round trip: concurrent transactions see the same old state.
        get: async (ref) => {
          const s = snap(ref.path);
          await tick();
          return s;
        },
        getAll: async (...refs) => {
          const s = refs.map((r) => snap(r.path));
          await tick();
          return s;
        },
        create: (ref, data) => {
          writes.push(() => {
            if (this.docs.has(ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`);
            this.set(ref.path, data);
          });
        },
        update: (ref, data) => {
          writes.push(() => {
            const current = this.docs.get(ref.path);
            if (!current) throw new Error(`NOT_FOUND: ${ref.path}`);
            const next = structuredClone(current.data);
            for (const [field, value] of Object.entries(data)) setPath(next, field, value);
            this.set(ref.path, next);
          });
        },
      };

      const result = await fn(tx);
      // Commit atomically, or retry if anything we read changed meanwhile.
      const conflict = [...seen].some(([path, v]) => (this.docs.get(path)?.version ?? 0) !== v);
      if (conflict) continue;
      writes.forEach((w) => w());
      this.commits++;
      return result;
    }
    throw new Error('ABORTED: too much contention');
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function getPath(data: Data, field: string): unknown {
  return field.split('.').reduce<any>((v, k) => (v == null ? undefined : v[k]), data);
}

function setPath(data: Data, field: string, value: unknown) {
  const keys = field.split('.');
  let target: any = data;
  for (const k of keys.slice(0, -1)) target = target[k] ??= {};
  target[keys.at(-1)!] = value;
}
