import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresDatabase, postgresParameters } from "../lib/server/postgres-adapter.ts";
import type { PgClient, PgPool } from "../lib/server/postgres-adapter.ts";
import type { SqlValue } from "../lib/server/repository.ts";

function poolFixture(failAt?: string, rollbackFails = false) {
  const calls: { client: string; text: string; values?: SqlValue[] }[] = [];
  const releases: boolean[] = [];
  let connections = 0;
  const failure = new Error("Test database failure");
  async function query(client: string, text: string, values?: SqlValue[]) {
    calls.push({ client, text, values });
    if (text === failAt || (rollbackFails && text === "ROLLBACK")) throw failure;
    return { rows: text.startsWith("SELECT") ? [{ value: values?.[0] }] : [], rowCount: 1 };
  }
  const client: PgClient = { query: (text, values) => query("transaction", text, values), release: destroy => { releases.push(Boolean(destroy)); } };
  const pool: PgPool = { query: (text, values) => query("pool", text, values), connect: async () => { connections++; return client; } };
  return { pool, calls, releases, failure, connections: () => connections, db: new PostgresDatabase(pool) };
}

test("SQL conversion preserves literals, identifiers, comments and dollar quotes", () => {
  const sql = "SELECT '?', 'it''s ?', \"?\", ? -- ?\n/* ? /* ? */ ? */ , $body$?$body$, $$?$$, ?";
  assert.deepEqual(postgresParameters(sql), {
    text: "SELECT '?', 'it''s ?', \"?\", $1 -- ?\n/* ? /* ? */ ? */ , $body$?$body$, $$?$$, $2", count: 2,
  });
  for (const malformed of ["SELECT 'unclosed ?", "SELECT /* ?", "SELECT $body$?", "SELECT $1, ?"]) {
    assert.throws(() => postgresParameters(malformed));
  }
});

test("untrusted values remain separate from SQL and bound statements are immutable", async () => {
  const f = poolFixture();
  const prepared = f.db.prepare("SELECT ? AS value");
  const attack = "'; DROP TABLE tasks; --";
  const first = prepared.bind(attack);
  const second = prepared.bind("second");
  assert.deepEqual(await first.first(), { value: attack });
  assert.deepEqual(await second.first(), { value: "second" });
  assert.equal(f.calls[0].text, "SELECT $1 AS value");
  assert.deepEqual(f.calls[0].values, [attack]);
  assert.throws(() => prepared.bind(), /count mismatch/);
  await assert.rejects(prepared.all(), /must be bound/);
  assert.equal(f.connections(), 0);
});

test("a batch uses one checked-out client and releases it after commit", async () => {
  const f = poolFixture();
  const result = await f.db.batch<{ value: string }>([f.db.prepare("SELECT ? AS value").bind("task"), f.db.prepare("INSERT INTO activity VALUES (?)").bind("event")]);
  assert.equal(f.connections(), 1);
  assert.deepEqual(f.calls.map(call => call.client), Array(4).fill("transaction"));
  assert.deepEqual(f.calls.map(call => call.text), ["BEGIN", "SELECT $1 AS value", "INSERT INTO activity VALUES ($1)", "COMMIT"]);
  assert.equal(result[0].results[0].value, "task");
  assert.equal(result[1].meta.changes, 1);
  assert.deepEqual(f.releases, [false]);
});

test("an audit failure rolls back and preserves the original failure", async () => {
  const f = poolFixture("INSERT INTO activity VALUES ($1)");
  await assert.rejects(f.db.batch([f.db.prepare("UPDATE tasks SET title=?").bind("change"), f.db.prepare("INSERT INTO activity VALUES (?)").bind("event")]), error => error === f.failure);
  assert.deepEqual(f.calls.map(call => call.text), ["BEGIN", "UPDATE tasks SET title=$1", "INSERT INTO activity VALUES ($1)", "ROLLBACK"]);
  assert.deepEqual(f.releases, [false]);
});

test("failed rollback destroys the client instead of returning a dirty transaction to the pool", async () => {
  const f = poolFixture("UPDATE tasks SET title=$1", true);
  await assert.rejects(f.db.batch([f.db.prepare("UPDATE tasks SET title=?").bind("change")]), error => error === f.failure);
  assert.deepEqual(f.releases, [true]);
});

test("connection and BEGIN failures do not leak clients or attempt mutations", async () => {
  const f = poolFixture("BEGIN");
  await assert.rejects(f.db.batch([f.db.prepare("SELECT 1")]), error => error === f.failure);
  assert.deepEqual(f.calls.map(call => call.text), ["BEGIN"]);
  assert.deepEqual(f.releases, [true]);
  f.pool.connect = async () => { throw f.failure; };
  await assert.rejects(f.db.batch([f.db.prepare("SELECT 1")]), error => error === f.failure);
  assert.equal(f.releases.length, 1);
});

test("empty and foreign-database batches do not acquire a transaction", async () => {
  const f = poolFixture();
  assert.deepEqual(await f.db.batch([]), []);
  await assert.rejects(f.db.batch([poolFixture().db.prepare("SELECT 1")]), /same database/);
  assert.equal(f.connections(), 0);
});

test("commit failures are reported without automatically retrying writes", async () => {
  const f = poolFixture("COMMIT");
  await assert.rejects(f.db.batch([f.db.prepare("UPDATE tasks SET title=?").bind("change")]), error => error === f.failure);
  assert.equal(f.calls.filter(call => call.text.startsWith("UPDATE")).length, 1);
  assert.equal(f.calls.at(-1)?.text, "ROLLBACK");
  assert.deepEqual(f.releases, [false]);
});
