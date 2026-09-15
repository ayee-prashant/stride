import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { assertPortAvailable, environments, localDocker, newConfig, provisioningEnvironment, readConfig, saveConfig, startDatabase, type Command } from "../scripts/local-setup.ts";

const input = { email: "Owner@Example.test", name: "Local Test Owner" };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "stride-setup-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("setup generates independent secrets and separates web and provisioning credentials", () => {
  const config = newConfig("fixture", input);
  const env = environments(config);
  assert.equal(config.email, "owner@example.test");
  assert.equal(new Set([config.runtimePassword, config.databasePassword, config.ownerPassword, config.authSecret]).size, 4);
  assert.notEqual(newConfig("fixture", input).id, config.id);
  for (const secret of [config.runtimePassword, config.databasePassword, config.ownerPassword, config.authSecret]) assert.match(secret, /^[a-f0-9]{64}$/);
  assert.equal(new URL(env.runtime.DATABASE_URL).username, "stride_app");
  assert.equal(new URL(env.provision.MIGRATION_DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(JSON.stringify(env.runtime).includes(config.databasePassword), false);
  assert.equal(JSON.stringify(env.runtime).includes(config.ownerPassword), false);
});

test("setup rejects malformed account input, dotenv injection and conflicting ports", () => {
  for (const email of ["", "not-email", "user@example.test\nEVIL=1", "user\0@example.test", "user$ENV@example.test", "user'@example.test"]) assert.throws(() => newConfig("fixture", { ...input, email }));
  for (const name of ["", "A\nB", "A\0B", "'quoted'", "$SECRET", "x".repeat(101)]) assert.throws(() => newConfig("fixture", { ...input, name }));
  for (const port of ["0", "80", "65536", "3000.5", "3e3", "3000;command"]) assert.throws(() => newConfig("fixture", { ...input, port }));
  assert.throws(() => newConfig("fixture", { ...input, port: "5432" }));
});

test("setup reruns preserve all config bytes and optional runtime settings", async t => {
  const root = await fixture(t);
  const config = newConfig(root, input);
  await saveConfig(config);
  const runtimePath = join(root, ".env.local");
  await writeFile(runtimePath, await readFile(runtimePath, "utf8") + "\nSTRIDE_S3_REGION='local'\n");
  const files = [".env.setup.json", ".env.local", ".env.provision"];
  const before = await Promise.all(files.map(name => readFile(join(root, name), "utf8")));
  assert.deepEqual(await readConfig(root, input), config);
  await saveConfig(config);
  assert.deepEqual(await Promise.all(files.map(name => readFile(join(root, name), "utf8"))), before);
  assert.deepEqual(parseEnv(before[2]), environments(config).provision);
});

test("setup resumes an interrupted environment write using the original secrets", async t => {
  const root = await fixture(t);
  const config = newConfig(root, input);
  await writeFile(join(root, ".env.setup.json"), JSON.stringify(config));
  const recovered = await readConfig(root, {});
  assert.deepEqual(recovered, config);
  await saveConfig(recovered!);
  assert.equal(parseEnv(await readFile(join(root, ".env.local"), "utf8")).BETTER_AUTH_SECRET, config.authSecret);
});

test("setup preserves unmanaged, copied, and conflicting environments", async t => {
  const root = await fixture(t);
  const local = join(root, ".env.local");
  await writeFile(local, "DATABASE_URL=existing\n");
  await assert.rejects(readConfig(root, {}), /not managed/);
  assert.equal(await readFile(local, "utf8"), "DATABASE_URL=existing\n");
  await rm(local);
  const config = newConfig(root, input);
  await saveConfig(config);
  await assert.rejects(readConfig(root, { email: "another@example.test" }), /different options/);
  await assert.rejects(readConfig(root, { dbPort: "5544" }), /different options/);
  await writeFile(join(root, ".env.setup.json"), JSON.stringify({ ...config, root: "another-checkout" }));
  await assert.rejects(readConfig(root, {}), /another checkout/);
});

test("setup rejects environment overrides and remote URLs without rewriting files", async t => {
  const root = await fixture(t);
  const config = newConfig(root, input);
  await saveConfig(config);
  await writeFile(join(root, ".env.development.local"), "DATABASE_URL=remote\n");
  await assert.rejects(readConfig(root, {}), /manual setup/);
  await rm(join(root, ".env.development.local"));
  const path = join(root, ".env.local");
  const text = await readFile(path, "utf8");
  await writeFile(path, text + "DATABASE_URL=postgresql://admin:password@remote.example/production\n");
  await assert.rejects(readConfig(root, {}), /differs/);
  await writeFile(path, text + "MIGRATION_DATABASE_URL=admin\n");
  await assert.rejects(readConfig(root, {}), /differs/);
});

