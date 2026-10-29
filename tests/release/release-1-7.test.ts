import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBehaviourIdentity } from "../../src/release/document.js";
import { createContentInventory } from "../../src/release/inventory.js";
import {
  configureItem,
  readRelease,
  readReleaseContent,
  readReleaseSets,
} from "../../src/release/reader.js";

const root = resolve(import.meta.dirname, "../..");
/** Parsed fixture JSON, edited in place by the mutation cases before re-reading. */
type Doc = ReturnType<typeof JSON.parse>;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (document: unknown) => new TextEncoder().encode(`${canonical(document)}\n`);
const fixture = (path: string): Doc =>
  JSON.parse(readFileSync(resolve(root, "fixtures", path), "utf8"));
const content = () => fixture("release-1-7/extensions-release-1.7.0.json");
const readContent = (document: unknown) =>
  readReleaseContent(bytesOf(document), { expectedSha256: sha256(bytesOf(document)) });
const reasons = (document: unknown) => {
  const result = readContent(document);
  return result.valid ? [] : result.diagnostics.map((d) => d.reason);
};
const itemOf = (document: Doc, id: string) => document.items.find((item: Doc) => item.id === id);
/** Recomputes an edited item's behaviour file and both identities, as the build does. */
function restamp(item: Doc): void {
  const identity = computeBehaviourIdentity(item, "1.7") as NonNullable<
    ReturnType<typeof computeBehaviourIdentity>
  >;
  const behaviour = item.materials.find((member: Doc) => member.role === "behaviour");
  behaviour.sha256 = sha256(identity.behaviourBytes);
  behaviour.byteLength = identity.behaviourBytes.length;
  item.contentSha256 = identity.contentSha256;
  item.behaviourSha256 = identity.behaviourSha256;
}
const archive = {
  kind: "archive",
  url: "https://example.test/c.tgz",
  sha256: "a".repeat(64),
  byteLength: 10,
} as const;

describe("release 1.7.0 reading", () => {
  it("reads the golden release with its baseline and inventory 1.2.0", () => {
    const document = fixture("release-1.7.0-valid.json");
    const bytes = bytesOf(document);
    const read = readRelease(bytes, { expectedSha256: sha256(bytes) });
    expect(read.valid).toBe(true);
    if (!read.valid) return;
    expect(read.release.schema).toBe("urn:aihq:catalog:release:1.7.0");
    const { baseline: _baseline, ...rest } = document;
    const inventory = createContentInventory(bytesOf(rest), {
      expectedSha256: sha256(bytesOf(rest)),
    });
    expect(inventory.valid && inventory.inventory.schema).toBe(
      "urn:aihq:catalog:content-inventory:1.2.0",
    );
    expect(inventory.valid && inventory.inventory.projection).toBe(
      "urn:aihq:catalog:release-content:1.2.0",
    );
  });

  it("lists grill-me once, tool-neutral, with a recipe per client and the tools only as hints", () => {
    const read = readContent(content());
    expect(read.valid).toBe(true);
    if (!read.valid) return;
    const grill = read.release.items.filter((item) => item.name === "grill-me");
    expect(grill).toHaveLength(1);
    expect(Object.keys(grill[0]?.recipes ?? {})).toEqual([
      "claude-code",
      "copilot-vscode",
      "kiro-ide",
    ]);
    expect(grill[0]?.recipe).toBeUndefined();
    expect(grill[0]?.hints).toEqual({ tools: ["claude-code", "copilot-vscode", "kiro-ide"] });
    expect(grill[0]?.role).toBe("choosable");
    expect(
      read.release.items.find((item) => item.id === "extensions.notices")?.payload,
    ).toMatchObject({
      purpose: "notice",
    });
    // The per-tool copies are retired with their replacement, and superseded by hash.
    expect(read.release.retired).toContainEqual({
      id: "extensions.kiro.matt.grill-me",
      reason: expect.any(String),
      replacedBy: [{ framework: "extensions", itemId: "extensions.matt.grill-me" }],
    });
    const matches = (grill[0]?.supersedes ?? []).map((entry) => [entry.itemId, entry.match]);
    expect(matches).toEqual(
      expect.arrayContaining([
        ["extensions.kiro.matt.grill-me", "hash"],
        ["extensions.copilot.matt.grill-me", "hash"],
        ["mattpocock.grill-me", "name+sourcePath"],
      ]),
    );
    expect(read.release.sets?.map((set) => set.id)).toEqual(["productivity"]);
  });

  it("refuses a sets document over a release that embeds its sets", () => {
    const read = readContent(content());
    if (!read.valid) throw new Error("fixture");
    const bytes = new TextEncoder().encode("{}\n");
    const sets = readReleaseSets(bytes, { expectedSha256: sha256(bytes), release: read.release });
    expect(sets.valid).toBe(false);
    expect(!sets.valid && sets.diagnostics[0]?.reason).toBe("sets-attached");
  });

  it("keeps reading 1.6.0 in the same package and refuses an unknown format precisely", () => {
    expect(readContent(fixture("release-1-7/extensions-copies-release-1.6.0.json")).valid).toBe(
      true,
    );
    const future = { ...content(), schema: "urn:aihq:catalog:release:1.8.0" };
    const read = readContent(future);
    expect(read.valid).toBe(false);
    if (read.valid) return;
    expect(read.diagnostics).toEqual([
      expect.objectContaining({
        code: "SCHEMA_UNSUPPORTED",
        encountered: "urn:aihq:catalog:release:1.8.0",
        supported: expect.arrayContaining([
          "urn:aihq:catalog:release:1.6.0",
          "urn:aihq:catalog:release:1.7.0",
        ]),
      }),
    ]);
  });

  it("matches the deterministic hash vectors", () => {
    const vectors = fixture("release-1-7/hash-vectors.json");
    for (const vector of vectors.releases) {
      const path = vector.export.replace("@aihq/catalog/fixtures/", "");
      const read = readContent(fixture(path));
      expect(read.valid).toBe(true);
      if (!read.valid) continue;
      expect(read.release.sha256).toBe(vector.releaseSha256);
      expect(
        read.release.items.map(({ id, itemSha256, contentSha256, behaviourSha256 }) => ({
          id,
          itemSha256,
          contentSha256,
          behaviourSha256,
        })),
      ).toEqual(vector.items);
    }
  });
});

