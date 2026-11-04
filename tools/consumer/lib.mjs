/**
 * Helpers for the packed-consumer journeys. Everything Catalog-specific comes from the
 * installed package's public entry points; the canonical JSON writer and the assertions here
 * are the consumer's own, written independently of Catalog's internals.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toolProfiles } from "@aihq/catalog/contracts";
import { readLocalSource } from "@aihq/catalog/node";
import { readContent, readRecipe, readToolProfile } from "@aihq/catalog/reader";

export { assert };
export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
export const utf8 = (bytes) => decoder.decode(bytes);
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Sorted keys, two-space indent, final newline: the committed form of every format. */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  return value;
}
export const canonical = (value) => encoder.encode(`${JSON.stringify(sortKeys(value), null, 2)}\n`);

/** One journey's record: named checks, pending branches and notes. */
export function journey(id, title, basis) {
  const record = { id, title, basis, outcome: "passed", checks: [], pending: [], notes: [] };
  return {
    record,
    async check(name, body) {
      try {
        await body();
        record.checks.push({ name, status: "passed" });
      } catch (error) {
        const detail = String(error?.message ?? error)
          .replace(/\s+/g, " ")
          .slice(0, 900);
        record.checks.push({ name, status: "failed", detail });
      }
    },
    /**
     * A recorded gap: a contract expectation the candidate does not meet yet, kept visible with
     * its reason until a decision or fix closes it. The check still runs: if it starts passing,
     * the row fails so the record is updated rather than left stale.
     */
    async open(name, reason, body) {
      try {
        await body();
        record.checks.push({ name, status: "failed", detail: `recorded as open, but it now passes: update the record (${reason})` });
      } catch (error) {
        const detail = String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 600);
        record.checks.push({ name, status: "open", reason, detail });
      }
    },
    pending(text) {
      record.pending.push(text);
    },
    note(text) {
      record.notes.push(text);
    },
    /** The plan's sha256, so a rerun on another machine can compare it byte for byte. */
    digest(name, plan) {
      record.plans ??= {};
      record.plans[name] = sha(encoder.encode(JSON.stringify(plan)));
    },
    finish() {
      if (record.checks.some((check) => check.status === "failed")) record.outcome = "failed";
      else if (record.checks.some((check) => check.status === "open")) record.outcome = "open";
      else if (record.pending.length > 0) record.outcome = "pending";
      if (record.notes.length === 0) delete record.notes;
      return record;
    },
  };
}

/** Writes a tree of `{ path: text | { text, executable } }` under `root`. */
export function writeTree(root, tree) {
  for (const [path, entry] of Object.entries(tree)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof entry === "string" ? entry : entry.text);
    chmodSync(target, typeof entry === "object" && entry.executable ? 0o755 : 0o644);
  }
  return root;
}

export function context({ inputs, prepared }) {
  const commit = prepared.identity.data.commit;
  const profiles = Object.fromEntries(
    Object.entries(toolProfiles).map(([id, text]) => {
      const read = readToolProfile(encoder.encode(text));
      if (read.status !== "ok") throw new Error(`profile ${id}: ${JSON.stringify(read)}`);
      return [id, read.profile];
    }),
  );
  const contents = new Map();
  const content = (framework) => {
    if (!contents.has(framework)) {
      const read = readContent(readFileSync(join(inputs, "data", framework, "content.json")));
      if (read.status !== "ok")
        throw new Error(`${framework}: ${JSON.stringify(read).slice(0, 600)}`);
      contents.set(framework, read.content);
    }
    return contents.get(framework);
  };
  const json = (path) => JSON.parse(readFileSync(join(inputs, path), "utf8"));
  /** Every regular file under an input folder, tagged with a source id when given. */
  const files = (path, sourceId) => {
    const read = readLocalSource(join(inputs, path));
    if (read.status !== "ok") throw new Error(`${path}: ${JSON.stringify(read).slice(0, 600)}`);
    return sourceId === undefined ? read.files : read.files.map((file) => ({ ...file, sourceId }));
  };
  const data = { repository: "https://github.com/samartomar/aih-catalog", commit };
  /** Recipes are written by the consumer here: none is published yet. */
  const recipeSource = { repository: "https://example.invalid/consumer-recipes", commit: "e".repeat(40) };
  const plugin = {
    name: "consumer-recipe",
    version: "0.1.0",
    description: "A recipe the packed-consumer journeys write.",
    author: { name: "Catalog consumer journeys" },
    license: "Apache-2.0",
    keywords: ["aihq-recipe"],
  };
  const recipe = (document) => {
    const read = readRecipe(canonical(plugin), canonical(document));
    if (read.status !== "ok") throw new Error(`recipe: ${JSON.stringify(read).slice(0, 800)}`);
    return read;
  };
  const base = {
    schema: "urn:aihq:catalog:recipe:0.1.0",
    kind: "base",
    plugins: {},
    setup: {},
    clis: {},
    options: [],
    namePrefix: {},
    overrides: [],
    requires: [],
    aiSetup: {},
    data,
  };
  return { commit, profiles, content, json, files, data, recipe, recipeSource, base, plugin };
}

/** A plan, or a thrown error naming why planning did not produce one. */
export function planned(result) {
  if (result.status !== "ok" && result.status !== "incomplete")
    throw new Error(`no plan: ${JSON.stringify(result).slice(0, 900)}`);
  return result;
}
export const placementOps = new Set(["write", "link", "merge", "fetch"]);
export const writes = (plan) => plan.plan.filter((step) => step.op === "write");
export const pathsOf = (plan, op = "write") =>
  plan.plan.filter((step) => step.op === op).map((step) => step.path ?? step.file);
export const stepAt = (plan, path) =>
  plan.plan.find((step) => (step.path ?? step.file) === path && step.op !== "merge");
