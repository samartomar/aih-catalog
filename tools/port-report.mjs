#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, portTool, root, sha256 as sha256Of } from "./lib/port.mjs";

for (const arg of process.argv.slice(2))
  if (arg !== "--check") {
    console.error(`port-report: unexpected argument ${arg}`);
    process.exit(2);
  }
const check = process.argv.includes("--check");
const { fail } = portTool("port-report", { check });
const read = (path) => readFileSync(join(root, path));
const json = (path) => JSON.parse(read(path).toString("utf8"));
const sha256 = (path) => sha256Of(read(path));

const SECTIONS = {
  maintained: "port-report/maintained.json",
  remaining: "port-report/remaining.json",
  aiSetup: "port-report/ai-setup.json",
};
const maintained = json(SECTIONS.maintained);
const remaining = json(SECTIONS.remaining);
const aiSetup = json(SECTIONS.aiSetup);

// The measured baseline: exactly one disposition per item.
const ids = maintained.dispositions.map((entry) => entry.baseline.id);
if (ids.length !== maintained.baseline.items)
  fail("the baseline count differs from its dispositions");
if (new Set(ids).size !== ids.length) fail("a baseline item has two dispositions");
if (ids.length !== 777) fail(`the measured baseline has 777 items, not ${ids.length}`);
const tally = (entries, key) => {
  const out = {};
  for (const entry of entries) out[key(entry)] = (out[key(entry)] ?? 0) + 1;
  return out;
};
const byKind = tally(maintained.dispositions, (entry) => entry.baseline.kind);
const baselineDispositions = tally(maintained.dispositions, (entry) =>
  entry.disposition === "mapped" && entry.edition !== undefined ? "edition" : entry.disposition,
);

