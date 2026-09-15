import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";

const stateFile = ".env.setup.json";
const label = "dev.stride.local-setup";
const image = "postgres:18";
const hexSecret = () => randomBytes(32).toString("hex");
const hasControl = (value: string) => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const fail = (message: string): never => { throw new SetupError(message); };
export class SetupError extends Error {}

export type SetupOptions = { email?: string; name?: string; port?: string; dbPort?: string; skipInstall?: boolean };
export type LocalConfig = {
  version: 1; root: string; id: string; email: string; name: string; port: number; dbPort: number;
  databasePassword: string; runtimePassword: string; authSecret: string; ownerPassword: string;
};
type Environment = Record<string, string | undefined>;
type CommandOptions = { env?: Environment; inherit?: boolean; timeout?: number };
export type Command = (file: string, args: string[], options?: CommandOptions) => { ok: boolean; output: string };

export function commandAt(root: string): Command {
  return (file, args, options = {}) => {
    const result = spawnSync(file, args, { cwd: root, shell: false, windowsHide: true,
      env: (options.env ?? process.env) as NodeJS.ProcessEnv, encoding: "utf8", stdio: options.inherit ? "inherit" : "pipe",
      timeout: options.timeout ?? 20_000, maxBuffer: 1024 * 1024 });
    return { ok: !result.error && result.status === 0, output: result.stdout?.trim() ?? "" };
  };
}

function port(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) fail("Ports must be integers from 1024 to 65535.");
  return Number(value);
}

// Keep generated dotenv values literal in both Node and Next.js (which expands $).
function checkFields(email: string, name: string, appPort: number, dbPort: number): void {
  if (email.length > 254 || hasControl(email) || !/^[^\s@'"`$\\#]+@[^\s@'"`$\\#]+\.[^\s@'"`$\\#]+$/.test(email)) fail("Enter a valid email address without dotenv metacharacters.");
  if (!name || name.length > 100 || hasControl(name) || /['"`$\\]/.test(name)) fail("Enter a name of 1–100 characters without control characters, quotes, $, or backslashes.");
  if (appPort === dbPort) fail("The app and database need different ports.");
}

export function newConfig(root: string, options: SetupOptions): LocalConfig {
  const email = (options.email ?? "").trim().toLowerCase();
  const name = (options.name ?? "").trim();
  const appPort = port(options.port, 3000);
  const dbPort = port(options.dbPort, 5432);
  checkFields(email, name, appPort, dbPort);
  return { version: 1, root, id: randomBytes(16).toString("hex"), email, name, port: appPort, dbPort,
    databasePassword: hexSecret(), runtimePassword: hexSecret(), authSecret: hexSecret(), ownerPassword: hexSecret() };
}

function validateConfig(value: unknown, root: string): LocalConfig {
  if (!value || typeof value !== "object") fail("Local setup state is invalid; existing files were preserved.");
  const config = value as LocalConfig;
  if (config.version !== 1 || config.root !== root || !/^[a-f0-9]{32}$/.test(config.id) ||
      [config.databasePassword, config.runtimePassword, config.authSecret, config.ownerPassword].some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) ||
      typeof config.email !== "string" || typeof config.name !== "string") fail("Local setup state is invalid or belongs to another checkout; existing files were preserved.");
  // Re-derive canonical values without newConfig's id/secret generation: validation has no reason to mint unused secrets.
  const email = config.email.trim().toLowerCase();
  const name = config.name.trim();
  const appPort = port(String(config.port), 3000);
  const dbPort = port(String(config.dbPort), 5432);
  checkFields(email, name, appPort, dbPort);
  if (email !== config.email || name !== config.name) fail("Local setup state is invalid; existing files were preserved.");
  return config;
}

