// Quota-card ordering stability: within a provider group, cards sorted by
// getSoonestResetMs flipped positions on every refresh because the opencode
// upstream reports every idle 5h window as NOW+5h (second-level jitter per
// fetch). The operator saw accounts "swap usage with each other" when only
// the card ORDER changed. Fix: compare reset times at MINUTE granularity in
// sortProviderConnectionsByPriority so sub-minute jitter cannot reorder cards.
import test from "node:test";

import assert from "node:assert/strict";
import { sortProviderConnectionsByPriority } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaCardGrid.tsx";

function conn(id: string, name: string) {
  return { id, name, provider: "opencode-go", isActive: true };
}

function quota(used: number, resetAt: string | null) {
  return {
    quotas: [
      {
        name: "session",
        used,
        total: 30,
        resetAt,
        remainingPercentage: 100 - (used / 30) * 100,
      },
    ],
  };
}

test("sub-minute reset jitter must not reorder same-status cards", () => {
  // Both accounts idle (0 used): resets differ by 2 SECONDS only — the exact
  // production shape after a bulk refresh. Order must fall through to the
  // stable name comparison, not flip with the jitter.
  // Anchor 10s into a minute so base and base+2s can never straddle the
  // minute boundary the sort rounds to.
  const base = Math.floor((Date.now() + 5 * 3600_000) / 60_000) * 60_000 + 10_000;
  const a = conn("aaa", "alpha");
  const b = conn("bbb", "beta");
  // alpha's jitter is LATER — the buggy sort would put beta first purely on
  // those 2 seconds of fetch-order noise.
  const data = {
    aaa: quota(0, new Date(base + 2000).toISOString()),
    bbb: quota(0, new Date(base).toISOString()),
  };

  const first = sortProviderConnectionsByPriority([a, b], data).map((c) => c.name);
  const second = sortProviderConnectionsByPriority([b, a], data).map((c) => c.name);

  assert.deepEqual(first, ["alpha", "beta"], "name-stable order (alpha first)");
  assert.deepEqual(second, ["alpha", "beta"], "input order must not change the result");
});

test("a genuinely sooner reset (>= 1 minute) still wins", () => {
  const base = Date.now() + 3600_000;
  const a = conn("aaa", "alpha"); // resets in 30 min
  const b = conn("bbb", "beta"); // resets in 2 h
  const data = {
    aaa: quota(10, new Date(base - 30 * 60_000).toISOString()),
    bbb: quota(10, new Date(base + 60 * 60_000).toISOString()),
  };
  const order = sortProviderConnectionsByPriority([b, a], data).map((c) => c.name);
  assert.deepEqual(order, ["alpha", "beta"], "sooner-reset account sorts first");
});
