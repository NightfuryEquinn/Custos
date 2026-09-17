import { ObjectId, type Db } from "mongodb";
import { COLLECTIONS, setDbForTests } from "@/db";
import { resetRateLimitsForTests } from "@/api/middleware/rate-limit";
import { afterAll, beforeAll, beforeEach } from "bun:test";

type Doc = Record<string, unknown> & { _id: ObjectId };

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (key === "$or") {
      const clauses = value as Record<string, unknown>[];
      if (!clauses.some((clause) => matches(doc, clause))) return false;
      continue;
    }
    if (key === "$and") {
      const clauses = value as Record<string, unknown>[];
      if (!clauses.every((clause) => matches(doc, clause))) return false;
      continue;
    }
    if (key === "_id") {
      if (
        value &&
        typeof value === "object" &&
        !(value instanceof ObjectId) &&
        !(value instanceof Date) &&
        !Array.isArray(value)
      ) {
        const ops = value as Record<string, unknown>;
        if ("$ne" in ops) {
          const right = ops.$ne;
          if (right instanceof ObjectId && doc._id instanceof ObjectId && doc._id.equals(right))
            return false;
          if (typeof right === "string" && String(doc._id) === right) return false;
          continue;
        }
        const docId = doc._id instanceof ObjectId ? doc._id : null;
        if (docId) {
          if ("$lt" in ops && ops.$lt instanceof ObjectId) {
            if (docId.toHexString() >= ops.$lt.toHexString()) return false;
            continue;
          }
          if ("$lte" in ops && ops.$lte instanceof ObjectId) {
            if (docId.toHexString() > ops.$lte.toHexString()) return false;
            continue;
          }
          if ("$gt" in ops && ops.$gt instanceof ObjectId) {
            if (docId.toHexString() <= ops.$gt.toHexString()) return false;
            continue;
          }
          if ("$gte" in ops && ops.$gte instanceof ObjectId) {
            if (docId.toHexString() < ops.$gte.toHexString()) return false;
            continue;
          }
          if ("$nin" in ops) {
            const list = ops.$nin as ObjectId[];
            if (list.some((candidate) => docId.equals(candidate))) return false;
            continue;
          }
        }
      }
      const id = value instanceof ObjectId ? value.toHexString() : String(value);
      const docId = doc._id instanceof ObjectId ? doc._id.toHexString() : String(doc._id);
      if (docId !== id) return false;
      continue;
    }
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof ObjectId)
    ) {
      const ops = value as Record<string, unknown>;
      if ("$exists" in ops) {
        const exists = doc[key] !== undefined;
        if (Boolean(ops.$exists) !== exists) return false;
        continue;
      }
      if ("$gt" in ops) {
        const left = doc[key];
        const right = ops.$gt;
        if (left instanceof ObjectId && right instanceof ObjectId) {
          if (left.toHexString() <= right.toHexString()) return false;
          continue;
        }
        if (!(left instanceof Date && right instanceof Date && left.getTime() > right.getTime())) {
          if (!(typeof left === "number" && typeof right === "number" && left > right)) {
            if (!(typeof left === "string" && typeof right === "string" && left > right))
              return false;
          }
        }
        continue;
      }
      if ("$gte" in ops) {
        const left = doc[key];
        const right = ops.$gte;
        if (left instanceof ObjectId && right instanceof ObjectId) {
          if (left.toHexString() < right.toHexString()) return false;
          continue;
        }
        if (!(left instanceof Date && right instanceof Date && left.getTime() >= right.getTime())) {
          if (!(typeof left === "number" && typeof right === "number" && left >= right)) {
            if (!(typeof left === "string" && typeof right === "string" && left >= right))
              return false;
          }
        }
        continue;
      }
      if ("$lt" in ops) {
        const left = doc[key];
        const right = ops.$lt;
        if (left instanceof ObjectId && right instanceof ObjectId) {
          if (left.toHexString() >= right.toHexString()) return false;
          continue;
        }
        if (!(left instanceof Date && right instanceof Date && left.getTime() < right.getTime())) {
          if (!(typeof left === "number" && typeof right === "number" && left < right)) {
            if (!(typeof left === "string" && typeof right === "string" && left < right))
              return false;
          }
        }
        continue;
      }
      if ("$lte" in ops) {
        const left = doc[key];
        const right = ops.$lte;
        if (left instanceof ObjectId && right instanceof ObjectId) {
          if (left.toHexString() > right.toHexString()) return false;
          continue;
        }
        if (!(left instanceof Date && right instanceof Date && left.getTime() <= right.getTime())) {
          if (!(typeof left === "number" && typeof right === "number" && left <= right)) {
            if (!(typeof left === "string" && typeof right === "string" && left <= right))
              return false;
          }
        }
        continue;
      }
      if ("$ne" in ops) {
        const right = ops.$ne;
        if (right instanceof ObjectId) {
          if (doc[key] instanceof ObjectId && (doc[key] as ObjectId).equals(right)) return false;
        } else if (doc[key] === right) {
          return false;
        }
        continue;
      }
      if ("$in" in ops) {
        const list = ops.$in as unknown[];
        if (!list.some((candidate) => valueEquals(doc[key], candidate))) return false;
        continue;
      }
      if ("$nin" in ops) {
        const list = ops.$nin as unknown[];
        if (list.some((candidate) => valueEquals(doc[key], candidate))) return false;
        continue;
      }
    }
    if (value instanceof ObjectId) {
      if (!(doc[key] instanceof ObjectId) || !(doc[key] as ObjectId).equals(value)) return false;
      continue;
    }
    if (doc[key] !== value) return false;
  }
  return true;
}

