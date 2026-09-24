import { codeUnitCompare, sha256HexV1 } from "../strict-json-v1.js";
import {
  COMMIT_SHA,
  exactKeys,
  type JsonRecord,
  list,
  literal,
  record,
  SHA256_HEX,
  text,
} from "../validate-v1.js";
import { readOpenCodePluginHooksV1 } from "./opencode-plugin-hooks-v1.js";

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
};

/**
 * Reviewed readings of the hooks an OpenCode plugin returns. A reading without
 * `event` joins the SessionStart hook; one with `event` is its own hook.
 */
const OPENCODE_HOOKS: Readonly<Record<string, { hook: string; event?: string }>> = {
  "experimental.chat.messages.transform": { hook: "session-start" },
  config: { hook: "skills-path", event: "config" },
};

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** The upstream files a hook reading could need; the fetch keeps only these. */
export function isSuperpowersHookSourcePathV1(path: string): boolean {
  return (
    /^\.[a-z0-9-]+-plugin\/plugin\.json$/u.test(path) ||
    path === "gemini-extension.json" ||
    /^hooks\/[^/]+$/u.test(path) ||
    /^\.opencode\/plugins\/[^/]+\.js$/u.test(path)
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