test("provisioning discards inherited production and bootstrap settings", () => {
  const config = newConfig("fixture", input);
  const env = provisioningEnvironment(config, { PATH: "safe", NODE_ENV: "production", DATABASE_URL: "remote", DATABASE_CA_CERT: "other", MIGRATION_DATABASE_URL: "remote", STRIDE_BOOTSTRAP_PASSWORD: "other", NODE_OPTIONS: "--env-file=production", RESEND_API_KEY: "external" });
  assert.equal(env.PATH, "safe");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.RESEND_API_KEY, undefined);
  assert.equal(env.STRIDE_BOOTSTRAP_PASSWORD, config.ownerPassword);
  assert.match(env.MIGRATION_DATABASE_URL!, /@127\.0\.0\.1:5432\/stride$/);
});

test("setup only uses a pinned local Docker context and handles a stopped daemon", () => {
  const calls: string[][] = [];
  const run: Command = (_file, args) => { calls.push(args); return { ok: true, output: args[1] === "show" ? "desktop-linux" : args[1] === "inspect" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "24" }; };
  localDocker(run, {})("docker", ["version"]);
  assert.deepEqual(calls.at(-1), ["--context", "desktop-linux", "version"]);
  assert.throws(() => localDocker(run, { DOCKER_HOST: "tcp://remote:2375" }), /Clear DOCKER_HOST/);
  assert.throws(() => localDocker((_file, args) => ({ ok: true, output: args[1] === "show" ? "remote" : "ssh://remote" }), {}), /local Docker engine/);
  assert.throws(() => localDocker((_file, args) => ({ ok: true, output: args[1] === "show" ? "remote" : "npipe:////remote/pipe/docker" }), {}), /local Docker engine/);
  assert.throws(() => localDocker((_file, args) => ({ ok: !args.includes("info"), output: args[1] === "show" ? "default" : "unix:///var/run/docker.sock" }), {}), /not running/);
});

test("new database uses loopback, persistent PG18 volume and no secret command arguments", async () => {
  const config = newConfig("fixture", input);
  const calls: { args: string[]; env?: Record<string, string | undefined> }[] = [];
  const docker: Command = (_file, args, options) => { calls.push({ args, env: options?.env }); return { ok: true, output: "" }; };
  await startDatabase(config, docker, async () => {}, async () => {});
  const create = calls.find(call => call.args[0] === "run")!;
  assert.ok(create.args.includes("127.0.0.1:5432:5432"));
  assert.ok(create.args.some(arg => arg.endsWith("target=/var/lib/postgresql")));
  assert.equal(create.args.at(-1), "postgres:18");
  assert.equal(create.args.join(" ").includes(config.databasePassword), false);
  assert.equal(create.env?.POSTGRES_PASSWORD, config.databasePassword);
  assert.ok(calls.at(-1)!.args.includes("127.0.0.1"));
});

test("database restart preserves its volume and never replaces conflicting containers", async () => {
  const config = newConfig("fixture", input);
  const name = `stride-local-${config.id}`;
  let owner = config.id;
  const calls: string[][] = [];
  const docker: Command = (_file, args) => {
    calls.push(args);
    if (args[0] === "container" && args[1] === "ls") return { ok: true, output: name };
    if (args[1] === "inspect") return { ok: true, output: [JSON.stringify({ "dev.stride.local-setup": owner }), JSON.stringify({ "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }] }), JSON.stringify([{ Name: `${name}-data`, Destination: "/var/lib/postgresql" }]), "postgres:18", "false"].join("|") };
    return { ok: true, output: "" };
  };
  await startDatabase(config, docker, async () => {}, async () => { assert.fail("existing database should not be recreated"); });
  assert.ok(calls.some(args => args[0] === "start"));
  assert.equal(calls.some(args => ["run", "rm", "volume"].includes(args[0])), false);
  owner = "another-owner"; calls.length = 0;
  await assert.rejects(startDatabase(config, docker), /conflicting database container/);
  assert.equal(calls.some(args => args[0] === "start"), false);
});

test("database volume conflicts, creation errors and readiness timeouts stop setup", async () => {
  const config = newConfig("fixture", input);
  const volume = `stride-local-${config.id}-data`;
  const collision: Command = (_file, args) => ({ ok: true, output: args[0] === "volume" ? (args[1] === "ls" ? volume : "other") : "" });
  await assert.rejects(startDatabase(config, collision, async () => {}, async () => {}), /conflicting database volume/);
  const failed: Command = (_file, args) => ({ ok: args[0] !== "run", output: "" });
  await assert.rejects(startDatabase(config, failed, async () => {}, async () => {}), /Could not start PostgreSQL/);
  let probes = 0;
  const unready: Command = (_file, args) => { if (args[0] === "exec") probes++; return { ok: args[0] !== "exec", output: "" }; };
  await assert.rejects(startDatabase(config, unready, async () => {}, async () => {}), /did not become ready/);
  assert.equal(probes, 45);
});

test("occupied loopback ports produce a useful recovery error", async t => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await assert.rejects(assertPortAvailable(address.port), /unavailable/);
});
