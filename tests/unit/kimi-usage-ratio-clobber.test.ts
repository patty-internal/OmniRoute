// Kimi usage parsing: the membership-ratio (usages.limit_*.used_ratio) block
// must NOT overwrite the authoritative windows (usage / limits[]) — live
// payload observed 2026-09-25 on api.kimi.com/coding/v1/usages:
//   usage.used = 66/100 (authoritative, real consumption)
//   usages.limit_7d.used_ratio = 0 (stuck at zero for API-key sessions)
// The old order applied membership ratios LAST, clobbering code_7d back to
// 0 used / 100% remaining — the dashboard then showed "100% remaining,
// always" while the account was two-thirds through its window.
import test from "node:test";
import assert from "node:assert/strict";

const kimiPayload = {
  usage: {
    limit: "100",
    used: "66",
    remaining: "34",
    resetTime: "2026-09-25T11:00:03.450452Z",
  },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: { limit: "100", remaining: "100", resetTime: "2026-09-25T06:00:03.450452Z" },
    },
  ],
  usages: {
    limit_5h: { used_ratio: 0, reset_time: "2026-09-25T06:00:02Z" },
    limit_7d: { used_ratio: 0, reset_time: "2026-09-25T11:00:02Z" },
  },
};

test("membership ratios must not overwrite the authoritative usage window", async () => {
  const { getKimiUsage } = await import("../../open-sse/services/usage/kimi.ts");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(kimiPayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const result = (await getKimiUsage(undefined, "kimi-test-key", {})) as {
      quotas?: Record<string, { used: number; total: number }>;
    };
    const code7d = result.quotas?.code_7d;
    assert.ok(code7d, "code_7d quota missing");
    assert.equal(code7d.used, 66, "code_7d.used must keep the authoritative usage.used=66");
    assert.equal(code7d.total, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("membership ratios still fill windows the count paths did not produce", async () => {
  const { getKimiUsage } = await import("../../open-sse/services/usage/kimi.ts");

  const noCountPaths = {
    // No `usage` record and an empty limits[] — only usages.limit_* remain.
    usage: undefined,
    limits: [],
    usages: {
      limit_5h: { used_ratio: 0.25, reset_time: "2026-09-25T06:00:02Z" },
      limit_7d: { used_ratio: 0.4, reset_time: "2026-09-25T11:00:02Z" },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(noCountPaths), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const result = (await getKimiUsage(undefined, "kimi-test-key", {})) as {
      quotas?: Record<string, { used: number }>;
    };
    assert.equal(result.quotas?.code_7d?.used, 40, "fallback ratio window (0.4) still applies");
    assert.equal(result.quotas?.code_5h?.used, 25, "fallback ratio window (0.25) still applies");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
