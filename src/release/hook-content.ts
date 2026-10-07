/**
 * Internal, portable renderer for the authored client hook items published in the
 * 1.1 release. Each item delivers a separately owned wrapper script with Core's
 * `file.write` and registers one client hook group through Core's owned
 * `hook.group` operation (recipe 1.1). The group is identified by a documented,
 * stable scalar the client already reads (the wrapper command), never by a field
 * Core invents. `tools/generate-release.mjs` writes the result; no Node built-ins.
 */
import type { Json } from "./contracts.js";
import { CORE_RECIPE_SCHEMA_ID_1_1 } from "./contracts.js";
import { canonicalJson, deepFreeze } from "./json.js";
import { sha256Hex } from "./sha256.js";

export const HOOK_SOURCE_ID = "aihq-client-hooks";
export const HOOK_SOURCE = Object.freeze({
  id: HOOK_SOURCE_ID,
  origin: Object.freeze({ kind: "authored" }),
});

const OUTPUT_ROOT = "release";
const encoder = new TextEncoder();
const documentBytes = (value: unknown): Uint8Array => encoder.encode(`${canonicalJson(value)}\n`);
const literalTarget = (segments: readonly string[]) => ({
  root: "project",
  segments: segments.map((segment) => ({ literal: segment })),
});

const PROTECT_ENV_SCRIPT = `// AIHQ Claude Code PreToolUse hook. Exit 2 blocks an Edit or Write call.
// This protects direct file edits only; it is not a sandbox for shell commands.
let payload;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  console.error("Blocked by AIHQ: unreadable hook input. Review this edit manually.");
  process.exit(2);
}
if (payload?.tool_name === "Edit" || payload?.tool_name === "Write") {
  const path = payload?.tool_input?.file_path;
  if (typeof path !== "string") {
    console.error("Blocked by AIHQ: edit path is missing. Review this edit manually.");
    process.exit(2);
  }
  const name = path.replaceAll("\\\\", "/").split("/").at(-1);
  // Windows stream syntax addresses the base file, including its default $DATA stream.
  const normalizedName = (process.platform === "win32" ? name?.split(":")[0] : name)?.toLowerCase();
  if (normalizedName && /^\\.env(?:\\..+)?$/.test(normalizedName) &&
      ![".env.example", ".env.sample", ".env.template"].includes(normalizedName)) {
    console.error("Blocked by AIHQ: " + name + " is a local environment file. Ask the user to change it.");
    process.exit(2);
  }
}
`;

interface ClientHook {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly settings: readonly string[];
  readonly event: string;
  readonly matcher: string;
  readonly scriptTarget: readonly string[];
  /** The documented project path placeholder, quoted for the client's shell form. */
  readonly command: string;
  readonly script: string;
  readonly client: string;
}

const CLAUDE_PROTECT_ENV: ClientHook = {
  id: "aihq.hook.claude.protect-env",
  label: "Claude Code: protect env files",
  description:
    "Opt-in Claude Code hook that blocks direct Edit and Write calls on local .env files (not .env.example).",
  settings: [".claude", "settings.json"],
  event: "PreToolUse",
  matcher: "Edit|Write",
  scriptTarget: [".claude", "hooks", "aihq-protect-env.mjs"],
  command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/aihq-protect-env.mjs"',
  script: PROTECT_ENV_SCRIPT,
  client: "claude-code",
};

export interface RenderedHookFamily {
  /** Package-relative recipe and material paths (release document excluded) → bytes. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Release item records, sorted by ID, exactly as a release document carries them. */
  readonly items: readonly Record<string, Json>[];
}

function hookItem(files: Map<string, Uint8Array>, hook: ClientHook): Record<string, Json> {
  const scriptBytes = encoder.encode(hook.script);
  const scriptPath = `${OUTPUT_ROOT}/materials/aihq/client-hooks/${hook.id}/${hook.scriptTarget.join("/")}`;
  files.set(scriptPath, scriptBytes);
  const script = {
    id: "script",
    sha256: sha256Hex(scriptBytes),
    byteLength: scriptBytes.length,
  };
  const recipe = {
    schema: CORE_RECIPE_SCHEMA_ID_1_1,
    id: hook.id,
    description: `Install the ${hook.client} ${hook.event} wrapper script and register its hook group in ${hook.settings.join("/")} without touching neighboring hook groups.`,
    inputs: {},
    materials: [script],
    targets: ["project"],
    prerequisites: [{ kind: "executable", name: "node" }],
    operations: [
      {
        id: "write-script",
        purpose: `Write the pinned ${hook.scriptTarget.join("/")} wrapper`,
        kind: "file.write",
        scope: "project",
        target: literalTarget(hook.scriptTarget),
        material: "script",
        requires: [],
        checks: ["script-sha256"],
      },
      {
        id: "register-hook",
        purpose: `Add the ${hook.event} group for ${hook.matcher} to ${hook.settings.join("/")}`,
        kind: "hook.group",
        scope: "project",
        target: literalTarget(hook.settings),
        format: "json",
        container: ["hooks", hook.event],
        groupId: "protect-env",
        selector: { path: ["hooks", 0, "command"], value: hook.command },
        action: "set",
        group: {
          literal: { matcher: hook.matcher, hooks: [{ type: "command", command: hook.command }] },
        },
        requires: ["write-script"],
        checks: [],
      },
    ],
    checks: [
      {
        id: "script-sha256",
        purpose: `The installed ${hook.scriptTarget.join("/")} has the pinned bytes`,
        kind: "file.sha256",
        target: literalTarget(hook.scriptTarget),
        sha256: script.sha256,
      },
    ],
  };
  const recipeBytes = documentBytes(recipe);
  const recipePath = `${OUTPUT_ROOT}/recipes/${hook.id}.json`;
  files.set(recipePath, recipeBytes);
  return {
    id: hook.id,
    label: hook.label,
    description: hook.description,
    kind: "hook",
    sourceIds: [HOOK_SOURCE_ID],
    targets: [{ kind: "executable", name: "node" }],
    scopes: ["project"],
    inputs: {},
    recipe: {
      id: hook.id,
      schema: CORE_RECIPE_SCHEMA_ID_1_1,
      path: recipePath,
      sha256: sha256Hex(recipeBytes),
      byteLength: recipeBytes.length,
    },
    materials: [{ ...script, path: scriptPath }],
    dependencies: { requires: [], optional: [], conflicts: [] },
    metadata: { client: hook.client, event: hook.event },
  };
}

/** Every authored client hook item with its recipe and material bytes, deterministically. */
export function renderHookFamily(): RenderedHookFamily {
  const files = new Map<string, Uint8Array>();
  const items = [CLAUDE_PROTECT_ENV]
    .map((hook) => hookItem(files, hook))
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  return { files, items: deepFreeze(items) };
}
