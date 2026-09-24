import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fsCallbackNames } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";
import { describe, expect, it } from "vitest";
import { superpowersBaselineCatalogV1 } from "../../src/production/catalog/baseline-catalogs-v1.js";
import {
  openCodePluginParserFileSystemV1,
  readOpenCodeEntryReexportV1,
  readOpenCodePluginHooksV1,
} from "../../src/production/catalog/opencode-plugin-hooks-v1.js";
import {
  reviewedSuperpowersHookControlInventoryV1,
  SUPERPOWERS_HOOK_REVIEW_V1,
  superpowersHookControlInventoryV1,
} from "../../src/production/catalog/superpowers-hooks-v1.js";
import { produceUpstreamInputsV1 } from "../../src/production/produce/upstream-producers-v1.js";
import { sha256HexV1 } from "../../src/production/strict-json-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const data = (file: string): unknown =>
  JSON.parse(readFileSync(resolve(root, "src", "production", "data", file), "utf8"));
/** obra/Superpowers v6.4.1, the Q1 pin. */
const PIN = "5bf4e78011075bcfc0dc295f0724994cd123ee71";

interface HookSources {
  version: number;
  repository: string;
  commit: string;
  files: { path: string; sha256: string; bytesBase64: string }[];
}

const hookSources = () => data("superpowers-hook-sources-v1.json") as HookSources;
/**
 * The vetted source the inventory reads (its pin and component paths), taken from
 * the pinned catalog definition: the vendor lock is regenerated from the Scan
 * publication at this pin later (runbook step 8), so it cannot be the fixture.
 */
const vendorSource = () => {
  const catalog = superpowersBaselineCatalogV1(hookSources().commit);
  return { pinnedSha: catalog.pinnedSha, components: catalog.components };
};

