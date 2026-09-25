// Unified MagicGrid quota board (2026-09 redesign).
//
// Operator direction: stop grouping cards into per-provider expandable
// sections — ONE flat board where every connection (any provider, any
// account count) is the same fixed-width card, laid out by magic-grid
// (https://github.com/e-oj/Magic-Grid) shortest-column-first. Provider
// identity lives on the card (icon + label + plan badge), so nothing is
// lost by dropping the section headers.
//
// These guards pin the new architecture at the three seams that matter:
//
// 1. NO per-provider grouping markup survives in QuotaCardGrid (no
//    <details>/<summary> sections, no group headers) — the whole point of
//    the redesign.
// 2. Mobile (#7072 guarantee, new mechanism): card wrappers are `w-full`
//    at the base breakpoint, which makes MagicGrid compute exactly one
//    column on phones (colWidth = container width), and widen to a fixed
//    sm: track >= 200px so two never fit on a phone.
// 3. Density (#6815 guarantee, new mechanism): with the sm: track width and
//    the configured gutter, a 1200px container yields >= 2 columns.
// 4. MagicGrid wiring: `static: true` + own observers, and listen() is
//    never called (it leaks an unremovable window resize listener).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sortProviderConnectionsByPriority } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaCardGrid";

const COMPONENT_PATH = path.resolve(
  import.meta.dirname,
  "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaCardGrid.tsx"
);

