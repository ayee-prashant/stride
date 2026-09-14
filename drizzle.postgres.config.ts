import { defineConfig } from "drizzle-kit";

// Offline generation does not require a production connection string.
export default defineConfig({
  schema: ["./db/postgres-schema.ts", "./db/auth-schema.ts", "./db/productivity-schema.ts", "./db/context-schema.ts", "./db/github-context-schema.ts", "./db/agent-schema.ts", "./db/delivery-schema.ts", "./db/oauth-schema.ts"],
  out: "./drizzle-postgres",
  dialect: "postgresql",
});
