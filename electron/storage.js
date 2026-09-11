import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const STATE_KEY = 'main';
const DB_FILE_NAME = 'dailog.db';

function nowIso() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    months: [],
    settings: null,
    aiDebugEntries: [],
  };
}

export function createStorage(userDataPath) {
  fs.mkdirSync(userDataPath, { recursive: true });

  const dbPath = path.join(userDataPath, DB_FILE_NAME);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db
    .prepare(
      `CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    )
    .run();

  const readStatement = db.prepare('SELECT value FROM app_state WHERE key = ?');
  const writeStatement = db.prepare(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  );

  return {
    dbPath,
    readState() {
      const row = readStatement.get(STATE_KEY);
      if (!row?.value) {
        return null;
      }

      try {
        const parsed = JSON.parse(row.value);
        return {
          months: Array.isArray(parsed?.months) ? parsed.months : [],
          settings: parsed?.settings ?? null,
          aiDebugEntries: Array.isArray(parsed?.aiDebugEntries) ? parsed.aiDebugEntries.slice(0, 8) : [],
        };
      } catch (error) {
        const backupPath = path.join(userDataPath, `dailog-state-corrupt-${Date.now()}.json`);
        fs.writeFileSync(backupPath, row.value, 'utf8');
        console.error('[Dailog] 本地状态数据损坏，已备份并使用空状态启动。', error);
        return emptyState();
      }
    },
    writeState(nextState) {
      const safeState = {
        months: Array.isArray(nextState?.months) ? nextState.months : [],
        settings: nextState?.settings ?? null,
        aiDebugEntries: Array.isArray(nextState?.aiDebugEntries) ? nextState.aiDebugEntries.slice(0, 8) : [],
      };

      writeStatement.run(STATE_KEY, JSON.stringify(safeState), nowIso());
      return safeState;
    },
    close() {
      db.close();
    },
  };
}
