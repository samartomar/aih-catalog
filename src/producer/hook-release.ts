import type { Json } from "../release/contracts.js";
import { canonicalJson } from "../release/json.js";
import { readRelease } from "../release/reader.js";
import type { Record_ } from "./base.js";
import { refuse } from "./errors.js";
import { HOOK_RELEASE_PATH, sha256Hex } from "./generate.js";

type Files = ReadonlyMap<string, Uint8Array>;

const asRecord = (value: Json | undefined): Record_ => value as Record_;
const parse = (bytes: Uint8Array): Record_ =>
  JSON.parse(Buffer.from(bytes).toString("utf8")) as Record_;

/** What Core keys a group by, plus the selector this release declares for it. */
interface HookGroup {
  readonly identity: string;
  readonly groupId: string;
  readonly selector: string;
}

/** One checked 1.1 release's hook groups, by item ID. Throws `base-invalid` on a damaged document. */
function hookGroups(files: Files, label: string): Map<string, HookGroup[]> {
  const bytes = files.get(HOOK_RELEASE_PATH);
  if (bytes === undefined) return new Map();
  const read = readRelease(bytes, { expectedSha256: sha256Hex(bytes) });
  if (!read.valid) {
    return refuse("base-invalid", `the ${label} ${HOOK_RELEASE_PATH} is not a valid release`, {
      diagnostics: read.diagnostics.map((d) => d.reason),
    });
  }
  const groups = new Map<string, HookGroup[]>();
  for (const item of read.release.items) {
    const recipeBytes = files.get(item.recipe.path);
    if (recipeBytes === undefined || sha256Hex(recipeBytes) !== item.recipe.sha256) {
      return refuse("base-invalid", `the ${label} recipe of ${item.id} is absent or changed`, {
        itemId: item.id,
      });
    }
    const operations = parse(recipeBytes).operations;
    groups.set(
      item.id,
      (Array.isArray(operations) ? operations : []).flatMap((operation) => {
        const op = asRecord(operation);
        if (op.kind !== "hook.group") return [];
        return [
          {
            identity: canonicalJson({
              target: op.target,
              format: op.format,
              container: op.container,
              groupId: op.groupId,
            }),
            groupId: op.groupId as string,
            selector: canonicalJson(op.selector),
          },
        ];
      }),
    );
  }
  return groups;
}

/**
 * Rejects a direct selector change for an item that keeps its Core group identity.
 * Core refuses the same change at review (`hook-selector-changed`); this stops the
 * authoring step first. `previous` is the validated, previously committed release
 * tree, absent for the first 1.1 release. Only the same item ID is compared: a changed
 * selector needs a new group ID, and an item-ID rename alone leaves the Core group
 * identity unchanged, so that move still takes the reviewed two-run removal path.
 */
export function assertHookSelectorContinuity(previous: Files | undefined, next: Files): void {
  if (previous === undefined) return;
  const before = hookGroups(previous, "previous");
  const after = hookGroups(next, "candidate");
  for (const [itemId, groups] of after) {
    for (const group of groups) {
      const prior = before.get(itemId)?.find((candidate) => candidate.identity === group.identity);
      if (prior !== undefined && prior.selector !== group.selector) {
        refuse(
          "hook-selector-changed",
          `${itemId} changes the selector of hook group ${group.groupId}; give the changed group a new group ID instead`,
          { itemId, groupId: group.groupId },
        );
      }
    }
  }
}
