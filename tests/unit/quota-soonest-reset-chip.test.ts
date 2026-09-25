// Soonest-reset header chip (2026-09 quota page redesign): expiration must be
// scannable across a grid of cards. Pins the shared pure helpers — soonest
// future reset selection (past/absent resets ignored), countdown presence,
// and the urgency buckets (<1h critical red, <6h warning amber, else calm).
import test from "node:test";
import assert from "node:assert/strict";
import {
  getSoonestResetInfo,
  getNextResetSummary,
  resetUrgency,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils";

function inMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

test("getSoonestResetInfo — picks the soonest FUTURE reset, ignoring past and absent", () => {
  const info = getSoonestResetInfo([
    { name: "a", resetAt: null },
    { name: "b", resetAt: inMs(2 * 3600_000) },
    { name: "c", resetAt: inMs(30 * 60_000) },
    { name: "d", resetAt: new Date(Date.now() - 3600_000).toISOString() }, // past
  ]);
  assert.ok(info);
  assert.equal(info.urgency, "critical", "30 minutes out is critical");
  assert.ok(info.countdown.length > 0);
});

test("getSoonestResetInfo — null when nothing has a future reset", () => {
  assert.equal(getSoonestResetInfo([]), null);
  assert.equal(getSoonestResetInfo([{ name: "a", resetAt: null }]), null);
  assert.equal(getSoonestResetInfo([{ name: "a", resetAt: "2020-01-01T00:00:00Z" }]), null);
  assert.equal(getSoonestResetInfo(undefined), null);
});

test("resetUrgency — threshold buckets", () => {
  assert.equal(resetUrgency(59 * 60_000), "critical");
  assert.equal(resetUrgency(61 * 60_000), "warning");
  assert.equal(resetUrgency(5 * 3600_000 + 60_000), "warning");
  assert.equal(resetUrgency(7 * 3600_000), "calm");
});

test("getNextResetSummary — delegates to the shared info (back-compat string)", () => {
  assert.equal(getNextResetSummary([{ name: "a", resetAt: inMs(90 * 60_000) }]), "1h 30m");
  assert.equal(getNextResetSummary([{ name: "a", resetAt: null }]), null);
});
