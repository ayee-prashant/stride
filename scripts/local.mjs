import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { availablePort, guardLocalEnvironment, loadLocalSettings, localDockerEndpoint, prepareLocalSettings, verifyLocalRuntime, provisioningEnvironment } from "./local-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const [command, ...args] = process.argv.slice(2);
let dockerEndpoint;
function run(binary, arguments_, environment = {}, timeout = 180_000, failureHint) {
  const result = spawnSync(binary, arguments_, { cwd: root, env: { ...process.env, ...environment }, encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error(failureHint ?? `The ${binary === process.execPath ? "Node" : binary} step failed. Configuration and database data are preserved. See docs/LOCAL_DEVELOPMENT.md for recovery steps.`);
  return result.stdout.trim();
}
function prerequisites() {
  run("git", ["--version"], {}, 10_000, "Install Git and run this command in a reviewed Stride checkout.");
  for (const path of [".stride-local/settings.json", ".env.local"]) run("git", ["check-ignore", "--quiet", path], {}, 10_000, "Private local files must be excluded by the checkout's Git ignore rules before setup can continue.");
  run("docker", ["compose", "version"], {}, 10_000, "Install Docker with Compose v2, then rerun npm run doctor:local.");
  const contextEndpoint = JSON.parse(run("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], {}, 10_000));
  const endpoint = process.env.DOCKER_CONTEXT ? contextEndpoint : process.env.DOCKER_HOST || contextEndpoint;
  if (!localDockerEndpoint(endpoint)) throw new Error("Select a local Unix-socket Docker context. Remote Docker engines are not supported for local setup.");
  dockerEndpoint = endpoint;
  run("docker", ["--host", endpoint, "info", "--format", "{{.ServerVersion}}"], { DOCKER_HOST: "", DOCKER_CONTEXT: "" }, 10_000, "Start your local Docker engine. On Windows, enable its WSL integration and run this command inside WSL.");
}
function compose(settings, arguments_) {
  return run("docker", ["--host", dockerEndpoint, "compose", "--project-name", settings.project, "--file", "infra/local/compose.yaml", ...arguments_], { DOCKER_HOST: "", DOCKER_CONTEXT: "", STRIDE_LOCAL_DB_PASSWORD: settings.adminPassword, STRIDE_LOCAL_DB_PORT: String(settings.dbPort) });
}
try {
  guardLocalEnvironment(process.env);
  if (!["setup", "doctor", "dev", "stop"].includes(command)) throw new Error("Use setup:local, doctor:local, dev:local or stop:local through npm run.");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = { "--app-port": "appPort", "--db-port": "dbPort" }[args[i]];
    if (command !== "setup" || !key || key in options || !/^\d{4,5}$/.test(args[i + 1] ?? "")) throw new Error("Setup accepts --app-port and --db-port once each, followed by a port number.");
    options[key] = Number(args[i + 1]);
  }
  if (command !== "dev") { console.log("Checking Node 24, Git and local Docker Compose…"); prerequisites(); }
  let settings = await loadLocalSettings(root);
  if (command === "setup") {
    settings = await prepareLocalSettings(root, options);
    console.log("Installing the locked dependencies…"); run("npm", ["ci", "--no-audit", "--no-fund"], {}, 300_000);
    console.log("Starting this checkout’s PostgreSQL 18 database…"); compose(settings, ["up", "--detach", "--wait", "--wait-timeout", "90", "postgres"]);
    console.log("Applying committed migrations and provisioning the local owner…"); run(process.execPath, ["--experimental-strip-types", "scripts/provision-postgres.ts"], provisioningEnvironment(settings));
    console.log(`Local setup ready. Run npm run dev:local, then open http://127.0.0.1:${settings.appPort}.\nYour initial login is in .stride-local/LOGIN.txt. Existing passwords are never reset.`);
  } else if (command === "doctor") {
    if (!settings) throw new Error("Prerequisites passed. Local setup has not run in this checkout; use npm run setup:local.");
    await verifyLocalRuntime(root, settings);
    if (!existsSync(new URL("../node_modules/next/package.json", import.meta.url))) throw new Error("Locked dependencies are missing. Run npm ci.");
    const ready = compose(settings, ["ps", "--status", "running", "--services"]);
    if (ready !== "postgres") throw new Error("The local database is stopped. Run npm run setup:local to resume it.");
    compose(settings, ["exec", "-T", "postgres", "pg_isready", "-U", "stride_local", "-d", "stride_local"]);
    console.log(`Local prerequisites, private settings and database readiness passed. App address: http://127.0.0.1:${settings.appPort}.\nThis does not verify migrations, sign-in, email delivery or production readiness. Run npm run verify for code checks.`);
  } else if (command === "stop") {
    if (!settings) throw new Error("No managed local setup exists here.");
    compose(settings, ["stop", "postgres"]); console.log("Local PostgreSQL stopped. Its volume and records are preserved.");
  } else {
    if (!settings) throw new Error("Run npm run setup:local first, or use npm run dev for manually configured development.");
    await verifyLocalRuntime(root, settings);
    await availablePort(settings.appPort);
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(settings.appPort)], { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", () => { console.error("Start failed. Check locked dependencies with npm run doctor:local."); process.exitCode = 1; });
    child.once("exit", code => { process.exitCode = code ?? 1; });
  }
} catch (error) {
  // Never print child output, URLs containing passwords, environment values or raw filesystem errors.
  console.error(error?.code ? "Local setup could not read or create its private files. Existing configuration is preserved." : error.message);
  process.exitCode = 1;
}