/** Mongo-style equality: ObjectIds compare by value, everything else by identity. */
function valueEquals(left: unknown, right: unknown): boolean {
  if (right instanceof ObjectId) {
    return left instanceof ObjectId && left.equals(right);
  }
  return left === right;
}

function applyUpdate(doc: Doc, update: Record<string, unknown>): void {
  if (update.$set && typeof update.$set === "object") {
    Object.assign(doc, update.$set);
  }
  if (update.$inc && typeof update.$inc === "object") {
    for (const [k, v] of Object.entries(update.$inc as Record<string, number>)) {
      const current = typeof doc[k] === "number" ? (doc[k] as number) : 0;
      doc[k] = current + v;
    }
  }
  if (update.$addToSet && typeof update.$addToSet === "object") {
    for (const [k, v] of Object.entries(update.$addToSet as Record<string, unknown>)) {
      const current = Array.isArray(doc[k]) ? (doc[k] as unknown[]) : [];
      const incoming =
        v && typeof v === "object" && "$each" in (v as Record<string, unknown>)
          ? ((v as { $each: unknown[] }).$each ?? [])
          : [v];
      doc[k] = [...current, ...incoming.filter((item) => !current.includes(item))];
    }
  }
  if (update.$unset && typeof update.$unset === "object") {
    for (const k of Object.keys(update.$unset as Record<string, unknown>)) {
      delete doc[k];
    }
  }
  if (update.$setOnInsert && typeof update.$setOnInsert === "object") {
    /* only applied on insert by the upsert paths */
  }
  for (const [k, v] of Object.entries(update)) {
    if (!k.startsWith("$")) doc[k] = v;
  }
}

/** Build the document Mongo would create for an upsert that matched nothing. */
function upsertedDoc(filter: Record<string, unknown>, update: Record<string, unknown>): Doc {
  const _id = (filter._id as ObjectId | string | undefined) ?? new ObjectId();
  const doc = { _id } as Doc;
  if (update.$setOnInsert && typeof update.$setOnInsert === "object") {
    Object.assign(doc, update.$setOnInsert);
  }
  applyUpdate(doc, update);
  /* Merge equality filter fields onto inserted doc (Mongo upsert behavior). */
  for (const [k, v] of Object.entries(filter)) {
    if (!k.startsWith("$") && doc[k] === undefined) doc[k] = v as never;
  }

  return doc;
}

