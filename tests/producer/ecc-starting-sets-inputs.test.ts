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
 * Inputs a caller must type before install: required, not a host-held secret, no default.
 * Both the item's configuration and the environment inputs an MCP server introduces count.
 */
const unfilledInputs = (item: CatalogItem) =>
  Object.entries({ ...item.inputs, ...(item.requirements?.inputs ?? {}) })
    .filter(([, spec]) => spec.required && spec.sensitive !== true && spec.default === undefined)
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

// Required inputs with no value or default; ECC's own config names them, sets cannot fill them.
const CALLER_CONFIGURED = {
  "ecc.mcp.ecc-memory-vault": ["ECC_MEMORY_HARNESS"],
  "ecc.mcp.ito-compute": ["ITO_MCP_ENTRYPOINT"],
  "ecc.mcp.jira": ["AIHQ_MCP_JIRA_ROOT", "JIRA_EMAIL", "JIRA_URL"],
  "ecc.mcp.omega-memory": ["AIHQ_MCP_OMEGA_ROOT", "OMEGA_HOME"],
} as const;

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
  ["ecc.module.platform-configs", 17],
  ["ecc.module.workflow-quality", 65],
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
  expect(count).toBe(242);
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
  ["ecc.profile.minimal", 311],
  ["ecc.profile.opencode", 159],
  ["ecc.profile.core", 311],
  ["ecc.profile.developer", 319],
  ["ecc.profile.security", 330],
  ["ecc.profile.research", 337],
  ["ecc.profile.full", 472],
])("%s with TypeScript resolves to %i items that need no typed input", (profile, count) => {
  const { count: actual, gaps, readerGaps } = resolveWithGaps([profile]);
  expect(gaps, profile).toEqual([]);
  expect(readerGaps, profile).toEqual([]);
  expect(actual, profile).toBe(count);
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
