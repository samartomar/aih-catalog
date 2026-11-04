/**
 * Item identities: `contentSha256` over the files, `behaviourSha256` over the files
 * plus kind, kind fields, requirements, dependencies, editions and bundle files. Both are
 * sha256 over canonical JSON. Qualification references never enter either digest.
 */
import { canonicalJson } from "./json.js";
import { skillFile } from "./kinds.js";
import type { Item, ItemFile } from "./model.js";
import { basenameOf, compareCodeUnits, dirnameOf } from "./paths.js";
import { sha256Hex } from "./sha256.js";

const encoder = new TextEncoder();
export const sha256OfText = (text: string): string => sha256Hex(encoder.encode(text));

/** The path a file takes in content identity: a cut-out file is `<sourcePath>#<pointer>`. */
const identityPath = (file: ItemFile): string =>
  file.derivedFrom ? `${file.derivedFrom.sourcePath}#${file.derivedFrom.pointer}` : file.sourcePath;

function fileFacts(files: readonly ItemFile[]) {
  return files
    .map((file) => ({
      executable: file.executable,
      sha256: file.sha256,
      sourcePath: identityPath(file),
    }))
    .sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath));
}

/** Kind fields per kind; for kinds not built here, the documented field names present. */
const KIND_FIELDS: Readonly<Record<string, readonly string[]>> = {
  skill: ["userOnly", "arguments"],
  rule: ["scope"],
  agent: ["agent"],
  hook: ["event", "matcher", "handler"],
  mcp: ["server", "enabledTools", "disabledTools", "startupSeconds", "callSeconds", "env"],
  document: ["purpose"],
  "ai-setup": ["aiSetup"],
};

export const kindFieldNames = (kind: string): readonly string[] => KIND_FIELDS[kind] ?? [];

export function contentSha256(files: readonly ItemFile[]): string {
  return sha256OfText(canonicalJson(fileFacts(files)));
}

export function behaviourSha256(
  item: Pick<Item, "kind" | "files" | "requirements" | "dependencies" | "editions"> &
    Readonly<Record<string, unknown>>,
  bundleFiles: readonly unknown[] | null,
): string {
  const fields: Record<string, unknown> = {};
  for (const name of kindFieldNames(item.kind))
    if (item[name] !== undefined) fields[name] = item[name];
  return sha256OfText(
    canonicalJson({
      bundle: bundleFiles,
      dependencies: [...(item.dependencies ?? [])].sort(compareCodeUnits),
      editions: item.editions ?? null,
      fields,
      files: fileFacts(item.files),
      kind: item.kind,
      requirements: item.requirements ?? null,
    }),
  );
}

/**
 * Item-relative install path of a file: a skill's files sit under the folder of its
 * `SKILL.md` (a former command's single file installs as `SKILL.md`); a file of any
 * other kind installs under its own name. Editions use the same rule over their files.
 */
export function installRelative(
  item: { readonly kind: string; readonly files: readonly { sourcePath: string; cli?: string }[] },
  file: { readonly sourcePath: string },
): string {
  if (item.kind !== "skill") return basenameOf(file.sourcePath);
  const found = skillFile(item.files);
  if (found === undefined) return basenameOf(file.sourcePath);
  if (found.command)
    return file === found.file || file.sourcePath === found.file.sourcePath
      ? "SKILL.md"
      : basenameOf(file.sourcePath);
  const root = dirnameOf(found.file.sourcePath);
  return root === "" ? file.sourcePath : file.sourcePath.slice(root.length + 1);
}
