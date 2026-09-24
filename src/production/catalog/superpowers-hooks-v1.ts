import { codeUnitCompare, sha256HexV1 } from "../strict-json-v1.js";
import {
  COMMIT_SHA,
  exactKeys,
  integer,
  type JsonRecord,
  list,
  literal,
  record,
  SHA256_HEX,
  text,
} from "../validate-v1.js";
import { parseYamlFrontmatterV1 } from "../yaml-frontmatter-v1.js";
import {
  readOpenCodeEntryReexportV1,
  readOpenCodePluginHooksV1,
} from "./opencode-plugin-hooks-v1.js";
import { assertReviewedSourcesV1, type ReviewedSourcesV1 } from "./reviewed-sources-v1.js";

/**
 * Derives the Superpowers `hookControlInventory` descriptor section from the
 * hook-declaring upstream files `produce:superpowers` fetched at the vendor
 * pin. Only files inside the vetted `runtime:superpowers-plugin` component are
 * read; every hook declaration must have a reviewed reading here, otherwise
 * the build fails closed. The shape is the one Core's
 * `@aihq/framework-superpowers` plugin reads.
 */
export const SUPERPOWERS_HOOK_SOURCES_FILE_V1 = "superpowers-hook-sources-v1.json";

const REPOSITORY = "obra/Superpowers";
const COMPONENT = "runtime:superpowers-plugin";

/** Hosts that load the Claude-format `hooks/hooks.json` from the plugin. */
const CLAUDE_FORMAT_HOSTS = ["claude", "copilot", "antigravity"] as const;

/** Reviewed, user-visible summaries; a hook without one is not published. */
const HOOK_SUMMARIES: Readonly<Record<string, string>> = {
  "session-start":
    "Injects the full using-superpowers skill into the agent's context when a session starts, is cleared, or compacts.",
  "skills-path":
    "Adds the Superpowers skills directory to the host's skill search paths when the host loads its configuration, so the Superpowers skills are discovered without manual links.",
  "skill-registration":
    "On OpenCode V2, registers every Superpowers skill with the host's native skill registry when the plugin is set up.",
  "session-context":
    "On OpenCode V2, injects the full using-superpowers skill into the first user message of each top-level session through the session context hook.",
  "first-turn-context":
    "On Hermes Agent, appends the full using-superpowers skill, how to load Superpowers skills on Hermes, the local skills directory and the Hermes tool mapping to the first turn's user message through the pre_llm_call hook.",
};

/** The Devin manifest is metadata only (Devin discovers `skills/` itself); any other field refuses. */
const DEVIN_MANIFEST = ".devin-plugin/plugin.json";
const DEVIN_METADATA = ["description", "author", "homepage", "repository", "license", "keywords"];

/**
 * Hermes loads `.hermes-plugin/__init__.py` and calls its `register(ctx)`. A
 * Python module has no mechanical reading here, so its hooks are a hand
 * review keyed by the module's sha256: other bytes have no reading and refuse.
 * The review at 5bf4e780: `register` locates the plugin's `skills/` tree
 * (raising if absent), registers each skill with `ctx.register_skill`, builds a
 * bootstrap text from `skills/using-superpowers/SKILL.md` and
 * `references/hermes-tools.md`, and registers one hook, `pre_llm_call`, which
 * returns `{"context": bootstrap}` on the first turn and nothing otherwise. It
 * reads only those local files: no process, network or write.
 */
const HERMES_MANIFEST = ".hermes-plugin/plugin.yaml";
const HERMES_PLUGIN = ".hermes-plugin/__init__.py";
const HERMES_REVIEWED_PLUGIN: { sha256: string; hooks: Readonly<Record<string, string>> } = {
  sha256: "7fd93899e39371d56ba1e32660548673afa78f3a4a8bd306f93fbb418afa6f3c",
  hooks: { pre_llm_call: "first-turn-context" },
};

/**
 * Reviewed readings of the hooks an OpenCode plugin returns (V1) or registers
 * from `setup` (V2). A reading without `event` joins the SessionStart hook; one
 * with `event` is its own hook. The V2 registrations are hooks of their own
 * because a hook carries at most one declaration per host.
 */
