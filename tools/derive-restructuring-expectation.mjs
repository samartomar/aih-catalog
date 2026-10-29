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
import { isHookRegistrationPath } from "../dist/release/document.js";
import { mcpEditsSha256, RESTRUCTURING_EXPECTATION_SCHEMA_ID } from "../dist/release/producer.js";

const root = resolve(import.meta.dirname, "..");
const PROJECTION = "restructuring/dry-run-20261023.json";
const OUTPUT = "restructuring/expected-1.7.0.json";
const projectionBytes = readFileSync(resolve(root, PROJECTION));
const projection = JSON.parse(projectionBytes.toString("utf8"));
const mcpAcquisition = JSON.parse(readFileSync(resolve(root, "producer/ecc/mcp-acquisition.json")));
const mcpFacts = JSON.parse(readFileSync(resolve(root, "producer/ecc/inventory.json"))).itemFacts;
const sorted = (list, key) => [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

const AMENDMENTS = [
  { id: "mcp-adoption-176", reason: "Catalog #176 supplies reviewed exact Node locks and isolated Python server projections, replaces obsolete providers and updates documented hosted endpoints. Upstream material/content identities remain unchanged; authored recipe, runtime and MCP edit identities change. Native/service readiness stays independently qualified." },
  { id: "behaviour-files", reason: "The dry run predates behaviour files. Content identities are unaffected (they cover content materials only), so the expected contentSha256 values stand; no behaviourSha256 is predicted and none is compared." },
  { id: "default-closing-release", reason: "The dry run moved the 18 client adapters and pointers to Core and the 27 Matt copies out of the default. Release 1.7 keeps the frozen default unchanged and adds a closing default release with no items whose retired[] gives all 46 a reason: adapters and pointers have no successor and name Core's per-tool delivery; Matt copies name their Extensions items." },
  { id: "matt-supersession", reason: "Each of the 27 Matt copies in the frozen default is superseded by its Extensions item with match name+sourcePath against the frozen default's exact digest; the dry run found 0 of 27 hash matches." },
  { id: "project-basics-split", reason: "The dry run kept the project context as one rule. The maintainer split it into three Project basics items, named by samartomar/aih-catalog#137: the router, a guide document; the working rules and the shared block, two rules. Each carries the folder-neutral form of one material of the frozen default's project context, rendered once by the authored context renderer: it names its neighbours by their place in the folder a project chooses, never a folder name, and promises no per-tool adapter notes. Its content identity is therefore predicted from that rendered text at its item-relative path, not from the frozen bytes; each supersedes the project context by split, and the default's project-context retirement names the three." },
  { id: "copy-supersession", reason: "Per-tool copies that collapse are superseded by hash when their content identity equals the survivor's, otherwise by name and source path; the dry run listed them without a match." },
  { id: "copies-retired", reason: "Every collapsed copy is also retired with its replacement, and templates and frameworks become sets, so their ids are retired; the dry run only marked them." },
  { id: "folded-hook-sources", reason: "Hook source items fold into their hook items. The hook ids are decided with the framework migrations, so these retirements are pending on those tickets." },
  { id: "superpowers-retirements", reason: "The dry run left 10 Superpowers items unmapped. The 9 per-tool plugin bundles and the duplicate skill library are retired with no item successor; upstream plugin routes become nativeRoutes." },
  { id: "superpowers-bootstrap-fallback", reason: "The session bootstrap hook gains a one-line rule as its fallback, an item the dry run did not have. samartomar/aih-catalog#144 names it superpowers.rule.session-bootstrap; its content identity is predicted from its authored line in producer/superpowers/release-1-7.json at its item-relative path, and the bootstrap source the hook folds is retired with the hook as its replacement." },
  { id: "superpowers-pinned-revision", reason: "The dry run read Superpowers at upstream revision bb92a77741419a4ab5f06e711a283343f1ada0c3, earlier than the 5bf4e78011075bcfc0dc295f0724994cd123ee71 (upstream 6.4.1) this package pins, so its Superpowers content identities name other bytes. They are predicted again, with the dry run's rule (item-relative paths, a skill's files below its own folder, the hook carrying the bootstrap source it folds), from the pinned materials of the committed release-superpowers.json. Items, kinds, supersessions and retirements are the dry run's." },
  { id: "ecc-notices-identity", reason: "The dry run's ecc.notices content identity reproduces from none of the tried item-relative path assignments for the four shipped notice materials (every suffix of each install target and source path, the package paths, and those paths with tool prefixes removed), so it cannot be checked. Their bytes are unchanged: the expectation predicts the identity from those four material digests at the item-relative paths every other ECC item uses, its install target without the .aihq/ecc/ and source/ prefixes (LICENSE, AGENTS.md, plugin.json, README.md)." },
  { id: "mcp-edit-digests", reason: "Each MCP survivor records whether its shipped definition is identical to upstream or edited; an edit is digested as SHA-256 of the canonical JSON {from: upstream, to: shipped} plus LF, in upstream's own encoding." },
  { id: "matt-buckets", reason: "The dry run carried only the 27 skills of Matt's plugin. Matt's buckets are sets in upstream's own grouping, so the Extensions release also carries the skills his pinned tree holds in the in-progress (7) and misc (3) buckets, each collapsing its three per-tool copies; his misc setup-pre-commit is already the Extensions skill copied from it, and the pinned tree has no skills in a specialists or deprecated bucket. Their content identities, copy supersessions and copy retirements come from the accepted Extensions build, limited to those ten items." },
  { id: "ecc-hooks", reason: "The dry run published none of ECC's 24 Claude Code hooks. Each upstream hook group in the pinned hooks/hooks.json is one hook item; its content identity is predicted from the reviewed run-time closure in producer/ecc/hook-facts.json and the pinned tree ledger's digests, at the source-relative paths its item folder keeps, plus ECC's LICENSE." },
  { id: "hook-registration-materials", reason: "A hook's materials never include a hook registration file. The three Extensions hooks leave out hooks/hooks.json and the Superpowers bootstrap leaves out hooks/hooks.json and its .claude-plugin manifests, so their predicted content identities cover the remaining materials." },
  { id: "extensions-content-identities", reason: "The dry run derived Extensions relPaths from install targets; for 16 of the 57 survivors (the agents, commands, notices, references and eight skills) those derivations are not reproducible from the pinned bytes under the documented rule, and the dry run called its own output proposed. The accepted Extensions build (samartomar/aih-catalog#145) projects the pinned copies to release 1.6 with source-relative material paths and collapses them with the public transition build; the expected Extensions content identities are re-derived from that canonical build, and the expected ids, kinds, purposes, supersessions and retirements are asserted to match the dry run unchanged." },
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
  if (id === SUPERPOWERS_DATA.hook.id)
    return contentIdentity(lines(item(SUPERPOWERS_DATA.hook.folds).materials, (path) => path).filter((line) => !isHookRegistrationPath(line.split("	")[0])));
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
    const acquired = Object.hasOwn(mcpAcquisition.providers, item.name);
    if (framework === "ecc" && (acquired || ["browser-use", "parallel-search", "jira", "omega-memory", "github"].includes(item.name))) {
      const to = mcpFacts[`ecc.claude.mcp.${item.name}`].offeredServer;
      return { survivor: item.id, transform: "edited", editsSha256: mcpEditsSha256({ from: server.upstream, to }) };
    }
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
for (const [key, original] of [["github-local", "github"], ["railway-hosted", "railway"]]) {
  const survivor = `ecc.mcp.${key}`, source = frameworks.ecc.items.find(item => item.id === `ecc.mcp.${original}`);
  const copies = [`ecc.claude.mcp.${key}`, `ecc.codex.mcp.${key}`];
  frameworks.ecc.items.push({ id: survivor, kind: "mcp-server", contentSha256: source.contentSha256 });
  for (const itemId of copies) {
    frameworks.ecc.supersessions.push({ survivor, itemId, match: "hash" });
    frameworks.ecc.retired.push({ id: itemId, replacedBy: [{ framework: "ecc", itemId: survivor }] });
  }
  frameworks.ecc.mcpPairs.push({ survivor, copies });
  const fact = mcpFacts[`ecc.claude.mcp.${key}`];
  const { description: _display, ...from } = fact.rawServer;
  frameworks.ecc.edits.push({ survivor, transform: "edited", editsSha256: mcpEditsSha256({ from, to: fact.offeredServer }) });
}
// Extensions: the amended expectation takes each content identity from the canonical
// accepted build (amendment extensions-content-identities). The build's ids, kinds
// and purposes must match the dry run's proposed survivors exactly, so the dry run
// stays the structural authority while the accepted projection supplies the hashes.
{
  const { buildExtensions17 } = await import("../dist/release/extensions-transition.js");
  const built = buildExtensions17({ root });
  const dryRunItems = new Map(frameworks.extensions.items.map((item) => [item.id, item]));
  // Amendment matt-buckets: Matt's in-progress and misc skills, outside his plugin.
  const buckets = built.release.items.filter((item) => item.kind === "skill" && /^skills\/(in-progress|misc)\//.test(item.provenance?.source.path ?? ""));
  assert.deepEqual(buckets.map((item) => item.id.split(".")[2]).sort(), ["chief-of-staff", "claude-handoff", "git-guardrails-claude-code", "loop-me", "migrate-to-shoehorn", "scaffold-exercises", "setup-ts-deep-modules", "writing-beats", "writing-fragments", "writing-shape"]);
  for (const item of buckets) dryRunItems.set(item.id, { id: item.id, kind: "skill" });
  const bucketIds = new Set(buckets.map((item) => item.id));
  assert.equal(built.release.items.length, dryRunItems.size);
  frameworks.extensions.supersessions = sorted([
    ...frameworks.extensions.supersessions,
    ...buckets.flatMap((item) => item.supersedes.map((entry) => ({ survivor: item.id, itemId: entry.itemId, match: entry.match }))),
  ], (entry) => `${entry.survivor} ${entry.itemId}`);
  frameworks.extensions.retired = sorted([
    ...frameworks.extensions.retired,
    ...built.release.retired.filter((entry) => entry.replacedBy.some((ref) => bucketIds.has(ref.itemId))).map((entry) => ({ id: entry.id, replacedBy: entry.replacedBy })),
  ], (entry) => entry.id);
  frameworks.extensions = {
    ...frameworks.extensions,
    items: sorted(
      built.release.items.map((item) => {
        const expected = dryRunItems.get(item.id);
        assert(expected, `The Extensions build carries ${item.id}, which the dry run did not propose`);
        const payload = item.payload && typeof item.payload === "object" ? item.payload : {};
        const purpose = "purpose" in payload ? payload.purpose : undefined;
        assert.equal(item.kind, expected.kind, `Kind drifted for ${item.id}`);
        assert.equal(purpose ?? undefined, expected.purpose ?? undefined, `Purpose drifted for ${item.id}`);
        return { id: item.id, kind: item.kind, ...(purpose ? { purpose } : {}), contentSha256: item.contentSha256 };
      }),
      (item) => item.id,
    ),
  };
}
// ECC's notice document: the shipped materials at their install targets' item-relative paths.
{
  const ecc = JSON.parse(readFileSync(resolve(root, "release/release-ecc.json"), "utf8"));
  const notices = ecc.items.find((item) => item.id === "ecc.notices");
  const recipe = JSON.parse(readFileSync(resolve(root, notices.recipe.path), "utf8"));
  const lines = notices.materials.map((member) => {
    const target = recipe.operations.find((operation) => operation.kind === "file.write" && operation.material === member.id);
    const path = target.target.segments.map((segment) => segment.literal).join("/");
    const relPath = path.replace(/^\.aihq\/ecc\/(?:source\/)?/, "");
    assert.notEqual(relPath, path, `Unexpected ECC notice target ${path}`);
    return `${relPath}\t${member.sha256}\n`;
  }).sort();
  const expected = frameworks.ecc.items.find((item) => item.id === "ecc.notices");
  assert(expected, "The dry run carries no ecc.notices");
  expected.contentSha256 = createHash("sha256").update(lines.join("")).digest("hex");
}
// Amendment ecc-hooks: one hook item per pinned upstream hook group, its content
// identity over the reviewed closure's ledger digests and ECC's LICENSE.
{
  const ledger = new Map(JSON.parse(readFileSync(resolve(root, "producer/ecc/inventory.json"), "utf8")).entries.map((row) => [row.path, row]));
  const facts = JSON.parse(readFileSync(resolve(root, "producer/ecc/hook-facts.json"), "utf8"));
  assert.equal(facts.hooks.length, 24);
  for (const hook of facts.hooks) {
    const lines = [...hook.closure, "LICENSE"].map((path) => `${path}	${(ledger.get(path) ?? assert.fail(`No pinned ${path}`)).sha256}
`);
    frameworks.ecc.items.push({ id: hook.itemId, kind: "hook", contentSha256: contentIdentity(lines) });
  }
  frameworks.ecc.items = sorted(frameworks.ecc.items, (item) => item.id);
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
assert.equal(counts.mattSupersessions, 27);
assert.equal(counts.mcpPairs, 34);
assert.equal(counts.defaultRetirements, 46);
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
