import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Repository } from "../lib/server/repository.ts";
import type { Database, SqlResult, SqlValue, Statement } from "../lib/server/repository.ts";

class SQLiteStatement implements Statement {
  db: DatabaseSync; sql: string; values: SqlValue[];
  constructor(db: DatabaseSync, sql: string, values: SqlValue[] = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values: SqlValue[]) { return new SQLiteStatement(this.db, this.sql, values); }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>(): Promise<SqlResult<T>> {
    const results = this.db.prepare(this.sql).all(...this.values) as T[];
    const changes = Number(this.db.prepare("SELECT changes() AS n").get()?.n ?? 0);
    return { results, meta: { changes } };
  }
  async run() { const result = this.db.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
}
export class SQLiteDatabase implements Database {
  raw = new DatabaseSync(":memory:");
  schemaSource: "migrations" | "fixture";
  constructor() {
    this.raw.exec("PRAGMA foreign_keys = ON");
    const migrationRoot = new URL("../drizzle/", import.meta.url);
    const files = readdirSync(migrationRoot).filter(name => name.endsWith(".sql")).sort();
    this.schemaSource = files.length ? "migrations" : "fixture";
    if (files.length) for (const file of files) this.raw.exec(readFileSync(new URL(file, migrationRoot), "utf8"));
    else this.raw.exec(readFileSync(new URL("./fixtures/schema.sql", import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new SQLiteStatement(this.raw, sql); }
  async batch<T>(statements: Statement[]): Promise<SqlResult<T>[]> {
    this.raw.exec("BEGIN");
    try {
      const result: SqlResult<T>[] = [];
      for (const statement of statements) result.push(await statement.all<T>());
      this.raw.exec("COMMIT"); return result;
    } catch (error) { this.raw.exec("ROLLBACK"); throw error; }
  }
}
export async function fixture() {
  const db = new SQLiteDatabase(); const repo = new Repository(db);
  const owner = { userId: "owner", email: "owner@example.test", displayName: "Owner" };
  const other = { userId: "other", email: "other@example.test", displayName: "Other" };
  await repo.bootstrap(owner); await repo.bootstrap(other);
  return { db, repo, owner, other, workspace: "ws_owner", project: "project_owner" };
}
