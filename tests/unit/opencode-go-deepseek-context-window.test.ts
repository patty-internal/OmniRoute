import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The opencode-go provider-wide defaultContextLength is 200000, but the
// DeepSeek V4 family it serves declares a 1M window (models.dev + gateway).
// The static registry must carry the per-model window, or the final
// context gate in chatCore rejects large requests with
// context_length_exceeded at 200k while clients advertise 1M.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-opencode-go-deepseek-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

const { getTokenLimit } = await import("../../open-sse/services/contextManager.ts");
const { getResolvedModelCapabilities } = await import("../../src/lib/modelCapabilities.ts");
const core = await import("../../src/lib/db/core.ts");

test.after(() => {
  core.resetDbInstance();
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("opencode-go deepseek v4 family resolves the declared 1M window", () => {
  const cases: Array<[string, number]> = [
    ["deepseek-v4.1-flash", 1_000_000],
    ["deepseek-v4-pro", 1_000_000],
    ["deepseek-v4-flash", 1_000_000],
  ];
  for (const [model, expected] of cases) {
    assert.equal(
      getTokenLimit("opencode-go", model),
      expected,
      `getTokenLimit(opencode-go, ${model})`
    );
  }
});

test("opencode-go deepseek-v4.1-flash capability contextWindow matches the limit", () => {
  const caps = getResolvedModelCapabilities("opencode-go/deepseek-v4.1-flash");
  assert.equal(caps.contextWindow, 1_000_000);
});
