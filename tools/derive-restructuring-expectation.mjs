#!/usr/bin/env node
// Derives the amended expected projection for release 1.7 from the promoted
// October dry run (restructuring/dry-run-20261023.json). Every difference from
// the dry run is an amendment below with its reason; nothing else changes.
// Deterministic: `--check` refuses a stale restructuring/expected-1.7.0.json.
// Run `npm run build:dist` first. No acquisition or execution.
//
//   node tools/derive-restructuring-expectation.mjs [--check]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  projectBasicsRouterDoc,
  projectBasicsSharedBlock,
  projectBasicsWorkingRulesDoc,
} from "../dist/release/context-content.js";
import { FROZEN_DEFAULT_RELEASE_SHA256 } from "../dist/release/contracts.js";
import { mcpEditsSha256, RESTRUCTURING_EXPECTATION_SCHEMA_ID } from "../dist/release/producer.js";

const root = resolve(import.meta.dirname, "..");
const PROJECTION = "restructuring/dry-run-20261023.json";
const OUTPUT = "restructuring/expected-1.7.0.json";
const projectionBytes = readFileSync(resolve(root, PROJECTION));
const projection = JSON.parse(projectionBytes.toString("utf8"));
const sorted = (list, key) => [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

const AMENDMENTS = [
  { id: "behaviour-files", reason: "The dry run predates behaviour files. Content identities are unaffected (they cover content materials only), so the expected contentSha256 values stand; no behaviourSha256 is predicted and none is compared." },
  { id: "default-closing-release", reason: "The dry run moved the 18 client adapters and pointers to Core and the 27 Matt copies out of the default. Release 1.7 keeps the frozen default unchanged and adds a closing default release with no items whose retired[] gives all 46 a reason: adapters and pointers have no successor and name Core's per-tool delivery; Matt copies name their Extensions items." },
  { id: "matt-supersession", reason: "Each of the 27 Matt copies in the frozen default is superseded by its Extensions item with match name+sourcePath against the frozen default's exact digest; the dry run found 0 of 27 hash matches." },
  { id: "project-basics-split", reason: "The dry run kept the project context as one rule. The maintainer split it into three Project basics items, named by samartomar/aih-catalog#137: the router, a guide document; the working rules and the shared block, two rules. Each carries the folder-neutral form of one material of the frozen default's project context, rendered once by the authored context renderer: it names its neighbours by their place in the folder a project chooses, never a folder name, and promises no per-tool adapter notes. Its content identity is therefore predicted from that rendered text at its item-relative path, not from the frozen bytes; each supersedes the project context by split, and the default's project-context retirement names the three." },
  { id: "copy-supersession", reason: "Per-tool copies that collapse are superseded by hash when their content identity equals the survivor's, otherwise by name and source path; the dry run listed them without a match." },
  { id: "copies-retired", reason: "Every collapsed copy is also retired with its replacement, and templates and frameworks become sets, so their ids are retired; the dry run only marked them." },
  { id: "folded-hook-sources", reason: "Hook source items fold into their hook items. The hook ids are decided with the framework migrations, so these retirements are pending on those tickets." },
  { id: "superpowers-retirements", reason: "The dry run left 10 Superpowers items unmapped. The 9 per-tool plugin bundles and the duplicate skill library are retired with no item successor; upstream plugin routes become nativeRoutes." },
  { id: "superpowers-bootstrap-fallback", reason: "The session bootstrap hook gains a one-line rule as its fallback, an item the dry run did not have. samartomar/aih-catalog#144 names it superpowers.rule.session-bootstrap; its content identity is predicted from its authored line in producer/superpowers/release-1-7.json at its item-relative path, and the bootstrap source the hook folds is retired with the hook as its replacement." },
  { id: "superpowers-pinned-revision", reason: "The dry run read Superpowers at an earlier upstream revision than the snapshot this package pins (upstream 6.4.1), so its Superpowers content identities name other bytes. They are predicted again, with the dry run's rule (item-relative paths, a skill's files below its own folder, the hook carrying the bootstrap source it folds), from the pinned materials of the committed release-superpowers.json. Items, kinds, supersessions and retirements are the dry run's." },
  { id: "mcp-edit-digests", reason: "Each MCP survivor records whether its shipped definition is identical to upstream or edited; an edit is digested as SHA-256 of the canonical JSON {from: upstream, to: shipped} plus LF, in upstream's own encoding." },
];

// The three Project basics items samartomar/aih-catalog#137 names, the frozen
// project-context material each splits, and its folder-neutral rendered text.
const BASICS = [
  { id: "project-basics.router", kind: "document", purpose: "guide", material: "rule-router", relPath: "RULE_ROUTER.md", render: projectBasicsRouterDoc },
  { id: "project-basics.shared-block", kind: "rule", material: "shared-block", relPath: "shared-block.md", render: projectBasicsSharedBlock },
  { id: "project-basics.working-rules", kind: "rule", material: "behavior-core", relPath: "rules/agent-behavior-core.md", render: projectBasicsWorkingRulesDoc },
];
const PENDING_HOOK = "the hook item it folds into is named by its framework migration";
// Superpowers at the pinned revision: each survivor's predicted content identity over
// the committed release's pinned materials, and the hook each folded source names.
const SUPERPOWERS = JSON.parse(readFileSync(resolve(root, "release/release-superpowers.json"), "utf8"));
const SUPERPOWERS_DATA = JSON.parse(readFileSync(resolve(root, "producer/superpowers/release-1-7.json"), "utf8"));
const FOLDED = { [SUPERPOWERS_DATA.hook.folds]: SUPERPOWERS_DATA.hook.id };
const contentIdentity = (lines) => createHash("sha256").update(lines.sort().join("")).digest("hex");
function superpowersIdentity(id) {
  const revision = `/${SUPERPOWERS.sources[0].origin.revision}/`;
  const item = (itemId) => SUPERPOWERS.items.find((entry) => entry.id === itemId) ?? assert.fail(`No Superpowers ${itemId}`);
  const lines = (materials, relPath) => materials.map((member) => `${relPath(member.path.slice(member.path.indexOf(revision) + revision.length))}\t${member.sha256}\n`);
  if (id === SUPERPOWERS_DATA.hook.id) return contentIdentity(lines(item(SUPERPOWERS_DATA.hook.folds).materials, (path) => path));
  const skill = /^superpowers\.skill\.(.+)$/.exec(id)?.[1];
  if (skill !== undefined) return contentIdentity(lines(item(id).materials, (path) => path.startsWith(`skills/${skill}/`) ? path.slice(`skills/${skill}/`.length) : path));
  return contentIdentity(lines(item(id).materials, (path) => path));
}
const rule = SUPERPOWERS_DATA.fallback;
const SUPERPOWERS_RULE = { id: rule.id, kind: "rule",
  contentSha256: contentIdentity([`${rule.relPath}\t${createHash("sha256").update(rule.text).digest("hex")}\n`]) };
const before = new Map(projection.before.map((item) => [`${item.framework}|${item.id}`, item]));
const frameworks = {};
for (const framework of ["anthropic", "ecc", "extensions", "superpowers"]) {
  const survivors = projection.survivors.filter((item) => item.framework === framework);
  const live = new Set(survivors.map((item) => item.id));
  const supersessions = [];
  for (const survivor of survivors) {
    for (const old of survivor.supersedes) {
      if (old.framework === "default") {
        supersessions.push({ survivor: survivor.id, itemId: old.itemId, match: "name+sourcePath", releaseSha256: FROZEN_DEFAULT_RELEASE_SHA256 });
      } else if (old.itemId !== survivor.id) {
        const copy = before.get(`${old.framework}|${old.itemId}`);
        supersessions.push({ survivor: survivor.id, itemId: old.itemId,
          match: copy?.contentSha256 === survivor.contentSha256 ? "hash" : "name+sourcePath" });
      }
    }
  }
  const mcpByKey = new Map(projection.mcp.map((server) => [server.key, server]));
  const mcpSurvivors = survivors.filter((item) => item.kind === "mcp-server");
  const edits = mcpSurvivors.map((item) => {
    const server = mcpByKey.get(item.name);
    assert(server, `No dry-run MCP payload for ${item.id}`);
    return server.transform === "edited"
      ? { survivor: item.id, transform: "edited", editsSha256: mcpEditsSha256({ from: server.upstream, to: server.shipped }) }
      : { survivor: item.id, transform: "identical" };
  });
  const retired = [];
  for (const item of projection.before.filter((entry) => entry.framework === framework)) {
    if (live.has(item.id)) continue;
    if (item.target === "fold-into-hook" && Object.hasOwn(FOLDED, item.id))
      retired.push({ id: item.id, replacedBy: [{ framework, itemId: FOLDED[item.id] }] });
    else if (item.target === "fold-into-hook") retired.push({ id: item.id, pending: PENDING_HOOK });
    else if (item.survivor !== undefined && live.has(item.survivor))
      retired.push({ id: item.id, replacedBy: [{ framework, itemId: item.survivor }] });
    else if (item.target === "set" || item.target === "unmapped") retired.push({ id: item.id, replacedBy: [] });
    else assert.fail(`Unaccounted dry-run item ${framework}/${item.id} (${item.target})`);
  }
  frameworks[framework] = {
    status: "expected",
    items: sorted([...survivors.map((item) => ({ id: item.id, kind: item.kind, ...(item.purpose ? { purpose: item.purpose } : {}),
      contentSha256: framework === "superpowers" ? superpowersIdentity(item.id) : item.contentSha256 })),
      ...(framework === "superpowers" ? [SUPERPOWERS_RULE] : [])], (item) => item.id),
    supersessions: sorted(supersessions, (entry) => `${entry.survivor}\u0000${entry.itemId}`),
    mcpPairs: sorted(mcpSurvivors.filter((item) => item.from.length > 1).map((item) => ({ survivor: item.id, copies: item.from })), (entry) => entry.survivor),
    edits: sorted(edits, (entry) => entry.survivor),
    retired: sorted(retired, (entry) => entry.id),
  };
}
// The closing default release: no items, and a durable reason for each of the 46.
const defaults = projection.before.filter((item) => item.framework === "default");
assert.equal(defaults.length, 46);
frameworks.default = {
  status: "expected",
  items: [],
  supersessions: [],
  mcpPairs: [],
  edits: [],
  retired: sorted(defaults.map((item) => item.target === "core"
    ? { id: item.id, replacedBy: [] }
    : item.target === "retired"
      ? { id: item.id, replacedBy: [{ framework: "extensions", itemId: item.survivor }] }
      : { id: item.id, replacedBy: BASICS.map((entry) => ({ framework: "project-basics", itemId: entry.id })) }), (entry) => entry.id),
};
// Project basics: each item's predicted content identity is the release 1.6/1.7
// line `relPath<TAB>sha256<LF>` over its folder-neutral rendered text; the frozen
// default's project context supplies the material it splits.
const frozenBytes = readFileSync(resolve(root, "release/release.json"));
assert.equal(createHash("sha256").update(frozenBytes).digest("hex"), FROZEN_DEFAULT_RELEASE_SHA256);
const context = JSON.parse(frozenBytes.toString("utf8")).items.find((item) => item.id === "aihq.project-context");
assert(context, "The frozen default carries no project context");
assert.equal(defaults.filter((item) => item.target !== "core" && item.target !== "retired").map((item) => item.id).join(), context.id);
frameworks["project-basics"] = {
  status: "expected",
  items: sorted(BASICS.map((entry) => {
    assert(context.materials.some((member) => member.id === entry.material), `No frozen material ${entry.material}`);
    const rendered = createHash("sha256").update(entry.render()).digest("hex");
    return { id: entry.id, kind: entry.kind, ...(entry.purpose ? { purpose: entry.purpose } : {}),
      contentSha256: createHash("sha256").update(`${entry.relPath}\t${rendered}\n`).digest("hex") };
  }), (item) => item.id),
  supersessions: sorted(BASICS.map((entry) => ({ survivor: entry.id, itemId: context.id, match: "split", releaseSha256: FROZEN_DEFAULT_RELEASE_SHA256 })), (entry) => entry.survivor),
  mcpPairs: [],
  edits: [],
  retired: [],
};

const counts = {
  mattSupersessions: frameworks.extensions.supersessions.filter((entry) => entry.releaseSha256 === FROZEN_DEFAULT_RELEASE_SHA256).length,
  mcpPairs: frameworks.ecc.mcpPairs.length,
  editedMcp: frameworks.ecc.edits.filter((entry) => entry.transform === "edited").length,
  defaultRetirements: frameworks.default.retired.length,
};
assert.deepEqual(counts, { mattSupersessions: 27, mcpPairs: 32, editedMcp: 15, defaultRetirements: 46 });
const expectation = {
  schema: RESTRUCTURING_EXPECTATION_SCHEMA_ID,
  derivedFrom: { path: PROJECTION, sha256: createHash("sha256").update(projectionBytes).digest("hex") },
  amendments: AMENDMENTS,
  counts,
  frameworks,
};
const bytes = `${JSON.stringify(expectation, null, 1)}\n`;
if (process.argv.includes("--check")) {
  assert.equal(readFileSync(resolve(root, OUTPUT), "utf8"), bytes, `Stale ${OUTPUT}; run node tools/derive-restructuring-expectation.mjs`);
  console.log(`Checked ${OUTPUT}: ${Object.keys(frameworks).length} frameworks, ${AMENDMENTS.length} amendments`);
} else {
  writeFileSync(resolve(root, OUTPUT), bytes);
  console.log(`Derived ${OUTPUT}: ${JSON.stringify(counts)}`);
}
