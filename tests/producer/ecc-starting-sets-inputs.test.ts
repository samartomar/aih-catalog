import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { CatalogItem } from "../../src/release/contracts.js";
import {
  readReleaseContent,
  resolveSelections,
  validateSelectionSet,
} from "../../src/release/reader.js";

const bytes = readFileSync("release/release-ecc.content.json");
const checked = readReleaseContent(bytes, {
  expectedSha256: createHash("sha256").update(bytes).digest("hex"),
});
if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
const release = checked.release;
const releases = { [release.sha256]: release };
const sets = release.sets ?? [];

/**
 * Inputs someone must supply before install: required with no default, secret or not.
 * Both the item's configuration and the environment inputs an MCP server introduces count.
 */
const unfilledInputs = (item: CatalogItem) =>
  Object.entries({ ...item.inputs, ...(item.requirements?.inputs ?? {}) })
    .filter(([, spec]) => spec.required && spec.default === undefined)
    .map(([name]) => name)
    .sort();

const setChoice = (setId: string) => {
  const set = sets.find((candidate) => candidate.id === setId);
  if (!set) throw new Error(`Missing ECC set: ${setId}`);
  const languages = set.options?.some((option) => option.id === "languages");
  return {
    release: { releaseSha256: release.sha256, scope: "project" as const },
    setId,
    setSha256: set.setSha256,
    ...(languages ? { options: { languages: ["typescript"] } } : {}),
  };
};

/** Resolves sets exactly as a caller would, then reads back each resolved item's input gaps. */
const resolveWithGaps = (setIds: readonly string[]) => {
  const resolved = resolveSelections({
    releases,
    roots: [],
    skips: [],
    sets: setIds.map(setChoice),
  });
  expect(resolved.status, JSON.stringify(resolved.diagnostics)).toBe("ok");
  if (resolved.status !== "ok") throw new Error("refused");
  const { selections } = resolved.value;
  const validated = validateSelectionSet({ releases, selections });
  const gaps = selections
    .map((selection) => {
      const item = release.items.find((candidate) => candidate.id === selection.item.itemId);
      if (!item) throw new Error(`Missing ECC item: ${selection.item.itemId}`);
      const names = unfilledInputs(item).filter(
        (name) => !Object.hasOwn(selection.configuration, name),
      );
      return names.length ? `${item.id}: ${names.join(", ")}` : undefined;
    })
    .filter((gap) => gap !== undefined)
    .sort();
  const readerGaps = validated.diagnostics.filter((d) => d.reason === "input-required");
  return { count: selections.length, gaps, readerGaps };
};

// Required inputs with no value or default, including secrets; no set can supply them.
const CALLER_CONFIGURED = {
  "ecc.mcp.browser-use": ["BROWSER_USE_KEY"],
  "ecc.mcp.ecc-memory-vault": ["ECC_MEMORY_HARNESS"],
  "ecc.mcp.github-local": ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  "ecc.mcp.ito-compute": ["ITO_MCP_ENTRYPOINT"],
  "ecc.mcp.jira": ["AIHQ_MCP_JIRA_ROOT", "JIRA_API_TOKEN", "JIRA_EMAIL", "JIRA_URL"],
  "ecc.mcp.memxus": ["MEMXUS_API_KEY"],
  "ecc.mcp.omega-memory": ["AIHQ_MCP_OMEGA_ROOT", "OMEGA_HOME"],
} as const;
const SECRETS = new Set([
  "BROWSER_USE_KEY",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "JIRA_API_TOKEN",
  "MEMXUS_API_KEY",
]);

/**
 * The ECC MCP servers that run from the pick as installed: a documented hosted endpoint
 * with no unsupported or unverified provider, beta consent, preprovisioning or setup
 * value. The reviewed producer list must agree, and only these may be set members.
 */
