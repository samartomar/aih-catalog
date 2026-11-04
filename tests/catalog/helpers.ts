import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";
import { readLocalSource } from "../../src/catalog/node.js";
import { buildContent } from "../../src/catalog/producer.js";
import { readToolProfile, type ToolProfile } from "../../src/catalog/reader.js";
import { findItems } from "../../src/catalog/source.js";

export const FRAMEWORK = "local-my-skills";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const created: string[] = [];

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

export type TreeEntry =
  | string
  | { readonly text: string; readonly executable?: boolean }
  | { readonly link: string };

/** A disposable folder holding exactly `tree`; removed after each test. */
export function folder(tree: Readonly<Record<string, TreeEntry>>, name = "my-skills"): string {
  const parent = mkdtempSync(join(tmpdir(), "aih-catalog-"));
  created.push(parent);
  const root = join(parent, name);
  mkdirSync(root);
  for (const [path, entry] of Object.entries(tree)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    if (typeof entry === "string") writeFileSync(target, entry);
    else if ("link" in entry) symlinkSync(entry.link, target);
    else {
      writeFileSync(target, entry.text);
      chmodSync(target, entry.executable ? 0o755 : 0o644);
    }
  }
  return root;
}

export const sha = (text: string | Uint8Array): string =>
  createHash("sha256").update(text).digest("hex");

/** A shipped tool profile, read through the public reader. */
export function profile(id: string): ToolProfile {
  const result = readToolProfile(readFileSync(join(repositoryRoot, "profiles", `${id}.json`)));
  if (result.status !== "ok") throw new Error(`profile ${id}: ${JSON.stringify(result)}`);
  return result.profile;
}

export const utf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Keys sorted recursively, for an independent canonical rendering. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Git's own tree hash of a folder holding exactly these regular files. */
export function gitTree(files: Readonly<Record<string, string>>): string {
  const parent = mkdtempSync(join(tmpdir(), "aih-catalog-git-"));
  created.push(parent);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: parent,
      encoding: "utf8",
    }).trim();
  git("init", "--quiet");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(parent, path)), { recursive: true });
    writeFileSync(join(parent, path), text);
  }
  git("add", "--all");
  return git("write-tree");
}

/** Reads, discovers and builds one own folder through the public functions. */
export async function ownContent(root: string) {
  const read = readLocalSource(root);
  if (read.status !== "ok") throw new Error(JSON.stringify(read));
  const found = findItems(read.files, { framework: FRAMEWORK });
  if (found.status !== "ok") throw new Error(JSON.stringify(found));
  const built = await buildContent(read.source, read.files, found.items, { framework: FRAMEWORK });
  if (built.status !== "ok") throw new Error(JSON.stringify(built));
  return { read, found, built };
}
