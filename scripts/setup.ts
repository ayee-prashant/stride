import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { setup, SetupError } from "./local-setup.ts";

try {
  let values;
  try {
    ({ values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" },
      port: { type: "string" }, "db-port": { type: "string" }, "skip-install": { type: "boolean" }, help: { type: "boolean" } } }));
  } catch { throw new SetupError("Invalid setup options. Run npm run setup -- --help."); }
  if (values.help) {
    console.log("Usage: npm run setup -- [--email you@example.com] [--name \"Your Name\"] [--port 3000] [--db-port 5432] [--skip-install]");
    console.log("Requires Node 24 and a running local Docker engine. Missing email/name are prompted in a terminal.");
    console.log("Generates a private initial password in .env.provision. Existing local credentials and database data are preserved.");
  } else {
    const ask = async (field: "email" | "name") => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SetupError("Noninteractive setup requires --email and --name. Run npm run setup -- --help.");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try { return await prompt.question(field === "email" ? "Local sign-in email: " : "Display name: "); }
      finally { prompt.close(); }
    };
    await setup(fileURLToPath(new URL("../", import.meta.url)), { email: values.email, name: values.name,
      port: values.port, dbPort: values["db-port"], skipInstall: values["skip-install"] }, ask);
  }
} catch (error) {
  // Filesystem and subprocess errors can contain secrets. Only authored diagnostics are safe to print.
  console.error(error instanceof SetupError ? error.message : "Local setup failed. Check file access and prerequisites in docs/LOCAL_SETUP.md; existing files were preserved.");
  process.exitCode = 1;
}
