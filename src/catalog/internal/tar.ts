/**
 * A bounded reader for the tar inside an npm tarball. Entries are read as data only: nothing
 * is written to disk, links and special files are reported but never followed, and the
 * leading package folder is removed the way npm removes it. Absolute or `..` paths refuse
 * the whole package. Limits are counted after unpacking.
 */
import { type Invalid, limits, type Refused } from "../contracts.js";
import type { SourceFile } from "./model.js";
import { compareCodeUnits, isSafeRelativePath, limitRefusal, quote, refused } from "./paths.js";

const BLOCK = 512;
const LATIN1 = new TextDecoder("latin1");
const UTF8 = new TextDecoder("utf-8", { fatal: true });

const text = (bytes: Uint8Array): string => {
  const end = bytes.indexOf(0);
  const used = end === -1 ? bytes : bytes.subarray(0, end);
  try {
    return UTF8.decode(used);
  } catch {
    return LATIN1.decode(used);
  }
};

function octal(field: Uint8Array): number | null {
  if (((field[0] as number) & 0x80) !== 0) return null; // base-256 sizes are never needed here
  const value = text(field).trim();
  return /^[0-7]*$/.test(value) ? (value === "" ? 0 : Number.parseInt(value, 8)) : null;
}

/** pax extended header records: `<length> <key>=<value>\n`. */
function paxRecords(bytes: Uint8Array): Map<string, string> | null {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const space = bytes.indexOf(0x20, offset);
    if (space === -1) return null;
    const length = Number(LATIN1.decode(bytes.subarray(offset, space)));
    if (!Number.isInteger(length) || length <= 0 || offset + length > bytes.byteLength) return null;
    let record: string;
    try {
      record = UTF8.decode(bytes.subarray(space + 1, offset + length - 1));
    } catch {
      return null;
    }
    const equals = record.indexOf("=");
    if (equals === -1) return null;
    records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}

export type ReadTarResult =
  | { readonly status: "ok"; readonly files: readonly SourceFile[] }
  | Refused
  | Invalid;

/** Reads a tar's entries; regular files carry bytes (sha256 is added by the caller). */
export function readTar(tar: Uint8Array): ReadTarResult {
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  let entries = 0;
  let regular = 0;
  let total = 0;
  let pax: Map<string, string> | null = null;
  let longName: string | null = null;
  let offset = 0;
  const bad = (reason: string): Refused => refused("source-mismatch", `the package tar ${reason}`);
  while (offset + BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const recorded = octal(header.subarray(148, 156));
    let sum = 0;
    for (let index = 0; index < BLOCK; index += 1)
      sum += index >= 148 && index < 156 ? 0x20 : (header[index] as number);
    if (recorded !== sum) return bad("has a damaged header");
    const type = String.fromCharCode(header[156] as number);
    const size = octal(header.subarray(124, 136));
    if (size === null) return bad("has an unreadable entry size");
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.byteLength) return bad("ends inside an entry");
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      pax = paxRecords(data);
      if (pax === null) return bad("has an unreadable extended header");
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      longName = text(data);
      continue;
    }
    if (type === "K") continue;

    const ustar = LATIN1.decode(header.subarray(257, 262)) === "ustar";
    const prefix = ustar ? text(header.subarray(345, 500)) : "";
    const name = text(header.subarray(0, 100));
    let path = pax?.get("path") ?? longName ?? (prefix === "" ? name : `${prefix}/${name}`);
    const paxSize = pax?.get("size");
    pax = null;
    longName = null;
    if (paxSize !== undefined && Number(paxSize) !== size) return bad("gives an entry two sizes");

    entries += 1;
    if (entries > limits.sourceEntries)
      return limitRefusal("sourceEntries", "the package entry count");
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\"))
      return refused("path-escape", `the package entry ${quote(path)} is not a safe relative path`);
    if (path.startsWith("./")) path = path.slice(2);
    if (path.endsWith("/")) path = path.slice(0, -1);
    if (path.split("/").some((segment) => segment === ".."))
      return refused("path-escape", `the package entry ${quote(path)} is not a safe relative path`);
    const slash = path.indexOf("/");
    if (slash === -1) {
      if (type === "5") continue; // the package folder itself
      return refused(
        "path-escape",
        `the package entry ${quote(path)} is outside the package folder`,
      );
    }
    const relative = path.slice(slash + 1);
    if (!isSafeRelativePath(relative))
      return refused("path-escape", `the package entry ${quote(path)} is not a safe relative path`);
    if (type === "5") continue;
    if (seen.has(relative)) return bad(`lists ${quote(relative)} twice`);
    seen.add(relative);
    if (type === "0" || type === "\0" || type === "7") {
      regular += 1;
      if (regular > limits.sourceFiles)
        return limitRefusal("sourceFiles", "the package file count");
      if (size > limits.sourceFileBytes)
        return limitRefusal("sourceFileBytes", `the file ${quote(relative)}`);
      total += size;
      if (total > limits.sourceBytes) return limitRefusal("sourceBytes", "the unpacked package");
      const mode = octal(header.subarray(100, 108)) ?? 0o644;
      files.push({
        path: relative,
        mode: (mode & 0o100) !== 0 ? "100755" : "100644",
        bytes: new Uint8Array(data),
      });
    } else if (type === "1" || type === "2") files.push({ path: relative, mode: "link" });
    else files.push({ path: relative, mode: "special-file" });
  }
  for (const path of seen) {
    for (let at = path.indexOf("/"); at !== -1; at = path.indexOf("/", at + 1))
      if (seen.has(path.slice(0, at)))
        return {
          status: "invalid",
          problems: [{ path, message: "the path is both a file and a folder" }],
        };
  }
  files.sort((left, right) => compareCodeUnits(left.path, right.path));
  return { status: "ok", files };
}