const READY_MCP = [
  "ecc.mcp.clickhouse",
  "ecc.mcp.github",
  "ecc.mcp.laraplugins",
  "ecc.mcp.parallel-search",
  "ecc.mcp.railway-hosted",
  "ecc.mcp.vercel",
];
const readiness = JSON.parse(readFileSync("producer/ecc/mcp-starting-sets.json", "utf8")) as {
  ready: Record<string, string>;
  notReady: Record<string, string>;
};
const mcpServers = release.items.filter((item) => item.kind === "mcp-server");
const notReadyMcp = mcpServers.map((item) => item.id).filter((id) => !READY_MCP.includes(id));

const PRE_TICKED = [
  "ecc.rules.common",
  "ecc.module.rules-core",
  "ecc.module.agents-core",
  "ecc.module.commands-core",
  "ecc.module.hooks-runtime",
  "ecc.module.platform-configs",
  "ecc.module.workflow-quality",
];

it("names every pre-ticked ECC set", () => {
  expect(sets.filter((set) => set.offer === "pre-ticked").map((set) => set.id)).toEqual(PRE_TICKED);
});

it.each([
  ["ecc.rules.common", 11],
  ["ecc.module.rules-core", 11],
  ["ecc.module.agents-core", 69],
  ["ecc.module.commands-core", 95],
  ["ecc.module.hooks-runtime", 0],
  ["ecc.module.platform-configs", 6],
  ["ecc.module.workflow-quality", 54],
])("pre-ticked %s resolves to %i items that need no typed input", (setId, count) => {
  const { count: actual, gaps, readerGaps } = resolveWithGaps([setId]);
  expect(gaps, setId).toEqual([]);
  expect(readerGaps, setId).toEqual([]);
  expect(actual, setId).toBe(count);
});

it("the default ECC pick with TypeScript rules needs no typed input", () => {
  const { count, gaps, readerGaps } = resolveWithGaps([...PRE_TICKED, "ecc.rules.typescript"]);
  expect(gaps).toEqual([]);
  expect(readerGaps).toEqual([]);
  expect(count).toBe(231);
});

it("lists every ECC profile", () => {
  expect(
    sets
      .filter((set) => set.id.startsWith("ecc.profile."))
      .map((set) => set.id)
      .sort(),
  ).toEqual([
    "ecc.profile.core",
    "ecc.profile.developer",
    "ecc.profile.full",
    "ecc.profile.minimal",
    "ecc.profile.opencode",
    "ecc.profile.research",
    "ecc.profile.security",
  ]);
});

it.each([
  ["ecc.profile.minimal", 300],
  ["ecc.profile.opencode", 148],
  ["ecc.profile.core", 300],
  ["ecc.profile.developer", 308],
  ["ecc.profile.security", 319],
  ["ecc.profile.research", 326],
  ["ecc.profile.full", 461],
])("%s with TypeScript resolves to %i items that need no typed input", (profile, count) => {
  const { count: actual, gaps, readerGaps } = resolveWithGaps([profile]);
  expect(gaps, profile).toEqual([]);
  expect(readerGaps, profile).toEqual([]);
  expect(actual, profile).toBe(count);
});

it("no member of any ECC set has a required input without a default", () => {
  expect(sets).toHaveLength(55);
  const gaps = sets.flatMap((set) =>
    (set.members ?? [])
      .map((member) => release.items.find((item) => item.id === member.item.itemId))
      .filter((item) => item !== undefined && unfilledInputs(item).length > 0)
      .map((item) => `${set.id}: ${item?.id}`),
  );
  expect(gaps).toEqual([]);
});

it("names exactly the ECC items whose inputs no set can fill", () => {
  const acquisition = JSON.parse(readFileSync("producer/ecc/mcp-acquisition.json", "utf8")) as {
    providers: Record<string, unknown>;
  };
  // The npm-acquired servers' caller-owned paths are covered by ecc-default-pick.test.ts.
  const npm = new Set(Object.keys(acquisition.providers).map((key) => `ecc.mcp.${key}`));
  const unfilled = Object.fromEntries(
    release.items
      .filter((item) => !npm.has(item.id))
      .map((item) => [item.id, unfilledInputs(item)] as const)
      .filter(([, names]) => names.length > 0),
  );
  expect(unfilled).toEqual(CALLER_CONFIGURED);
});