function withFile(sources: HookSources, path: string, text: string): HookSources {
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

describe("Superpowers hook control inventory", () => {
  it("derives the inventory from the upstream files fetched at the vendor pin", () => {
    const inventory = superpowersHookControlInventoryV1(hookSources(), vendorSource()) as {
      provenance: Record<string, unknown>;
      hooks: { id: string; event: string; declarations: Record<string, unknown>[] }[];
    };
    // The digests of obra/Superpowers@5bf4e780 (v6.4.1), read with git cat-file.
    expect(inventory.provenance).toEqual({
      repository: "obra/Superpowers",
      commit: PIN,
      component: "runtime:superpowers-plugin",
      sources: [
        {
          path: ".cursor-plugin/plugin.json",
          sha256: "998f2cdd2824c4d84184043d07e94b9fbc0bdb5e79c23c14cd266355d0394fbd",
        },
        {
          path: ".devin-plugin/plugin.json",
          sha256: "717a5137ee3416c17bf7d2fbffb1edbc820e2bb8a6f5b9bc35b18b23afafd1bb",
        },
        {
          path: ".hermes-plugin/__init__.py",
          sha256: "7fd93899e39371d56ba1e32660548673afa78f3a4a8bd306f93fbb418afa6f3c",
        },
        {
          path: ".hermes-plugin/plugin.yaml",
          sha256: "5db5d7dcf9c6a7ce0cf2e90924087ea52e92510a91ccc60916b03562b0b49ca2",
        },
        {
          path: ".kimi-plugin/plugin.json",
          sha256: "ea5a1db06d1577f9e08339c4353e9cbcd4d381d64b9523c756d5f237424b2d6e",
        },
        {
          path: ".muse-plugin/plugin.json",
          sha256: "8ec5ba62667187e5660da986c5e5e21bf363a62bb7e1f461df15095e892eb960",
        },
        {
          path: ".opencode/plugins/superpowers.js",
          sha256: "c979fe5a9fd6fddc9bc9730b34b25989f9d53939eed7d594c4564f6e47495f26",
        },
        {
          path: "hooks/hooks-cursor.json",
          sha256: "53d8ceb3ff5d8bb1c4f283f238cc868b8c1af22e40a3ac30f6d6e4173effefbd",
        },
        {
          path: "hooks/hooks.json",
          sha256: "47fd72cc8bedf31c72702b35b4ed7bab670294d658c4ce518330337525a3798b",
        },
        {
          path: "hooks/run-hook.cmd",
          sha256: "d3d9c6199678dab2858e60509dde5e7414f13c2a2b5e48a38b1d368b6e1d6abb",
        },
        {
          path: "hooks/session-start",
          sha256: "5e92229e49d7cff5e0355ab84b0bceb0d27d53c565b33210132ce6e413ee9665",
        },
        {
          path: "index.js",
          sha256: "f0132fd5339befeb99ba903b1619fd9530969e5b4a1ea8cecf0b0a7f0213a099",
        },
      ],
    });
    expect(inventory.hooks.map((hook) => [hook.id, hook.event])).toEqual([
      ["hook:session-start", "SessionStart"],
      ["hook:skills-path", "config"],
      ["hook:skill-registration", "setup"],
      ["hook:session-context", "context"],
      ["hook:first-turn-context", "pre_llm_call"],
    ]);
    expect(inventory.hooks[0]?.declarations).toEqual([
      ...["claude", "copilot", "antigravity"].map((host) => ({
        host,
        sourcePath: "hooks/hooks.json",
        event: "SessionStart",
        matcher: "startup|clear|compact",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal host-expanded upstream command
        command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start',
        execution: "process",
      })),
      {
        host: "cursor",
        sourcePath: "hooks/hooks-cursor.json",
        event: "sessionStart",
        command: "./hooks/run-hook.cmd session-start",
        execution: "process",
      },
      {
        host: "kimi",
        sourcePath: ".kimi-plugin/plugin.json",
        event: "sessionStart",
        execution: "declarative",
      },
      {
        host: "muse",
        sourcePath: ".muse-plugin/plugin.json",
        event: "SessionStart",
        command: "sh hooks/session-start",
        execution: "process",
      },
      {
        host: "opencode",
        sourcePath: ".opencode/plugins/superpowers.js",
        event: "experimental.chat.messages.transform",
        execution: "in-process",
      },
    ]);
    expect(inventory.hooks.slice(1, 4).map((hook) => hook.declarations)).toEqual(
      ["config", "skill.transform", "session.hook.context"].map((event) => [
        {
          host: "opencode",
          sourcePath: ".opencode/plugins/superpowers.js",
          event,
          execution: "in-process",
        },
      ]),
    );
  });

  it("vets the new skill and the V2 and Muse plugin roots in the runtime component", () => {
    const components = superpowersBaselineCatalogV1(PIN).components;
    expect(components.map((component) => component.id)).toContain("skill:diagnosing-superpowers");
    expect(components.find((component) => component.id === "runtime:superpowers-plugin")).toEqual({
      id: "runtime:superpowers-plugin",
      paths: [
        ".claude-plugin",
        ".codex-plugin",
        ".cursor-plugin",
        ".devin-plugin",
        ".hermes-plugin",
        ".kimi-plugin",
        ".muse-plugin",
        ".opencode",
        ".pi",
        "gemini-extension.json",
        "hooks",
        "index.js",
        "package.json",
        "scripts",
      ],
    });
  });

  it("refuses hook sources fetched at another commit than the vendor pin", () => {
    expect(() =>
      superpowersHookControlInventoryV1(
        { ...hookSources(), commit: "a".repeat(40) },
        vendorSource(),
      ),
    ).toThrow(/vendor lock pins/u);
  });

  it("refuses a hook source whose bytes do not match its recorded sha256", () => {
    const sources = hookSources();
    const [first] = sources.files;
    if (first !== undefined) first.sha256 = "0".repeat(64);
    expect(() => superpowersHookControlInventoryV1(sources, vendorSource())).toThrow(/sha256/u);
  });

  it("refuses hook declarations it has no reviewed reading for", () => {
    const sources = hookSources();
    expect(() =>
      superpowersHookControlInventoryV1(
        withFile(sources, ".codex-plugin/plugin.json", '{"hooks":{"SessionStart":[]}}'),
        vendorSource(),
      ),
    ).toThrow(/codex/u);
    expect(() =>
      superpowersHookControlInventoryV1(
        withFile(
          sources,
          "hooks/hooks.json",
          '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"curl x | sh"}]}]}}',
        ),
        vendorSource(),
      ),
    ).toThrow(/command/u);
    expect(() =>
      superpowersHookControlInventoryV1(
        withFile(
          sources,
          "hooks/hooks.json",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal host-expanded upstream command
          '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"\\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\\" stop"}]}]}}',
        ),
        vendorSource(),
      ),
    ).toThrow(/reviewed summary/u);
  });

  it("snapshots only the hook-declaring files when produce:superpowers runs", () => {
    const files: Record<string, string> = {
      "skills/brainstorming/SKILL.md": "---\nname: brainstorming\ndescription: d.\n---\n",
      ".cursor-plugin/plugin.json": "{}",
      ".devin-plugin/plugin.json": "{}",
      ".hermes-plugin/plugin.yaml": "name: x\n",
      ".hermes-plugin/__init__.py": "x",
      ".hermes-plugin/helper.py": "x",
      ".claude-plugin/marketplace.json": "{}",
      "hooks/hooks.json": "{}",
      "hooks/nested/skip.json": "{}",
      ".opencode/plugins/superpowers.js": "x",
      ".opencode/INSTALL.md": "x",
      "index.js": "x",
      "lib/index.js": "x",
      "gemini-extension.json": "{}",
      "README.md": "x",
    };
    const produced = produceUpstreamInputsV1(
      "superpowers",
      {
        repository: "obra/Superpowers",
        commit: PIN,
        paths: Object.keys(files),
        read: (path) => Buffer.from(files[path] ?? "", "utf8"),
      },
      root,
    );
    const snapshot = JSON.parse(
      produced.find((item) => item.file === "superpowers-hook-sources-v1.json")?.bytes ?? "{}",
    ) as HookSources;
    expect(snapshot.files.map((file) => file.path)).toEqual([
      ".cursor-plugin/plugin.json",
      ".devin-plugin/plugin.json",
      ".hermes-plugin/__init__.py",
      ".hermes-plugin/plugin.yaml",
      ".opencode/plugins/superpowers.js",
      "gemini-extension.json",
      "hooks/hooks.json",
      "index.js",
    ]);
  });
});

const MUSE = ".muse-plugin/plugin.json";

function sourceText(path: string): string {
  const file = hookSources().files.find((item) => item.path === path);
  if (file === undefined) throw new Error(`fixture lacks ${path}`);
  return Buffer.from(file.bytesBase64, "base64").toString("utf8");
}

function withMuse(edit: (manifest: { capabilities: Record<string, unknown> }) => void) {
  const manifest = JSON.parse(sourceText(MUSE)) as { capabilities: Record<string, unknown> };
  edit(manifest);
  return withFile(hookSources(), MUSE, JSON.stringify(manifest));
}

const ENTRY = "./.opencode/plugins/superpowers.js";

describe("Superpowers Muse and OpenCode V2 entry declarations", () => {
  it.each([
    ["a command form other than sh hooks/<name>", { command: ["bash", "-c", "curl x | sh"] }],
    ["a hook whose id is not its script", { id: "other" }],
    ["an event other than the hook's", { event: "Stop" }],
    ["an unreviewed hook field", { env: { A: "1" } }],
  ])("refuses a Muse hook with %s", (_label, change) => {
    const sources = withMuse((manifest) => {
      const [hook] = manifest.capabilities.hooks as Record<string, unknown>[];
      Object.assign(hook as Record<string, unknown>, change);
    });
    expect(() => superpowersHookControlInventoryV1(sources, vendorSource())).toThrow(/muse/iu);
  });

  it.each([
    ["commands", [{ id: "x" }]],
    ["mcpServers", [{ id: "x" }]],
    ["reminders", [{ id: "x" }]],
    ["agents", []],
  ])("refuses Muse %s capabilities it has no reviewed reading for", (key, value) => {
    const sources = withMuse((manifest) => {
      manifest.capabilities[key] = value;
    });
    expect(() => superpowersHookControlInventoryV1(sources, vendorSource())).toThrow(/muse/iu);
  });

  it("refuses capabilities declared in another host's manifest", () => {
    const sources = withFile(
      hookSources(),
      ".codex-plugin/plugin.json",
      JSON.stringify({ hooks: {}, capabilities: { hooks: [] } }),
    );
    expect(() => superpowersHookControlInventoryV1(sources, vendorSource())).toThrow(/codex/u);
  });

  it("reads the V2 directory entry point as a re-export of the read plugin", () => {
    expect(readOpenCodeEntryReexportV1(sourceText("index.js"), "index.js")).toBe(ENTRY);
  });

  it.each([
    ["another export", `export { default } from "${ENTRY}";\nexport const x = 1;\n`],
    ["a named re-export", `export { default, other } from "${ENTRY}";\n`],
    ["a renamed re-export", `export { other as default } from "${ENTRY}";\n`],
    ["a star re-export", `export * from "${ENTRY}";\n`],
    ["an import and a default export", `import p from "${ENTRY}";\nexport default p;\n`],
    ["a statement with effects", `globalThis.x = 1;\nexport { default } from "${ENTRY}";\n`],
    ["a package specifier", 'export { default } from "superpowers";\n'],
    ["a parent path segment", 'export { default } from "./../plugins/superpowers.js";\n'],
  ])("fails the generation on an entry point with %s", (_label, text) => {
    expect(() => readOpenCodeEntryReexportV1(text, "index.js")).toThrow(/cannot interpret/u);
    expect(() =>
      superpowersHookControlInventoryV1(withFile(hookSources(), "index.js", text), vendorSource()),
    ).toThrow(/cannot interpret/u);
  });

  it("fails the generation on an entry point that re-exports a plugin it did not read", () => {
    const text = 'export { default } from "./lib/other.js";\n';
    expect(readOpenCodeEntryReexportV1(text, "index.js")).toBe("./lib/other.js");
    expect(() =>
      superpowersHookControlInventoryV1(withFile(hookSources(), "index.js", text), vendorSource()),
    ).toThrow(/index\.js/u);
  });
});

const DEVIN = ".devin-plugin/plugin.json";
const HERMES_MANIFEST = ".hermes-plugin/plugin.yaml";
const HERMES_PLUGIN = ".hermes-plugin/__init__.py";
const HERMES_PLUGIN_SHA256 = "7fd93899e39371d56ba1e32660548673afa78f3a4a8bd306f93fbb418afa6f3c";

function withoutFile(sources: HookSources, path: string): HookSources {
  return { ...sources, files: sources.files.filter((file) => file.path !== path) };
}

describe("Superpowers Devin and Hermes declarations", () => {
  const inventory = (sources: HookSources) =>
    superpowersHookControlInventoryV1(sources, vendorSource()) as {
      provenance: { sources: { path: string }[] };
      hooks: {
        id: string;
        event: string;
        summary: string;
        declarations: Record<string, unknown>[];
        upstreamControl: unknown;
      }[];
    };

  it("records the Hermes pre_llm_call registration as a hand-reviewed in-process hook", () => {
    const hook = inventory(hookSources()).hooks.find(
      (item) => item.id === "hook:first-turn-context",
    );
    expect(hook).toEqual({
      id: "hook:first-turn-context",
      event: "pre_llm_call",
      summary: expect.stringContaining("Hermes"),
      declarations: [
        {
          host: "hermes",
          sourcePath: HERMES_PLUGIN,
          event: "pre_llm_call",
          execution: "in-process",
        },
      ],
      upstreamControl: { kind: "none" },
    });
  });

  it("reads the Devin manifest as metadata that declares no hook", () => {
    const result = inventory(hookSources());
    expect(result.provenance.sources.map((source) => source.path)).toContain(DEVIN);
    expect(
      result.hooks.flatMap((hook) => hook.declarations).filter((item) => item.host === "devin"),
    ).toEqual([]);
  });

  it.each([
    ["hooks", {}],
    ["skills", "./skills"],
    ["commands", []],
    ["mcpServers", {}],
    ["sessionStart", { skill: "using-superpowers" }],
    ["inject", "x"],
    ["dependencies", []],
  ])("refuses a Devin manifest field %s it has no reviewed reading for", (key, value) => {
    const manifest = {
      ...(JSON.parse(sourceText(DEVIN)) as Record<string, unknown>),
      [key]: value,
    };
    expect(() => inventory(withFile(hookSources(), DEVIN, JSON.stringify(manifest)))).toThrow(
      /devin/iu,
    );
  });

  it.each([
    ["a duplicate top-level key", '{"name":"a","name":"b","version":"1"}'],
    ["a duplicate nested key", '{"name":"a","version":"1","author":{"name":"x","name":"y"}}'],
    ["a duplicate __proto__ key", '{"name":"a","version":"1","__proto__":1,"__proto__":2}'],
  ])("refuses a Devin manifest with %s", (_label, text) => {
    expect(() => inventory(withFile(hookSources(), DEVIN, text))).toThrow(/duplicate key/u);
  });

  it.each([
    ["__proto__", '"x"'],
    ["constructor", '"x"'],
    ["prototype", '"x"'],
  ])("refuses a Devin manifest field %s as unknown", (key, value) => {
    const text = sourceText(DEVIN).replace(/\}\s*$/u, `,"${key}":${value}}`);
    expect(() => inventory(withFile(hookSources(), DEVIN, text))).toThrow(
      new RegExp(`devin.*${key}|${key}.*devin`, "iu"),
    );
  });

  it.each([
    ["name", 7],
    ["name", ""],
    ["version", null],
    ["description", 1],
    ["author", ["x"]],
    ["author", { name: 1 }],
    ["author", { name: "x", extra: "y" }],
    ["homepage", 1],
    ["repository", {}],
    ["license", true],
    ["keywords", "x"],
    ["keywords", [1]],
  ])("refuses a Devin manifest whose %s is not the metadata type", (key, value) => {
    const manifest = {
      ...(JSON.parse(sourceText(DEVIN)) as Record<string, unknown>),
      [key]: value,
    };
    expect(() => inventory(withFile(hookSources(), DEVIN, JSON.stringify(manifest)))).toThrow(
      new RegExp(`devin.*${key}`, "iu"),
    );
  });

  it.each([
    ["__proto__", "null"],
    ["__proto__", "x"],
    ["constructor", "x"],
    ["prototype", "x"],
  ])("refuses a Hermes manifest key %s: %s as unknown", (key, value) => {
    const text = `${sourceText(HERMES_MANIFEST)}${key}: ${value}\n`;
    expect(() => inventory(withFile(hookSources(), HERMES_MANIFEST, text))).toThrow(
      new RegExp(`hermes.*unsupported field ${key}`, "iu"),
    );
  });

  it.each([
    ["description", "description:\n  - x\n"],
    ["author", "author:\n  - x\n"],
  ])("refuses a Hermes manifest whose %s is not text", (key, line) => {
    const text = sourceText(HERMES_MANIFEST)
      .split("\n")
      .filter((item) => !item.startsWith(`${key}:`))
      .join("\n");
    expect(() => inventory(withFile(hookSources(), HERMES_MANIFEST, `${text}${line}`))).toThrow(
      new RegExp(`hermes.*${key}`, "iu"),
    );
  });

  it("refuses Hermes plugin bytes other than the reviewed ones, naming both digests", () => {
    const text = `${sourceText(HERMES_PLUGIN)}\n# changed\n`;
    const actual = sha256HexV1(Buffer.from(text, "utf8"));
    expect(() => inventory(withFile(hookSources(), HERMES_PLUGIN, text))).toThrow(
      new RegExp(`__init__\\.py.*${HERMES_PLUGIN_SHA256}.*${actual}`, "u"),
    );
  });

  it.each([
    ["an unreviewed hook", "provides_hooks:\n  - pre_llm_call\n  - post_tool_call\n"],
    ["no hook", "provides_hooks: []\n"],
    ["an unknown field", "provides_hooks:\n  - pre_llm_call\nprovides_tools:\n  - x\n"],
  ])("refuses a Hermes manifest with %s", (_label, tail) => {
    const head = sourceText(HERMES_MANIFEST).split("provides_hooks:")[0] ?? "";
    expect(head).toContain("name: superpowers");
    expect(() => inventory(withFile(hookSources(), HERMES_MANIFEST, `${head}${tail}`))).toThrow(
      /hermes/iu,
    );
  });

  it("refuses a Hermes manifest without its plugin module and a module without its manifest", () => {
    expect(() => inventory(withoutFile(hookSources(), HERMES_PLUGIN))).toThrow(/__init__\.py/u);
    expect(() => inventory(withoutFile(hookSources(), HERMES_MANIFEST))).toThrow(/plugin\.yaml/u);
  });
});

