/**
 * What the port tools share: the repository root, the --check switch, writing or comparing
 * outputs, the canonical document form (the library's own, from dist), sha256, and the small
 * readers over fetched files. Each tool names itself for its messages.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDocument } from "../../dist/catalog/internal/json.js";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const check = process.argv.includes("--check");
export const encoder = new TextEncoder();

/** The canonical bytes' text of a document: sorted keys, two-space indent, final LF. */
export const canonical = (value) => canonicalDocument(value);
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** The sha256 of a document's canonical form: its identity. */
export const shaOf = (value) => sha256(encoder.encode(canonical(value)));

export const fileMap = (files) =>
  new Map(files.filter((file) => file.bytes).map((file) => [file.path, file]));
export const textOf = (file) => new TextDecoder().decode(file.bytes);
/** A source file as an item file of `sourceId`. */
export const discoveredFile = (sourceId, file, extra = {}) => ({
  sourceId,
  sourcePath: file.path,
  sha256: file.sha256,
  executable: file.mode === "100755",
  role: "content",
  ...extra,
});
export const under = (prefixes) => (file) =>
  prefixes.some((prefix) => file.path === prefix || file.path.startsWith(prefix));

/** Repository-relative paths of every file below `folder`. */
export function listFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

/** One tool's failure, outputs and result line. */
export function portTool(name) {
  const out = { written: [], drift: [] };
  const fail = (message) => {
    console.error(`${name}: ${message}`);
    process.exit(1);
  };
  /** Writes `bytes` at a repository path, or with --check records a difference. */
  const writeOrCompare = (path, bytes) => {
    const target = join(root, path);
    if (check) {
      if (!existsSync(target) || !Buffer.from(readFileSync(target)).equals(Buffer.from(bytes)))
        out.drift.push(path);
      return;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    out.written.push(path);
  };
  /** Removes (or with --check reports) files below `folder` that are not `expected`. */
  const removeStale = (folder, expected) => {
    for (const stale of listFiles(folder))
      if (!expected.has(stale)) {
        if (check) out.drift.push(stale);
        else rmSync(join(root, stale));
      }
  };
  return { out, fail, writeOrCompare, removeStale };
}
