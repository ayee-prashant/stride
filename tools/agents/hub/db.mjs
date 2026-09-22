// Shared context store for the CLI agents.
//
// Deliberately mirrors db/context-schema.ts in the STRIDE repo so the concepts
// map 1:1 when this moves in: a monotonic sequence per project, immutable
// revisions, an ordered event log, idempotency keys and optimistic concurrency.
//
// node:sqlite is built into Node 22+, so this needs no dependency at all.

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const now = () => new Date().toISOString();
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- One monotonic clock per project. Every append takes the next value inside a
-- transaction, so the log has a total order even with concurrent writers.
CREATE TABLE IF NOT EXISTS context_heads (
  project_id TEXT PRIMARY KEY,
  sequence   INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0)
);

CREATE TABLE IF NOT EXISTS context_documents (
  id              TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('requirement','decision','constraint','note')),
  current_version INTEGER NOT NULL CHECK (current_version BETWEEN 1 AND 500),
  created_at      TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);

-- Revisions are immutable. A new fact is a new version, never an edit, so the
-- history of what an agent was told stays reconstructible.
CREATE TABLE IF NOT EXISTS context_revisions (
  project_id  TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version     INTEGER NOT NULL CHECK (version BETWEEN 1 AND 500),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  change_note TEXT NOT NULL CHECK (length(change_note) BETWEEN 1 AND 500),
  -- pending: proposed by an agent, awaiting a human. active: approved.
  state       TEXT NOT NULL CHECK (state IN ('pending','active','retired','rejected')),
  author      TEXT NOT NULL,
  approved_by TEXT,
  created_at  TEXT NOT NULL,
  input_hash  TEXT NOT NULL CHECK (length(input_hash) = 64),
  PRIMARY KEY (project_id, document_id, version),
  FOREIGN KEY (project_id, document_id) REFERENCES context_documents(project_id, id)
);

-- The ordered log. This is how agents learn what other agents did: they read
-- it, rather than being messaged. A late joiner sees the whole history.
CREATE TABLE IF NOT EXISTS context_events (
  project_id  TEXT NOT NULL,
  sequence    INTEGER NOT NULL CHECK (sequence > 0),
  kind        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  document_id TEXT,
  version     INTEGER,
  summary     TEXT NOT NULL,
  payload     TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, sequence)
);

-- A repeated request_id is a no-op that returns the first result, so an agent
-- retrying after a timeout cannot double-write.
CREATE TABLE IF NOT EXISTS idempotency (
  project_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  result     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, request_id)
);

CREATE TABLE IF NOT EXISTS work_items (
  id          TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body        TEXT NOT NULL DEFAULT '',
  state       TEXT NOT NULL CHECK (state IN ('open','claimed','done','abandoned')),
  claimed_by  TEXT,
  lease_until TEXT,
  outcome     TEXT,
  version     INTEGER NOT NULL CHECK (version > 0),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);

