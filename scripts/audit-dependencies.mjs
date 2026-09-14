import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
let failed = false;
for (const production of [true, false]) {
  const result = spawnSync("npm", ["audit", "--json", ...(production ? ["--omit=dev"] : [])], { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(result.stdout); if (report.error || !report.metadata?.vulnerabilities) throw new Error(); }
  catch { console.error(JSON.stringify({ event: "dependency_audit_unavailable", scope: production ? "production" : "all" })); process.exit(1); }
  writeFileSync(`audit-${production ? "production" : "all"}.json`, JSON.stringify(report, null, 2));
  const vulnerabilities = Object.values(report.vulnerabilities ?? {}).map(value => ({ name: value.name, severity: value.severity, direct: value.isDirect, fixAvailable: value.fixAvailable }));
  console.log(JSON.stringify({ event: "dependency_audit", checkedAt: new Date().toISOString(), scope: production ? "production" : "all", counts: report.metadata.vulnerabilities, vulnerabilities }));
  if (production && (report.metadata.vulnerabilities.high || report.metadata.vulnerabilities.critical)) failed = true;
}
if (failed) process.exitCode = 1;
