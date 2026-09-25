// OpenCode Go usage shaping: an idle (0%-used) rolling window's `resetsAt` is
// reported by the upstream API as NOW+5h — it slides forward on every poll,
// so every account's card showed the SAME, constantly-changing "expiration".
// Live observations (2026-09-25, four keys fetched within 4 seconds):
//   rolling: {status "ok", percent 0, resetsAt <fetch-time>+5h}  ← all four
//   weekly:  resetsAt next Monday 00:00 UTC                       ← all four
//   monthly: per-account absolute date                            ← distinct
// Shaping rule: a 0%-used window has nothing to reset — null its resetAt so
// the card renders "—" instead of the shared sliding timestamp. A window with
// real usage keeps upstream's resetAt untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { getOpencodeUsage } from "../../open-sse/services/usage/opencode.ts";

function windowPayload(percent: number, resetsAt: string) {
  return {
    usage: {
      rolling: { status: "ok", percent, resetsAt },
      weekly: { status: "ok", percent: 10, resetsAt: "2026-09-28T00:00:00.000Z" },
      monthly: { status: "ok", percent: 20, resetsAt: "2026-10-22T11:08:01.000Z" },
    },
  };
}

test("idle (0%) 5h window gets resetAt nulled — no shared sliding expiry", async () => {
  const sliding = new Date(Date.now() + 5 * 3600_000).toISOString();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(windowPayload(0, sliding)), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const result = (await getOpencodeUsage("conn-idle", "sk-test")) as {
      quotas: Record<string, { resetAt: string | null; used: number }>;
    };
    assert.equal(result.quotas.session.resetAt, null, "idle session resetAt must be null");
    assert.equal(result.quotas.session.used, 0);
    assert.equal(
      result.quotas.weekly.resetAt,
      "2026-09-28T00:00:00.000Z",
      "non-zero weekly reset stays authoritative"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("active (>0%) 5h window keeps upstream's resetAt", async () => {
  const real = "2026-09-25T14:00:00.000Z";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(windowPayload(42, real)), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const result = (await getOpencodeUsage("conn-active", "sk-test")) as {
      quotas: Record<string, { resetAt: string | null; used: number }>;
    };
    assert.equal(result.quotas.session.resetAt, real);
    assert.ok(Math.abs(result.quotas.session.used - 42 * 0.12) < 0.01);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
