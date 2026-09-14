import type { Database, SqlResult, SqlValue, Statement } from "./repository.ts";

/** Structural interface compatible with a node-postgres pool; no global client. */
export interface PgExecutor {
  query(text: string, values?: SqlValue[]): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>;
}
export interface PgClient extends PgExecutor {
  release(destroy?: boolean): void;
}
export interface PgPool extends PgExecutor {
  connect(): Promise<PgClient>;
}

/** Convert only parameter markers, preserving quoted SQL and comments verbatim. */
export function postgresParameters(sql: string): { text: string; count: number } {
  let text = "";
  let count = 0;
  let i = 0;
  while (i < sql.length) {
    const start = i;
    const char = sql[i];
    if (char === "'" || char === '"') {
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] !== char) continue;
        if (sql[i] === char) { i++; continue; }
        closed = true;
        break;
      }
      if (!closed) throw new Error("Unterminated SQL quote");
      text += sql.slice(start, i);
    } else if (sql.startsWith("--", i)) {
      const newline = sql.indexOf("\n", i + 2);
      i = newline === -1 ? sql.length : newline + 1;
      text += sql.slice(start, i);
    } else if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unterminated SQL comment");
      text += sql.slice(start, i);
    } else if (char === "$") {
      const delimiter = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (!delimiter) throw new Error("Use question-mark parameters in repository SQL");
      const end = sql.indexOf(delimiter, i + delimiter.length);
      if (end === -1) throw new Error("Unterminated dollar-quoted SQL");
      i = end + delimiter.length;
      text += sql.slice(start, i);
    } else {
      text += char === "?" ? `$${++count}` : char;
      i++;
    }
  }
  return { text, count };
}

class PostgresStatement implements Statement {
  readonly database: PostgresDatabase;
  readonly compiled: { text: string; count: number };
  readonly values: SqlValue[];

  constructor(database: PostgresDatabase, compiled: { text: string; count: number }, values: SqlValue[] = []) {
    this.database = database;
    this.compiled = compiled;
    this.values = values;
  }

  bind(...values: SqlValue[]): PostgresStatement {
    if (values.length !== this.compiled.count) throw new Error("SQL parameter count mismatch");
    return new PostgresStatement(this.database, this.compiled, [...values]);
  }

  async execute<T>(executor: PgExecutor): Promise<SqlResult<T>> {
    if (this.values.length !== this.compiled.count) throw new Error("SQL parameters must be bound");
    const result = await executor.query(this.compiled.text, [...this.values]);
    return { results: result.rows as T[], meta: { changes: result.rowCount ?? 0 } };
  }

  async first<T>(): Promise<T | null> {
    return (await this.execute<T>(this.database.pool)).results[0] ?? null;
  }

  all<T>(): Promise<SqlResult<T>> { return this.execute<T>(this.database.pool); }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = await this.execute(this.database.pool);
    return { meta: result.meta };
  }
}

/** D1-compatible repository boundary backed by a PostgreSQL connection pool. */
export class PostgresDatabase implements Database {
  readonly pool: PgPool;
  readonly inTransaction: boolean;
  constructor(pool: PgPool, inTransaction = false) { this.pool = pool; this.inTransaction = inTransaction; }

  prepare(sql: string): Statement { return new PostgresStatement(this, postgresParameters(sql)); }

  async batch<T>(statements: Statement[]): Promise<SqlResult<T>[]> {
    if (!statements.length) return [];
    const own = statements.map(statement => {
      if (!(statement instanceof PostgresStatement) || statement.database !== this) {
        throw new Error("Transaction statements must belong to the same database");
      }
      return statement;
    });
    return this.transaction(async database => {
      const executor = (database as PostgresDatabase).pool;
      const results: SqlResult<T>[] = [];
      for (const statement of own) results.push(await statement.execute<T>(executor));
      return results;
    });
  }

  async transaction<T>(operation: (database: Database) => Promise<T>): Promise<T> {
    if (this.inTransaction) return operation(this);
    const client = await this.pool.connect();
    let begun = false;
    let destroy = false;
    try {
      await client.query("BEGIN");
      begun = true;
      const scoped = new PostgresDatabase({
        query: (text, values) => client.query(text, values),
        connect: async () => { throw new Error("Nested connection is unavailable inside a transaction"); },
      }, true);
      const result = await operation(scoped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (begun) {
        try { await client.query("ROLLBACK"); }
        catch { destroy = true; }
      } else destroy = true;
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}