function parseSource(sourcePath: string): ts.SourceFile {
  return ts.createSourceFile(
    sourcePath,
    fs.readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
}

function collectStringLiterals(node: ts.Node, out: string[] = []): string[] {
  if (ts.isStringLiteral(node)) out.push(node.text);
  // forEachChild STOPS on a truthy visitor return — the callback must be void.
  ts.forEachChild(node, (child) => {
    collectStringLiterals(child, out);
  });
  return out;
}

const source = parseSource(COMPONENT_PATH);
const allLiterals = collectStringLiterals(source);

test("unified board — no per-provider section markup survives in QuotaCardGrid", () => {
  assert.ok(
    !allLiterals.includes("details") && !allLiterals.includes("summary"),
    "QuotaCardGrid must not render per-provider <details>/<summary> sections — cards flow on one unified board"
  );
  const code = fs.readFileSync(COMPONENT_PATH, "utf8");
  assert.ok(
    !/buildProviderGroups|ProviderQuotaSection/.test(code),
    "grouping helpers must be gone — sortProviderConnectionsByPriority + one flat list is the model now"
  );
});

test("unified board — card width: full-width on phones, fixed >= 260px track from sm up", () => {
  const widthLiterals = allLiterals.filter((c) => c.includes("w-full") && c.includes("sm:w-["));
  assert.ok(
    widthLiterals.length >= 1,
    `expected the MagicGrid item wrapper to carry "w-full sm:w-[Npx]" (found none); got ${JSON.stringify(allLiterals)}`
  );
  for (const cls of widthLiterals) {
    assert.match(
      cls,
      /\bw-full\b/,
      "base (mobile) width must be full — MagicGrid then computes 1 column"
    );
    const match = cls.match(/sm:w-\[(\d+)px\]/);
    assert.ok(match, `expected a fixed sm: track width in "${cls}"`);
    assert.ok(
      Number(match![1]) >= 200,
      `sm: track ${match![1]}px is narrow enough for 2 columns on a phone (#7072 regression)`
    );
  }
});

test("unified board — density: configured track + gutter yield >= 2 columns at 1200px", () => {
  const widths = allLiterals
    .map((c) => c.match(/sm:w-\[(\d+)px\]/)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);
  assert.ok(widths.length >= 1, "expected a fixed sm: card width literal");
  const track = Math.min(...widths);
  // MagicGrid: numCols = floor(containerWidth / (track + gutter)); gutter 12 in the config test below.
  const columnsAt1200 = Math.floor(1200 / (track + 12));
  assert.ok(
    columnsAt1200 >= 2,
    `track ${track}px + gutter 12 yields only ${columnsAt1200} column(s) at 1200px (#6815 density regression)`
  );
});

test("unified board — MagicGrid wiring: static config, shortest-column-first, no listen()", () => {
  const code = fs.readFileSync(COMPONENT_PATH, "utf8");
  assert.match(code, /new MagicGrid\(/, "QuotaCardGrid must drive a MagicGrid instance");
  assert.match(
    code,
    /static:\s*true/,
    "MagicGrid must be configured static (partial loads position immediately)"
  );
  // useMin must be OFF: shortest-column-first packing scatters DOM-adjacent
  // (same-provider) cards across the board. Round-robin columns keep the
  // grouped DOM order reading row-major, left to right.
  assert.match(
    code,
    /useMin:\s*false/,
    "useMin packing must stay OFF — it scatters grouped provider cards"
  );
  assert.ok(
    !/maxColumns:/.test(code),
    "columns must stay uncapped so the board uses all available width on wide screens"
  );
  assert.ok(
    !/\.listen\(\)/.test(code),
    "listen() must NOT be called — it registers an unremovable window resize listener (leak on unmount)"
  );
  // Reposition triggers must be ours and cleaned up.
  assert.match(
    code,
    /new MutationObserver\(/,
    "card height changes (expander, loading→data) must reposition"
  );
  assert.match(code, /new ResizeObserver\(/, "container resize must reposition");
  assert.match(
    code,
    /mutation\.disconnect\(\)/,
    "MutationObserver must be disconnected on unmount"
  );
  assert.match(code, /resize\.disconnect\(\)/, "ResizeObserver must be disconnected on unmount");
});

test("unified board — compact density keeps its own narrower track", () => {
  const code = fs.readFileSync(COMPONENT_PATH, "utf8");
  const full = code.match(/full:\s*"w-full sm:w-\[(\d+)px\]"/);
  const compact = code.match(/compact:\s*"w-full sm:w-\[(\d+)px\]"/);
  assert.ok(full && compact, "expected a CARD_WIDTH_CLASS map with full + compact tracks");
  assert.ok(
    Number(compact![1]) < Number(full![1]),
    `compact track (${compact![1]}px) should be narrower than full (${full![1]}px)`
  );
});

test("unified board — same-provider cards are adjacent in the sorted DOM order", () => {
  const mk = (id: string, provider: string, name: string) => ({
    id,
    provider,
    name,
    isActive: true,
  });
  const quota = (remaining: number) => [
    { name: "q", used: 100 - remaining, total: 100, remainingPercentage: remaining },
  ];
  // quotaData entries are shaped { quotas: [...] } — same as the component reads.
  const data = {
    oc1: { quotas: quota(90) },
    oc2: { quotas: quota(10) },
    cl1: { quotas: quota(50) },
    oc3: { quotas: quota(70) },
    z1: { quotas: quota(30) },
  };
  const conns = [
    mk("oc1", "opencode-go", "a"),
    mk("cl1", "claude", "b"),
    mk("oc2", "opencode-go", "c"),
    mk("z1", "zai", "d"),
    mk("oc3", "opencode-go", "e"),
  ];
  const sorted = sortProviderConnectionsByPriority(conns, data);
  const providers = sorted.map((c: { provider: string }) => c.provider);
  // Re-entry = a provider block ENDS and the same provider starts again later.
  const seen = new Set<string>();
  let switches = 0;
  let prev: string | null = null;
  for (const p of providers) {
    if (prev !== null && p !== prev && seen.has(p)) switches++;
    seen.add(p);
    prev = p;
  }
  assert.equal(
    switches,
    0,
    `provider cards must be grouped adjacently (no re-entry), got order: ${providers.join(",")}`
  );
  // opencode-go's internal order still follows the priority sort (worst first).
  const ocOrder = sorted
    .filter((c: { provider: string }) => c.provider === "opencode-go")
    .map((c: { id: string }) => c.id);
  assert.deepEqual(
    ocOrder,
    ["oc2", "oc3", "oc1"],
    "within a provider, priority sort still applies"
  );
});
