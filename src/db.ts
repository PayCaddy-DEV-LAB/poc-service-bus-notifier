import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DB_PATH } from "./config.js";

export type DeliveryStatus = "DELIVERED" | "FAILED" | "DLQ";

export type DeliveryLogEntry = {
  id: number;
  message_id: string;
  client_id: string;
  event_type: string;
  payload_hash: string;
  status: DeliveryStatus;
  attempt: number;
  http_status: number | null;
  error_message: string | null;
  delivered_at: string;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS delivery_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id    TEXT NOT NULL,
    client_id     TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    payload_hash  TEXT NOT NULL,
    status        TEXT NOT NULL CHECK(status IN ('DELIVERED','FAILED','DLQ')),
    attempt       INTEGER NOT NULL DEFAULT 1,
    http_status   INTEGER,
    error_message TEXT,
    delivered_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_client_id  ON delivery_log(client_id);
  CREATE INDEX IF NOT EXISTS idx_message_id ON delivery_log(message_id);
  CREATE INDEX IF NOT EXISTS idx_status     ON delivery_log(status);
`;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.exec(SCHEMA);
  return _db;
}

export type LogDeliveryInput = Omit<DeliveryLogEntry, "id" | "delivered_at">;

export function logDelivery(entry: LogDeliveryInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO delivery_log (message_id, client_id, event_type, payload_hash, status, attempt, http_status, error_message)
     VALUES (@message_id, @client_id, @event_type, @payload_hash, @status, @attempt, @http_status, @error_message)`
  ).run(entry);
}

export function getDeliveryLog(filters?: {
  clientId?: string;
  status?: string;
}): DeliveryLogEntry[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.clientId) {
    conditions.push("client_id = @clientId");
    params.clientId = filters.clientId;
  }
  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM delivery_log ${where} ORDER BY delivered_at DESC`)
    .all(params) as DeliveryLogEntry[];
}