describe("release 1.7.0 item rules", () => {
  it("closes the kind list and requires a document purpose and a role", () => {
    const kind = content();
    itemOf(kind, "extensions.matt.grilling").kind = "instruction";
    restamp(itemOf(kind, "extensions.matt.grilling"));
    expect(reasons(kind)).toContain("unsupported-kind");
    const purpose = content();
    delete itemOf(purpose, "extensions.notices").payload.purpose;
    restamp(itemOf(purpose, "extensions.notices"));
    expect(reasons(purpose)).toContain("missing-field");
    const role = content();
    itemOf(role, "extensions.notices").role = "featured";
    expect(reasons(role)).toContain("invalid-role");
    const noRole = content();
    delete itemOf(noRole, "extensions.notices").role;
    expect(reasons(noRole)).toContain("missing-field");
  });

  it("carries exactly one of recipe or recipes, with entries agreeing with the item", () => {
    const both = content();
    const grill = itemOf(both, "extensions.matt.grill-me");
    const { materials: _m, inputs: _i, ...descriptor } = grill.recipes["claude-code"];
    grill.recipe = descriptor;
    expect(reasons(both)).toContain("recipe-or-map");
    const stray = content();
    itemOf(stray, "extensions.matt.grill-me").recipes["claude-code"].materials.push("missing");
    expect(reasons(stray)).toContain("recipe-materials-mismatch");
    const input = content();
    itemOf(input, "extensions.matt.grill-me").recipes["kiro-ide"].inputs = ["agentDirectory"];
    expect(reasons(input)).toContain("recipe-inputs-mismatch");
    const client = content();
    const recipes = itemOf(client, "extensions.matt.grill-me").recipes;
    recipes["Claude Code"] = recipes["claude-code"];
    expect(reasons(client)).toContain("invalid-client-id");
  });

  it("keeps fallback, variantOf and hints outside both identities and refuses fallbacks for agents and commands", () => {
    const declared = content();
    const grill = itemOf(declared, "extensions.matt.grill-me");
    grill.fallback = { itemId: "extensions.matt.grilling" };
    grill.variantOf = { itemId: "extensions.matt.grilling" };
    grill.hints = { tools: ["kiro-ide"] };
    const read = readContent(declared);
    const base = readContent(content());
    expect(read.valid && base.valid).toBe(true);
    if (!read.valid || !base.valid) return;
    const after = read.release.items.find((item) => item.id === "extensions.matt.grill-me");
    const before = base.release.items.find((item) => item.id === "extensions.matt.grill-me");
    expect(after?.contentSha256).toBe(before?.contentSha256);
    expect(after?.behaviourSha256).toBe(before?.behaviourSha256);
    expect(after?.itemSha256).not.toBe(before?.itemSha256);
    const agent = content();
    const item = itemOf(agent, "extensions.matt.grilling");
    item.kind = "agent";
    item.payload = { files: ["asset-1"] };
    item.fallback = { itemId: "extensions.matt.grill-me" };
    restamp(item);
    expect(reasons(agent)).toContain("fallback-native-only");
    const dangling = content();
    itemOf(dangling, "extensions.matt.grill-me").variantOf = { itemId: "extensions.absent" };
    expect(reasons(dangling)).toContain("declaration-unresolved");
  });

  it("checks supersession matches the reader can recompute", () => {
    const hash = content();
    const grill = itemOf(hash, "extensions.matt.grill-me");
    grill.supersedes.find((entry: Doc) => entry.match === "hash").contentSha256 = "b".repeat(64);
    expect(reasons(hash)).toContain("supersedes-hash-mismatch");
    const name = content();
    itemOf(name, "extensions.matt.grill-me").supersedes.find(
      (entry: Doc) => entry.match === "name+sourcePath",
    ).sourcePath = "skills/productivity/other/SKILL.md";
    expect(reasons(name)).toContain("supersedes-source-path-mismatch");
    const split = fixture("release-1-7/split-supersession-release-1.7.0.json");
    expect(readContent(split).valid).toBe(true);
    for (const item of split.items.slice(1)) delete item.supersedes;
    expect(reasons(split)).toContain("split-survivors");
  });

  it("keeps retirement records sorted, qualified and distinct from live items", () => {
    const live = content();
    live.retired.push({ id: "extensions.notices", reason: "Live.", replacedBy: [] });
    live.retired.sort((a: Doc, b: Doc) => (a.id < b.id ? -1 : 1));
    expect(reasons(live)).toContain("retired-item-present");
    const bare = content();
    bare.retired[0].replacedBy = ["extensions.matt.grill-me"];
    expect(reasons(bare)).toContain("invalid-type");
    const reason = content();
    delete reason.retired[0].reason;
    expect(reasons(reason)).toContain("missing-field");
  });

  it("requires both identities on cross-release references", () => {
    const document = content();
    const grill = itemOf(document, "extensions.matt.grill-me");
    grill.dependencies.requires.push({
      release: {
        source: archive,
        manifest: { path: "release/release-other.json", sha256: "c".repeat(64), byteLength: 10 },
      },
      itemId: "other.item",
      itemSha256: "d".repeat(64),
    });
    restamp(grill);
    expect(reasons(document)).toContain("cross-release-identity-required");
  });
});