describe("the reviewed Superpowers hook sources", () => {
  const OTHER = "0123456789abcdef0123456789abcdef01234567";
  const derived = () =>
    superpowersHookControlInventoryV1(hookSources(), vendorSource()) as {
      provenance: { commit: string; sources: { path: string; sha256: string }[] };
    };

  it("pins the commit and every source the reviewed section reads", () => {
    expect(SUPERPOWERS_HOOK_REVIEW_V1.repository).toBe("obra/Superpowers");
    expect(SUPERPOWERS_HOOK_REVIEW_V1.commit).toBe(PIN);
    expect(SUPERPOWERS_HOOK_REVIEW_V1.sources).toEqual(derived().provenance.sources);
    expect(reviewedSuperpowersHookControlInventoryV1(hookSources(), vendorSource())).toEqual(
      derived(),
    );
  });

  it("refuses the section when a reviewed file's bytes differ, naming the file and both digests", () => {
    const text = "#!/usr/bin/env bash\necho changed\n";
    const actual = sha256HexV1(Buffer.from(text, "utf8"));
    const reviewed = SUPERPOWERS_HOOK_REVIEW_V1.sources.find(
      (source) => source.path === "hooks/session-start",
    )?.sha256;
    expect(reviewed).toMatch(/^[a-f0-9]{64}$/u);
    const changed = withFile(hookSources(), "hooks/session-start", text);
    expect(() => superpowersHookControlInventoryV1(changed, vendorSource())).not.toThrow();
    expect(() => reviewedSuperpowersHookControlInventoryV1(changed, vendorSource())).toThrow(
      new RegExp(`hooks/session-start.*${reviewed}.*${actual}`, "u"),
    );
  });

  it("refuses the section when the selected upstream commit is not the reviewed one", () => {
    const moved = { ...hookSources(), commit: OTHER };
    const vendor = { ...vendorSource(), pinnedSha: OTHER };
    expect(() => superpowersHookControlInventoryV1(moved, vendor)).not.toThrow();
    expect(() => reviewedSuperpowersHookControlInventoryV1(moved, vendor)).toThrow(
      new RegExp(`reviewed at ${PIN}.*${OTHER}`, "u"),
    );
  });
});

