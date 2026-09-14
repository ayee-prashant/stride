import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationOrigin, authenticationSettings, allowedEmails, postgresSettings } from "../lib/server/deployment-config.ts";

test("production origins reject redirects, credentials and insecure protocols", () => {
  for (const APP_URL of ["", "http://localhost:3000", "http://stride.example", "https://attacker@stride.example", "https://stride.example/auth", "https://stride.example/?next=attacker", "https://stride.example/#x"]) {
    assert.throws(() => applicationOrigin({ NODE_ENV: "production", APP_URL }), { code: "SETUP_REQUIRED" });
  }
  assert.equal(applicationOrigin({ NODE_ENV: "production", APP_URL: "https://stride.example" }), "https://stride.example");
  assert.equal(applicationOrigin({ NODE_ENV: "development", APP_URL: "http://localhost:3000" }), "http://localhost:3000");
});
test("authentication fails closed without secrets and an explicit email allowlist", () => {
  for (const STRIDE_ALLOWED_EMAILS of ["", "*", "user-login", "owner@example.test,", "a b@example.test", "person@invalid"]) {
    assert.throws(() => allowedEmails({ STRIDE_ALLOWED_EMAILS }), { code: "SETUP_REQUIRED" });
  }
  assert.deepEqual([...allowedEmails({ STRIDE_ALLOWED_EMAILS: "Owner@Example.test,teammate@example.test" })], ["owner@example.test", "teammate@example.test"]);
  assert.throws(() => authenticationSettings({ APP_URL: "https://stride.example", STRIDE_ALLOWED_EMAILS: "owner@example.test" }), { code: "SETUP_REQUIRED" });
  assert.equal(authenticationSettings({ NODE_ENV: "production", APP_URL: "https://stride.example", STRIDE_ALLOWED_EMAILS: "owner@example.test", BETTER_AUTH_SECRET: "isolated-fixture-secret-32-characters-long" }).approvedEmails.has("owner@example.test"), true);
});
test("database URLs cannot weaken TLS, and only nonproduction loopback can use plaintext", () => {
  const DATABASE_URL = "postgresql://fictional:fixture@database.example.test/stride";
  const options = postgresSettings({ NODE_ENV: "production", DATABASE_URL });
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(options.max, 3);
  for (const suffix of ["?sslmode=disable", "?sslmode=no-verify", "?sslmode=require", "?ssl=false", "?sslcert=unexpected"]) {
    assert.throws(() => postgresSettings({ DATABASE_URL: DATABASE_URL + suffix }), { code: "SETUP_REQUIRED" });
  }
  const local = DATABASE_URL.replace("database.example.test", "127.0.0.1");
  assert.equal(postgresSettings({ NODE_ENV: "test", DATABASE_URL: local }).ssl, false);
  assert.deepEqual(postgresSettings({ NODE_ENV: "production", DATABASE_URL: local }).ssl, { rejectUnauthorized: true });
});
