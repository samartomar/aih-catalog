import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readOpenCodePluginHooksV1 } from "../../src/production/catalog/opencode-plugin-hooks-v1.js";
import { superpowersHookControlInventoryV1 } from "../../src/production/catalog/superpowers-hooks-v1.js";
import {
  buildCatalogFrameworkDefaultsV1,
  serializeCatalogDefaultV1,
} from "../../src/production/catalog-defaults-v1.js";
import { produceUpstreamInputsV1 } from "../../src/production/produce/upstream-producers-v1.js";
import { sha256HexV1 } from "../../src/production/strict-json-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const data = (file: string): unknown =>
  JSON.parse(readFileSync(resolve(root, "src", "production", "data", file), "utf8"));
const PIN = "b36e0829c6d0140e93cfef2ca599b1b07d4a7797";

interface HookSources {
  version: number;
  repository: string;
  commit: string;
  files: { path: string; sha256: string; bytesBase64: string }[];
}

const hookSources = () => data("superpowers-hook-sources-v1.json") as HookSources;
const vendorSource = () =>
  (data("vendor-lock-v1.json") as { sources: { id: string }[] }).sources.find(
    (source) => source.id === "superpowers",
  );

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
    const descriptor = buildCatalogFrameworkDefaultsV1(root)[
      "defaults/catalog-framework-superpowers-v1.json"
    ] as { sections: { hookControlInventory: Record<string, unknown> } };
    const inventory = descriptor.sections.hookControlInventory as {
      provenance: Record<string, unknown>;
      hooks: { id: string; event: string; declarations: Record<string, unknown>[] }[];
    };
    // The digests Core recorded for obra/Superpowers@b36e0829 (v6.3.0).
    expect(inventory.provenance).toEqual({
      repository: "obra/Superpowers",
      commit: PIN,
      component: "runtime:superpowers-plugin",
      sources: [
        {
          path: ".cursor-plugin/plugin.json",
          sha256: "6bdbd1aba18726b9445196eb341313347870955cb15cdabf3e4b5cb1788af3cb",
        },
        {
          path: ".kimi-plugin/plugin.json",
          sha256: "847469c0c2b1f0cec8dedcce53f9ef14092d0138012d670d65a49e0de30d5031",
        },
        {
          path: ".opencode/plugins/superpowers.js",
          sha256: "a5c5e1dbb0abfbd6ec3322b724b9a7b3318bbbb3d83f9a661c56ae0ed0a3adb8",
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
          sha256: "88a060272ca8047e0d1cd73a016e1cebba8396807a44be1e296d7c02dcbb9934",
        },
      ],
    });
    expect(inventory.hooks.map((hook) => [hook.id, hook.event])).toEqual([
      ["hook:session-start", "SessionStart"],
      ["hook:skills-path", "config"],
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
        host: "opencode",
        sourcePath: ".opencode/plugins/superpowers.js",
        event: "experimental.chat.messages.transform",
        execution: "in-process",
      },
    ]);
    expect(inventory.hooks[1]?.declarations).toEqual([
      {
        host: "opencode",
        sourcePath: ".opencode/plugins/superpowers.js",
        event: "config",
        execution: "in-process",
      },
    ]);
    expect(serializeCatalogDefaultV1(descriptor)).toBe(
      readFileSync(resolve(root, "defaults", "catalog-framework-superpowers-v1.json"), "utf8"),
    );
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
      ".claude-plugin/marketplace.json": "{}",
      "hooks/hooks.json": "{}",
      "hooks/nested/skip.json": "{}",
      ".opencode/plugins/superpowers.js": "x",
      ".opencode/INSTALL.md": "x",
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
      ".opencode/plugins/superpowers.js",
      "gemini-extension.json",
      "hooks/hooks.json",
    ]);
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

describe("OpenCode plugin hook declarations", () => {
  const transform = "'experimental.chat.messages.transform'";

  it("enumerates every hook the pinned plugin exports, including config", () => {
    expect(readOpenCodePluginHooksV1(openCodeSource(), OPENCODE)).toEqual([
      { plugin: "SuperpowersPlugin", hook: "config" },
      { plugin: "SuperpowersPlugin", hook: "experimental.chat.messages.transform" },
    ]);
  });

  it("reads a declaration the same whatever its quote style", () => {
    const source = openCodeSource();
    expect(source.includes(transform)).toBe(true);
    for (const quoted of ['"experimental.chat.messages.transform"', transform]) {
      expect(openCodeDeclarations(inventoryWith(source.replace(transform, quoted)))).toEqual([
        ["hook:session-start", "experimental.chat.messages.transform"],
        ["hook:skills-path", "config"],
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

  it("fails the generation when the plugin's hooks are not one returned object literal", () => {
    const early = openCodeSource().replace(
      "  return {\n",
      "  if (!client) return {};\n  return {\n",
    );
    expect(() => readOpenCodePluginHooksV1(early, OPENCODE)).toThrow(/cannot interpret/u);
    const built = openCodeSource().replace("  return {\n", "  const hooks = {\n");
    expect(() => readOpenCodePluginHooksV1(built, OPENCODE)).toThrow(/cannot interpret/u);
  });

  it("fails the generation on an export it cannot interpret", () => {
    for (const extra of [
      "export { SuperpowersPlugin as Other };",
      "export const Other = makePlugin();",
      "export default { id: 'superpowers', server: SuperpowersPlugin, setup };",
    ])
      expect(() => readOpenCodePluginHooksV1(`${openCodeSource()}\n${extra}\n`, OPENCODE)).toThrow(
        /cannot interpret|no reviewed reading/u,
      );
  });

  it("reads data exports and a default export that only aliases a read plugin", () => {
    const source = `export const MAPPING = \`**Tools**\`;\n${openCodeSource()}\nexport default { id: 'superpowers', server: SuperpowersPlugin };\n`;
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