it.each(
  Object.entries(CALLER_CONFIGURED),
)("%s stays individually pickable and asks for its inputs", (itemId, names) => {
  const item = release.items.find((candidate) => candidate.id === itemId);
  expect(item?.role, itemId).toBe("choosable");
  if (!item) return;
  expect(unfilledInputs(item), itemId).toEqual(names);
  for (const name of names)
    expect(item.requirements?.inputs?.[name], `${itemId} ${name}`).toMatchObject({
      required: true,
      type: "string",
      ...(SECRETS.has(name) ? { sensitive: true } : {}),
    });
  const picked = resolveSelections({
    releases,
    roots: [{ releaseSha256: release.sha256, itemId, scope: "project", configuration: {} }],
    skips: [],
  });
  expect(picked.status, `${itemId}: ${JSON.stringify(picked.diagnostics)}`).toBe("ok");
  if (picked.status === "ok")
    expect(picked.value.selections.map((selection) => selection.item.itemId)).toContain(itemId);
});

it("classifies every ECC MCP server as ready or not, agreeing with the reviewed producer list", () => {
  expect(mcpServers).toHaveLength(37);
  expect(Object.keys(readiness.ready).sort()).toEqual(READY_MCP);
  expect(Object.keys(readiness.notReady).sort()).toEqual(notReadyMcp.sort());
  expect(notReadyMcp).toHaveLength(31);
  for (const [id, reason] of Object.entries({ ...readiness.ready, ...readiness.notReady }))
    expect(reason.length, id).toBeGreaterThan(0);
});

it("no ECC set, pre-ticked or listed, has a server that does not run as installed", () => {
  const members = sets.flatMap((set) =>
    (set.members ?? [])
      .filter((member) => notReadyMcp.includes(member.item.itemId))
      .map((member) => `${set.id}: ${member.item.itemId}`),
  );
  expect(members).toEqual([]);
  const picked = resolveSelections({
    releases,
    roots: [],
    skips: [],
    sets: PRE_TICKED.map(setChoice),
  });
  expect(picked.status).toBe("ok");
  if (picked.status === "ok")
    expect(
      picked.value.selections
        .map((selection) => selection.item.itemId)
        .filter((id) => notReadyMcp.includes(id)),
    ).toEqual([]);
});

it("the default ECC pick keeps the ready servers its module lists", () => {
  const platform = sets.find((set) => set.id === "ecc.module.platform-configs");
  expect(
    (platform?.members ?? [])
      .map((member) => member.item.itemId)
      .filter((id) => id.startsWith("ecc.mcp."))
      .sort(),
  ).toEqual(READY_MCP.filter((id) => id !== "ecc.mcp.railway-hosted"));
});

it.each(
  notReadyMcp.filter((id) => !Object.hasOwn(CALLER_CONFIGURED, id)),
)("%s stays individually pickable with its warning", (itemId) => {
  const item = release.items.find((candidate) => candidate.id === itemId);
  expect(item?.role, itemId).toBe("choosable");
  expect(item?.description, itemId).toMatch(/\S/);
  if (unfilledInputs(item as CatalogItem).length > 0) return; // npm servers: ecc-default-pick.test.ts
  const picked = resolveSelections({
    releases,
    roots: [{ releaseSha256: release.sha256, itemId, scope: "project", configuration: {} }],
    skips: [],
  });
  expect(picked.status, `${itemId}: ${JSON.stringify(picked.diagnostics)}`).toBe("ok");
  if (picked.status === "ok")
    expect(picked.value.selections.map((selection) => selection.item.itemId)).toContain(itemId);
});
