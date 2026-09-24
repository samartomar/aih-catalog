import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readUpstreamInputsManifestV1,
  readVerifiedUpstreamInputV1,
} from "../../src/production/catalog/upstream-inputs-v1.js";
import {
  canonicalEccDisabledHookIds,
  ECC_DISABLE_ELIGIBLE_HOOK_IDS,
  ECC_HOOK_CONTROL_PROVENANCE,
  ECC_HOOK_SOURCES_FILE_V1,
  ECC_OPENCODE_HOOK_CONTROL_ROWS,
  eccHookControlCatalog,
  eccHookControlInventoryV1,
} from "../../src/production/ecc-hook-controls-v1.js";
import { sha256HexV1 } from "../../src/production/strict-json-v1.js";

/** affaan-m/ECC v2.2.1, the Q1 pin. */
const PIN = "5064474d4d762dc9640234a41617cccb79185cec";
const OTHER = "0123456789abcdef0123456789abcdef01234567";
const OPENCODE_PLUGIN = ".opencode/plugins/ecc-hooks.ts";
const root = resolve(import.meta.dirname, "..", "..");

interface HookSources {
  version: number;
  repository: string;
  commit: string;
  files: { path: string; sha256: string; bytesBase64: string }[];
}

/** The reviewed files `produce:ecc` fetched, byte for byte. */
const hookSources = () =>
  JSON.parse(
    readFileSync(resolve(root, "src", "production", "data", ECC_HOOK_SOURCES_FILE_V1), "utf8"),
  ) as HookSources;

function withBytes(sources: HookSources, path: string, text: string): HookSources {
  const bytes = Buffer.from(text, "utf8");
  return {
    ...sources,
    files: sources.files.map((file) =>
      file.path === path
        ? { path, sha256: sha256HexV1(bytes), bytesBase64: bytes.toString("base64") }
        : file,
    ),
  };
}

