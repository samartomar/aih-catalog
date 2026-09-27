import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type SignedHistoryFile = { path: string; sha256: string };

export const verifySignedHistoryDigests = (
  root: string,
  files: readonly SignedHistoryFile[],
): void => {
  if (files.length === 0) throw new Error("signed history list is empty");
  const seen = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    if (
      parts.length < 3 ||
      parts[0] !== "catalog" ||
      parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === "." || part === "..") ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      seen.has(file.path)
    )
      throw new Error(`invalid signed history entry: ${file.path}`);
    seen.add(file.path);
    let current = resolve(root);
    for (const [index, part] of parts.entries()) {
      current = resolve(current, part);
      const stat = lstatSync(current);
      if (
        stat.isSymbolicLink() ||
        (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
      )
        throw new Error(`signed history is not a regular file: ${file.path}`);
    }
    const actual = createHash("sha256").update(readFileSync(current)).digest("hex");
    if (actual !== file.sha256) throw new Error(`signed history digest changed: ${file.path}`);
  }
};
