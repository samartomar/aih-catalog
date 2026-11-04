/**
 * Content Catalog authors itself (framework and source `aih`), shipped with the library so a
 * plan can place it without the caller supplying it: the duplicate-resolver agent a plan that
 * mixes frameworks adds where its clients support agents. The record is the one `buildContent`
 * gives over these bytes (a test holds them equal), so the installer copies or renders it like
 * any other item, taking the bytes from `files`.
 */
import { formats } from "../contracts.js";
import { behaviourSha256, contentSha256 } from "./identity.js";
import { deepFreeze } from "./json.js";
import type { Content, Item, ItemFile } from "./model.js";
import { sha256Hex } from "./sha256.js";

export const AUTHORED_FRAMEWORK = "aih";
export const DUPLICATE_RESOLVER = "aih.agent.duplicate-resolver";
export const DUPLICATES_REPORT = ".aihq/duplicates.json";

const RESOLVER_PATH = "agents/duplicate-resolver.md";
const RESOLVER_TEXT = `---
name: aih-duplicate-resolver
description: Resolves overlap after AI frameworks are mixed. Reads the duplicates report, finds items that share a name, content or purpose, asks the user which to keep, and only then switches the others off.
---
You help the user resolve overlap between the AI frameworks installed together here.

1. Read \`.aihq/duplicates.json\` in the project, or \`~/.aihq/duplicates.json\` for a user-level installation. It lists items that share an install name or have identical content, with their frameworks and the clients they were planned for. It records facts only: nothing has been chosen.
2. Look for overlap the report cannot show: items with different names that do the same job, such as \`tdd\` and \`test-driven-development\`. Read each item's description and text before you decide that two overlap.
3. Show the user each overlap: the items, the framework each came from, and how they differ. Ask which one to keep. Never choose for the user, and never treat the first or the newest as the winner.
4. Only after the user answers, switch off the items they did not keep, the way their client supports it: remove or rename that installed copy, or use the client's documented setting to turn off a built-in. Change nothing the user did not approve.
5. A skill that a plugin installs may not be switchable on its own; Claude Code, for example, locks plugin skills. Then offer two choices: remove the whole plugin, or keep both and accept the overlap.
6. Never edit an item's upstream text to make it fit. When you finish, list exactly what you changed.
`;

const bytes = new TextEncoder().encode(RESOLVER_TEXT);
const file: ItemFile = {
  sourceId: AUTHORED_FRAMEWORK,
  sourcePath: RESOLVER_PATH,
  sha256: sha256Hex(bytes),
  bytes: bytes.byteLength,
  executable: false,
  role: "content",
};
const resolverBase = {
  kind: "agent" as const,
  files: [file],
  agent: { prompt: RESOLVER_PATH },
};
const resolver: Item = {
  id: DUPLICATE_RESOLVER,
  ...resolverBase,
  name: "aih-duplicate-resolver",
  description:
    "Resolves overlap after AI frameworks are mixed. Reads the duplicates report, finds items that share a name, content or purpose, asks the user which to keep, and only then switches the others off.",
  contentSha256: contentSha256([file]),
  behaviourSha256: behaviourSha256(resolverBase, null),
  scanKey: "git-sha1:9ef59a84018bbcb9f130cd794aaf629076d3ba3c",
};

/** Catalog's own content and the bytes of its files, for placing and rendering. */
export const aihContent: {
  readonly content: Content;
  readonly files: readonly {
    readonly sourceId: string;
    readonly sourcePath: string;
    readonly bytes: Uint8Array;
  }[];
} = Object.freeze({
  content: deepFreeze({
    schema: formats.content,
    framework: { id: AUTHORED_FRAMEWORK, name: "AIH" },
    sources: [{ id: AUTHORED_FRAMEWORK, kind: "authored" as const, notices: [] }],
    items: [resolver],
  }),
  // Each read gives a fresh copy, so no caller can change the bytes another plan renders.
  files: Object.freeze([
    Object.freeze({
      sourceId: AUTHORED_FRAMEWORK,
      sourcePath: RESOLVER_PATH,
      get bytes() {
        return bytes.slice();
      },
    }),
  ]),
});
