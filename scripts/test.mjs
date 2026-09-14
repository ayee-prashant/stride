import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "tests/domain.test.ts", "tests/repository.test.ts", "tests/http.test.ts", "tests/client-api.test.ts", "tests/postgres-adapter.test.ts"], { cwd: new URL("../", import.meta.url), stdio: "inherit" });
process.exit(result.status ?? 1);
