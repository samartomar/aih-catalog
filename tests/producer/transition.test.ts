import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogRelease } from "../../src/release/contracts.js";
import { canonicalJson } from "../../src/release/json.js";
import { readReleaseContent } from "../../src/release/reader.js";
import { sha256Hex } from "../../src/release/sha256.js";

/** The document fields of a checked view, without the reader's computed ones. */
const stripChecked = (release: CatalogRelease) => {
  const {
    sha256: _sha,
    byteLength: _length,
    ...document
  } = release as CatalogRelease & Record<string, unknown>;
  return {
    ...document,
    items: release.items.map(({ itemSha256: _item, ...item }) => item),
  };
};

import { KIND_TRANSITION } from "../../src/release/contracts.js";
import {
  checkReleaseTransition,
  compileProducerDeclaration,
  compileTransitionRelease,
  type TransitionItemDeclaration,
  type TransitionRequest,
} from "../../src/release/producer.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const skill = (description: string) => `---\ndescription: ${description}\n---\n# Skill\n\nBody.\n`;
const directory = () => ({
  agentDirectory: {
    type: "string" as const,
    required: true,
    default: ".claude",
    minLength: 1,
    maxLength: 64,
    description: "Project directory that receives skills/<name>/ (Claude Code reads .claude).",
  },
});
const item = (id: string, options: Record<string, unknown> = {}) => ({
  id,
  source: "notes",
  label: "review",
  description: "Review skill",
  kind: "skill",
  skillPath: "review/SKILL.md",
  requires: [],
  optional: [],
  conflicts: [],
  clientCapabilities: [],
  activation: [],
  configuration: directory(),
  ...options,
});
const FRAMEWORK = {
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  description: "Framework for the release 1.7 transition tests.",
};
/** A checked release 1.6 of one tool's copies, built through the public 3.2.0 producer. */
function copies(
  items: Record<string, unknown>[],
  extra: Record<string, string> = {},
): CatalogRelease {
  const compiled = compileProducerDeclaration({
    declaration: {
      schema: "urn:aihq:catalog:producer-declaration:3.2.0",
      format: "aihq-catalog-producer-declaration",
      version: 3,
      framework: FRAMEWORK,
      sources: [
        { id: "notes", repository: "example/notes", licensePath: "LICENSE", license: "MIT" },
      ],
      items,
    },
    sourceFiles: [
      {
        source: "notes",
        revision: "a".repeat(40),
        files: Object.fromEntries(
          Object.entries({
            LICENSE: "MIT license fixture\n",
            "review/SKILL.md": skill("Review the setup."),
            "review/notes.md": "Support notes.\n",
            "helper/SKILL.md": skill("Help."),
            ...extra,
          }).map(([path, text]) => [path, encode(text)]),
        ),
      },
    ],
  });
  if (compiled.status !== "ok") throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.value.release;
}
const request = (
  releases: CatalogRelease[],
  items: TransitionItemDeclaration[],
  extra: Partial<TransitionRequest> = {},
): TransitionRequest => ({
  releases: Object.fromEntries(releases.map((release) => [release.sha256, release])),
  earlier: [(releases[0] as CatalogRelease).sha256],
  framework: { ...FRAMEWORK, version: "1.1.0" },
  package: { name: "supplied-catalog", version: "0.0.0" },
  items,
  ...extra,
});
const reasons = (result: { status: string; diagnostics: readonly { reason?: string }[] }) =>
  result.diagnostics.map((d) => d.reason);
const helper = item("notes.helper", { label: "helper", skillPath: "helper/SKILL.md" });

const kiro = (id: string, options: Record<string, unknown> = {}) =>
  item(id.replace("notes.", "notes.kiro."), options);
const declared = (
  id: string,
  copies: [CatalogRelease, string, string?][],
  extra: Partial<TransitionItemDeclaration> = {},
): TransitionItemDeclaration => ({
  id,
  kind: "skill",
  role: "choosable",
  copies: copies.map(([release, itemId, clientId]) => ({
    releaseSha256: release.sha256,
    itemId,
    ...(clientId === undefined ? {} : { clientId }),
  })),
  ...extra,
});

