import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonV1, sha256HexV1 } from "../../src/production/strict-json-v1.js";
import {
  assembleCatalogAuthoringBundleV1,
  readCollectionSnapshotV1,
} from "../../src/production/workbench/authoring-bundle-v1.js";
import { compileMattPocockProviderV1 } from "../../src/production/workbench/catalog-providers-v1.js";
import {
  produceSingleSourceAuthoringBundleV1,
  projectAuthoringBundleSourceV1,
} from "../../src/production/workbench/single-source-bundle-v1.js";
import { assertCoreAdmitsV1, type Json } from "./core-admits.js";
import { curatedVendorLockV2 } from "./v2-fixtures.js";

const root = resolve(import.meta.dirname, "..", "..");
const recorded = (file: string): string =>
  JSON.parse(
    readFileSync(resolve(root, "src", "production", "data", "upstream-inputs-v1.json"), "utf8"),
  ).files[file].commit;

const ANTHROPICS_PIN = "3".repeat(40);
function anthropicsInput(commit = ANTHROPICS_PIN, id = "anthropics-skills"): Json {
  const file = (path: string, content: string) => {
    const bytes = Buffer.from(content, "utf8");
    return {
      path,
      bytesBase64: bytes.toString("base64"),
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      size: bytes.length,
    };
  };
  const skill = (name: string) => ({
    id: `skill:${name}`,
    kind: "skill",
    label: name,
    description: `The ${name} skill.`,
    primaryPath: `skills/${name}/SKILL.md`,
    fileRefs: [`skills/${name}/LICENSE.txt`, `skills/${name}/SKILL.md`],
  });
  return {
    version: "pinned-component-collection/v1",
    source: {
      id,
      repository: "https://github.com/anthropics/skills",
      commit,
      version: "0.0.0",
      licenseFileRef: "README.md",
    },
    files: [
      file("README.md", "# skills\n"),
      file("skills/alpha/LICENSE.txt", "Apache-2.0\n"),
      file("skills/alpha/SKILL.md", "---\nname: alpha\ndescription: Alpha.\n---\nalpha\n"),
      file("skills/beta/LICENSE.txt", "Apache-2.0\n"),
      file("skills/beta/SKILL.md", "---\nname: beta\ndescription: Beta.\n---\nbeta\n"),
    ],
    components: [skill("alpha"), skill("beta")],
  };
}