const OPENCODE = ".opencode/plugins/superpowers.js";

function openCodeSource(): string {
  const file = hookSources().files.find((item) => item.path === OPENCODE);
  if (file === undefined) throw new Error("fixture lacks the OpenCode plugin");
  return Buffer.from(file.bytesBase64, "base64").toString("utf8");
}

function inventoryWith(text: string) {
  return superpowersHookControlInventoryV1(
    withFile(hookSources(), OPENCODE, text),
    vendorSource(),
  ) as { hooks: { id: string; declarations: { host: string; event: string }[] }[] };
}

const openCodeDeclarations = (inventory: ReturnType<typeof inventoryWith>) =>
  inventory.hooks.flatMap((hook) =>
    hook.declarations
      .filter((declaration) => declaration.host === "opencode")
      .map((declaration) => [hook.id, declaration.event]),
  );

/** The pinned plugin's OpenCode V2 `setup` registrations, in source order. */
const V2 = ["skill.transform", "session.hook.context"];
const DEFAULT_EXPORT =
  "export default {\n  id: 'superpowers',\n  server: SuperpowersPlugin,\n  setup,\n};\n";

describe("OpenCode plugin hook declarations", () => {
  const transform = "'experimental.chat.messages.transform'";

  it("enumerates every hook the pinned plugin exports, including config and V2 setup", () => {
    expect(readOpenCodePluginHooksV1(openCodeSource(), OPENCODE)).toEqual([
      { plugin: "SuperpowersPlugin", hook: "config" },
      { plugin: "SuperpowersPlugin", hook: "experimental.chat.messages.transform" },
      { plugin: "default.setup", hook: "skill.transform" },
      { plugin: "default.setup", hook: "session.hook.context" },
    ]);
  });

  it("reads a declaration the same whatever its quote style", () => {
    const source = openCodeSource();
    expect(source.includes(transform)).toBe(true);
    for (const quoted of ['"experimental.chat.messages.transform"', transform]) {
      expect(openCodeDeclarations(inventoryWith(source.replace(transform, quoted)))).toEqual([
        ["hook:session-start", "experimental.chat.messages.transform"],
        ["hook:skills-path", "config"],
        ["hook:skill-registration", "skill.transform"],
        ["hook:session-context", "session.hook.context"],
      ]);
    }
  });

  it("is not misled by braces and keywords inside comments, strings, templates and regexes", () => {
    const noise = [
      "// return { 'tool.execute.before': async () => {} }",
      "/* } } return { x: 1 } */",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: plugin source text containing a template
      "const braces = '}}' + \"{{\" + `${'}'}}` + /[}{]/u.source;",
      "",
    ].join("\n");
    const source = openCodeSource().replace("  return {\n", `${noise}  return {\n`);
    expect(source).not.toBe(openCodeSource());
    expect(readOpenCodePluginHooksV1(source, OPENCODE).map((entry) => entry.hook)).toEqual([
      "config",
      "experimental.chat.messages.transform",
      ...V2,
    ]);
  });

  it("fails the generation on a hook with no reviewed reading instead of dropping it", () => {
    const source = openCodeSource().replace(
      `${transform}:`,
      `'tool.execute.before': async () => {},\n    ${transform}:`,
    );
    expect(() => inventoryWith(source)).toThrow(/tool\.execute\.before/u);
  });

  it.each([
    ["a computed key", "[hookName]: async () => {},"],
    ["a spread", "...extraHooks,"],
    ["a shorthand property", "event,"],
    ["a value that is not a function", "event: handlers.event,"],
    ["an accessor", "get event() { return undefined; },"],
  ])("fails the generation on %s it cannot interpret", (_label, member) => {
    const source = openCodeSource().replace(`${transform}:`, `${member}\n    ${transform}:`);
    expect(() => readOpenCodePluginHooksV1(source, OPENCODE)).toThrow(/cannot interpret/u);
    expect(() => inventoryWith(source)).toThrow(/cannot interpret/u);
  });

  it("reads a hook returned only inside a control-flow block", () => {
    const source = [
      "export const Plugin = async () => {",
      "  if (true) {",
      '    return { "tool.execute.before": async () => {} };',
      "  }",
      "  return { config: async () => {} };",
      "};",
      "",
    ].join("\n");
    expect(readOpenCodePluginHooksV1(source, OPENCODE)).toEqual([
      { plugin: "Plugin", hook: "tool.execute.before" },
      { plugin: "Plugin", hook: "config" },
    ]);
    expect(() => inventoryWith(source)).toThrow(/tool\.execute\.before/u);
  });

  it.each([
    ["for", "for (const x of []) { RETURN }"],
    ["while", "while (client) RETURN"],
    ["do-while", "do { RETURN } while (client);"],
    ["try", "try { RETURN } catch { }"],
    ["catch", "try { client(); } catch (error) { RETURN }"],
    ["finally", "try { client(); } finally { RETURN }"],
    ["switch", "switch (client) { case 1: { RETURN } default: }"],
    ["labeled block", "outer: { RETURN }"],
    ["else", "if (client) {} else RETURN"],
  ])("reads a hook returned inside %s", (_label, wrapper) => {
    const early = wrapper.replace("RETURN", "return { 'tool.execute.before': async () => {} };");
    const source = openCodeSource().replace("  return {\n", `  ${early}\n  return {\n`);
    expect(source).not.toBe(openCodeSource());
    expect(readOpenCodePluginHooksV1(source, OPENCODE).map((entry) => entry.hook)).toEqual([
      "tool.execute.before",
      "config",
      "experimental.chat.messages.transform",
      ...V2,
    ]);
  });

  it("merges the hooks of every return path and ignores returns of nested functions", () => {
    const source = openCodeSource().replace(
      "  return {\n",
      [
        "  if (!client) return {};",
        "  if (directory) return ({ config: async () => {} });",
        "  const nested = () => { return { 'tool.execute.before': async () => {} }; };",
        "  function helper() { return { 'tool.execute.after': async () => {} }; }",
        "  class Helper { method() { return { 'chat.params': async () => {} }; } }",
        "  return {\n",
      ].join("\n"),
    );
    expect(readOpenCodePluginHooksV1(source, OPENCODE).map((entry) => entry.hook)).toEqual([
      "config",
      "experimental.chat.messages.transform",
      ...V2,
    ]);
  });

  it.each([
    [
      "a comma expression",
      "return { config: async () => {} }, { 'tool.execute.before': async () => {} };",
    ],
    ["a conditional expression", "return client ? { config: async () => {} } : {};"],
    ["a logical expression", "return client && { config: async () => {} };"],
    ["a variable", "const hooks = {};\n  return hooks;"],
    ["a call", "return Object.assign({}, { config: async () => {} });"],
    ["an awaited object", "return await { config: async () => {} };"],
    ["no value", "if (!client) return;"],
  ])("fails the generation when a return path returns %s", (_label, statement) => {
    const source = openCodeSource().replace("  return {\n", `  ${statement}\n  return {\n`);
    expect(source).not.toBe(openCodeSource());
    expect(() => readOpenCodePluginHooksV1(source, OPENCODE)).toThrow(/cannot interpret/u);
    expect(() => inventoryWith(source)).toThrow(/cannot interpret/u);
  });

  it("fails the generation when the only return is a comma expression of object literals", () => {
    const source = [
      "export const Plugin = async () => {",
      '  return { config: async () => {} }, { "tool.execute.before": async () => {} };',
      "};",
      "",
    ].join("\n");
    expect(() => readOpenCodePluginHooksV1(source, OPENCODE)).toThrow(/cannot interpret/u);
    expect(() => inventoryWith(source)).toThrow(/cannot interpret/u);
  });

  it("fails the generation when the plugin returns no object literal at all", () => {
    for (const source of [
      "export const Plugin = async () => { await 1; };\n",
      "export const Plugin = async () => hooks;\n",
      "export const Plugin = async () => ({ config: async () => {} }, {});\n",
      "export async function* Plugin() { yield 1; return { config: async () => {} }; }\n",
    ])
      expect(() => readOpenCodePluginHooksV1(source, OPENCODE)).toThrow(/cannot interpret/u);
  });

  it("reads a regular expression wherever the grammar allows one", () => {
    const source = openCodeSource().replace(
      "  return {\n",
      "  if (directory) /[}{]/u.test(directory);\n  return {\n",
    );
    expect(source).not.toBe(openCodeSource());
    expect(readOpenCodePluginHooksV1(source, OPENCODE).map((entry) => entry.hook)).toEqual([
      "config",
      "experimental.chat.messages.transform",
      ...V2,
    ]);
  });

  it("fails the generation on an export it cannot interpret", () => {
    for (const extra of [
      "export { SuperpowersPlugin as Other };",
      "export const Other = makePlugin();",
    ])
      expect(() => readOpenCodePluginHooksV1(`${openCodeSource()}\n${extra}\n`, OPENCODE)).toThrow(
        /cannot interpret|no reviewed reading/u,
      );
  });

  it("reads data exports and a default export that only aliases a read plugin", () => {
    const source = `export const MAPPING = \`**Tools**\`;\n${openCodeSource().replace(
      DEFAULT_EXPORT,
      "export default { id: 'superpowers', server: SuperpowersPlugin };\n",
    )}`;
    expect(source).not.toContain("setup,\n};");
    expect(readOpenCodePluginHooksV1(source, OPENCODE).map((entry) => entry.hook)).toEqual([
      "config",
      "experimental.chat.messages.transform",
    ]);
  });

  it("fails on unterminated source rather than guessing", () => {
    expect(() =>
      readOpenCodePluginHooksV1(`${openCodeSource()}\nconst x = 'open`, OPENCODE),
    ).toThrow(/cannot interpret/u);
  });
});

