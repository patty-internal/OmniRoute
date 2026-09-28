import { NextResponse } from "next/server";
import {
  setSystemPromptConfig,
  getSystemPromptConfig,
} from "@omniroute/open-sse/services/systemPrompt.ts";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { updateSystemPromptSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;
  try {
    return NextResponse.json(getSystemPromptConfig());
  } catch (error) {
    console.error("Error reading system prompt config:", error);
    return NextResponse.json({ error: "Failed to read system prompt config" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "body", message: "Invalid JSON body" }],
        },
      },
      { status: 400 }
    );
  }

  try {
    const validation = validateBody(updateSystemPromptSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const body = validation.data;

    // The schema is all-optional, and updateSettings() replaces the whole
    // `systemPrompt` section — a partial body would silently wipe every field
    // it omits (incident 2026-09-28: a client-side emptied config disabled the
    // feature and destroyed the stored prompts). Merge over the stored section
    // so a PUT can only change the fields it actually carries.
    const stored = asRecord((await getSettings()).systemPrompt);
    const merged = { ...stored, ...body };

    // Recovery net: when an update empties previously non-empty prompts, stash
    // the previous section so the loss is reversible.
    const hadPromptContent = nonEmpty(stored.prefixPrompt) || nonEmpty(stored.suffixPrompt);
    const wipesPrompts = !nonEmpty(merged.prefixPrompt) && !nonEmpty(merged.suffixPrompt);
    if (hadPromptContent && wipesPrompts) {
      await updateSettings({ systemPromptBackup: stored });
    }

    setSystemPromptConfig(merged);
    await updateSettings({ systemPrompt: merged });

    return NextResponse.json(getSystemPromptConfig());
  } catch (error) {
    console.error("Error updating system prompt config:", error);
    return NextResponse.json({ error: "Failed to update system prompt config" }, { status: 500 });
  }
}