describe("single-source bundle at a new pin (no packaged record overlay)", () => {
  it("emits each collection at its curated pin, whatever record the Catalog still carries", () => {
    for (const [id, file] of [["mattpocock", "mattpocock.snapshot.json"]] as const) {
      const pin = recorded(file);
      const bundle = produceSingleSourceAuthoringBundleV1(root, id, pin, {
        newPin: true,
      }) as unknown as Json;
      assertCoreAdmitsV1(bundle, `source:${id}`, pin);
    }
  });

  it("is the named source exactly as the full overlay leaves it: other records cannot reach it", () => {
    const pin = recorded("mattpocock.snapshot.json");
    const alone = produceSingleSourceAuthoringBundleV1(root, "mattpocock", pin, { newPin: true });
    const anthropics = produceSingleSourceAuthoringBundleV1(
      root,
      "anthropics-skills",
      ANTHROPICS_PIN,
      {
        newPin: true,
        compilerInput: anthropicsInput(),
      },
    );
    const record = {
      version: "packaged-workbench-source-data/v1",
      sourceBundle: anthropics,
      source: { repository: "anthropics/skills", commit: ANTHROPICS_PIN },
      scannerProof: {},
      compilerTemplate: {},
      inlineBlobs: [],
      publicationBlobs: [{ sha256: "0".repeat(64), bytes: 1, url: "https://example.invalid/p" }],
    };
    const bytes = canonicalJsonV1(record);
    const { bundle: overlaid } = assembleCatalogAuthoringBundleV1(
      root,
      [compileMattPocockProviderV1(readCollectionSnapshotV1(root, "mattpocock.snapshot.json"))],
      [],
      [{ bytes, sha256: sha256HexV1(bytes) }],
      [],
    );
    expect(overlaid.sources["source:anthropics-skills"]?.revision.id).toBe(ANTHROPICS_PIN);
    expect(projectAuthoringBundleSourceV1(root, overlaid, "source:mattpocock")).toEqual(alone);
  });

  it("emits ecc and superpowers at the vendor-lock pin and keeps the vetted-pin guard", () => {
    const vendorLock = curatedVendorLockV2(root) as {
      sources: { id: string; pinnedSha: string }[];
    };
    for (const id of ["ecc", "superpowers"] as const) {
      const pin = vendorLock.sources.find((source) => source.id === id)?.pinnedSha as string;
      const bundle = produceSingleSourceAuthoringBundleV1(root, id, pin, {
        newPin: true,
        vendorLock,
      }) as unknown as Json;
      assertCoreAdmitsV1(bundle, `source:${id}`, pin);
      expect(
        (bundle.sources as Record<string, { inputFormat: string }>)[`source:${id}`]?.inputFormat,
      ).toBe("pinned-baseline/v1");
    }
    const moved = structuredClone(vendorLock);
    const ecc = moved.sources.find((source) => source.id === "ecc");
    if (ecc === undefined) throw new Error("no ecc source");
    ecc.pinnedSha = "1".repeat(40);
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "ecc", "1".repeat(40), {
        newPin: true,
        vendorLock: moved,
      }),
    ).toThrow(/was not fetched at the vetted pin/);
  });

  it("emits anthropics-skills from its named compiler input", () => {
    const bundle = produceSingleSourceAuthoringBundleV1(root, "anthropics-skills", ANTHROPICS_PIN, {
      newPin: true,
      compilerInput: anthropicsInput(),
    }) as unknown as Json;
    assertCoreAdmitsV1(bundle, "source:anthropics-skills", ANTHROPICS_PIN);
    const source = (bundle.sources as Record<string, Json>)["source:anthropics-skills"] as Json;
    expect(source.inputFormat).toBe("pinned-component-collection/v1");
    expect(source.distributor).toEqual({ kind: "aih", locator: "@aihq/core" });
    expect(source.upstreamOrigin).toEqual({
      kind: "git",
      locator: "https://github.com/anthropics/skills",
    });
    expect(Object.keys(bundle.assets as Json)).toHaveLength(2);
  });

  it("refuses what the route cannot build truthfully", () => {
    const pin = recorded("mattpocock.snapshot.json");
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "anthropics-skills", ANTHROPICS_PIN, {
        compilerInput: anthropicsInput(),
      }),
    ).toThrow(/anthropics-skills is emitted only by the new-pin route/);
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "anthropics-skills", ANTHROPICS_PIN, {
        newPin: true,
      }),
    ).toThrow(/anthropics-skills needs its named compiler input/);
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "mattpocock", pin, {
        newPin: true,
        compilerInput: anthropicsInput(),
      }),
    ).toThrow(/a compiler input applies only to anthropics-skills/);
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "anthropics-skills", "4".repeat(40), {
        newPin: true,
        compilerInput: anthropicsInput(),
      }),
    ).toThrow(new RegExp(`emits source:anthropics-skills@${ANTHROPICS_PIN}, not 4{40}`));
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "anthropics-skills", ANTHROPICS_PIN, {
        newPin: true,
        compilerInput: anthropicsInput(ANTHROPICS_PIN, "other-skills"),
      }),
    ).toThrow(/anthropics-skills provider requires its exact source identity/);
    expect(() =>
      produceSingleSourceAuthoringBundleV1(root, "mattpocock", "0".repeat(40), { newPin: true }),
    ).toThrow(new RegExp(`emits source:mattpocock@${pin}, not 0{40}`));
  });
});
