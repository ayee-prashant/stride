import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { checkSetup, setup, SetupError } from "./local-setup.ts";

const helpText = `Usage: npm run setup -- [options]

Prepares a local PostgreSQL 18 environment for Stride: installs the locked
dependency tree, generates private credentials, starts a Docker-backed
database, and provisions the schema and your account. Requires Node 24 and
a running local Docker engine. Reruns are safe and preserve existing data.

Options:
  --email <address>    Local sign-in email. Prompted interactively if omitted.
  --name <text>        Display name. Prompted interactively if omitted.
  --port <1024-65535>  App port (default 3000). Only used on the first run.
  --db-port <port>     Database port (default 5432). Only used on the first run.
  --skip-install       Reuse an existing npm ci install instead of reinstalling.
  --check              Verify prerequisites (Node, Docker, ports) only; makes
                        no changes: no install, no files written, nothing started.
  --json                Print one JSON result line on stdout; human-readable
                        progress and errors go to stderr instead. For agents
                        and scripts. Combine with --help for a JSON option list.
  --help                Show this message.

Examples:
  npm run setup                                          Interactive, for a human at a terminal.
  npm run setup -- --check --json                         Agent preflight: is this checkout ready?
  npm run setup -- --email a@b.test --name Dev --json     Agent or CI: fully noninteractive.

Exit code 0 on success, 1 on any failure (including a failed --check).
Managed files: .env.local, .env.provision, .env.setup.json. See docs/LOCAL_SETUP.md.`;

// A machine-readable mirror of the same contract, for an agent introspecting this command
// before invoking it: npm run setup -- --help --json
const helpSchema = {
  command: "npm run setup --",
  options: {
    email: "string: local sign-in email; prompted if omitted at an interactive terminal",
    name: "string: display name; prompted if omitted at an interactive terminal",
    port: "string: app port 1024-65535, default 3000; only used on the first run",
    "db-port": "string: database port 1024-65535, default 5432; only used on the first run",
    "skip-install": "boolean: skip npm ci; requires dependencies already installed",
    check: "boolean: read-only preflight (Node, Docker, ports); no side effects",
    json: "boolean: one JSON result line on stdout; progress and errors go to stderr",
    help: "boolean: show help; combine with json for this schema",
  },
  noninteractiveRequires: ["email", "name"],
  exitCodes: { "0": "success", "1": "failure; see stderr, or the error field in the JSON result" },
  managedFiles: [".env.local", ".env.provision", ".env.setup.json"],
};

let json = false;
let mode: "check" | "setup" = "setup";
try {
  let values;
  try {
    ({ values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" },
      port: { type: "string" }, "db-port": { type: "string" }, "skip-install": { type: "boolean" },
      check: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean" } } }));
  } catch { throw new SetupError("Invalid setup options. Run npm run setup -- --help."); }
  json = Boolean(values.json);
  mode = values.check ? "check" : "setup";

  if (values.help) {
    console.log(json ? JSON.stringify(helpSchema, null, 2) : helpText);
  } else {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const options = { email: values.email, name: values.name, port: values.port, dbPort: values["db-port"], skipInstall: values["skip-install"] };

    if (values.check) {
      const result = await checkSetup(root, options);
      if (json) console.log(JSON.stringify({ ok: true, mode: "check", ...result }));
      else console.log(`Ready: ${result.state === "existing" ? "an existing local setup was found" : "this is a fresh checkout"}. Docker is reachable. Setup would use ${result.appUrl} (database port ${result.dbPort}).`);
    } else {
      const ask = async (field: "email" | "name") => {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SetupError("Noninteractive setup requires --email and --name. Run npm run setup -- --help.");
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try { return await prompt.question(field === "email" ? "Local sign-in email: " : "Display name: "); }
        finally { prompt.close(); }
      };
      // In --json mode, human progress lines go to stderr so stdout carries only the final result line.
      const log = json ? (message: string) => console.error(message) : console.log;
      const config = await setup(root, options, ask, log);
      if (json) {
        console.log(JSON.stringify({ ok: true, mode: "setup", root: config.root, appUrl: `http://127.0.0.1:${config.port}`,
          port: config.port, dbPort: config.dbPort, email: config.email, name: config.name,
          container: `stride-local-${config.id}`,
          envFiles: { runtime: ".env.local", provision: ".env.provision", state: ".env.setup.json" } }));
      }
    }
  }
} catch (error) {
  // Filesystem and subprocess errors can contain secrets. Only authored diagnostics are safe to print.
  const message = error instanceof SetupError ? error.message : "Local setup failed. Check file access and prerequisites in docs/LOCAL_SETUP.md; existing files were preserved.";
  if (json) console.log(JSON.stringify({ ok: false, mode, error: message }));
  else console.error(message);
  process.exitCode = 1;
}