describe("configureItem with a transition recipe map", () => {
  const release = () => {
    const read = readContent(content());
    if (!read.valid) throw new Error("fixture");
    return read.release;
  };
  const configure = (clientId?: string) =>
    configureItem({
      release: release(),
      itemId: "extensions.matt.grill-me",
      configuration: {},
      materialSource: archive,
      ...(clientId === undefined ? {} : { clientId }),
    });

  it("requires a clientId and refuses a client with no recipe", () => {
    expect(configure().diagnostics[0]?.reason).toBe("client-id-required");
    expect(configure("cursor").diagnostics[0]?.reason).toBe("client-unavailable");
    expect(configure("Kiro").diagnostics[0]?.reason).toBe("invalid-client-id");
  });

  it("selects the client's recipe and references exactly its material closure", () => {
    const result = configure("kiro-ide");
    expect(result.valid).toBe(true);
    const entry = release().items.find((item) => item.id === "extensions.matt.grill-me")?.recipes?.[
      "kiro-ide"
    ];
    expect(result.selection?.recipe.reference.sha256).toBe(entry?.sha256);
    expect(result.selection?.recipe.reference.path).toBe(`package/${entry?.path}`);
    expect(result.selection?.recipe.reference.materials.map((member) => member.id)).toEqual(
      entry?.materials,
    );
    expect(result.provenance?.clientId).toBe("kiro-ide");
    expect(Object.keys(result.inputs ?? {})).toEqual(entry?.inputs);
  });

  it("refuses a clientId for an item with one recipe", () => {
    const result = configureItem({
      release: release(),
      itemId: "extensions.notices",
      configuration: {},
      materialSource: archive,
      clientId: "claude-code",
    });
    expect(result.diagnostics[0]?.reason).toBe("client-id-unexpected");
    const plain = configureItem({
      release: release(),
      itemId: "extensions.notices",
      configuration: {},
      materialSource: archive,
    });
    expect(plain.valid).toBe(true);
    expect(
      plain.selection?.recipe.reference.materials.some((member) => member.id === "behaviour"),
    ).toBe(false);
  });
});

it("carries the frozen default's exact digest in the release inventory", async () => {
  const { releaseInventory, FROZEN_DEFAULT_RELEASE_SHA256 } = await import(
    "../../src/release/contracts.js"
  );
  const entry = releaseInventory.releases.find((release) => release.release === "./release.json");
  expect(entry).toMatchObject({ historical: true, sha256: FROZEN_DEFAULT_RELEASE_SHA256 });
  expect(sha256(readFileSync(resolve(root, "release/release.json")))).toBe(
    FROZEN_DEFAULT_RELEASE_SHA256,
  );
});
