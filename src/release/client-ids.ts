/**
 * The native client identifiers Catalog checks a `client-adapter` item's `clientId`
 * against: a frozen, sorted mirror of Core's `nativeClientIds` from `@aihq/core/harness`.
 * Catalog keeps this mirror aligned with Core; `tools/verify-core-consumer.mjs` compares
 * it against the real Core package. The release reader checks only the form of a
 * `clientId`, so a reader keeps reading releases that name a client Core adds later;
 * this set is for Catalog's own renderer and whole-package integrity check.
 * Portable: no Node built-ins.
 */
import { CLIENT_ID } from "./document.js";

export const CORE_NATIVE_CLIENT_IDS: readonly string[] = Object.freeze([
  "antigravity",
  "claude",
  "codex",
  "copilot",
  "cursor",
  "gemini",
  "kimi",
  "kiro",
  "opencode",
  "windsurf",
  "zed",
]);

export interface ClientAdapterProblem {
  readonly reason: "missing-client-id" | "invalid-client-id" | "unknown-client-id";
  readonly itemId: string;
  /** The offending value, present only for a well-formed id outside the Core set. */
  readonly clientId?: string;
}

/**
 * Stable problems for every `client-adapter` item whose `clientId` is missing,
 * malformed or not a Core native client id, in item order. Other kinds are ignored.
 */
export function clientAdapterProblems(
  items: readonly { readonly id: string; readonly kind: string; readonly clientId?: unknown }[],
): readonly ClientAdapterProblem[] {
  const problems: ClientAdapterProblem[] = [];
  for (const item of items) {
    if (item.kind !== "client-adapter") continue;
    const clientId = item.clientId;
    if (clientId === undefined) problems.push({ reason: "missing-client-id", itemId: item.id });
    else if (typeof clientId !== "string" || !CLIENT_ID.test(clientId)) {
      problems.push({ reason: "invalid-client-id", itemId: item.id });
    } else if (!CORE_NATIVE_CLIENT_IDS.includes(clientId)) {
      problems.push({ reason: "unknown-client-id", itemId: item.id, clientId });
    }
  }
  return Object.freeze(problems);
}
