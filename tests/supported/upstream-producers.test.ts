import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseUpstreamInputsManifestV1 } from "../../src/production/catalog/upstream-inputs-v1.js";
import { buildCatalogFrameworkDefaultsV1 } from "../../src/production/catalog-defaults-v1.js";
import { catalogProductionRuntimeV1 } from "../../src/production/collation-v1.js";
import {
  produceContentMetadataV1,
  produceUpstreamInputsV1,
  recordUpstreamInputsV1,
  type UpstreamTreeV1,
} from "../../src/production/produce/upstream-producers-v1.js";
import { sha256HexV1 } from "../../src/production/strict-json-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const dataPath = (file: string) => resolve(root, "src", "production", "data", file);
const dataText = (file: string) => readFileSync(dataPath(file), "utf8");
const ECC_COMMIT = "5caf398a91599029a176ca6d806409b00d1052c4";
const OTHER_RUNTIME = { node: "20.19.0", icu: "76.1", unicode: "16.0", cldr: "46.0" };

function tree(repository: string, commit: string, files: Record<string, string | Buffer>) {
  return {
    repository,
    commit,
    paths: Object.keys(files),
    read(path: string) {
      const value = files[path];
      if (value === undefined) throw new TypeError(`absent ${path}`);
      return typeof value === "string" ? Buffer.from(value, "utf8") : value;
    },
  } satisfies UpstreamTreeV1;
}

/** Rebuilds the upstream manifests the committed ECC projections were cut from. */
function eccTree(extra: Record<string, string> = {}) {
  const modules = JSON.parse(dataText("ecc-modules-v1.json")) as {
    schemaVersion: number;
    modules: Record<string, unknown>[];
  };
  const profiles = JSON.parse(dataText("ecc-profiles-v1.json")) as {
    schemaVersion: number;
    profiles: Record<string, Record<string, unknown>>;
  };
  const skills = JSON.parse(dataText("ecc-skill-inventory-v1.json")) as string[];
  const files: Record<string, string> = {
    "manifests/install-modules.json": JSON.stringify({
      version: modules.schemaVersion,
      modules: modules.modules.map((module) => ({ ...module, description: "dropped" })),
    }),
    "manifests/install-profiles.json": JSON.stringify({
      version: profiles.schemaVersion,
      profiles: Object.fromEntries(
        Object.entries(profiles.profiles).map(([id, profile]) => [id, { ...profile, cost: 1 }]),
      ),
    }),
    "mcp-configs/mcp-servers.json": dataText("ecc-mcp-inventory-v1.json"),
    "agents/planner.md":
      "---\nname: planner\ndescription: Plans work.\ntools: Read, Grep\n---\n\nBody.\n",
    ...extra,
  };
  for (const skill of [...skills].reverse())
    files[`skills/${skill}/SKILL.md`] = `---\nname: ${skill}\ndescription: ${skill} skill.\n---\n`;
  return tree("affaan-m/ECC", ECC_COMMIT, files);
}

