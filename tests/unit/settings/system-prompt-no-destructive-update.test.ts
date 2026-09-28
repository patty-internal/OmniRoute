/**
 * Global System Prompt settings must never be wiped by a partial or
 * client-side-emptied PUT.
 *
 * Reproduces the production incident: the settings tab parsed GET failures as
 * an empty config and its debounced autosave then PUT
 * {enabled:false, prefixPrompt:"", suffixPrompt:""} — updateSettings()
 * replaces the whole `systemPrompt` section, destroying the stored prompts
 * with no way back.
 *
 * Contract:
 *   1. A partial PUT merges over the stored section (never replaces it).
 *   2. A PUT that would empty previously non-empty prompts stashes the
 *      previous section under settings key `systemPromptBackup` (recovery).
 *   3. A normal content update leaves the other field untouched, no backup.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { setupSettingsFixture } from "../_mocks/settings.ts";
import { makeManagementSessionRequest } from "../../helpers/managementSession.ts";

// API-key auth check uses a Redis-backed cache otherwise — disable so the
// management session does not stall on ETIMEDOUT in the local test loop.
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";

const fixture = setupSettingsFixture("system-prompt-no-destructive-update");

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;

const core = await import("../../../src/lib/db/core.ts");
const settingsDb = await import("../../../src/lib/db/settings.ts");
const systemPromptService = await import("@omniroute/open-sse/services/systemPrompt.ts");
const route = await import("../../../src/app/api/settings/system-prompt/route.ts");

const STORED = { enabled: true, prefixPrompt: "BEFORE", suffixPrompt: "AFTER" };

test.beforeEach(async () => {
  await fixture.resetStorage();
  process.env.JWT_SECRET = "test-jwt-secret-system-prompt";
  process.env.INITIAL_PASSWORD = "initial-pass";
  await settingsDb.updateSettings({ systemPrompt: { ...STORED } });
  systemPromptService.setSystemPromptConfig({ ...STORED });
});

test.after(() => {
  core.resetDbInstance();
  fixture.cleanup();
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  if (ORIGINAL_INITIAL_PASSWORD === undefined) delete process.env.INITIAL_PASSWORD;
  else process.env.INITIAL_PASSWORD = ORIGINAL_INITIAL_PASSWORD;
});

async function put(body: unknown): Promise<Response> {
  const request = await makeManagementSessionRequest(
    "http://dashboard.test/api/settings/system-prompt",
    { method: "PUT", body }
  );
  return route.PUT(request);
}

async function storedSection(): Promise<Record<string, unknown> | null> {
  const settings = await settingsDb.getSettings();
  return (settings as { systemPrompt?: Record<string, unknown> }).systemPrompt ?? null;
}

async function backupSection(): Promise<unknown> {
  const settings = await settingsDb.getSettings();
  return (settings as { systemPromptBackup?: unknown }).systemPromptBackup;
}

test("partial PUT merges over the stored section instead of replacing it", async () => {
  const res = await put({ enabled: false });
  assert.equal(res.status, 200);

  assert.deepEqual(await storedSection(), {
    enabled: false,
    prefixPrompt: "BEFORE",
    suffixPrompt: "AFTER",
  });
  assert.deepEqual(systemPromptService.getSystemPromptConfig(), {
    enabled: false,
    prefixPrompt: "BEFORE",
    suffixPrompt: "AFTER",
  });
});

test("a wiping PUT stashes the previous section as systemPromptBackup", async () => {
  const res = await put({ enabled: true, prefixPrompt: "", suffixPrompt: "" });
  assert.equal(res.status, 200);

  assert.deepEqual(await backupSection(), { ...STORED });
  assert.deepEqual(await storedSection(), {
    enabled: true,
    prefixPrompt: "",
    suffixPrompt: "",
  });
});

test("a normal content update keeps the other field and creates no backup", async () => {
  const res = await put({ enabled: true, prefixPrompt: "NEW" });
  assert.equal(res.status, 200);

  assert.deepEqual(await storedSection(), {
    enabled: true,
    prefixPrompt: "NEW",
    suffixPrompt: "AFTER",
  });
  assert.equal(await backupSection(), undefined);
});
