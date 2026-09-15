import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.length > 2 || process.versions.node.split(".")[0] !== "24") {
  console.error("Use npm run verify with Node 24. No production or database target is accepted."); process.exit(1);
}
if (!existsSync(new URL("../node_modules/typescript/package.json", import.meta.url))) {
  console.error("Install the committed dependencies with npm ci first."); process.exit(1);
}
for (const step of ["test", "typecheck", "lint", "build"]) {
  console.log(`Checking ${step}…`);
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", step], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) { console.error(`${step} failed. Later checks were not run.`); process.exit(result.status ?? 1); }
}
console.log("Passed: unit/contract tests, typecheck, lint and production build.\nPostgreSQL integration, browser flows, dependency audit and restore verification remain separate CI release gates. This command does not approve or deploy a release.");