-- Which agent is connected, on what model, under what approval mode. The hub
-- stamps the actor from the token; an agent never declares who it is.
CREATE TABLE IF NOT EXISTS agents (
  token         TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  project_id    TEXT NOT NULL,
  model         TEXT,
  approval_mode TEXT NOT NULL DEFAULT 'prompt' CHECK (approval_mode IN ('prompt','auto')),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_project_seq ON context_events(project_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_docs_project_kind  ON context_documents(project_id, kind);
`;

export class Store {
  constructor(file) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this.#migrate();
    this.listeners = new Set();
  }

  // CREATE TABLE IF NOT EXISTS does not add columns to a table that already
  // exists, so new fields need an explicit, idempotent migration.
  #migrate() {
    const add = (table, column, decl) => {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!cols.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    };
    // Which CLI a member runs. Deliberately separate from its name: two members
    // can share a runtime while being different agents on different models.
    add('agents', 'runtime', 'TEXT');
    // What the member is allowed to do. Only a manager may create or assign work.
    add('agents', 'role', "TEXT NOT NULL DEFAULT 'implementer'");
    // Who a work item is meant for. NULL means anyone may take it.
    add('work_items', 'assignee', 'TEXT');
  }

  // ---- plumbing -----------------------------------------------------------

  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit(ev) { for (const fn of this.listeners) { try { fn(ev); } catch { /* a bad listener must not break a write */ } } }

  #tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; }
  }

  #head(projectId) {
    this.db.prepare('INSERT OR IGNORE INTO context_heads(project_id, sequence) VALUES(?, 0)').run(projectId);
    return this.db.prepare('SELECT sequence FROM context_heads WHERE project_id = ?').get(projectId).sequence;
  }

  headSequence(projectId) { return this.#head(projectId); }

  // Assigns the next sequence inside the caller's transaction, so the log is
  // totally ordered even when several agents write at the same moment.
  #append(projectId, ev) {
    const seq = this.#head(projectId) + 1;
    this.db.prepare('UPDATE context_heads SET sequence = ? WHERE project_id = ?').run(seq, projectId);
    this.db.prepare(
      `INSERT INTO context_events(project_id, sequence, kind, actor, document_id, version, summary, payload, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    ).run(projectId, seq, ev.kind, ev.actor, ev.documentId ?? null, ev.version ?? null,
          ev.summary, ev.payload ? JSON.stringify(ev.payload) : null, now());
    return seq;
  }

  // A repeat of the same request_id returns the original result untouched.
  #idempotent(projectId, requestId, fn) {
    if (!requestId) throw new Error('request_id is required so a retry cannot double-write');
    const seen = this.db.prepare('SELECT result FROM idempotency WHERE project_id = ? AND request_id = ?')
      .get(projectId, requestId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };

    const result = this.#tx(() => {
      const r = fn();
      this.db.prepare('INSERT INTO idempotency(project_id, request_id, result, created_at) VALUES(?,?,?,?)')
        .run(projectId, requestId, JSON.stringify(r), now());
      return r;
    });
    this.#emit({ projectId, ...result });
    return result;
  }

  // ---- agents -------------------------------------------------------------

  // Re-registering must not silently discard the controller settings. connect.ps1
  // re-registers on every run and does not know the policy, so an unset field here
  // means "leave it alone", not "clear it". Only setPolicy changes policy.
  registerAgent({ name, projectId, model, approvalMode, runtime, role }) {
    const existing = this.db.prepare('SELECT token FROM agents WHERE name = ?').get(name);
    if (existing) {
      this.db.prepare('UPDATE agents SET project_id=?, model=COALESCE(?,model), approval_mode=COALESCE(?,approval_mode), runtime=COALESCE(?,runtime), role=COALESCE(?,role) WHERE name=?')
        .run(projectId, model ?? null, approvalMode ?? null, runtime ?? null, role ?? null, name);
      return existing.token;
    }
    model = model ?? null;
    approvalMode = approvalMode ?? 'prompt';
    const token = randomUUID().replace(/-/g, '');
    this.db.prepare('INSERT INTO agents(token,name,project_id,model,approval_mode,runtime,role,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(token, name, projectId, model, approvalMode, runtime ?? null, role ?? 'implementer', now());
    return token;
  }

  agentByToken(token) {
    const a = this.db.prepare('SELECT * FROM agents WHERE token = ?').get(token);
    if (a) this.db.prepare('UPDATE agents SET last_seen_at = ? WHERE token = ?').run(now(), token);
    return a ?? null;
  }

  listAgents() { return this.db.prepare('SELECT name, project_id, model, approval_mode, runtime, role, last_seen_at FROM agents ORDER BY name').all(); }

  setPolicy(name, { model, approvalMode }) {
    const a = this.db.prepare('SELECT name FROM agents WHERE name = ?').get(name);
    if (!a) throw new Error(`no such agent: ${name}`);
    if (model !== undefined) this.db.prepare('UPDATE agents SET model = ? WHERE name = ?').run(model, name);
    if (approvalMode !== undefined) this.db.prepare('UPDATE agents SET approval_mode = ? WHERE name = ?').run(approvalMode, name);
    return this.db.prepare('SELECT name, model, approval_mode FROM agents WHERE name = ?').get(name);
  }

  // ---- context ------------------------------------------------------------

  // The approved context, and only the approved context.
  //
  // This deliberately selects the latest revision whose state is 'active',
  // NOT the document's current_version. current_version advances on every
  // proposal, so joining on it meant an unapproved proposal replaced the
  // approved revision in this result - and since the pending row was then
  // filtered out by state, the document vanished from every agent's view
  // entirely. An agent could suppress a constraint it did not want to follow
  // just by proposing an edit to it.
  contextHead(projectId) {
    const docs = this.db.prepare(
      `SELECT d.id, d.kind, r.version AS current_version, r.title, r.body, r.state,
              r.author, r.approved_by, r.created_at
         FROM context_documents d
         JOIN context_revisions r
           ON r.project_id = d.project_id AND r.document_id = d.id
        WHERE d.project_id = ?
          AND r.state = 'active'
          AND r.version = (SELECT MAX(x.version) FROM context_revisions x
                            WHERE x.project_id = d.project_id AND x.document_id = d.id
                              AND x.state = 'active')
        ORDER BY d.kind, d.id`
    ).all(projectId);
    return { project_id: projectId, head_sequence: this.#head(projectId), documents: docs };
  }

  /** Proposals awaiting a human decision. Separate from contextHead on purpose:
   *  mixing them into one list is what allowed a proposal to masquerade as
   *  context in the first place. */
  pending(projectId) {
    const revisions = this.db.prepare(
      `SELECT r.document_id, r.version, r.title, r.body, r.change_note, r.author, r.created_at, d.kind
         FROM context_revisions r
         JOIN context_documents d ON d.project_id = r.project_id AND d.id = r.document_id
        WHERE r.project_id = ? AND r.state = 'pending'
        ORDER BY r.created_at`
    ).all(projectId);
    return { head_sequence: this.#head(projectId), revisions };
  }

  contextGet(projectId, documentId) {
    const doc = this.db.prepare('SELECT * FROM context_documents WHERE project_id=? AND id=?').get(projectId, documentId);
    if (!doc) return null;
    const revisions = this.db.prepare(
      'SELECT version,title,body,change_note,state,author,approved_by,created_at FROM context_revisions WHERE project_id=? AND document_id=? ORDER BY version'
    ).all(projectId, documentId);
    return { ...doc, head_sequence: this.#head(projectId), revisions };
  }

  // An agent proposes; it lands as 'pending'. Only a human promotes it, which
  // is why there is no approve tool on the MCP surface.
  proposeRevision(projectId, actor, { documentId, kind, title, body, changeNote, expectedVersion, requestId }) {
    return this.#idempotent(projectId, requestId, () => {
      const id = documentId || `doc_${randomUUID().slice(0, 8)}`;
      const doc = this.db.prepare('SELECT * FROM context_documents WHERE project_id=? AND id=?').get(projectId, id);

      let version;
      if (!doc) {
        version = 1;
        this.db.prepare('INSERT INTO context_documents(id,project_id,kind,current_version,created_at) VALUES(?,?,?,?,?)')
          .run(id, projectId, kind, 1, now());
      } else {
        // Optimistic concurrency: a writer working from a stale read is
        // rejected rather than silently overwriting someone else's revision.
        if (expectedVersion !== undefined && expectedVersion !== doc.current_version) {
          const e = new Error(`stale write: document is at version ${doc.current_version}, you sent ${expectedVersion}`);
          e.conflict = { current_version: doc.current_version };
          throw e;
        }
        version = doc.current_version + 1;
        this.db.prepare('UPDATE context_documents SET current_version=? WHERE project_id=? AND id=?')
          .run(version, projectId, id);
      }

      this.db.prepare(
        `INSERT INTO context_revisions(project_id,document_id,version,title,body,change_note,state,author,created_at,input_hash)
         VALUES(?,?,?,?,?,?,'pending',?,?,?)`
      ).run(projectId, id, version, title, body, changeNote, actor, now(), sha256(`${id}|${version}|${title}|${body}`));

      const seq = this.#append(projectId, {
        kind: 'context_proposed', actor, documentId: id, version,
        summary: `${actor} proposed ${kind} "${title}" (v${version}, awaiting approval)`,
      });
      return { document_id: id, version, state: 'pending', head_sequence: seq };
    });
  }

  // Human-only. Not reachable from the MCP tool surface.
  decideRevision(projectId, documentId, version, { approve, approver }) {
    const r = this.#tx(() => {
      const rev = this.db.prepare('SELECT * FROM context_revisions WHERE project_id=? AND document_id=? AND version=?')
        .get(projectId, documentId, version);
      if (!rev) throw new Error('no such revision');
      if (rev.state !== 'pending') throw new Error(`revision is ${rev.state}, not pending`);

      this.db.prepare('UPDATE context_revisions SET state=?, approved_by=? WHERE project_id=? AND document_id=? AND version=?')
        .run(approve ? 'active' : 'rejected', approver, projectId, documentId, version);
      if (approve && version > 1) {
        this.db.prepare(`UPDATE context_revisions SET state='retired' WHERE project_id=? AND document_id=? AND version<? AND state='active'`)
          .run(projectId, documentId, version);
      }
      const seq = this.#append(projectId, {
        kind: approve ? 'context_approved' : 'context_rejected', actor: approver, documentId, version,
        summary: `${approver} ${approve ? 'approved' : 'rejected'} ${documentId} v${version}`,
      });
      return { document_id: documentId, version, state: approve ? 'active' : 'rejected', head_sequence: seq };
    });
    this.#emit({ projectId, ...r });
    return r;
  }

  // ---- the feed: how agents see each other --------------------------------

  feed(projectId, { since = 0, limit = 50 } = {}) {
    const rows = this.db.prepare(
      `SELECT sequence, kind, actor, document_id, version, summary, payload, created_at
         FROM context_events WHERE project_id = ? AND sequence > ?
        ORDER BY sequence LIMIT ?`
    ).all(projectId, since, Math.min(limit, 200));
    return {
      head_sequence: this.#head(projectId),
      events: rows.map((r) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null })),
    };
  }

  appendNote(projectId, actor, { title, body, tags = [], requestId }) {
    return this.#idempotent(projectId, requestId, () => {
      const seq = this.#append(projectId, {
        kind: 'note', actor, summary: `${actor}: ${title}`, payload: { title, body, tags },
      });
      return { sequence: seq, head_sequence: seq };
    });
  }

  // ---- work ---------------------------------------------------------------

  /** Only a manager may create or assign work. The check lives here rather than
   *  only in the tool layer, so a second caller cannot bypass it later. */
  #requireManager(actor) {
    if (actor === 'human') return;
    const a = this.db.prepare('SELECT role FROM agents WHERE name = ?').get(actor);
    if (!a || a.role !== 'manager') {
      throw new Error(`only the manager may do this; ${actor} is ${a ? a.role : 'unknown'}`);
    }
  }

  createWorkItem(projectId, { id, title, body = '', requestId, actor = 'human', assignee = null }) {
    this.#requireManager(actor);
    // The row and its event are written in one transaction. They used to be
    // separate, so a failure between them could leave an item that never
    // appeared in the log - invisible to every agent reading the feed.
    return this.#idempotent(projectId, requestId ?? `work:${randomUUID()}`, () => {
      const wid = id || `w_${randomUUID().slice(0, 8)}`;
      this.db.prepare('INSERT INTO work_items(id,project_id,title,body,state,version,created_at,assignee) VALUES(?,?,?,?,?,1,?,?)')
        .run(wid, projectId, title, body, 'open', now(), assignee);
      const seq = this.#append(projectId, {
        kind: 'work_created', actor,
        summary: assignee ? `${actor} created "${title}" for ${assignee}` : `${actor} created "${title}" (unassigned)`,
        payload: { id: wid, assignee },
      });
      return { id: wid, assignee, head_sequence: seq };
    });
  }

  /** Return abandoned work to the pool.
   *
   * claimWork already let another agent take over an expired lease, but
   * listWork still reported the old holder, so abandoned work looked like work
   * in progress to both humans and agents. Expiry is applied here and written
   * to the log, so a lease lapsing is an auditable event rather than a silent
   * difference between what the list says and what a claim would do. */
  #sweepLeases(projectId) {
    const stale = this.db.prepare(
      `SELECT id, title, claimed_by, lease_until FROM work_items
        WHERE project_id = ? AND state = 'claimed' AND lease_until IS NOT NULL AND lease_until <= ?`
    ).all(projectId, now());
    if (!stale.length) return;
    this.#tx(() => {
      for (const w of stale) {
        this.db.prepare(`UPDATE work_items SET state='open', claimed_by=NULL, lease_until=NULL, version=version+1 WHERE project_id=? AND id=?`)
          .run(projectId, w.id);
        this.#append(projectId, {
          kind: 'work_lease_expired', actor: 'system',
          summary: `${w.claimed_by}'s lease on "${w.title}" expired; it is available again`,
          payload: { id: w.id, previous_holder: w.claimed_by, lease_until: w.lease_until },
        });
      }
    });
    this.#emit({ projectId, swept: stale.length });
  }

  assignWork(projectId, actor, { itemId, assignee, requestId }) {
    this.#requireManager(actor);
    return this.#idempotent(projectId, requestId, () => {
      const item = this.db.prepare('SELECT * FROM work_items WHERE project_id=? AND id=?').get(projectId, itemId);
      if (!item) throw new Error('no such work item');
      if (assignee) {
        const who = this.db.prepare('SELECT name FROM agents WHERE name = ?').get(assignee);
        if (!who) throw new Error(`no such agent: ${assignee}`);
      }
      this.db.prepare('UPDATE work_items SET assignee=?, version=version+1 WHERE project_id=? AND id=?')
        .run(assignee ?? null, projectId, itemId);
      const seq = this.#append(projectId, {
        kind: 'work_assigned', actor,
        summary: assignee ? `${actor} assigned "${item.title}" to ${assignee}` : `${actor} unassigned "${item.title}"`,
        payload: { id: itemId, assignee },
      });
      return { id: itemId, assignee: assignee ?? null, head_sequence: seq };
    });
  }

  listWork(projectId) {
    this.#sweepLeases(projectId);
    return {
      head_sequence: this.#head(projectId),
      items: this.db.prepare('SELECT id,title,body,state,claimed_by,lease_until,outcome,version,assignee FROM work_items WHERE project_id=? ORDER BY created_at').all(projectId),
    };
  }

  // A lease, not a flag: if an agent dies holding a claim the work becomes
  // available again instead of being stuck forever.
  claimWork(projectId, actor, { itemId, leaseSeconds = 1800, requestId }) {
    // Sweep first so a claim and the work list never disagree about who holds what.
    this.#sweepLeases(projectId);
    return this.#idempotent(projectId, requestId, () => {
      const item = this.db.prepare('SELECT * FROM work_items WHERE project_id=? AND id=?').get(projectId, itemId);
      if (!item) throw new Error('no such work item');
      // An item assigned to someone else is not yours to take. Without this the
      // manager's plan is advisory and two implementers can still collide.
      if (item.assignee && item.assignee !== actor) {
        const e = new Error(`"${item.title}" is assigned to ${item.assignee}, not you`);
        e.conflict = { assignee: item.assignee };
        throw e;
      }
      const held = item.state === 'claimed' && item.lease_until && item.lease_until > now();
      if (held && item.claimed_by !== actor) {
        const e = new Error(`already claimed by ${item.claimed_by} until ${item.lease_until}`);
        e.conflict = { claimed_by: item.claimed_by, lease_until: item.lease_until };
        throw e;
      }
      const until = new Date(Date.now() + leaseSeconds * 1000).toISOString();
      this.db.prepare('UPDATE work_items SET state=?, claimed_by=?, lease_until=?, version=version+1 WHERE project_id=? AND id=?')
        .run('claimed', actor, until, projectId, itemId);
      const seq = this.#append(projectId, { kind: 'work_claimed', actor, summary: `${actor} claimed "${item.title}"`, payload: { id: itemId, lease_until: until } });
      return { id: itemId, claimed_by: actor, lease_until: until, head_sequence: seq };
    });
  }

  releaseWork(projectId, actor, { itemId, outcome, summary, requestId }) {
    return this.#idempotent(projectId, requestId, () => {
      const item = this.db.prepare('SELECT * FROM work_items WHERE project_id=? AND id=?').get(projectId, itemId);
      if (!item) throw new Error('no such work item');
      if (item.claimed_by && item.claimed_by !== actor) throw new Error(`claimed by ${item.claimed_by}, not you`);
      const state = outcome === 'done' ? 'done' : 'open';
      this.db.prepare('UPDATE work_items SET state=?, claimed_by=NULL, lease_until=NULL, outcome=?, version=version+1 WHERE project_id=? AND id=?')
        .run(state, summary ?? null, projectId, itemId);
      const seq = this.#append(projectId, { kind: 'work_released', actor, summary: `${actor} released "${item.title}" (${outcome})`, payload: { id: itemId, outcome, summary } });
      return { id: itemId, state, head_sequence: seq };
    });
  }
}