describe("compileTransitionRelease", () => {
  it("collapses per-tool copies into one item keeping the union of materials and dependencies", () => {
    const claude = copies([item("notes.review", { supportPaths: ["notes.md"] }), helper]);
    const kiroRelease = copies([
      kiro("notes.review", { requires: [{ itemId: "notes.kiro.helper" }] }),
      kiro("notes.helper", { label: "helper", skillPath: "helper/SKILL.md" }),
    ]);
    const result = compileTransitionRelease(
      request(
        [claude, kiroRelease],
        [
          declared("notes.review", [
            [claude, "notes.review", "claude-code"],
            [kiroRelease, "notes.kiro.review", "kiro-ide"],
          ]),
          declared(
            "notes.helper",
            [
              [claude, "notes.helper", "claude-code"],
              [kiroRelease, "notes.kiro.helper", "kiro-ide"],
            ],
            { role: "supporting" },
          ),
        ],
        { earlier: [claude.sha256, kiroRelease.sha256] },
      ),
    );
    expect(reasons(result)).toEqual([]);
    if (result.status !== "ok") return;
    const review = result.value.release.items.find((entry) => entry.id === "notes.review");
    expect(result.value.release.items.filter((entry) => entry.name === "review")).toHaveLength(1);
    const relPaths = review?.materials.map((member) => (member as { relPath?: string }).relPath);
    expect(relPaths).toEqual(expect.arrayContaining(["SKILL.md", "LICENSE", "notes.md"]));
    // The kiro copy's extra dependency follows its survivor.
    expect(review?.dependencies.requires).toEqual([{ itemId: "notes.helper" }]);
    expect(Object.keys(review?.recipes ?? {})).toEqual(["claude-code", "kiro-ide"]);
    // The kiro recipe keeps its own closure; the support file came from the other copy.
    const notes = review?.materials.find(
      (member) => (member as { relPath?: string }).relPath === "notes.md",
    );
    expect(review?.recipes?.["kiro-ide"]?.materials).not.toContain(notes?.id);
    expect(review?.recipes?.["claude-code"]?.materials).toContain(notes?.id);
    expect(review?.supersedes).toEqual([
      expect.objectContaining({ itemId: "notes.kiro.review", match: "name+sourcePath" }),
    ]);
    const helperItem = result.value.release.items.find((entry) => entry.id === "notes.helper");
    expect(helperItem?.supersedes).toEqual([
      expect.objectContaining({ itemId: "notes.kiro.helper", match: "hash" }),
    ]);
    expect(result.value.release.retired?.map((entry) => entry.id)).toEqual([
      "notes.kiro.helper",
      "notes.kiro.review",
    ]);
    expect(result.value.release.retired?.[1]).toEqual({
      id: "notes.kiro.review",
      reason: expect.any(String),
      replacedBy: [{ framework: "notes", itemId: "notes.review" }],
    });
    expect(result.value.materials.map((file) => file.path)).toEqual([
      "release/items/notes.helper/aih-behaviour.json",
      "release/items/notes.review/aih-behaviour.json",
    ]);
  });

  it("refuses conflicting copies instead of picking one", () => {
    const claude = copies([
      item("notes.review", { requires: [{ itemId: "notes.helper" }] }),
      helper,
    ]);
    const collapse = (other: CatalogRelease, clients: (string | undefined)[], helpers = false) =>
      compileTransitionRelease(
        request(
          [claude, other],
          [
            declared("notes.review", [
              [claude, "notes.review", clients[0]],
              [other, "notes.kiro.review", clients[1]],
            ]),
            declared(
              "notes.helper",
              helpers
                ? [
                    [claude, "notes.helper", "claude-code"],
                    [other, "notes.kiro.helper", "kiro-ide"],
                  ]
                : [[claude, "notes.helper"]],
            ),
          ],
          { earlier: [] },
        ),
      );
    const fork = copies([kiro("notes.review")], {
      "review/SKILL.md": skill("A different review."),
    });
    expect(reasons(collapse(fork, ["claude-code", "kiro-ide"]))).toContain("conflicting-copies");
    const against = copies([
      kiro("notes.review", { conflicts: [{ itemId: "notes.kiro.helper" }] }),
      kiro("notes.helper", { label: "helper", skillPath: "helper/SKILL.md" }),
    ]);
    expect(reasons(collapse(against, ["claude-code", "kiro-ide"], true))).toContain(
      "conflicting-copies",
    );
    const same = copies([
      kiro("notes.review", { requires: [{ itemId: "notes.kiro.helper" }] }),
      kiro("notes.helper", { label: "helper", skillPath: "helper/SKILL.md" }),
    ]);
    expect(reasons(collapse(same, ["claude-code", undefined], true))).toContain("client-id-mixed");
    // Without client ids the copies must share one recipe; theirs differ.
    expect(reasons(collapse(same, [undefined, undefined], true))).toContain("conflicting-copies");
  });

  it("maps 1.x kinds and refuses kinds that become sets or retire", () => {
    expect(KIND_TRANSITION.instruction.becomes).toEqual(["rule", "document"]);
    expect(KIND_TRANSITION.notice.becomes).toEqual(["document"]);
    expect(KIND_TRANSITION.template.becomes).toBe("set");
    expect(KIND_TRANSITION.framework.becomes).toBe("set");
    expect(KIND_TRANSITION["client-adapter"].becomes).toBe("retired");
    expect(KIND_TRANSITION["client-entry-pointer"].becomes).toBe("retired");
    const release = copies([item("notes.review")]);
    const wrong = compileTransitionRelease(
      request([release], [declared("notes.review", [[release, "notes.review"]], { kind: "rule" })]),
    );
    expect(reasons(wrong)).toContain("kind-mismatch");
  });

  it("fails when an earlier item disappears without retirement or reappears under a new id", () => {
    const release = copies([item("notes.review"), helper]);
    const review = declared("notes.review", [[release, "notes.review"]]);
    expect(reasons(compileTransitionRelease(request([release], [review])))).toContain(
      "dropped-without-retirement",
    );
    const retired = compileTransitionRelease(
      request([release], [review], {
        retired: [{ id: "notes.helper", reason: "Folded into review.", replacedBy: [] }],
      }),
    );
    expect(reasons(retired)).toEqual([]);
    // The helper's bytes reappear under a new id from another release.
    const moved = copies([item("notes.assist", { label: "assist", skillPath: "helper/SKILL.md" })]);
    const renamed = request(
      [release, moved],
      [review, declared("notes.assist", [[moved, "notes.assist"]])],
      {
        earlier: [release.sha256],
        retired: [
          {
            id: "notes.helper",
            reason: "Renamed.",
            replacedBy: [{ framework: "notes", itemId: "notes.assist" }],
          },
        ],
      },
    );
    expect(reasons(compileTransitionRelease(renamed))).toContain("unmapped-rename");
    const old = release.items.find((entry) => entry.id === "notes.helper");
    const mapped = compileTransitionRelease({
      ...renamed,
      items: [
        review,
        declared("notes.assist", [[moved, "notes.assist"]], {
          supersedes: [
            {
              match: "hash",
              releaseSha256: release.sha256,
              itemId: "notes.helper",
              itemSha256: old?.itemSha256 as string,
              contentSha256: old?.contentSha256 as string,
              behaviourSha256: old?.behaviourSha256 as string,
            },
          ],
        }),
      ],
    });
    expect(reasons(mapped)).toEqual([]);
  });

  it("keeps retirement records durable across releases", () => {
    const release = copies([item("notes.review"), helper]);
    const first = compileTransitionRelease(
      request([release], [declared("notes.review", [[release, "notes.review"]])], {
        retired: [{ id: "notes.helper", reason: "Folded into review.", replacedBy: [] }],
      }),
    );
    if (first.status !== "ok") throw new Error(JSON.stringify(first.diagnostics));
    const r1 = first.value.release;
    const next = (retired?: TransitionRequest["retired"]) =>
      compileTransitionRelease(
        request([r1], [declared("notes.review", [[r1, "notes.review"]])], {
          framework: { ...FRAMEWORK, version: "1.2.0" },
          ...(retired ? { retired } : {}),
        }),
      );
    const carried = next();
    expect(carried.status === "ok" && carried.value.release.retired).toEqual(r1.retired);
    expect(reasons(next([{ id: "notes.helper", reason: "Changed.", replacedBy: [] }]))).toContain(
      "retired-not-durable",
    );
    const check = checkReleaseTransition({
      releases: { [r1.sha256]: r1 },
      earlier: [r1.sha256],
      release: r1,
    });
    expect(check.status).toBe("ok");
    // A later release built without r1's record is refused when checked against r1, not thrown.
    const dropped = compileTransitionRelease(
      request([r1], [declared("notes.review", [[r1, "notes.review"]])], {
        earlier: [],
        framework: { ...FRAMEWORK, version: "1.2.0" },
      }),
    );
    expect(dropped.status).toBe("ok");
    if (dropped.status !== "ok") return;
    expect(
      reasons(
        checkReleaseTransition({
          releases: { [r1.sha256]: r1, [dropped.value.release.sha256]: dropped.value.release },
          earlier: [r1.sha256],
          release: dropped.value.release,
        }),
      ),
    ).toEqual(expect.arrayContaining(["retired-not-durable"]));
  });

  it("carries a release 1.6 retirement forward, qualified by its framework", () => {
    const release = copies([item("notes.review")]);
    const retiredOld = {
      ...release,
      retired: [{ id: "notes.gone", reason: "Retired in 1.6.", replacedBy: ["notes.review"] }],
    };
    // Re-read through the public reader so the view is checked.
    const bytes = new TextEncoder().encode(`${canonicalJson(stripChecked(retiredOld))}\n`);
    const read = readReleaseContent(bytes, { expectedSha256: sha256Hex(bytes) });
    expect(read.valid).toBe(true);
    if (!read.valid) return;
    const built = compileTransitionRelease(
      request([read.release], [declared("notes.review", [[read.release, "notes.review"]])]),
    );
    expect(reasons(built)).toEqual([]);
    expect(built.status === "ok" && built.value.release.retired).toEqual([
      {
        id: "notes.gone",
        reason: "Retired in 1.6.",
        replacedBy: [{ framework: "notes", itemId: "notes.review" }],
      },
    ]);
  });

  it("requires the earlier releases, framework and package", () => {
    const release = copies([item("notes.review")]);
    const base = request([release], [declared("notes.review", [[release, "notes.review"]])]);
    for (const missing of ["earlier", "framework", "package"] as const) {
      const { [missing]: _omitted, ...rest } = base;
      expect(reasons(compileTransitionRelease(rest as TransitionRequest))).toEqual([
        "request-invalid",
      ]);
    }
  });
});

