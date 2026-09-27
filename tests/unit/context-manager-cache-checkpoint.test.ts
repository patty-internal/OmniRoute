import { test } from "node:test";
import assert from "node:assert/strict";
import { compressContext } from "../../open-sse/services/contextManager.ts";

function request(turns: number) {
  return {
    model: "test-model",
    messages: [
      { role: "developer", content: "Keep the session instructions stable." },
      ...Array.from({ length: turns }, (_, index) => ({
        role: "user",
        content: `Historical turn ${index}: ${"content ".repeat(200)}`,
      })),
    ],
  };
}

test("growing saturated conversation reuses its retained prompt prefix", () => {
  const options = {
    maxTokens: 5_000,
    reserveTokens: 0,
    cacheSessionKey: "cache-checkpoint-growing-session",
    cacheReuseMaxTokens: 7_000,
  };
  const first = compressContext(request(50), options);
  const next = compressContext(request(51), options);

  assert.equal(first.compressed, true);
  assert.equal(next.compressed, true);
  const firstMessages = first.body?.messages as Array<Record<string, unknown>>;
  const nextMessages = next.body?.messages as Array<Record<string, unknown>>;
  assert.ok(firstMessages.length > 2, "a useful history should survive compaction");
  assert.deepEqual(
    nextMessages.slice(0, firstMessages.length),
    firstMessages,
    "the next request should append to the same retained prefix"
  );
});

test("a history checkpoint rolls forward when the retained prompt exhausts its safe budget", () => {
  const options = {
    maxTokens: 5_000,
    reserveTokens: 0,
    cacheSessionKey: "cache-checkpoint-rollover-session",
    cacheReuseMaxTokens: 7_000,
  };
  const first = compressContext(request(50), options);
  const grown = compressContext(request(70), options);
  const firstMessages = first.body?.messages as Array<Record<string, unknown>>;
  const grownMessages = grown.body?.messages as Array<Record<string, unknown>>;

  assert.equal(grown.compressed, true);
  assert.notDeepEqual(grownMessages.slice(0, firstMessages.length), firstMessages);
  assert.ok(grown.stats.final <= options.maxTokens, "a fresh checkpoint returns to the target");
  assert.equal(grownMessages.at(-1)?.content, request(70).messages.at(-1)?.content);
});

test("history checkpoints are isolated by session and invalidated when their anchor changes", () => {
  const options = {
    maxTokens: 5_000,
    reserveTokens: 0,
    cacheSessionKey: "cache-checkpoint-anchor-session",
    cacheReuseMaxTokens: 7_000,
  };
  const first = compressContext(request(50), options);
  const reused = compressContext(request(51), options);
  const independent = compressContext(request(51), {
    ...options,
    cacheSessionKey: "cache-checkpoint-independent-session",
  });
  const firstMessages = first.body?.messages as Array<Record<string, unknown>>;
  const reusedMessages = reused.body?.messages as Array<Record<string, unknown>>;
  const independentMessages = independent.body?.messages as Array<Record<string, unknown>>;
  assert.deepEqual(reusedMessages.slice(0, firstMessages.length), firstMessages);
  assert.notDeepEqual(independentMessages, reusedMessages);

  const edited = request(51);
  const retainedAnchor = firstMessages.find((message) => message.role === "user")?.content;
  const anchor = edited.messages.find((message) => message.content === retainedAnchor);
  assert.ok(anchor, "the retained anchor must be in the original request");
  anchor.content = "The previously retained history was edited.";
  const invalidated = compressContext(edited, options);
  const fresh = compressContext(edited, {
    ...options,
    cacheSessionKey: "cache-checkpoint-after-edit-session",
  });
  assert.deepEqual(invalidated.body?.messages, fresh.body?.messages);
});
