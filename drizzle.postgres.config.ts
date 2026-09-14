import { defineConfig } from "drizzle-kit";

// Offline generation does not require a production connection string.
export default defineConfig({
  schema: ["./db/postgres-schema.ts", "./db/auth-schema.ts"],
  out: "./drizzle-postgres",
  dialect: "postgresql",
});
