import { spawnSync } from "node:child_process";
const templates = spawnSync(process.execPath, ["scripts/generate-agent-roles.mjs", "--check"], { cwd: new URL("../", import.meta.url), stdio: "inherit" });
if (templates.status !== 0) process.exit(templates.status ?? 1);
const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "tests/domain.test.ts", "tests/repository.test.ts", "tests/collaboration.test.ts", "tests/productivity.test.ts", "tests/productivity-security.test.ts", "tests/context.test.ts", "tests/agent-registry.test.ts", "tests/delivery.test.ts", "tests/github-context-provider.test.ts", "tests/repository-sources.test.ts", "tests/http.test.ts", "tests/client-api.test.ts", "tests/postgres-adapter.test.ts", "tests/deployment-config.test.ts"], { cwd: new URL("../", import.meta.url), stdio: "inherit" });
process.exit(result.status ?? 1);
