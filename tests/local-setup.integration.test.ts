import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { commandAt, localDocker, readConfig, setup } from "../scripts/local-setup.ts";

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>(resolve => server.close(() => resolve()));
  return String(address.port);
}

test("real local setup provisions PG18 and preserves credentials and data after restart", { timeout: 420_000 }, async t => {
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const docker = localDocker(commandAt(repository));
  const work = join(repository, "work");
  await mkdir(work, { recursive: true });
  const root = await realpath(await mkdtemp(join(work, "setup-integration-")));
  let database: Pool | undefined;
  let name: string | undefined;
  t.after(async () => {
    await database?.end();
    // Only resources identified by this new fixture's cryptographically random ID.
    if (name) {
      assert.match(name, /^stride-local-[a-f0-9]{32}$/);
      const containers = docker("docker", ["container", "ls", "--all", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"]);
      assert.equal(containers.ok, true);
      if (containers.output === name) assert.equal(docker("docker", ["container", "rm", "--force", name]).ok, true);
      const volumes = docker("docker", ["volume", "ls", "--filter", `name=^${name}-data$`, "--format", "{{.Name}}"]);
      assert.equal(volumes.ok, true);
      if (volumes.output === `${name}-data`) assert.equal(docker("docker", ["volume", "rm", `${name}-data`]).ok, true);
    }
    assert.equal(root.startsWith(await realpath(work)), true);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "scripts", "provision-postgres.ts"), `import ${JSON.stringify(pathToFileURL(join(repository, "scripts", "provision-postgres.ts")).href)};\n`);
  await cp(join(repository, "drizzle-postgres"), join(root, "drizzle-postgres"), { recursive: true });
  await symlink(join(repository, "node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const logs: string[] = [];
  const ask = async () => { throw new Error("The fixture must not prompt"); };
  const options = { email: "local-fixture@stride.invalid", name: "Isolated Setup Owner", port: await freePort(), dbPort: await freePort(), skipInstall: true };
  if (options.port === options.dbPort) options.dbPort = await freePort();
  try {
    await setup(root, options, ask, message => logs.push(message));
  } finally {
    const saved = await readConfig(root, {});
    if (saved) name = `stride-local-${saved.id}`;
  }
  const config = (await readConfig(root, {}))!;
  assert.ok(config);
  const connectionString = `postgresql://postgres:${config.databasePassword}@127.0.0.1:${config.dbPort}/stride`;
  database = new Pool({ connectionString, max: 1 });
  const owner = await database.query("SELECT id,password FROM auth_accounts WHERE provider_id='credential'");
  assert.equal(owner.rowCount, 1);
  assert.equal(await verifyPassword({ hash: owner.rows[0].password, password: config.ownerPassword }), true);
  const changedHash = await hashPassword("fictional-changed-local-password");
  await database.query("UPDATE auth_accounts SET password=$1 WHERE id=$2", [changedHash, owner.rows[0].id]);
  await database.query("CREATE TABLE setup_recovery_probe (value text NOT NULL)");
  await database.query("INSERT INTO setup_recovery_probe VALUES ('preserved')");
  const files = [".env.local", ".env.provision", ".env.setup.json"];
  const before = await Promise.all(files.map(file => readFile(join(root, file), "utf8")));
  await database.end(); database = undefined;
  assert.equal(docker("docker", ["stop", name!], { timeout: 30_000 }).ok, true);
  await setup(root, { skipInstall: true }, ask, message => logs.push(message));
  assert.deepEqual(await Promise.all(files.map(file => readFile(join(root, file), "utf8"))), before);
  database = new Pool({ connectionString, max: 1 });
  assert.equal((await database.query("SELECT value FROM setup_recovery_probe")).rows[0].value, "preserved");
  assert.equal((await database.query("SELECT password FROM auth_accounts WHERE id=$1", [owner.rows[0].id])).rows[0].password, changedHash);
  const role = (await database.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='stride_app'")).rows[0];
  assert.deepEqual(Object.values(role), [false, false, false, false, false]);
  const runtime = new Pool({ connectionString: connectionString.replace(`postgres:${config.databasePassword}`, `stride_app:${config.runtimePassword}`), max: 1 });
  try { assert.equal((await runtime.query("SELECT value FROM setup_recovery_probe")).rows[0].value, "preserved"); }
  finally { await runtime.end(); }
  for (const secret of [config.databasePassword, config.runtimePassword, config.authSecret, config.ownerPassword]) assert.equal(logs.join("\n").includes(secret), false);
});
