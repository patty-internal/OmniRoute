// @vitest-environment jsdom
//
// SystemPromptTab must never unlock an empty, editable config.
//
// Production incident: the tab parsed GET failures (401/500/network) as an
// empty config and unlocked the editor; the next keystroke's debounced
// autosave then PUT {enabled:false, prefixPrompt:"", suffixPrompt:""},
// wiping the stored prompts server-side.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// next-intl: return the key so we can assert on stable strings.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { default: SystemPromptTab } =
  await import("../../../src/app/(dashboard)/dashboard/settings/components/SystemPromptTab");

const OK_CONFIG = { enabled: true, prefixPrompt: "BEFORE", suffixPrompt: "AFTER" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const containers: Array<{ root: Root; el: HTMLDivElement }> = [];

function renderTab() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<SystemPromptTab />);
  });
  containers.push({ root, el });
  return el;
}

// React tracks the value setter for controlled inputs — assigning `.value`
// directly is swallowed by its internal tracker. Go through the prototype
// setter so the dispatched input event carries the new value to onChange.
function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const { root, el } of containers.splice(0)) {
    act(() => root.unmount());
    el.remove();
  }
});

describe("SystemPromptTab", () => {
  it("a failed config load shows an error + retry and never unlocks an empty editable state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const el = renderTab();
    await act(async () => {});

    // The bug: the toggle rendered as editable with the wiped default config.
    expect(el.querySelector('button[role="switch"]')).toBeNull();
    expect(el.textContent).toContain("systemPromptLoadFailed");
    expect(el.textContent).toContain("retry");
  });

  it("editing after a successful load autosaves the full merged config", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => jsonResponse(OK_CONFIG));
    const el = renderTab();
    await act(async () => {});

    const textarea = el.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe("BEFORE");

    await act(async () => {
      typeInto(textarea!, "BEFORE!");
    });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    await act(async () => {});

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall![1]?.body));
    // enabled and suffixPrompt must come from the loaded state, not defaults.
    expect(body).toEqual({ enabled: true, prefixPrompt: "BEFORE!", suffixPrompt: "AFTER" });
  });

  it("a failed autosave surfaces an error instead of claiming saved", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (_input, init?) => {
      if (init?.method === "PUT") return jsonResponse({ error: "boom" }, 500);
      return jsonResponse(OK_CONFIG);
    });
    const el = renderTab();
    await act(async () => {});

    const textarea = el.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      typeInto(textarea, "BEFORE!");
    });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    await act(async () => {});

    expect(el.textContent).toContain("systemPromptSaveFailed");
    expect(el.textContent).not.toContain("saved");
  });
});