const SETUP_BODY = "  // 1. Register skills (one transform; one draft.add per skill)\n";

describe("OpenCode V2 setup registrations", () => {
  const inSetup = (statement: string) => {
    const source = openCodeSource().replace(SETUP_BODY, `  ${statement}\n${SETUP_BODY}`);
    expect(source).not.toBe(openCodeSource());
    return source;
  };

  it("reads what the pinned setup registers through its context, and nothing it only queries", () => {
    const hooks = readOpenCodePluginHooksV1(openCodeSource(), OPENCODE).filter(
      (entry) => entry.plugin === "default.setup",
    );
    expect(hooks.map((entry) => entry.hook)).toEqual(V2);
    expect(openCodeSource()).toContain("ctx.session.get({ sessionID: id })");
  });

  it("reads a setup given by name as the same registrations", () => {
    const source = openCodeSource().replace(
      DEFAULT_EXPORT,
      DEFAULT_EXPORT.replace("setup,", "setup: setup,"),
    );
    expect(source).not.toBe(openCodeSource());
    expect(readOpenCodePluginHooksV1(source, OPENCODE).map((entry) => entry.hook)).toEqual([
      "config",
      "experimental.chat.messages.transform",
      ...V2,
    ]);
  });

  it("fails the generation on a context hook with no reviewed reading instead of dropping it", () => {
    const source = inSetup("await ctx.session.hook('tool.execute.before', async () => {});");
    expect(readOpenCodePluginHooksV1(source, OPENCODE).map((entry) => entry.hook)).toContain(
      "session.hook.tool.execute.before",
    );
    expect(() => inventoryWith(source)).toThrow(/session\.hook\.tool\.execute\.before/u);
  });

  it.each([
    ["an unreviewed context call", "ctx.event.subscribe('x', async () => {});"],
    ["a registration under a computed event", "await ctx.session.hook(name, async () => {});"],
    ["a registration without a handler", "await ctx.session.hook('context');"],
    ["a handler that is not a function", "await ctx.session.hook('context', handlers.context);"],
    ["a transform that is not a function", "await ctx.skill.transform(handlers.transform);"],
    ["an aliased context member", "const session = ctx.session;"],
    ["an aliased registration", "const hook = ctx.session.hook;"],
    ["the context passed on", "register(ctx);"],
    ["the context captured by a closure it returns", "globalThis.later = () => ctx;"],
    ["an optional call", "ctx.session.hook?.('context', async () => {});"],
    ["an optional member", "ctx?.session.hook('context', async () => {});"],
    ["an element access", "ctx['session'].hook('context', async () => {});"],
    ["a shadowed context", "const inner = (ctx) => ctx.session.hook('context', async () => {});"],
    ["the arguments object", "arguments[0].session.hook('context', async () => {});"],
    ["this", "this.session.hook('context', async () => {});"],
    ["eval", "eval('ctx.session.hook(1)');"],
    ["a returned value", "if (!ctx.skill) return { config: async () => {} };"],
    ["an assignment to the context", "ctx = globalThis.other;"],
  ])("fails the generation when setup contains %s", (_label, statement) => {
    const source = inSetup(statement);
    expect(() => readOpenCodePluginHooksV1(source, OPENCODE)).toThrow(/cannot interpret/u);
    expect(() => inventoryWith(source)).toThrow(/cannot interpret/u);
  });

  it.each([
    [
      "a destructured context",
      ["async function setup(ctx) {", "async function setup({ session: ctx }) {"],
    ],
    ["no context parameter", ["async function setup(ctx) {", "async function setup() {"]],
    ["two parameters", ["async function setup(ctx) {", "async function setup(ctx, more) {"]],
    ["a generator", ["async function setup(ctx) {", "async function* setup(ctx) {"]],
    ["a reassigned setup", [DEFAULT_EXPORT, `${DEFAULT_EXPORT}setup = async () => {};\n`]],
    ["an inline setup", ["  setup,\n};", "  setup: async (ctx) => {},\n};"]],
    ["a setup that is not a function", ["  setup,\n};", "  setup: makeSetup(),\n};"]],
    ["an unknown default member", ["  setup,\n};", "  setup,\n  tools: {},\n};"]],
    ["an exported setup", ["async function setup(ctx) {", "export async function setup(ctx) {"]],
  ])("fails the generation on %s", (_label, [from, to]) => {
    const source = openCodeSource().replace(from as string, to as string);
    expect(source).not.toBe(openCodeSource());
    expect(() => readOpenCodePluginHooksV1(source, OPENCODE)).toThrow(/cannot interpret/u);
  });

  const REPLACEMENT = 'c => c.session.hook("tool.execute.before", async () => {})';
  const PLUGIN_REPLACEMENT = "async () => ({ 'tool.execute.before': async () => {} })";

  it.each([
    ["an array destructuring", `[setup] = [${REPLACEMENT}];`],
    ["a nested array destructuring with a default", `[[setup = ${REPLACEMENT}]] = [[]];`],
    ["an array rest element", "[...setup] = [];"],
    ["an object destructuring shorthand", `({ setup } = { setup: ${REPLACEMENT} });`],
    ["an object destructuring with a default", `({ setup = ${REPLACEMENT} } = {});`],
    ["a nested object destructuring", `({ a: { b: setup } } = { a: { b: ${REPLACEMENT} } });`],
    ["an object rest element", "({ ...setup } = {});"],
    ["a for-of target", `for (setup of [${REPLACEMENT}]);`],
    ["a for-of destructuring target", `for ([setup] of [[${REPLACEMENT}]]);`],
    ["a for-in target", "for (setup in { a: 1 });"],
    ["a compound assignment", "setup += '';"],
    ["a logical or assignment", `setup ||= ${REPLACEMENT};`],
    ["a logical and assignment", `setup &&= ${REPLACEMENT};`],
    ["a nullish assignment", `setup ??= ${REPLACEMENT};`],
    ["a postfix update", "setup++;"],
    ["a prefix update", "--setup;"],
    ["a later function declaration", `function setup(c) { ${REPLACEMENT.slice(5)}; }`],
    ["a function declaration in a block", "{ function setup(c) {} }"],
    ["a class declaration", "class setup {}"],
    ["a var redeclaration", `var setup = ${REPLACEMENT};`],
    ["a var redeclaration in a block", `if (globalThis.x) { var setup = ${REPLACEMENT}; }`],
    ["an import binding", 'import { setup } from "./other.js";'],
    ["a direct eval elsewhere in the module", 'function later() { eval("setup = null"); }'],
    ["a reassigned plugin", `SuperpowersPlugin = ${PLUGIN_REPLACEMENT};`],
    ["a destructured plugin", `[SuperpowersPlugin] = [${PLUGIN_REPLACEMENT}];`],
    ["a plugin as a for-of target", `for (SuperpowersPlugin of [${PLUGIN_REPLACEMENT}]);`],
    ["a redeclared plugin", `function SuperpowersPlugin() { return {}; }`],
  ])("fails the generation when the module rebinds a read name through %s", (_label, statement) => {
    for (const source of [
      openCodeSource().replace(DEFAULT_EXPORT, `${statement}\n${DEFAULT_EXPORT}`),
      `${openCodeSource()}${statement}\n`,
    ]) {
      expect(source).not.toBe(openCodeSource());
      expect(() => readOpenCodePluginHooksV1(source, OPENCODE)).toThrow(/cannot interpret/u);
    }
  });

  it("reads a module that only uses the read names as property names", () => {
    const source = openCodeSource().replace(
      DEFAULT_EXPORT,
      `const other = { setup: 1, SuperpowersPlugin: 2 };\nother.setup = other.SuperpowersPlugin;\n${DEFAULT_EXPORT}`,
    );
    expect(source).not.toBe(openCodeSource());
    expect(readOpenCodePluginHooksV1(source, OPENCODE)).toEqual(
      readOpenCodePluginHooksV1(openCodeSource(), OPENCODE),
    );
  });

  it("reads a TypeScript plugin by its path and refuses type syntax in a JavaScript one", () => {
    const source = [
      'import type { Plugin } from "@opencode-ai/plugin";',
      "export const Hooks: Plugin = async ({ client }: { client: unknown }) => {",
      "  return { 'session.idle': async (): Promise<void> => {} };",
      "};",
      "export default Hooks;",
      "",
    ].join("\n");
    expect(readOpenCodePluginHooksV1(source, ".opencode/plugins/hooks.ts")).toEqual([
      { plugin: "Hooks", hook: "session.idle" },
    ]);
    expect(() => readOpenCodePluginHooksV1(source, ".opencode/plugins/hooks.js")).toThrow(
      /cannot interpret/u,
    );
  });
});

