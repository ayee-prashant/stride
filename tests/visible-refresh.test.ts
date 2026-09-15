import assert from "node:assert/strict";
import { test } from "node:test";
import { startVisibleRefresh } from "../lib/visible-refresh.ts";

test("visible reads pause, coalesce focus events, abort on leave and never overlap", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  let allowed = false; let reads = 0; let signal: AbortSignal | undefined;
  let complete = () => {};
  const loop = startVisibleRefresh(async current => { reads++; signal = current; await new Promise<void>(resolve => { complete = resolve; }); }, () => allowed);
  context.after(() => loop.stop());
  context.mock.timers.tick(30_000); assert.equal(reads, 0);
  allowed = true; loop.trigger(); loop.trigger(); assert.equal(reads, 1);
  context.mock.timers.tick(60_000); assert.equal(reads, 1);
  complete(); await new Promise(resolve => setImmediate(resolve));
  loop.trigger(); assert.equal(reads, 2);
  loop.stop(); assert.equal(signal?.aborted, true);
  complete(); await new Promise(resolve => setImmediate(resolve));
  context.mock.timers.tick(120_000); loop.trigger(); assert.equal(reads, 2);
});

test("read failures back off; recovery restores the normal interval", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  let reads = 0;
  const loop = startVisibleRefresh(async () => { reads++; if (reads <= 2) throw new Error("offline"); }, () => true);
  context.after(() => loop.stop());
  const settle = () => new Promise(resolve => setImmediate(resolve));
  context.mock.timers.tick(30_000); await settle(); assert.equal(reads, 1);
  context.mock.timers.tick(59_999); await settle(); assert.equal(reads, 1);
  context.mock.timers.tick(1); await settle(); assert.equal(reads, 2);
  context.mock.timers.tick(119_999); await settle(); assert.equal(reads, 2);
  context.mock.timers.tick(1); await settle(); assert.equal(reads, 3);
  loop.trigger(); await settle(); assert.equal(reads, 3);
  context.mock.timers.tick(30_000); await settle(); assert.equal(reads, 4);
});