// The committed data: every framework once, every mapped item present.
const frameworks = readdirSync(join(root, "data"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "qualifications")
  .map((entry) => entry.name)
  .sort();
const owner = (framework) => {
  const owners = [
    maintained.families.includes(framework) ? "maintained" : null,
    remaining.families.includes(framework) ? "remaining" : null,
    framework in aiSetup.items ? "aiSetup" : null,
  ].filter(Boolean);
  if (owners.length !== 1) fail(`data/${framework} belongs to ${owners.length} sections`);
  return owners[0];
};
const itemIds = new Set();
const frameworkFacts = {};
for (const framework of frameworks) {
  const path = `data/${framework}/content.json`;
  const content = json(path);
  for (const item of content.items) itemIds.add(item.id);
  frameworkFacts[framework] = {
    contentSha256: sha256(path),
    items: content.items.length,
    section: owner(framework),
  };
}
for (const family of [...maintained.families, ...remaining.families, ...Object.keys(aiSetup.items)])
  if (!frameworks.includes(family) && family !== "project-context")
    fail(`section family ${family} has no data/${family}`);
const mapped = [
  ...maintained.dispositions.flatMap((entry) => (entry.item ? [entry.item] : [])),
  ...remaining.dispositions.flatMap((entry) => [
    ...(entry.item ? [entry.item] : []),
    ...(entry.items ?? []),
  ]),
];
const missing = mapped.filter((id) => !itemIds.has(id));
if (missing.length > 0)
  fail(`mapped items missing from the data: ${missing.slice(0, 10).join(", ")}`);
for (const [framework, items] of Object.entries(aiSetup.items))
  for (const id of items) if (!itemIds.has(id)) fail(`${framework}: ${id} is not in the data`);

// Qualifications: every record the section names is committed under its sha256.
const committedQualifications = new Set(
  readdirSync(join(root, "data", "qualifications")).map((file) => file.replace(/\.json$/, "")),
);
for (const entry of aiSetup.qualifications) {
  if (!committedQualifications.has(entry.sha256))
    fail(`qualification ${entry.sha256} is not committed`);
  if (sha256(`data/qualifications/${entry.sha256}.json`) !== entry.sha256)
    fail(`qualification ${entry.sha256} does not match its bytes`);
}

/**
 * Earlier release items that no section owns: the three single-item release documents that
 * were neither part of the measured baseline nor of a remaining family. Recorded here, so they
 * survive the removal of the release documents.
 */
const OTHER = [
  {
    earlier: {
      file: "release/release-1.1.json",
      release: "urn:aihq:catalog:release:1.1.0",
      id: "aihq.hook.claude.protect-env",
      kind: "hook",
      paths: ["aihq.hook.claude.protect-env/.claude/hooks/aihq-protect-env.mjs"],
    },
    disposition: "dropped",
    reason: "no-edition-place",
    note: "an opt-in Claude Code hook Catalog authored. Claude keeps hooks in its shared, list-valued settings file, which a plan cannot own as one entry, so the hook would be unavailable on its only client; no framework carries it",
  },
  {
    earlier: {
      file: "release/release-native-bundles.json",
      release: "urn:aihq:catalog:release:1.0.0",
      id: "aihq.native-bundle.claude.graph-fixture",
      kind: "native-verification-bundle",
      paths: [
        "aihq.native-bundle.claude.graph-fixture/aihq.catalog.claude.graph-fixture.v1.json",
        "aihq.native-bundle.claude.graph-fixture/expected-CLAUDE.md",
        "aihq.native-bundle.claude.graph-fixture/expected-mcp.json",
      ],
    },
    disposition: "dropped",
    reason: "test-fixture",
    note: "a test-scope verification bundle for the old installer's native checks, not content; native loading is validated outside the package",
  },
  {
    earlier: {
      file: "release/release-native-fixture.json",
      release: "urn:aihq:catalog:release:1.0.0",
      id: "aihq.mcp.claude.graph-fixture",
      kind: "mcp-server",
      paths: [
        "aihq.mcp.claude.graph-fixture/graph-server.mjs",
        "aihq.mcp.claude.graph-fixture/graph.json",
        "aihq.mcp.claude.graph-fixture/recorder.mjs",
      ],
    },
    disposition: "dropped",
    reason: "test-fixture",
    note: "a test-scope MCP server and recorder for the old installer's native checks, not content",
  },
];

/** Release documents superseded by the measured baseline (older formats of the same families). */
const SUPERSEDED = [
  {
    file: "release/release-ecc.json",
    release: "urn:aihq:catalog:release:1.2.0",
    by: "release/release-ecc.content.json",
  },
  {
    file: "release/release-extensions.json",
    release: "urn:aihq:catalog:release:1.2.0",
    by: "release/release-extensions.content.json",
  },
  {
    file: "release/release-superpowers.json",
    release: "urn:aihq:catalog:release:1.2.0",
    by: "release/release-superpowers.content.json",
  },
  {
    file: "release/release-default.content.json",
    release: "urn:aihq:catalog:release:1.7.0",
    by: "release/release-project-basics.content.json",
    note: "the closing default release, with no items of its own",
  },
];

const qualifications = aiSetup.qualifications.map((entry) => ({
  aiSetup: entry.aiSetup,
  cell: entry.cell,
  sha256: entry.sha256,
  status: entry.status,
}));
const qualified = qualifications.filter((entry) => entry.status === "qualified");
const blocked = qualifications.filter((entry) => entry.status === "blocked");
const incompleteReferences = Object.entries(remaining.pathReferences)
  .filter(([, facts]) => facts.items > 0)
  .map(
    ([family, facts]) =>
      `${family}: ${facts.items} items name ${facts.references} files no placed bundle provides`,
  );

const limits = {
  native: [
    "Fixture and test results prove planning behaviour only; native loading of the planned layouts by each client is not validated by this package.",
    "Plugin presence checks are `none` on every client until a reliable check is evidenced, so an installed plugin is never reported as confirmed.",
    `AI setup qualifications are the recorded runs' results: ${qualified.map((entry) => `${entry.aiSetup} on ${entry.cell}`).join(", ")} qualified; ${blocked.map((entry) => `${entry.aiSetup} on ${entry.cell}`).join(", ")} blocked; every other cell unknown or without a record.`,
    "The code-review-graph, codebase-memory-mcp and Serena trio has no combination qualification, so its recipe plans `incomplete` on every cell.",
    "Profile facts are as checked on the dates each profile's `checkedWith` records; some places and field names rest on vendor documentation rather than a live check.",
  ],
  deferred: [
    "All data is a candidate: every scan key is new and unscanned, and none is admitted until it passes the data-commit gate against matching trusted scans.",
    "Recipes are drafts in the section reports; each is published once it names the admitted data commit.",
    "Extensions declares no per-client routes yet, so it has no base recipe and is planned through items only.",
    ...incompleteReferences,
    `${maintained.dispositions.filter((entry) => entry.disposition === "dropped").length} baseline items are dropped with their reasons; ${Object.keys(remaining.unrepresentable ?? {}).length} upstream item cannot be represented (${Object.keys(remaining.unrepresentable ?? {}).join(", ")}).`,
    `${Object.keys(remaining.upstreamOnlyReasons ?? {}).length + maintained.added.filter((entry) => entry.fetch === "upstream").length} items are fetched from their pinned upstream at install time instead of shipped (licence), and are not scanned.`,
    "Path references are reported strictly: an item that names a source file outside its own files is `incomplete` unless a placed bundle or the project-scope sibling layout provides it.",
  ],
};

const report = {
  baseline: {
    release: maintained.baseline.release,
    items: ids.length,
    byKind,
    dispositions: baselineDispositions,
    families: maintained.families,
  },
  earlier: {
    disposed: remaining.dispositions.length + OTHER.length,
    sections: { remaining: remaining.dispositions.length },
    other: OTHER,
    superseded: SUPERSEDED,
  },
  frameworks: frameworkFacts,
  qualifications,
  sections: Object.fromEntries(
    Object.entries(SECTIONS).map(([name, path]) => [name, { path, sha256: sha256(path) }]),
  ),
  totals: {
    frameworks: frameworks.length,
    items: Object.values(frameworkFacts).reduce((total, facts) => total + facts.items, 0),
    qualifications: qualifications.length,
    draftRecipes: Object.keys(remaining.recipes ?? {}).length + (aiSetup.recipes ?? []).length,
  },
  limits,
};

const target = join(root, "port-report", "report.json");
const text = canonical(report);
if (check) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== text)
    fail("port-report/report.json is out of date; run npm run port:report");
  console.log(
    `port-report: report matches (${ids.length} baseline items, ${report.earlier.disposed} earlier items, ${frameworks.length} frameworks)`,
  );
} else {
  writeFileSync(target, text);
  console.log(
    `port-report: wrote port-report/report.json (${ids.length} baseline items, ${report.earlier.disposed} earlier items, ${frameworks.length} frameworks)`,
  );
}
