import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardLocalEnvironment, loadLocalSettings, localDockerEndpoint, prepareLocalSettings, provisioningEnvironment, runtimeText, verifyLocalRuntime } from "../scripts/local-environment.mjs";

async function fixture(context) {
  const root = await mkdtemp(join(tmpdir(), "stride-local-test-"));
  context.after(() => rm(root, { recursive: true, force: true })); return root;
}
// scripts/local-environment.mjs is POSIX-only by design — the guard test below asserts
// it rejects win32. The cases that follow read uid ownership and create symlinks, which
// Windows cannot do without elevation, so they are skipped rather than failing there.
const posixOnly = process.platform === "win32"
  ? { skip: "POSIX-only: local-environment.mjs rejects win32, and these assert uid ownership and symlinks" }
  : {};
test("local setup rejects production credentials, remote Docker and unsupported runtimes", () => {
  for (const environment of [{ NODE_ENV: "production" }, { DATABASE_URL: "remote" }, { RAILWAY_ENVIRONMENT_ID: "production" }, { PGHOST: "remote" }, { STRIDE_GITHUB_APP_PRIVATE_KEY: "private" }]) assert.throws(() => guardLocalEnvironment(environment, "linux", "24.1.0"));
  assert.throws(() => guardLocalEnvironment({}, "win32", "24.1.0"));
  assert.throws(() => guardLocalEnvironment({}, "linux", "22.1.0"));
  assert.doesNotThrow(() => guardLocalEnvironment({ NODE_ENV: "development" }, "linux", "24.1.0"));
  assert.equal(localDockerEndpoint("ssh://server"), false); assert.equal(localDockerEndpoint("tcp://127.0.0.1:2375"), false);
  assert.equal(localDockerEndpoint("unix:///var/run/docker.sock"), true);
});
test("local setup is repeatable, isolates worktrees and separates admin/runtime credentials", posixOnly, async context => {
  const root = await fixture(context); const other = await fixture(context);
  const settings = await prepareLocalSettings(root); const again = await prepareLocalSettings(root);
  assert.deepEqual(settings, again); assert.deepEqual(await loadLocalSettings(root), settings);
  const runtime = await readFile(join(root, ".env.local"), "utf8");
  assert.equal(runtime, runtimeText(settings));
  await verifyLocalRuntime(root, settings);
  for (const value of [settings.adminPassword, settings.ownerPassword, "MIGRATION_DATABASE_URL", "BOOTSTRAP"]) assert.equal(runtime.includes(value), false);
  assert.equal(provisioningEnvironment(settings).MIGRATION_DATABASE_URL.endsWith("/stride_local"), true);
  assert.equal((await lstat(join(root, ".stride-local"))).mode & 0o777, 0o700);
  assert.equal((await lstat(join(root, ".stride-local/settings.json"))).mode & 0o777, 0o600);
  assert.equal((await lstat(join(root, ".env.local"))).mode & 0o777, 0o600);
  const independent = await prepareLocalSettings(other);
  assert.notEqual(independent.project, settings.project); assert.notEqual(independent.runtimePassword, settings.runtimePassword);
  await writeFile(join(other, ".stride-local/settings.json"), JSON.stringify(settings));
  await assert.rejects(() => loadLocalSettings(other));
});
test("existing environment, edited config, links and public credential files are never overwritten", posixOnly, async context => {
  const root = await fixture(context); const settings = await prepareLocalSettings(root);
  const original = await readFile(join(root, ".stride-local/settings.json"));
  await writeFile(join(root, ".env.local"), "DATABASE_URL=existing\n");
  await assert.rejects(() => prepareLocalSettings(root));
  assert.equal(await readFile(join(root, ".env.local"), "utf8"), "DATABASE_URL=existing\n");
  assert.deepEqual(await readFile(join(root, ".stride-local/settings.json")), original);
  await writeFile(join(root, ".env.local"), runtimeText(settings));
  await chmod(join(root, ".stride-local/settings.json"), 0o644); await assert.rejects(() => prepareLocalSettings(root));
  const linked = await fixture(context); await symlink(join(root, ".stride-local"), join(linked, ".stride-local"));
  await assert.rejects(() => prepareLocalSettings(linked));
  const existing = await fixture(context); await writeFile(join(existing, ".env.provision"), "existing config");
  await assert.rejects(() => prepareLocalSettings(existing));
  assert.equal(await readFile(join(existing, ".env.provision"), "utf8"), "existing config");
  const override = await fixture(context); const valid = await prepareLocalSettings(override);
  await writeFile(join(override, ".env.development.local"), "DATABASE_URL=remote");
  await assert.rejects(() => verifyLocalRuntime(override, valid));
});
test("invalid ports do not create local credentials; incomplete setup can resume", posixOnly, async context => {
  const root = await fixture(context);
  for (const options of [{ appPort: 80 }, { dbPort: 65536 }, { appPort: 3100, dbPort: 3100 }, { reset: true }]) await assert.rejects(() => prepareLocalSettings(root, options));
  assert.equal(await loadLocalSettings(root), null);
  await mkdir(join(root, ".stride-local"), { mode: 0o700 });
  const settings = await prepareLocalSettings(root);
  await rm(join(root, ".env.local"));
  assert.deepEqual(await prepareLocalSettings(root), settings);
  await assert.rejects(() => prepareLocalSettings(root, { appPort: settings.appPort + 1 }));
});