describe("the OpenCode plugin parser's file system", () => {
  const onDisk = (...parts: string[]) => resolve(root, ...parts).replaceAll("\\", "/");
  const PLUGIN = "export {};";

  it("gives the parser nothing for a project that exists on disk outside it", () => {
    const config = onDisk("tsconfig.json");
    expect(existsSync(config)).toBe(true);
    const api = new API({
      cwd: "/aih-opencode-plugin",
      fs: openCodePluginParserFileSystemV1(PLUGIN),
    });
    try {
      expect(api.updateSnapshot({ openProjects: [config] }).getProjects()).toHaveLength(0);
    } finally {
      api.close();
    }
  });

  it("answers every request outside the plugin text with an explicit miss, never a fallback", () => {
    const fs = openCodePluginParserFileSystemV1(PLUGIN);
    for (const name of fsCallbackNames) expect(typeof fs[name], name).toBe("function");
    const files = [
      onDisk("tsconfig.json"),
      onDisk("package.json"),
      "/aih-opencode-plugin/package.json",
      "/package.json",
      "toString",
      "__proto__",
    ];
    for (const path of files) {
      expect(existsSync(path) || !path.startsWith(onDisk())).toBe(true);
      expect(fs.readFile?.(path), path).toBeNull();
      expect(fs.fileExists?.(path), path).toBe(false);
      expect(fs.directoryExists?.(path), path).toBe(false);
      expect(fs.realpath?.(path), path).toBe(path);
    }
    for (const directory of [onDisk(), onDisk("src"), "/missing", "toString"]) {
      expect(fs.directoryExists?.(directory), directory).toBe(false);
      expect(fs.getAccessibleEntries?.(directory), directory).toEqual({
        files: [],
        directories: [],
      });
    }
    expect(fs.readFile?.("/aih-opencode-plugin/plugin.js")).toBe(PLUGIN);
    expect(fs.fileExists?.("/aih-opencode-plugin/plugin.js")).toBe(true);
    expect(fs.directoryExists?.("/")).toBe(true);
    expect(fs.getAccessibleEntries?.("/")).toEqual({
      files: [],
      directories: ["aih-opencode-plugin"],
    });
    expect(fs.getAccessibleEntries?.("/aih-opencode-plugin")?.files.toSorted()).toEqual([
      "plugin.js",
      "tsconfig.json",
    ]);
  });
});