async function readOptional(path: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    // Read through the already-opened handle rather than re-reading by path, and cross-check its
    // identity against a fresh lstat, so a symlink swapped in between the check and the read cannot
    // make this function return the contents of a different file than the one it validated.
    const [opened, current] = await Promise.all([handle.stat(), lstat(path)]);
    if (!opened.isFile() || current.isSymbolicLink() || current.ino !== opened.ino || current.dev !== opened.dev) {
      fail("Setup configuration must be regular files, not links or directories.");
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export function environments(config: LocalConfig) {
  return {
    runtime: {
      APP_URL: `http://127.0.0.1:${config.port}`,
      DATABASE_URL: `postgresql://stride_app:${config.runtimePassword}@127.0.0.1:${config.dbPort}/stride`,
      BETTER_AUTH_SECRET: config.authSecret, STRIDE_ALLOWED_EMAILS: config.email,
    },
    provision: {
      NODE_ENV: "development",
      MIGRATION_DATABASE_URL: `postgresql://postgres:${config.databasePassword}@127.0.0.1:${config.dbPort}/stride`,
      STRIDE_RUNTIME_PASSWORD: config.runtimePassword, STRIDE_ALLOWED_EMAILS: config.email,
      STRIDE_BOOTSTRAP_EMAIL: config.email, STRIDE_BOOTSTRAP_NAME: config.name, STRIDE_BOOTSTRAP_PASSWORD: config.ownerPassword,
    },
  };
}

function checkEnv(text: string, expected: Record<string, string>, forbidden: string[] = []) {
  const actual = parseEnv(text);
  if (Object.entries(expected).some(([key, value]) => actual[key] !== value) || forbidden.some(key => key in actual)) {
    fail("Existing environment configuration differs from local setup. Files were preserved; use docs/LOCAL_SETUP.md to reconcile it.");
  }
}

export async function readConfig(root: string, options: SetupOptions): Promise<LocalConfig | undefined> {
  // These files override or supplement .env.local in Next.js and can silently redirect a local app.
  // (next dev fixes NODE_ENV=development, so this is exactly its env-file precedence chain.)
  const nextEnvNames = [".env", ".env.development", ".env.development.local"];
  const [nextEnvFiles, saved, runtime, provision] = await Promise.all([
    Promise.all(nextEnvNames.map(name => readOptional(join(root, name)))),
    readOptional(join(root, stateFile)),
    readOptional(join(root, ".env.local")),
    readOptional(join(root, ".env.provision")),
  ]);
  if (nextEnvFiles.some(text => text !== undefined)) fail("Existing Next.js environment files need manual setup; see docs/LOCAL_SETUP.md. No files were changed.");
  if (saved === undefined) {
    if (runtime !== undefined || provision !== undefined) fail("Existing environment files are not managed by setup. No files were changed; see docs/LOCAL_SETUP.md.");
    return undefined;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(saved); } catch { fail("Local setup state is unreadable; existing files were preserved."); }
  const config = validateConfig(parsed, root);
  const requested = { email: options.email?.trim().toLowerCase(), name: options.name?.trim(), port: options.port === undefined ? undefined : port(options.port, 3000), dbPort: options.dbPort === undefined ? undefined : port(options.dbPort, 5432) };
  if (Object.entries(requested).some(([key, value]) => value !== undefined && config[key as keyof LocalConfig] !== value)) fail("Setup already exists with different options. Rerun without changed options; existing credentials and data were preserved.");
  const env = environments(config);
  // Any provision-only key (i.e. not also expected in the runtime file) leaking into .env.local is a hazard;
  // derive that set from environments() so it stays in sync automatically as provisioning keys change.
  const provisionOnlyKeys = Object.keys(env.provision).filter(key => !(key in env.runtime));
  if (runtime !== undefined) checkEnv(runtime, env.runtime, provisionOnlyKeys);
  if (provision !== undefined) checkEnv(provision, env.provision);
  return config;
}

export async function saveConfig(config: LocalConfig) {
  // Save recovery state first. A subsequent run can finish a partially written setup.
  const env = environments(config);
  const dotenv = (values: Record<string, string>) => "# Generated by npm run setup. Local secrets: never commit this file.\n" +
    Object.entries(values).map(([key, value]) => `${key}='${value}'`).join("\n") + "\n";
  const files: [string, string][] = [[stateFile, JSON.stringify(config, null, 2) + "\n"], [".env.local", dotenv(env.runtime)], [".env.provision", dotenv(env.provision)]];
  // The existence checks are independent reads and can run concurrently; the writes that follow must
  // stay in this fixed order (state file first) so a crash mid-run leaves a resumable recovery state.
  const existing = await Promise.all(files.map(([name]) => readOptional(join(config.root, name))));
  for (const [index, [name, text]] of files.entries()) {
    if (existing[index] === undefined) await writeFile(join(config.root, name), text, { flag: "wx", mode: 0o600 });
  }
  // A lightweight re-read of just the state file's id is enough to detect a concurrent run; routing
  // this through the full readConfig (env-file checks, validation, secret-free but still redundant
  // re-parsing) would re-read files this call just read or wrote for no additional guarantee.
  const stateText = await readOptional(join(config.root, stateFile));
  let storedId: unknown;
  try { storedId = stateText === undefined ? undefined : JSON.parse(stateText).id; } catch { storedId = undefined; }
  if (storedId !== config.id) fail("Setup configuration changed during this run. Rerun setup before continuing.");
}

export async function assertPortAvailable(value: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new SetupError(`Loopback port ${value} is unavailable. Stop its service or choose a different port on first setup.`)));
    server.listen(value, "127.0.0.1", () => server.close(() => resolve()));
  });
}