const OPENCODE_HOOKS: Readonly<Record<string, { hook: string; event?: string }>> = {
  "experimental.chat.messages.transform": { hook: "session-start" },
  config: { hook: "skills-path", event: "config" },
  "skill.transform": { hook: "skill-registration", event: "setup" },
  "session.hook.context": { hook: "session-context", event: "context" },
};

/**
 * The commit and bytes the hand-written summaries and readings above were
 * reviewed against: every file the section reads. The section is emitted only
 * over exactly these bytes (obra/Superpowers v6.4.1).
 */
export const SUPERPOWERS_HOOK_REVIEW_V1: ReviewedSourcesV1 = {
  repository: REPOSITORY,
  commit: "5bf4e78011075bcfc0dc295f0724994cd123ee71",
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
};

/** The OpenCode V2 directory entry point; it may only re-export a read plugin. */
const OPENCODE_ENTRY = "index.js";

/** The Muse manifest capabilities with a reviewed reading; only `hooks` may be non-empty. */
const MUSE_CAPABILITIES = ["skills", "commands", "hooks", "mcpServers", "reminders"] as const;

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** The upstream files a hook reading could need; the fetch keeps only these. */
export function isSuperpowersHookSourcePathV1(path: string): boolean {
  return (
    /^\.[a-z0-9-]+-plugin\/plugin\.json$/u.test(path) ||
    path === "gemini-extension.json" ||
    /^hooks\/[^/]+$/u.test(path) ||
    path === HERMES_MANIFEST ||
    path === HERMES_PLUGIN ||
    /^\.opencode\/plugins\/[^/]+\.js$/u.test(path) ||
    path === OPENCODE_ENTRY
  );
}

interface HookSourceFileV1 {
  path: string;
  sha256: string;
  bytes: Buffer;
}

function parseHookSources(value: unknown): {
  commit: string;
  files: Map<string, HookSourceFileV1>;
} {
  const label = "Superpowers hook sources";
  const input = exactKeys(
    record(value, label),
    ["version", "repository", "commit", "files"],
    label,
  );
  literal(input.version, 1, `${label} version`);
  literal(input.repository, REPOSITORY, `${label} repository`);
  const commit = text(input.commit, `${label} commit`, COMMIT_SHA);
  const files = new Map<string, HookSourceFileV1>();
  for (const item of list(input.files, `${label} files`, 1, 64)) {
    const file = exactKeys(record(item, `${label} file`), ["path", "sha256", "bytesBase64"], label);
    const path = text(file.path, `${label} file path`);
    if (!isSuperpowersHookSourcePathV1(path) || files.has(path))
      throw new TypeError(`${label} carries unexpected or duplicate ${path}`);
    const sha256 = text(file.sha256, `${label} ${path} sha256`, SHA256_HEX);
    const bytes = Buffer.from(text(file.bytesBase64, `${label} ${path} bytes`), "base64");
    if (bytes.toString("base64") !== file.bytesBase64 || sha256HexV1(bytes) !== sha256)
      throw new TypeError(`${label} ${path} does not match its recorded sha256`);
    files.set(path, { path, sha256, bytes });
  }
  return { commit, files };
}

function json(file: HookSourceFileV1): JsonRecord {
  return record(JSON.parse(file.bytes.toString("utf8")), file.path);
}

interface DeclarationV1 {
  host: string;
  sourcePath: string;
  event: string;
  matcher?: string;
  command?: string;
  execution: "process" | "in-process" | "declarative";
}

/** `run-hook.cmd <name>` runs `hooks/<name>`; any other command form is unreviewed. */
function hookScript(command: string, path: string): string {
  const match =
    /^(?:"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/run-hook\.cmd"|\.\/hooks\/run-hook\.cmd) ([a-z0-9][a-z0-9-]*)$/u.exec(
      command,
    );
  if (match === null) throw new TypeError(`${path} has an unreviewed hook command ${command}`);
  return match[1] as string;
}