function createCollection() {
  const docs: Doc[] = [];

  return {
    async insertMany(incoming: Record<string, unknown>[]) {
      const insertedIds: ObjectId[] = [];
      for (const doc of incoming) {
        const _id = (doc._id as ObjectId) ?? new ObjectId();
        docs.push({ ...doc, _id } as Doc);
        insertedIds.push(_id);
      }
      return { insertedIds, insertedCount: insertedIds.length, acknowledged: true };
    },
    async insertOne(doc: Record<string, unknown>) {
      const _id = (doc._id as ObjectId) ?? new ObjectId();
      if (docs.some((d) => d._id instanceof ObjectId && d._id.equals(_id))) {
        /* Mirrors Mongo's real duplicate-key error shape closely enough for
           insert-idempotent.ts's `err.code === 11000` check. */
        const err = new Error(`E11000 duplicate key error: _id ${_id.toHexString()}`);
        (err as Error & { code: number }).code = 11000;
        throw err;
      }
      const stored = { ...doc, _id } as Doc;
      docs.push(stored);
      return { insertedId: _id, acknowledged: true };
    },
    async findOne(filter: Record<string, unknown>, _options?: Record<string, unknown>) {
      /* A snapshot, not the live stored object — the real Mongo driver hands
         back a freshly-deserialized document per call, so a later
         findOneAndUpdate/updateOne/updateMany on the same row must never be
         able to retroactively mutate a document a caller already holds
         (e.g. a route's own pre-update `existing` read, used to detect a
         field's before/after transition). */
      const doc = docs.find((d) => matches(d, filter));
      return doc ? { ...doc } : null;
    },
    async findOneAndUpdate(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: { upsert?: boolean; returnDocument?: "before" | "after" },
    ) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc && options?.upsert) {
        const created = upsertedDoc(filter, update);
        docs.push(created);
        return options?.returnDocument === "before" ? null : { ...created };
      }
      if (!doc) return null;
      const before = { ...doc };
      applyUpdate(doc, update);
      return options?.returnDocument === "before" ? before : { ...doc };
    },
    async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: { upsert?: boolean },
    ) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) {
        if (!options?.upsert) return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
        const created = upsertedDoc(filter, update);
        docs.push(created);
        return {
          matchedCount: 0,
          modifiedCount: 0,
          upsertedId: created._id,
          acknowledged: true,
        };
      }
      applyUpdate(doc, update);
      return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
    },
    async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>) {
      let matched = 0;
      for (const doc of docs) {
        if (!matches(doc, filter)) continue;
        applyUpdate(doc, update);
        matched++;
      }
      return { matchedCount: matched, modifiedCount: matched, acknowledged: true };
    },
    find(filter: Record<string, unknown> = {}) {
      const matched = docs.filter((d) => matches(d, filter));
      const state = {
        docs: matched,
        sortKeys: [] as Array<{ key: string; dir: 1 | -1 }>,
        limitN: null as number | null,
      };
      const api = {
        sort(spec: Record<string, 1 | -1>) {
          const entries = Object.entries(spec);
          state.sortKeys = entries.map(([key, dir]) => ({ key, dir: dir ?? 1 }));
          return api;
        },
        limit(n: number) {
          state.limitN = n;
          return api;
        },
        async toArray() {
          /* Clones, for the same reason findOne clones — see its comment. */
          const out = state.docs.map((d) => ({ ...d }));
          if (state.sortKeys.length) {
            out.sort((a, b) => {
              for (const { key, dir } of state.sortKeys) {
                const av = a[key];
                const bv = b[key];
                let cmp: number;
                if (av instanceof ObjectId && bv instanceof ObjectId) {
                  cmp = av.toHexString().localeCompare(bv.toHexString());
                } else if (av instanceof Date && bv instanceof Date) {
                  cmp = av.getTime() - bv.getTime();
                } else {
                  cmp = String(av).localeCompare(String(bv));
                }
                if (cmp !== 0) return cmp * dir;
              }

              return 0;
            });
          }
          if (state.limitN != null) return out.slice(0, state.limitN);
          return out;
        },
      };
      return api;
    },
    async countDocuments(filter: Record<string, unknown> = {}) {
      return docs.filter((d) => matches(d, filter)).length;
    },
    async deleteOne(filter: Record<string, unknown> = {}) {
      const idx = docs.findIndex((d) => matches(d, filter));
      if (idx < 0) return { deletedCount: 0, acknowledged: true };
      docs.splice(idx, 1);
      return { deletedCount: 1, acknowledged: true };
    },
    async deleteMany(filter: Record<string, unknown> = {}) {
      if (!filter || Object.keys(filter).length === 0) {
        const n = docs.length;
        docs.length = 0;
        return { deletedCount: n, acknowledged: true };
      }
      let deleted = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (!matches(docs[i]!, filter)) continue;
        docs.splice(i, 1);
        deleted++;
      }
      return { deletedCount: deleted, acknowledged: true };
    },
    _docs: docs,
  };
}

export type MemoryDb = {
  collection: (name: string) => ReturnType<typeof createCollection>;
  _reset: () => void;
};

export function createMemoryDb(): MemoryDb {
  const collections = new Map<string, ReturnType<typeof createCollection>>();

  const db = {
    collection(name: string) {
      let col = collections.get(name);
      if (!col) {
        col = createCollection();
        collections.set(name, col);
      }
      return col;
    },
    _reset() {
      for (const name of Object.values(COLLECTIONS)) {
        collections.get(name)?.deleteMany();
      }
      collections.clear();
    },
  };

  return db;
}

export function installMemoryDb(): MemoryDb {
  const db = createMemoryDb();
  setDbForTests(db as unknown as Db);
  return db;
}

export function uninstallMemoryDb(): void {
  setDbForTests(null);
}

/**
 * The standard per-suite lifecycle: install a fresh MemoryDb for `beforeAll`,
 * uninstall on `afterAll`, and reset both the db and the in-memory rate
 * limiter before each test. Returns an accessor for the current instance —
 * call it inside a test/hook body, not at module scope (it isn't assigned
 * until `beforeAll` runs).
 */
export function useMemoryDb(): () => MemoryDb {
  let memory: MemoryDb;

  beforeAll(() => {
    memory = installMemoryDb();
  });

  afterAll(() => {
    uninstallMemoryDb();
  });

  beforeEach(() => {
    memory._reset();
    resetRateLimitsForTests();
  });

  return () => memory;
}