export function localDocker(run: Command, environment: Environment = process.env) {
  if (environment.DOCKER_HOST || environment.DOCKER_CONTEXT) fail("Clear DOCKER_HOST and DOCKER_CONTEXT before local setup; select a local Docker context instead.");
  const context = run("docker", ["context", "show"]);
  if (!context.ok || !context.output) fail("Docker is required. Install Docker Desktop, then rerun npm run setup.");
  const endpoint = run("docker", ["context", "inspect", context.output, "--format", "{{.Endpoints.docker.Host}}"]);
  if (!endpoint.ok || !(endpoint.output.startsWith("unix:///") || endpoint.output.startsWith("npipe:////./pipe/"))) fail("Setup requires a local Docker engine using a Unix socket or Windows named pipe.");
  const docker: Command = (_file, args, options) => run("docker", ["--context", context.output, ...args], options);
  if (!docker("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 15_000 }).ok) fail("Docker is not running. Start Docker Desktop (Linux containers), wait for it to be ready, then rerun npm run setup.");
  return docker;
}

export async function startDatabase(config: LocalConfig, docker: Command, wait: (ms: number) => Promise<void> = delay, checkPort = assertPortAvailable) {
  const name = `stride-local-${config.id}`;
  const volume = `${name}-data`;
  const containers = docker("docker", ["container", "ls", "--all", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"]);
  if (!containers.ok) fail("Could not inspect the local database container. Check Docker and rerun setup.");
  if (containers.output === name) {
    // Inspect only ownership and networking; never print or fetch the container's environment.
    const details = docker("docker", ["container", "inspect", name, "--format", '{{json .Config.Labels}}|{{json .HostConfig.PortBindings}}|{{json .Mounts}}|{{.Config.Image}}|{{.State.Running}}']);
    let owned = false; let running = false;
    try {
      const [labels, ports, mounts, containerImage, active] = details.output.split("|");
      const binding = JSON.parse(ports)["5432/tcp"];
      owned = details.ok && JSON.parse(labels)[label] === config.id && containerImage === image &&
        binding?.length === 1 && binding[0].HostIp === "127.0.0.1" && binding[0].HostPort === String(config.dbPort) &&
        JSON.parse(mounts).some((mount: { Name?: string; Destination?: string }) => mount.Name === volume && mount.Destination === "/var/lib/postgresql");
      running = active === "true";
    } catch { /* Fail closed on unexpected Docker output. */ }
    if (!owned) fail("A conflicting database container exists. Setup will not modify it.");
    if (!running && !docker("docker", ["start", name]).ok) fail("Could not restart the database. Check its port and Docker, then rerun setup.");
  } else {
    if (containers.output) fail("Unexpected database container match; no container was changed.");
    await checkPort(config.dbPort);
    const volumes = docker("docker", ["volume", "ls", "--filter", `name=^${volume}$`, "--format", "{{.Name}}"]);
    if (!volumes.ok || (volumes.output && volumes.output !== volume)) fail("Could not inspect the database volume.");
    if (volumes.output === volume) {
      const owner = docker("docker", ["volume", "inspect", volume, "--format", `{{index .Labels "${label}"}}`]);
      if (!owner.ok || owner.output !== config.id) fail("A conflicting database volume exists. Setup will not modify it.");
    } else if (!docker("docker", ["volume", "create", "--label", `${label}=${config.id}`, volume]).ok) fail("Could not create the local database volume.");
    const result = docker("docker", ["run", "--detach", "--name", name, "--label", `${label}=${config.id}`,
      "--publish", `127.0.0.1:${config.dbPort}:5432`, "--mount", `type=volume,source=${volume},target=/var/lib/postgresql`,
      "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=stride", image],
    { env: { ...process.env, POSTGRES_PASSWORD: config.databasePassword }, timeout: 300_000 });
    if (!result.ok) fail("Could not start PostgreSQL 18. Check Docker, image access and the database port, then rerun setup. Saved credentials and volume were retained.");
  }
  for (let attempt = 0; attempt < 45; attempt++) {
    // TCP avoids the image's temporary initialization server, which only uses a Unix socket.
    if (docker("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "stride"], { timeout: 5000 }).ok) return;
    await wait(1000);
  }
  fail("PostgreSQL did not become ready. Check Docker, then rerun setup; its data was retained.");
}

export function provisioningEnvironment(config: LocalConfig, inherited: Environment = process.env): Environment {
  // Do not let shell production URLs, TLS settings or bootstrap variables override local credentials.
  const clean = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^(STRIDE_|DATABASE_|MIGRATION_|BETTER_AUTH_|APP_URL$|NODE_ENV$|NODE_OPTIONS$|RESEND_)/i.test(key)));
  return { ...clean, ...environments(config).provision };
}

export async function setup(rootPath: string, options: SetupOptions, ask: (field: "email" | "name") => Promise<string>, log = console.log) {
  if (Number(process.versions.node.split(".")[0]) !== 24) fail("Stride requires Node.js 24. Install it, then rerun npm run setup.");
  if (process.env.NODE_ENV === "production") fail("This command is for local development. Clear NODE_ENV=production before continuing.");
  const root = await realpath(rootPath);
  const run = commandAt(root);
  const saved = await readConfig(root, options);
  const docker = localDocker(run);
  const config = saved ?? newConfig(root, { ...options, email: options.email ?? await ask("email"), name: options.name ?? await ask("name") });
  if (!saved) await Promise.all([assertPortAvailable(config.port), assertPortAvailable(config.dbPort)]);
  if (!options.skipInstall) {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new SetupError("Run this command through npm run setup so it can install locked dependencies.");
    log("Installing locked dependencies...");
    if (!run(process.execPath, [npmCli, "ci"], { inherit: true, timeout: 600_000 }).ok) fail("Dependency installation failed. Fix the npm error, then rerun setup.");
  } else if (await readOptional(join(root, "node_modules", "pg", "package.json")) === undefined) {
    fail("--skip-install requires dependencies already installed with npm ci.");
  }
  await saveConfig(config);
  log("Starting the local PostgreSQL database...");
  await startDatabase(config, docker);
  log("Applying migrations and provisioning the local account...");
  const provision = run(process.execPath, ["--experimental-strip-types", "scripts/provision-postgres.ts"],
    { env: provisioningEnvironment(config), timeout: 120_000 });
  if (!provision.ok) fail("Database provisioning failed. Saved credentials and data were retained. Check docs/LOCAL_SETUP.md, then rerun setup.");
  log(`Local setup is ready. Run: npm run dev -- --port ${config.port}`);
  log(`Open http://127.0.0.1:${config.port}. Sign in using STRIDE_BOOTSTRAP_EMAIL and STRIDE_BOOTSTRAP_PASSWORD from .env.provision.`);
  log("An existing account keeps its current password. Generated passwords are never printed.");
  log(`To stop the database without deleting data: docker stop stride-local-${config.id}`);
}