function commandHooks(
  file: HookSourceFileV1,
  claudeFormat: boolean,
): { name: string; event: string; matcher?: string; command: string }[] {
  const hooks = record(json(file).hooks, `${file.path} hooks`);
  return Object.entries(hooks).flatMap(([event, entries]) =>
    list(entries, `${file.path} ${event}`, 1).flatMap((raw) => {
      const entry = record(raw, `${file.path} ${event} entry`);
      if (!claudeFormat) {
        const command = text(entry.command, `${file.path} ${event} command`);
        return [{ name: hookScript(command, file.path), event, command }];
      }
      const matcher =
        entry.matcher === undefined
          ? undefined
          : text(entry.matcher, `${file.path} ${event} matcher`);
      return list(entry.hooks, `${file.path} ${event} hooks`, 1).map((rawHook) => {
        const hook = record(rawHook, `${file.path} ${event} hook`);
        literal(hook.type, "command", `${file.path} ${event} hook type`);
        const command = text(hook.command, `${file.path} ${event} command`);
        return {
          name: hookScript(command, file.path),
          event,
          ...(matcher === undefined ? {} : { matcher }),
          command,
        };
      });
    }),
  );
}

export function superpowersHookControlInventoryV1(
  hookSources: unknown,
  vendorSource: unknown,
): JsonRecord {
  const { commit, files } = parseHookSources(hookSources);
  const vendor = record(vendorSource, "Superpowers vendor source");
  if (vendor.pinnedSha !== commit)
    throw new TypeError(
      `Superpowers hook sources were fetched at ${commit} but the vendor lock pins ${String(vendor.pinnedSha)}`,
    );
  const component = list(vendor.components, "Superpowers vendor components")
    .map((item) => record(item, "Superpowers vendor component"))
    .find((item) => item.id === COMPONENT);
  if (component === undefined) throw new TypeError(`Superpowers vendor lock has no ${COMPONENT}`);
  const roots = list(component.paths, `${COMPONENT} paths`).map((path) => text(path, COMPONENT));
  const inComponent = (path: string) =>
    roots.some((rootPath) => path === rootPath || path.startsWith(`${rootPath}/`));
  const read = (path: string): HookSourceFileV1 | undefined =>
    inComponent(path) ? files.get(path) : undefined;
  const need = (path: string, why: string): HookSourceFileV1 => {
    const file = read(path);
    if (file === undefined) throw new TypeError(`${why} names ${path}, which was not fetched`);
    return file;
  };

  const recorded = new Set<string>();
  const byHook = new Map<string, { event: string; declarations: DeclarationV1[] }>();
  const addProcess = (
    file: HookSourceFileV1,
    hosts: readonly string[],
    claudeFormat: boolean,
  ): void => {
    recorded.add(file.path);
    for (const hook of commandHooks(file, claudeFormat)) {
      if (!Object.hasOwn(HOOK_SUMMARIES, hook.name))
        throw new TypeError(`Superpowers hook ${hook.name} has no reviewed summary`);
      recorded.add(need("hooks/run-hook.cmd", file.path).path);
      recorded.add(need(`hooks/${hook.name}`, file.path).path);
      const entry = byHook.get(hook.name) ?? { event: hook.event, declarations: [] };
      byHook.set(hook.name, entry);
      for (const host of hosts)
        entry.declarations.push({
          host,
          sourcePath: file.path,
          event: hook.event,
          ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
          command: hook.command,
          execution: "process",
        });
    }
  };
  const sessionStartHook = () => {
    const matches = [...byHook.entries()].filter(([, hook]) => hook.event === "SessionStart");
    if (matches.length !== 1 || matches[0] === undefined)
      throw new TypeError("a session-start declaration needs exactly one SessionStart hook");
    return matches[0][1];
  };

  const claude = read("hooks/hooks.json");
  if (claude !== undefined) addProcess(claude, CLAUDE_FORMAT_HOSTS, true);
  const manifests = [...files.keys()]
    .filter((path) => /^\.[a-z0-9-]+-plugin\/plugin\.json$/u.test(path) && inComponent(path))
    .sort(codeUnitCompare);
  for (const path of manifests) {
    const host = path.slice(1, path.indexOf("-plugin/"));
    const manifest = json(need(path, path));
    if (path === DEVIN_MANIFEST) {
      exactKeys(
        manifest,
        ["name", "version"],
        `${path} (Devin reads metadata only)`,
        DEVIN_METADATA,
      );
      recorded.add(path);
      continue;
    }
    const hooks = manifest.hooks;
    if (hooks !== undefined) {
      if (host === "cursor" && typeof hooks === "string") {
        const target = hooks.replace(/^\.\//u, "");
        recorded.add(path);
        addProcess(need(target, path), [host], false);
      } else if (
        hooks === null ||
        typeof hooks !== "object" ||
        Array.isArray(hooks) ||
        Object.keys(hooks).length !== 0
      )
        throw new TypeError(
          `${path} declares ${host} hooks this Catalog has no reviewed reading for`,
        );
    }
    if (manifest.capabilities !== undefined) {
      if (host !== "muse")
        throw new TypeError(
          `${path} declares ${host} capabilities this Catalog has no reviewed reading for`,
        );
      const capabilities = exactKeys(
        record(manifest.capabilities, `${path} capabilities`),
        MUSE_CAPABILITIES,
        `${path} capabilities`,
      );
      list(capabilities.skills, `${path} skills`);
      for (const key of ["commands", "mcpServers", "reminders"])
        list(capabilities[key], `${path} ${key} (no reviewed reading)`, 0, 0);
      recorded.add(path);
      for (const raw of list(capabilities.hooks, `${path} hooks`)) {
        const label = `${path} hook`;
        const hook = exactKeys(record(raw, label), ["id", "event", "command"], label, [
          "timeoutMs",
        ]);
        const name = text(hook.id, `${label} id`, /^[a-z0-9][a-z0-9-]*$/u);
        const event = text(hook.event, `${label} ${name} event`);
        const command = list(hook.command, `${label} ${name} command`, 2, 2);
        if (command[0] !== "sh" || command[1] !== `hooks/${name}`)
          throw new TypeError(`${path} has an unreviewed ${host} hook command for ${name}`);
        if (hook.timeoutMs !== undefined) integer(hook.timeoutMs, `${label} ${name} timeoutMs`, 1);
        const target = byHook.get(name);
        if (target === undefined || target.event !== event)
          throw new TypeError(
            `${path} declares ${host} hook ${name} on ${event}, which no reviewed hook file declares`,
          );
        recorded.add(need(`hooks/${name}`, path).path);
        target.declarations.push({
          host,
          sourcePath: path,
          event,
          command: `sh hooks/${name}`,
          execution: "process",
        });
      }
    }
    if (manifest.sessionStart !== undefined) {
      if (host !== "kimi")
        throw new TypeError(`${path} declares a ${host} sessionStart this Catalog cannot read`);
      text(
        record(manifest.sessionStart, `${path} sessionStart`).skill,
        `${path} sessionStart skill`,
      );
      recorded.add(path);
      sessionStartHook().declarations.push({
        host,
        sourcePath: path,
        event: "sessionStart",
        execution: "declarative",
      });
    }
  }
  const gemini = read("gemini-extension.json");
  if (gemini !== undefined && json(gemini).hooks !== undefined)
    throw new TypeError("gemini-extension.json declares hooks this Catalog cannot read");
  const openCodePlugins = [...files.keys()]
    .filter((path) => /^\.opencode\/plugins\/[^/]+\.js$/u.test(path) && inComponent(path))
    .sort(codeUnitCompare);
  for (const path of openCodePlugins) {
    recorded.add(path);
    for (const { plugin, hook } of readOpenCodePluginHooksV1(
      UTF8.decode(need(path, path).bytes),
      path,
    )) {
      const reading = OPENCODE_HOOKS[hook];
      if (reading === undefined || !Object.hasOwn(OPENCODE_HOOKS, hook))
        throw new TypeError(
          `${path} ${plugin} declares OpenCode hook ${hook}, which has no reviewed reading`,
        );
      let target = reading.event === undefined ? sessionStartHook() : byHook.get(reading.hook);
      if (target === undefined) {
        target = { event: reading.event as string, declarations: [] };
        byHook.set(reading.hook, target);
      }
      if (target.declarations.some((declaration) => declaration.host === "opencode"))
        throw new TypeError(`${path} ${plugin} declares OpenCode hook ${hook} more than once`);
      target.declarations.push({
        host: "opencode",
        sourcePath: path,
        event: hook,
        execution: "in-process",
      });
    }
  }

  if (inComponent(OPENCODE_ENTRY)) {
    const entry = need(OPENCODE_ENTRY, "runtime:superpowers-plugin");
    const target = readOpenCodeEntryReexportV1(UTF8.decode(entry.bytes), entry.path).slice(2);
    if (!openCodePlugins.includes(target))
      throw new TypeError(
        `${OPENCODE_ENTRY} re-exports ${target}, which this Catalog did not read as an OpenCode plugin`,
      );
    recorded.add(entry.path);
  }

  if (inComponent(HERMES_MANIFEST) || inComponent(HERMES_PLUGIN)) {
    const manifestFile = need(HERMES_MANIFEST, "the Hermes plugin");
    const plugin = need(HERMES_PLUGIN, "the Hermes plugin");
    const label = `${HERMES_MANIFEST} (Hermes manifest)`;
    const manifest = exactKeys(
      parseYamlFrontmatterV1(UTF8.decode(manifestFile.bytes), label),
      ["name", "version", "provides_hooks"],
      label,
      ["description", "author"],
    );
    text(manifest.name, `${label} name`);
    text(manifest.version, `${label} version`);
    const declared = list(manifest.provides_hooks, `${label} provides_hooks`, 1).map((hook) =>
      text(hook, `${label} provides_hooks entry`),
    );
    if (plugin.sha256 !== HERMES_REVIEWED_PLUGIN.sha256)
      throw new TypeError(
        `${HERMES_PLUGIN} was reviewed with sha256 ${HERMES_REVIEWED_PLUGIN.sha256} but the fetched bytes have sha256 ${plugin.sha256}; this Catalog has no reading for them`,
      );
    const reviewed = Object.keys(HERMES_REVIEWED_PLUGIN.hooks);
    if (
      new Set(declared).size !== declared.length ||
      declared.length !== reviewed.length ||
      declared.some((hook) => !reviewed.includes(hook))
    )
      throw new TypeError(
        `${label} provides hooks ${declared.join(", ")}, but the reviewed Hermes plugin registers exactly ${reviewed.join(", ")}`,
      );
    recorded.add(manifestFile.path);
    recorded.add(plugin.path);
    for (const [event, name] of Object.entries(HERMES_REVIEWED_PLUGIN.hooks)) {
      if (byHook.has(name)) throw new TypeError(`Superpowers hook ${name} is declared twice`);
      byHook.set(name, {
        event,
        declarations: [{ host: "hermes", sourcePath: plugin.path, event, execution: "in-process" }],
      });
    }
  }

  const hooks = [...byHook.entries()].map(([name, hook]) => {
    const summary = HOOK_SUMMARIES[name];
    if (summary === undefined)
      throw new TypeError(`Superpowers hook ${name} has no reviewed summary`);
    return {
      id: `hook:${name}`,
      event: hook.event,
      summary,
      declarations: hook.declarations,
      upstreamControl: { kind: "none" },
    };
  });
  if (hooks.length === 0) throw new TypeError("Superpowers declares no hooks at the pin");
  return {
    provenance: {
      repository: REPOSITORY,
      commit,
      component: COMPONENT,
      sources: [...recorded]
        .sort(codeUnitCompare)
        .map((path) => ({ path, sha256: files.get(path)?.sha256 as string })),
    },
    hooks,
  };
}

/**
 * The descriptor section: the derived inventory, refused unless the selected
 * upstream commit and every file it read are the reviewed ones.
 */
export function reviewedSuperpowersHookControlInventoryV1(
  hookSources: unknown,
  vendorSource: unknown,
): JsonRecord {
  const inventory = superpowersHookControlInventoryV1(hookSources, vendorSource);
  const provenance = inventory.provenance as ReviewedSourcesV1;
  assertReviewedSourcesV1("the Superpowers hook review", SUPERPOWERS_HOOK_REVIEW_V1, provenance);
  return inventory;
}