describe("compileTransitionRelease placement", () => {
  const read = (path: string) => {
    const bytes = encode(
      `${JSON.stringify(JSON.parse(readFileSync(resolve(import.meta.dirname, "../..", path), "utf8")))}\n`,
    );
    const result = readReleaseContent(bytes, { expectedSha256: sha256Hex(bytes) });
    if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
    return result.release;
  };
  const copiesRelease = () => read("fixtures/release-1-7/extensions-copies-release-1.6.0.json");
  const build = (extra: Partial<TransitionItemDeclaration>, kind = "document") => {
    const release = copiesRelease();
    return compileTransitionRelease({
      releases: { [release.sha256]: release },
      earlier: [],
      framework: { ...FRAMEWORK, id: "extensions" },
      package: release.package,
      items: [
        {
          id: "extensions.notices",
          kind: kind as TransitionItemDeclaration["kind"],
          role: "supporting",
          purpose: "notice",
          copies: [{ releaseSha256: release.sha256, itemId: "extensions.notices" }],
          ...extra,
        },
      ],
    });
  };

  it("carries a declared placement in a document's payload, which release 1.6 cannot hold", () => {
    const result = build({ placement: "project-folder" });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("ok");
    if (result.status !== "ok") return;
    const [notices] = result.value.release.items;
    expect(notices?.payload).toMatchObject({ purpose: "notice", placement: "project-folder" });
    const plain = build({});
    expect(plain.status === "ok" && plain.value.release.items[0]?.payload).not.toHaveProperty(
      "placement",
    );
  });

  it("refuses a placement on a kind that has none", () => {
    const release = copiesRelease();
    const result = compileTransitionRelease({
      releases: { [release.sha256]: release },
      earlier: [],
      framework: { ...FRAMEWORK, id: "extensions" },
      package: release.package,
      items: [
        {
          id: "extensions.matt.grill-me",
          kind: "skill",
          role: "choosable",
          placement: "file",
          copies: [{ releaseSha256: release.sha256, itemId: "extensions.matt.grill-me" }],
        },
      ],
    });
    expect(reasons(result)).toEqual(["placement-kind"]);
  });
});
