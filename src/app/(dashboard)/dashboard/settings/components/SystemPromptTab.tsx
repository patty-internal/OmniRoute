"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, Toggle } from "@/shared/components";
import { useTranslations } from "next-intl";

interface SystemPromptConfig {
  enabled: boolean;
  prefixPrompt: string;
  suffixPrompt: string;
}

const EMPTY_CONFIG: SystemPromptConfig = { enabled: false, prefixPrompt: "", suffixPrompt: "" };

function normalizeConfig(data: unknown): SystemPromptConfig | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    prefixPrompt: typeof record.prefixPrompt === "string" ? record.prefixPrompt : "",
    suffixPrompt: typeof record.suffixPrompt === "string" ? record.suffixPrompt : "",
  };
}

export default function SystemPromptTab() {
  const [config, setConfig] = useState<SystemPromptConfig>(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef(config);
  const t = useTranslations("settings");

  const load = useCallback(() => {
    // .then-chain style (matches the sibling settings panels): every setState
    // happens in a promise callback, never synchronously in the effect body.
    return fetch("/api/settings/system-prompt")
      .then((res) => {
        if (!res.ok) throw new Error(`config load failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const next = normalizeConfig(data);
        if (!next) throw new Error("config load returned an unexpected shape");
        setConfig(next);
        configRef.current = next;
        setLoaded(true);
        setLoadFailed(false);
      })
      .catch(() => {
        // Never fall back to the empty default: an editable wiped config would
        // autosave `{enabled:false, prefixPrompt:""}` on the next keystroke and
        // destroy the stored prompts (production incident 2026-09-28). Show an
        // error + retry instead.
        setConfig(EMPTY_CONFIG);
        configRef.current = EMPTY_CONFIG;
        setLoaded(false);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const retryLoad = () => {
    setLoading(true);
    setLoadFailed(false);
    void load();
  };

  useEffect(() => {
    void load();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load]);

  const save = async (updates: Partial<SystemPromptConfig>) => {
    const newConfig = { ...configRef.current, ...updates };
    setConfig(newConfig);
    configRef.current = newConfig;
    setStatus("");
    try {
      const res = await fetch("/api/settings/system-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConfig),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const saved = normalizeConfig(await res.json());
      if (saved && configRef.current === newConfig) {
        // Re-sync from the server response, but only when the user has not
        // typed since this save started — otherwise their in-flight edits
        // would be reverted by the response.
        setConfig(saved);
        configRef.current = saved;
      }
      setStatus("saved");
      setTimeout(() => setStatus(""), 2000);
    } catch {
      setStatus("error");
    }
  };

  const handleFieldChange = (field: "prefixPrompt" | "suffixPrompt", text: string) => {
    const updated = { ...configRef.current, [field]: text };
    setConfig(updated);
    configRef.current = updated;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void save({ [field]: text });
    }, 800);
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            edit_note
          </span>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold">{t("globalSystemPrompt")}</h3>
        </div>
        {!loadFailed && (
          <div className="flex items-center gap-3">
            {status === "saved" && (
              <span className="text-xs font-medium text-emerald-500 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>{" "}
                {t("saved")}
              </span>
            )}
            {status === "error" && (
              <span className="text-xs font-medium text-red-500 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">error</span>{" "}
                {t("systemPromptSaveFailed")}
              </span>
            )}
            <Toggle
              checked={config.enabled}
              onChange={() => save({ enabled: !config.enabled })}
              disabled={loading || !loaded}
            />
          </div>
        )}
      </div>

      {loadFailed ? (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
          <span className="material-symbols-outlined text-red-500 text-[20px]" aria-hidden="true">
            cloud_off
          </span>
          <p className="text-sm text-text-secondary flex-1">{t("systemPromptLoadFailed")}</p>
          <button
            type="button"
            onClick={retryLoad}
            className="text-sm font-medium text-amber-500 hover:text-amber-400 transition-colors"
          >
            {t("retry")}
          </button>
        </div>
      ) : (
        loaded &&
        config.enabled && (
          <div className="flex flex-col gap-5">
            {/* Before Prompt — injected BEFORE agent/provider instructions */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">vertical_align_top</span>
                {t("beforePromptLabel")}
              </label>
              <p className="text-xs text-text-muted/70">{t("beforePromptDesc")}</p>
              <div className="relative">
                <textarea
                  value={config.prefixPrompt}
                  onChange={(e) => handleFieldChange("prefixPrompt", e.target.value)}
                  placeholder={t("beforePromptPlaceholder")}
                  rows={9}
                  className="w-full px-4 py-3 rounded-lg border border-border/50 bg-surface/30 text-sm
                             placeholder:text-text-muted/50 resize-y min-h-[220px]
                             focus:outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-500/50
                             transition-colors"
                />
                <div className="absolute bottom-2 right-3 text-xs text-text-muted/60 tabular-nums">
                  {t("chars", { count: config.prefixPrompt.length })}
                </div>
              </div>
            </div>

            {/* After Prompt — injected AFTER agent/provider instructions */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">vertical_align_bottom</span>
                {t("afterPromptLabel")}
              </label>
              <p className="text-xs text-text-muted/70">{t("afterPromptDesc")}</p>
              <div className="relative">
                <textarea
                  value={config.suffixPrompt}
                  onChange={(e) => handleFieldChange("suffixPrompt", e.target.value)}
                  placeholder={t("afterPromptPlaceholder")}
                  rows={9}
                  className="w-full px-4 py-3 rounded-lg border border-border/50 bg-surface/30 text-sm
                             placeholder:text-text-muted/50 resize-y min-h-[220px]
                             focus:outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-500/50
                             transition-colors"
                />
                <div className="absolute bottom-2 right-3 text-xs text-text-muted/60 tabular-nums">
                  {t("chars", { count: config.suffixPrompt.length })}
                </div>
              </div>
            </div>
          </div>
        )
      )}
    </Card>
  );
}
