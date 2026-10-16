import * as SQLite from 'expo-sqlite';

import type { Garment } from '../../types/garment';

type GarmentRow = Omit<Garment, 'retryRequested'> & { retryRequested: number };
type Listener = (id: string | null) => void;

const columns = [
  'localId', 'remoteId', 'originalLocalUri', 'cutoutLocalUri', 'thumbnailLocalUri',
  'originalRemoteUrl', 'cutoutRemoteUrl', 'thumbnailRemoteUrl', 'mimeType', 'fileName',
  'status', 'uploadAttempts', 'nextAttemptAt', 'pollAttempts', 'nextPollAt',
  'retryRequested', 'lastError', 'createdAt', 'updatedAt',
] as const satisfies readonly (keyof Garment)[];

const schema = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS garments (
    localId TEXT PRIMARY KEY NOT NULL,
    remoteId TEXT,
    originalLocalUri TEXT NOT NULL,
    cutoutLocalUri TEXT,
    thumbnailLocalUri TEXT,
    originalRemoteUrl TEXT,
    cutoutRemoteUrl TEXT,
    thumbnailRemoteUrl TEXT,
    mimeType TEXT NOT NULL,
    fileName TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN (
      'local_saved','upload_queued','uploading','queued','processing','ready','needs_review','failed'
    )),
    uploadAttempts INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt INTEGER NOT NULL DEFAULT 0,
    pollAttempts INTEGER NOT NULL DEFAULT 0,
    nextPollAt INTEGER NOT NULL DEFAULT 0,
    retryRequested INTEGER NOT NULL DEFAULT 0,
    lastError TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS garments_capture_order ON garments(createdAt DESC, localId DESC);
  CREATE INDEX IF NOT EXISTS garments_upload_queue ON garments(status, nextAttemptAt);
  CREATE INDEX IF NOT EXISTS garments_poll_queue ON garments(status, nextPollAt);
  PRAGMA user_version = 1;
`;

function fromRow(row: GarmentRow): Garment {
  return { ...row, retryRequested: row.retryRequested === 1 };
}

function bind(value: Garment[keyof Garment]): string | number | null {
  return typeof value === 'boolean' ? Number(value) : value;
}

/** The queued job lives in the same SQLite row as its garment, so insertion is atomic. */
export function createGarmentRepository(open: () => Promise<SQLite.SQLiteDatabase>) {
  let database: Promise<SQLite.SQLiteDatabase> | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  const listeners = new Set<Listener>();

  async function db() {
    if (!database) {
      database = (async () => {
        const connection = await open();
        try {
          await connection.execAsync(schema);
          return connection;
        } catch (error) {
          await connection.closeAsync();
          throw error;
        }
      })();
      database.catch(() => { database = null; });
    }
    return database;
  }

  // All read/modify/write operations are serialized; a late network response cannot resurrect a deletion.
  function write<T>(operation: () => Promise<T>): Promise<T> {
    const next = writes.then(operation);
    writes = next.catch(() => undefined);
    return next;
  }

  function emit(id: string | null) {
    for (const listener of listeners) {
      try { listener(id); } catch (error) { console.error('Wardrobe subscription failed', error); }
    }
  }

  return {
    async initialize(): Promise<void> { await db(); },

    async list(): Promise<Garment[]> {
      const connection = await db();
      return (await connection.getAllAsync<GarmentRow>(
        'SELECT * FROM garments ORDER BY createdAt DESC, localId DESC',
      )).map(fromRow);
    },

    async get(id: string): Promise<Garment | null> {
      const row = await (await db()).getFirstAsync<GarmentRow>(
        'SELECT * FROM garments WHERE localId = ?', id,
      );
      return row ? fromRow(row) : null;
    },

    insert(garment: Garment): Promise<void> {
      return write(async () => {
        const connection = await db();
        await connection.runAsync(
          `INSERT INTO garments (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map((key) => bind(garment[key])),
        );
        emit(garment.localId);
      });
    },

    update(id: string, patch: Partial<Garment>): Promise<boolean> {
      return write(async () => {
        const connection = await db();
        const row = await connection.getFirstAsync<GarmentRow>(
          'SELECT * FROM garments WHERE localId = ?', id,
        );
        if (!row) return false;
        const current = fromRow(row);
        const changed = columns.filter((key) => key !== 'localId' && key !== 'createdAt'
          && key !== 'updatedAt' && patch[key] !== undefined && patch[key] !== current[key]);
        if (!changed.length) return true;
        const timestamp = patch.updatedAt ?? new Date().toISOString();
        await connection.runAsync(
          `UPDATE garments SET ${changed.map((key) => `${key} = ?`).join(', ')}, updatedAt = ? WHERE localId = ?`,
          [...changed.map((key) => bind(patch[key] as Garment[typeof key])), timestamp, id],
        );
        emit(id);
        return true;
      });
    },

    remove(id: string): Promise<void> {
      return write(async () => {
        const result = await (await db()).runAsync('DELETE FROM garments WHERE localId = ?', id);
        if (result.changes) emit(id);
      });
    },

    recoverInterrupted(): Promise<void> {
      return write(async () => {
        const result = await (await db()).runAsync(`
          UPDATE garments SET
            status = CASE WHEN remoteId IS NULL THEN 'upload_queued' ELSE 'queued' END,
            nextAttemptAt = 0, nextPollAt = 0, updatedAt = ?
          WHERE status = 'uploading'
        `, new Date().toISOString());
        if (result.changes) emit(null);
      });
    },

    async getUploadCandidates(now: number): Promise<Garment[]> {
      return (await (await db()).getAllAsync<GarmentRow>(`
        SELECT * FROM garments WHERE nextAttemptAt <= ? AND (
          (remoteId IS NULL AND status IN ('local_saved', 'upload_queued'))
          OR (remoteId IS NOT NULL AND retryRequested = 1)
        ) ORDER BY createdAt ASC, localId ASC
      `, now)).map(fromRow);
    },

    async getPollCandidates(now: number): Promise<Garment[]> {
      return (await (await db()).getAllAsync<GarmentRow>(`
        SELECT * FROM garments WHERE remoteId IS NOT NULL AND retryRequested = 0
          AND nextPollAt <= ? AND (
            status IN ('queued', 'processing') OR (status = 'ready' AND cutoutLocalUri IS NULL)
          ) ORDER BY nextPollAt ASC, createdAt ASC, localId ASC
      `, now)).map(fromRow);
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const repository = createGarmentRepository(() => SQLite.openDatabaseAsync('wearmuse-wardrobe.db'));