describe("networked upstream producers (offline transforms)", () => {
  it("projects the ECC manifests and skill inventory exactly as committed", () => {
    const produced = produceUpstreamInputsV1("ecc", eccTree(), root);
    const byFile = Object.fromEntries(produced.map((item) => [item.file, item]));
    for (const file of [
      "ecc-modules-v1.json",
      "ecc-profiles-v1.json",
      "ecc-skill-inventory-v1.json",
      "ecc-mcp-inventory-v1.json",
    ])
      expect(byFile[file]?.bytes, file).toBe(dataText(file));
    expect(byFile["ecc-modules-v1.json"]?.sources).toEqual({
      "manifests/install-modules.json": expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("orders the skill inventory as the git tree does", () => {
    const produced = produceUpstreamInputsV1(
      "ecc",
      eccTree({
        "skills/zz/SKILL.md": "---\nname: zz\ndescription: z.\n---\n",
        "skills/zz-top/SKILL.md": "---\nname: zz-top\ndescription: z.\n---\n",
      }),
      root,
    );
    const names = JSON.parse(
      produced.find((item) => item.file === "ecc-skill-inventory-v1.json")?.bytes ?? "[]",
    ) as string[];
    expect(names.slice(-2)).toEqual(["zz-top", "zz"]);
  });

  it("derives content metadata from frontmatter and records each file digest", () => {
    const markdown = "---\nname: Planner\ndescription: Plans work.\ntools: [Read, Grep]\n---\n";
    const metadata = JSON.parse(
      produceContentMetadataV1(
        tree("obra/Superpowers", "b36e0829c6d0140e93cfef2ca599b1b07d4a7797", {
          "agents/planner.md": markdown,
          "skills/brainstorming/SKILL.md":
            "---\nname: brainstorming\n---\n\n## Overview\n\nUse it before building.\n",
          "skills/brainstorming/extra.md": "not a skill",
        }),
      ),
    ) as { agents: Record<string, unknown>[]; skills: Record<string, unknown>[] };
    expect(metadata.agents).toEqual([
      {
        id: "planner",
        declaredName: "Planner",
        title: "Planner",
        path: "agents/planner.md",
        summary: "Plans work.",
        usageContext: "Plans work.",
        allowedTools: ["Read", "Grep"],
        sourceSha256: sha256HexV1(markdown),
      },
    ]);
    expect(metadata.skills.map((entry) => entry.summary)).toEqual(["Use it before building."]);
  });

  it("skips nested mappings only under frontmatter keys it never reads", () => {
    const skill = (frontmatter: string) =>
      produceContentMetadataV1(
        tree("obra/Superpowers", ECC_COMMIT, {
          "skills/a/SKILL.md": `---\n${frontmatter}\n---\n`,
        }),
      );
    const metadata = JSON.parse(
      skill("name: a\nmetadata:\n  origin: ECC\n  clawdbot:\n    emoji: x\n\ndescription: Kept."),
    ) as { skills: { summary: string }[] };
    expect(metadata.skills[0]?.summary).toBe("Kept.");
    expect(() => skill("name: a\ndescription:\n  nested: no")).toThrow(/nested mapping/u);
    expect(() => skill("name: a\nmetadata:\n  a: 1\nmetadata:\n  b: 2\ndescription: d")).toThrow(
      /duplicate key metadata/u,
    );
  });

  it("refuses upstream Markdown without frontmatter or with invalid UTF-8", () => {
    const base = { "skills/a/SKILL.md": "---\nname: a\ndescription: a.\n---\n" };
    expect(() =>
      produceContentMetadataV1(
        tree("obra/Superpowers", ECC_COMMIT, { ...base, "agents/x.md": "no frontmatter" }),
      ),
    ).toThrow(/no YAML frontmatter/u);
    expect(() =>
      produceContentMetadataV1(
        tree("obra/Superpowers", ECC_COMMIT, { ...base, "agents/x.md": Buffer.from([0xff]) }),
      ),
    ).toThrow(/UTF-8/u);
  });

  it("refreshes the collection snapshots from upstream bytes and keeps the curation", () => {
    for (const [name, file, repository, commit] of [
      [
        "mattpocock",
        "mattpocock.snapshot.json",
        "mattpocock/skills",
        "3cca18b368ae95cdbdebbff572ccafa662551015",
      ],
      [
        "ponytail",
        "ponytail.snapshot.json",
        "DietrichGebert/ponytail",
        "974d940a1c5344210874150b98ff0d2c861fab6a",
      ],
    ] as const) {
      const snapshot = JSON.parse(dataText(file)) as {
        entries?: { path: string; base64: string }[];
        files?: { path: string; bytesBase64: string }[];
      };
      const files: Record<string, Buffer> = {};
      for (const entry of snapshot.entries ?? [])
        files[entry.path] = Buffer.from(entry.base64, "base64");
      for (const entry of snapshot.files ?? [])
        files[entry.path] = Buffer.from(entry.bytesBase64, "base64");
      if (name === "mattpocock")
        files[".claude-plugin/plugin.json"] = Buffer.from('{"version":"1.2.3"}');
      const [produced] = produceUpstreamInputsV1(name, tree(repository, commit, files), root);
      expect(produced?.bytes, file).toBe(dataText(file));
      const [first] = Object.keys(files);
      delete files[first as string];
      expect(() => produceUpstreamInputsV1(name, tree(repository, commit, files), root)).toThrow(
        /absent/u,
      );
    }
  });

  it("refuses a tree from another repository or a short commit", () => {
    expect(() =>
      produceUpstreamInputsV1("ecc", tree("affaan-m/other", ECC_COMMIT, {}), root),
    ).toThrow(/repository/u);
    expect(() => produceUpstreamInputsV1("ecc", tree("affaan-m/ECC", "5caf398", {}), root)).toThrow(
      /commit/u,
    );
  });

  it("records what a produce step fetched in the upstream inputs manifest", () => {
    const manifest = JSON.parse(dataText("upstream-inputs-v1.json")) as {
      files: Record<string, { commit: string; sha256: string }>;
    };
    const next = JSON.parse(
      recordUpstreamInputsV1(
        dataText("upstream-inputs-v1.json"),
        "affaan-m/ECC",
        "a".repeat(40),
        [{ file: "ecc-modules-v1.json", bytes: "{}\n", sources: {} }],
        OTHER_RUNTIME,
      ),
    ) as typeof manifest;
    expect(next.files["ecc-modules-v1.json"]).toEqual({
      repository: "affaan-m/ECC",
      commit: "a".repeat(40),
      sha256: sha256HexV1("{}\n"),
      sources: {},
      runtime: OTHER_RUNTIME,
    });
    expect(next.files["ecc-profiles-v1.json"]).toEqual(manifest.files["ecc-profiles-v1.json"]);
    expect(
      recordUpstreamInputsV1(
        dataText("upstream-inputs-v1.json"),
        "affaan-m/ECC",
        ECC_COMMIT,
        [],
        OTHER_RUNTIME,
      ),
    ).toBe(dataText("upstream-inputs-v1.json"));
  });

  it("keeps the recorded runtime when a produce step reproduces the same bytes", () => {
    const text = dataText("upstream-inputs-v1.json");
    const manifest = JSON.parse(text) as { files: Record<string, { runtime: unknown }> };
    const same = {
      file: "ecc-skill-inventory-v1.json",
      bytes: dataText("ecc-skill-inventory-v1.json"),
      sources: {},
    };
    expect(recordUpstreamInputsV1(text, "affaan-m/ECC", ECC_COMMIT, [same], OTHER_RUNTIME)).toBe(
      text,
    );
    const changed = JSON.parse(
      recordUpstreamInputsV1(
        text,
        "affaan-m/ECC",
        ECC_COMMIT,
        [{ ...same, bytes: `${same.bytes} ` }],
        OTHER_RUNTIME,
      ),
    ) as typeof manifest;
    expect(changed.files["ecc-skill-inventory-v1.json"]?.runtime).toEqual(OTHER_RUNTIME);
    expect(manifest.files["ecc-skill-inventory-v1.json"]?.runtime).not.toEqual(OTHER_RUNTIME);
  });

  it("keeps the recorded runtime for the same bytes at another commit and updates the provenance", () => {
    const text = dataText("upstream-inputs-v1.json");
    const manifest = JSON.parse(text) as { files: Record<string, Record<string, unknown>> };
    const file = "ecc-skill-inventory-v1.json";
    const sources = { "skills/example/SKILL.md": "b".repeat(64) };
    const next = JSON.parse(
      recordUpstreamInputsV1(
        text,
        "affaan-m/ECC",
        "a".repeat(40),
        [{ file, bytes: dataText(file), sources }],
        OTHER_RUNTIME,
      ),
    ) as typeof manifest;
    expect(next.files[file]).toEqual({
      ...manifest.files[file],
      repository: "affaan-m/ECC",
      commit: "a".repeat(40),
      sources,
      runtime: manifest.files[file]?.runtime,
    });
    expect(manifest.files[file]?.runtime).not.toEqual(OTHER_RUNTIME);
  });

  it("records the Node, ICU, Unicode and CLDR versions that produced every input", () => {
    const manifest = JSON.parse(dataText("upstream-inputs-v1.json")) as {
      files: Record<string, { runtime: Record<string, string> }>;
    };
    expect(Object.keys(manifest.files).length).toBeGreaterThan(0);
    for (const [file, entry] of Object.entries(manifest.files)) {
      expect(Object.keys(entry.runtime), file).toEqual(["node", "icu", "unicode", "cldr"]);
      for (const version of Object.values(entry.runtime))
        expect(version, file).toMatch(/^[0-9]+(\.[0-9]+)*$/u);
    }
    expect(catalogProductionRuntimeV1()).toEqual({
      node: process.versions.node,
      icu: process.versions.icu,
      unicode: process.versions.unicode,
      cldr: process.versions.cldr,
    });
  });

  it("refuses a manifest entry without a well-formed production runtime", () => {
    const manifest = JSON.parse(dataText("upstream-inputs-v1.json")) as {
      files: Record<string, Record<string, unknown>>;
    };
    const entry = manifest.files["ecc-modules-v1.json"] as Record<string, unknown>;
    const { runtime, ...withoutRuntime } = entry;
    for (const candidate of [
      withoutRuntime,
      { ...entry, runtime: { ...(runtime as object), icu: "" } },
      { ...entry, runtime: { ...(runtime as object), icu: "78.3; rm" } },
      { ...entry, runtime: { ...(runtime as object), extra: "1" } },
      { ...entry, runtime: "78.3" },
    ])
      expect(() =>
        parseUpstreamInputsManifestV1({
          ...manifest,
          files: { ...manifest.files, "ecc-modules-v1.json": candidate },
        }),
      ).toThrow(/runtime/u);
  });

  it("refuses a recorded version or identity that ends in a line terminator", () => {
    const manifest = JSON.parse(dataText("upstream-inputs-v1.json")) as {
      files: Record<string, Record<string, unknown>>;
    };
    const entry = manifest.files["ecc-modules-v1.json"] as Record<string, unknown>;
    const runtime = entry.runtime as Record<string, string>;
    const parse = (candidate: Record<string, unknown>) =>
      parseUpstreamInputsManifestV1({
        ...manifest,
        files: { ...manifest.files, "ecc-modules-v1.json": candidate },
      });
    expect(() => parse(entry)).not.toThrow();
    for (const terminator of ["\n", "\r\n", "\r", " ", " "]) {
      for (const field of ["node", "icu", "unicode", "cldr"])
        expect(() =>
          parse({ ...entry, runtime: { ...runtime, [field]: `${runtime[field]}${terminator}` } }),
        ).toThrow(/runtime/u);
      for (const field of ["repository", "commit", "sha256"])
        expect(() =>
          parse({ ...entry, [field]: `${entry[field] as string}${terminator}` }),
        ).toThrow(new RegExp(field, "u"));
    }
  });

  it("records every fetched input at the commit its content pins", () => {
    const manifest = JSON.parse(dataText("upstream-inputs-v1.json")) as {
      files: Record<string, { repository: string; commit: string; sha256: string }>;
    };
    for (const [file, repository, commit] of [
      [
        "superpowers-content-metadata-v1.json",
        "obra/Superpowers",
        "b36e0829c6d0140e93cfef2ca599b1b07d4a7797",
      ],
      ["mattpocock.snapshot.json", "mattpocock/skills", "3cca18b368ae95cdbdebbff572ccafa662551015"],
      [
        "ponytail.snapshot.json",
        "DietrichGebert/ponytail",
        "974d940a1c5344210874150b98ff0d2c861fab6a",
      ],
    ] as const) {
      expect(manifest.files[file], file).toMatchObject({ repository, commit });
      expect(manifest.files[file]?.sha256, file).toBe(sha256HexV1(readFileSync(dataPath(file))));
    }
  });

  it("refuses to build from a fetched input whose bytes differ from the manifest", () => {
    for (const file of [
      "superpowers-content-metadata-v1.json",
      "mattpocock.snapshot.json",
      "ponytail.snapshot.json",
    ]) {
      const copy = mkdtempSync(join(tmpdir(), "aih-catalog-inputs-"));
      try {
        const data = join(copy, "src", "production", "data");
        cpSync(resolve(root, "src", "production", "data"), data, { recursive: true });
        writeFileSync(join(data, file), `${readFileSync(join(data, file), "utf8")} `);
        expect(() => buildCatalogFrameworkDefaultsV1(copy), file).toThrow(/recorded sha256/u);
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    }
  });

  it("exposes each networked step as an explicit produce script the offline build never runs", () => {
    const { scripts } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const name of ["ecc", "superpowers", "mattpocock", "ponytail"])
      expect(scripts[`produce:${name}`]).toBe(
        `npm run build:dist && node tools/produce-upstream-inputs.mjs ${name}`,
      );
    for (const offline of ["build", "build:dist", "check:catalog-index", "verify", "test"])
      expect(scripts[offline], offline).not.toMatch(/produce/u);
  });
});
