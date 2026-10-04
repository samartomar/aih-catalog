import { describe, expect, it } from "vitest";
import { parseBaseRelease } from "../../src/producer/base.js";
import { buildCandidate } from "../../src/producer/candidate.js";
import { ProducerRefusal } from "../../src/producer/errors.js";
import { documentBytes } from "../../src/producer/generate.js";
import { assertHookSelectorContinuity } from "../../src/producer/hook-release.js";
import { checkCandidateFiles, INTEGRITY_CHECKS } from "../../src/producer/integrity.js";
import {
  committedRelease,
  declaration,
  memoryTree,
  PINNED_REVISION,
  packageIdentity,
  pinnedUpstreamFiles,
  sha256,
} from "./helpers.js";

const HOOK_DOC = "release/release-1.1.json";
const ITEM_ID = "aihq.hook.claude.protect-env";
const OTHER_COMMAND = 'sh "${CLAUDE_PROJECT_DIR}/.claude/hooks/other.sh"';
const identity = packageIdentity();
const authored = declaration().authored;

type Doc = {
  package: { version: string };
  items: { id: string; recipe: { path: string; sha256: string; byteLength: number } }[];
};
type HookOperation = {
  kind: string;
  groupId?: string;
  action?: string;
  selector?: { path: unknown[]; value: string };
};
type Recipe = { operations: HookOperation[] };

const failing = (files: ReadonlyMap<string, Buffer>, id = identity) =>
  checkCandidateFiles(files, id, { authored })
    .checks.filter((check) => !check.ok)
    .map((check) => check.name);

/** Re-pins a hook recipe edit into the committed 1.1 document, as a regeneration would. */
function withHookOperation(change: (hook: HookOperation) => void): Map<string, Buffer> {
  const files = committedRelease();
  const document = JSON.parse((files.get(HOOK_DOC) as Buffer).toString("utf8")) as Doc;
  const item = document.items.find((candidate) => candidate.id === ITEM_ID) as Doc["items"][number];
  const recipe = JSON.parse((files.get(item.recipe.path) as Buffer).toString("utf8")) as Recipe;
  change(recipe.operations.find((op) => op.kind === "hook.group") as HookOperation);
  const bytes = documentBytes(recipe);
  files.set(item.recipe.path, bytes);
  item.recipe.sha256 = sha256(bytes);
  item.recipe.byteLength = bytes.length;
  files.set(HOOK_DOC, documentBytes(document));
  return files;
}
const refusal = (run: () => unknown): ProducerRefusal => {
  try {
    run();
  } catch (error) {
    if (error instanceof ProducerRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("release 1.1 admission", () => {
  it("passes every whole-package check for the committed 1.0 and 1.1 documents together", () => {
    const result = checkCandidateFiles(committedRelease(), identity, { authored });
    expect(result.checks.map((check) => check.name)).toEqual([...INTEGRITY_CHECKS]);
    expect(result.checks.filter((check) => !check.ok)).toEqual([]);
  });

  it("still accepts a candidate with no 1.1 document", () => {
    const files = committedRelease();
    for (const path of [...files.keys()]) {
      if (path.includes("client-hooks") || path.includes("aihq.hook.") || path === HOOK_DOC) {
        files.delete(path);
      }
    }
    expect(failing(files)).toEqual([]);
  });

  it("fails a hook material changed behind its pinned hash", () => {
    const files = committedRelease();
    const script = [...files.keys()].find((path) =>
      path.endsWith("aihq-protect-env.mjs"),
    ) as string;
    files.set(script, Buffer.from("#!/bin/sh\nexit 0\n"));
    expect(failing(files)).toEqual(["member-bytes"]);
  });

  it("fails a 1.1 document that names another package version", () => {
    expect(failing(committedRelease(), { ...identity, version: "9.9.9" })).toContain(
      "package-identity",
    );
  });

  it("fails a hook recipe that no longer agrees with Core's published 1.1 structure", () => {
    const files = withHookOperation((hook) => {
      hook.action = "remove";
    });
    expect(failing(files)).toEqual(["recipe-configuration-agreement"]);
  });
});

describe("hook group selector continuity", () => {
  it("accepts an unchanged selector", () => {
    expect(() =>
      assertHookSelectorContinuity(committedRelease(), committedRelease()),
    ).not.toThrow();
  });

  it("accepts a first 1.1 release, which has no prior baseline", () => {
    expect(() => assertHookSelectorContinuity(undefined, committedRelease())).not.toThrow();
  });

  it("rejects a selector changed under the same item and group ID", () => {
    const changed = withHookOperation((hook) => {
      (hook.selector as { value: string }).value = OTHER_COMMAND;
    });
    const error = refusal(() => assertHookSelectorContinuity(committedRelease(), changed));
    expect(error.reason).toBe("hook-selector-changed");
    expect(error.message).toContain(ITEM_ID);
    expect(error.message).toContain("protect-env");
  });

  it("allows the same item to take a new group ID with a new selector", () => {
    const changed = withHookOperation((hook) => {
      hook.groupId = "protect-env-v2";
      (hook.selector as { value: string }).value = OTHER_COMMAND;
    });
    expect(() => assertHookSelectorContinuity(committedRelease(), changed)).not.toThrow();
  });

  it("refuses to compare against a damaged previous 1.1 release", () => {
    const damaged = committedRelease();
    damaged.set(HOOK_DOC, Buffer.from("{}\n"));
    expect(refusal(() => assertHookSelectorContinuity(damaged, committedRelease())).reason).toBe(
      "base-invalid",
    );
  });

  it("refuses a re-pinned but structurally invalid committed recipe", () => {
    const damaged = withHookOperation((hook) => {
      hook.action = "remove";
    });
    expect(refusal(() => assertHookSelectorContinuity(damaged, committedRelease())).reason).toBe(
      "base-invalid",
    );
  });
});

describe("candidate carrying the 1.1 release", () => {
  const upstream = () => memoryTree(PINNED_REVISION, pinnedUpstreamFiles());
  const build = (version: string) =>
    buildCandidate({
      declaration: declaration(),
      tree: upstream(),
      base: parseBaseRelease(committedRelease()),
      package: { ...identity, version },
    });

  it("carries the hook release and its members byte for byte at the same package version", () => {
    const result = build(identity.version);
    for (const [path, bytes] of committedRelease()) {
      expect(result.files.get(path)?.equals(bytes), path).toBe(true);
    }
    expect(result.files.size).toBe(committedRelease().size);
  });

  it("restamps only the package version of the 1.1 release for a new package version", () => {
    const result = build("9.9.9");
    const before = JSON.parse((committedRelease().get(HOOK_DOC) as Buffer).toString("utf8"));
    const after = JSON.parse((result.files.get(HOOK_DOC) as Buffer).toString("utf8"));
    expect(after.package.version).toBe("9.9.9");
    expect({ ...after, package: before.package }).toEqual(before);
    expect(failing(result.files, { ...identity, version: "9.9.9" })).toEqual([]);
  });

  it("refuses a base whose 1.1 members are absent or undeclared", () => {
    const missing = committedRelease();
    missing.delete(
      [...missing.keys()].find((path) => path.endsWith("aihq-protect-env.mjs")) as string,
    );
    expect(refusal(() => parseBaseRelease(missing)).reason).toBe("base-member-missing");
    const extra = committedRelease().set(
      "release/materials/aihq/client-hooks/stray.txt",
      Buffer.from("x"),
    );
    expect(refusal(() => parseBaseRelease(extra)).reason).toBe("base-orphan-file");
  });
});