describe("ECC hook controls at v2.2.1", () => {
  it("binds the reviewed inventory to the source digests at the pin", () => {
    // Digests of the blobs at 5064474d, read with git cat-file.
    expect(ECC_HOOK_CONTROL_PROVENANCE).toEqual({
      repository: "affaan-m/ECC",
      commit: PIN,
      sources: [
        {
          path: "hooks/hooks.json",
          sha256: "42376cf51c9453d0e9ac4fef9c30baa8acdd01e5a0067f63fd03a94bd1cb70a1",
        },
        {
          path: "scripts/hooks/session-start-bootstrap.js",
          sha256: "48f949ebc4ab83a9e8d3b6bee91bb201511046a8c504f53f8d1e48e29f03bc0d",
        },
        {
          path: "scripts/hooks/bash-hook-dispatcher.js",
          sha256: "b6e4163536d8092b63cfca205372d699f38550d6dd0fe2e74abde2f029f6ecbe",
        },
        {
          path: "scripts/hooks/posttooluse-dispatcher.js",
          sha256: "74262d37a1f02d63b44ce498178cb3327b429c6d278c7aed5453905efe71b725",
        },
        {
          path: "scripts/hooks/run-with-flags.js",
          sha256: "0b30fae9163681b118307e62f23d055682d42faf004218b11d3ce76378f2f209",
        },
        {
          path: "scripts/lib/hook-flags.js",
          sha256: "1f5fbf2d2ebd0ab07a3e54406db18c2932ae7bf965513ec12c521da1be54425d",
        },
        {
          path: OPENCODE_PLUGIN,
          sha256: "0345093b34e537d350c5b5aa0296511f558aa767e5104fb5ef05069013f3b5b6",
        },
      ],
      contentSha256: createHash("sha256")
        .update(
          JSON.stringify(
            ECC_HOOK_CONTROL_PROVENANCE.sources.map(({ path, sha256 }) => [path, sha256]),
          ),
        )
        .digest("hex"),
    });
  });

  it("adds the PowerShell fact-forcing gate in manifest order after the Bash wrapper", () => {
    expect(eccHookControlCatalog).toHaveLength(44);
    expect(eccHookControlCatalog.slice(0, 3).map((hook) => hook.id)).toEqual([
      "pre:bash:dispatcher",
      "pre:powershell:gateguard-fact-force",
      "pre:write:doc-file-warning",
    ]);
    expect(eccHookControlCatalog[1]).toEqual({
      id: "pre:powershell:gateguard-fact-force",
      event: "PreToolUse",
      profiles: ["standard", "strict"],
      disableEligible: true,
    });
    const eligible = eccHookControlCatalog.filter((hook) => hook.disableEligible);
    expect(ECC_DISABLE_ELIGIBLE_HOOK_IDS).toHaveLength(43);
    expect(
      ["minimal", "standard", "strict"].map(
        (profile) =>
          eligible.filter((hook) => (hook.profiles as readonly string[]).includes(profile)).length,
      ),
    ).toEqual([11, 40, 43]);
  });

  it("lists ECC's OpenCode plugin as its own surface that aih cannot switch off", () => {
    expect(ECC_OPENCODE_HOOK_CONTROL_ROWS).toEqual([
      {
        id: "opencode:ecc-hooks",
        event: "plugin",
        profiles: ["minimal", "standard", "strict"],
        disableEligible: true,
        declarations: [
          "file.edited",
          "tool.execute.after",
          "tool.execute.before",
          "session.created",
          "session.idle",
          "session.deleted",
          "file.watcher.updated",
          "todo.updated",
          "shell.env",
          "experimental.session.compacting",
          "permission.ask",
        ].map((event) => ({
          host: "opencode",
          sourcePath: OPENCODE_PLUGIN,
          event,
          execution: "in-process",
        })),
        control: { kind: "none" },
      },
    ]);
    // aih's only ECC switch is the Claude settings environment; the OpenCode row is not on it.
    expect(ECC_DISABLE_ELIGIBLE_HOOK_IDS).not.toContain("opencode:ecc-hooks");
    expect(() => canonicalEccDisabledHookIds(["opencode:ecc-hooks"], "standard")).toThrow(
      /not in the pinned inventory/u,
    );
  });

  it("publishes the Claude rows and the OpenCode row in the descriptor section", () => {
    const inventory = eccHookControlInventoryV1(hookSources(), { pinnedSha: PIN });
    expect(inventory.provenance).toBe(ECC_HOOK_CONTROL_PROVENANCE);
    expect(inventory.profiles.map((profile) => profile.id)).toEqual([
      "minimal",
      "standard",
      "strict",
    ]);
    expect(inventory.hooks).toEqual([...eccHookControlCatalog, ...ECC_OPENCODE_HOOK_CONTROL_ROWS]);
    const ids = inventory.hooks.map((hook) => hook.id);
    expect(new Set(ids).size).toBe(45);
    const recorded = new Set<string>(inventory.provenance.sources.map((source) => source.path));
    for (const row of ECC_OPENCODE_HOOK_CONTROL_ROWS)
      for (const declaration of row.declarations)
        expect(recorded.has(declaration.sourcePath)).toBe(true);
  });

  it("records the reviewed files as produce:ecc fetched them at the pin", () => {
    const manifest = readUpstreamInputsManifestV1(root);
    const input = readVerifiedUpstreamInputV1(root, manifest, ECC_HOOK_SOURCES_FILE_V1);
    expect(input.provenance.repository).toBe("affaan-m/ECC");
    expect(input.provenance.commit).toBe(PIN);
    const sources = input.json as HookSources;
    expect(sources.commit).toBe(PIN);
    expect(
      sources.files.map((file) => ({
        path: file.path,
        sha256: sha256HexV1(Buffer.from(file.bytesBase64, "base64")),
      })),
    ).toEqual(ECC_HOOK_CONTROL_PROVENANCE.sources);
  });

  it("refuses the section when a reviewed file's bytes differ, naming the file and both digests", () => {
    for (const { path, sha256 } of ECC_HOOK_CONTROL_PROVENANCE.sources) {
      const changed = withBytes(hookSources(), path, "// changed upstream\n");
      const actual = sha256HexV1(Buffer.from("// changed upstream\n", "utf8"));
      expect(() => eccHookControlInventoryV1(changed, { pinnedSha: PIN })).toThrow(
        new RegExp(`${path.replaceAll(".", "\\.")}.*${sha256}.*${actual}`, "u"),
      );
    }
  });

  it("refuses the section when the selected upstream commit is not the reviewed one", () => {
    const moved = { ...hookSources(), commit: OTHER };
    expect(() => eccHookControlInventoryV1(moved, { pinnedSha: OTHER })).toThrow(
      new RegExp(`reviewed at ${PIN}.*${OTHER}`, "u"),
    );
  });

  it("refuses hook sources fetched at a commit other than the vendor pin", () => {
    expect(() => eccHookControlInventoryV1(hookSources(), { pinnedSha: OTHER })).toThrow(
      new RegExp(`${PIN}.*${OTHER}`, "u"),
    );
  });

  it("refuses a missing reviewed file and an unreviewed extra file", () => {
    const sources = hookSources();
    const missing = { ...sources, files: sources.files.slice(1) };
    expect(() => eccHookControlInventoryV1(missing, { pinnedSha: PIN })).toThrow(
      /hooks\/hooks\.json/u,
    );
    const bytes = Buffer.from("{}\n", "utf8");
    const extra = {
      ...sources,
      files: [
        ...sources.files,
        {
          path: "hooks/extra.json",
          sha256: sha256HexV1(bytes),
          bytesBase64: bytes.toString("base64"),
        },
      ],
    };
    expect(() => eccHookControlInventoryV1(extra, { pinnedSha: PIN })).toThrow(
      /hooks\/extra\.json/u,
    );
  });

  it("refuses hook sources whose recorded digest does not match their bytes", () => {
    const sources = hookSources();
    const [first, ...rest] = sources.files;
    if (first === undefined) throw new Error("no hook sources");
    const forged = { ...sources, files: [{ ...first, sha256: "0".repeat(64) }, ...rest] };
    expect(() => eccHookControlInventoryV1(forged, { pinnedSha: PIN })).toThrow(/sha256/u);
  });
});
