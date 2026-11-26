import type { ReportContext } from "./report-context";

/**
 * Reports the device could not send yet, held in IndexedDB until it can.
 *
 * A rider on the underground often has no signal exactly when something is
 * wrong, and the sheet used to lose the report at that moment. The queue is
 * small and boring on purpose: capped, aged out, flushed in order, and flushed
 * only while a page is open (on mount and when the connection returns). No
 * Background Sync - the service worker is not involved; a queued report goes
 * out through the same POST as a live one (lib/report-delivery.ts).
 *
 * Where IndexedDB is unavailable (private modes, old WebViews) every function
 * reports "nothing queued" and the sheet keeps its copy/email behaviour.
 */

const DB_NAME = "bts-reports";
const STORE = "reports";
const DB_VERSION = 1;

/** Enough for a run of failed sends; an old report is worth less than a new one. */
export const MAX_QUEUED_REPORTS = 50;
/** A week-old report describes a version of the app that may no longer exist. */
export const REPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredReport {
  id: number;
  queuedAt: number;
  report: ReportContext;
}

export interface FlushResult {
  sent: number;
  remaining: number;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });
}

/**
 * Open (and create on first use) the queue database. Resolves null when the
 * browser has no IndexedDB or refuses to open one - the caller then keeps the
 * old behaviour instead of pretending a report was saved.
 */
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Some privacy modes throw here rather than failing the request.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        // Oldest-first is the order they are sent in, and the order they go.
        store.createIndex("queuedAt", "queuedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readAll(db: IDBDatabase): Promise<StoredReport[]> {
  const tx = db.transaction(STORE, "readonly");
  return promisify(tx.objectStore(STORE).index("queuedAt").getAll() as IDBRequest<StoredReport[]>);
}

/** Keep only the newest MAX_QUEUED_REPORTS that are still within the retention window. */
async function prune(db: IDBDatabase): Promise<void> {
  const all = await readAll(db);
  const now = Date.now();
  const fresh = all.filter((entry) => now - entry.queuedAt <= REPORT_RETENTION_MS);
  const keep = new Set(fresh.slice(-MAX_QUEUED_REPORTS).map((entry) => entry.id));
  const drop = all.filter((entry) => !keep.has(entry.id)).map((entry) => entry.id);
  if (drop.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of drop) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb delete failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb delete aborted"));
  });
}

function remove(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb delete failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb delete aborted"));
  });
}

/** Store a report for later. False means the device could not keep it (no IndexedDB, or full). */
export async function queueReport(report: ReportContext): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add({ queuedAt: Date.now(), report });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexeddb write aborted"));
    });
    // Cap and age are applied after the write, so one burst of offline reports
    // cannot leave the older ones to grow without bound.
    await prune(db);
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/**
 * Send what is waiting, oldest first, and stop at the first failure: that means
 * the connection (or the endpoint) is still not ready, and the rest must stay.
 * `sent` is how many went; `remaining` is what is left afterwards.
 *
 * One flush at a time for the whole page: the sheet is mounted in several
 * places (map cards, the route panel, Settings), and they must not send the
 * same queued report twice when they all notice the connection return.
 */
let activeFlush: Promise<FlushResult> | null = null;

export function flushReportQueue(send: (report: ReportContext) => Promise<boolean>): Promise<FlushResult> {
  if (activeFlush) return activeFlush;
  activeFlush = flushOnce(send).finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

async function flushOnce(send: (report: ReportContext) => Promise<boolean>): Promise<FlushResult> {
  const db = await openDb();
  if (!db) return { sent: 0, remaining: 0 };
  try {
    await prune(db);
    const queued = await readAll(db);
    let sent = 0;
    for (const entry of queued) {
      let ok = false;
      try {
        ok = await send(entry.report);
      } catch {
        ok = false;
      }
      if (!ok) break;
      try {
        await remove(db, entry.id);
      } catch {
        // Kept in the queue: it may go twice rather than be lost.
        break;
      }
      sent += 1;
    }
    return { sent, remaining: queued.length - sent };
  } catch {
    // A read/tidy-up failure must not take the sheet down with it.
    return { sent: 0, remaining: 0 };
  } finally {
    db.close();
  }
}
