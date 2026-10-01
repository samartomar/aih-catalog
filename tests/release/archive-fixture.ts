import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

export interface TarEntry {
  readonly path: string;
  readonly body?: Uint8Array;
  /** "0" regular, "5" directory, "2" symlink, "1" hard link. */
  readonly type?: string;
  readonly mode?: number;
  readonly linkname?: string;
}

/** A minimal independent ustar writer for archive fixtures. */
export function tarGz(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? new Uint8Array());
    const header = Buffer.alloc(512);
    // ustar splits a long path into a prefix (≤155 bytes) and a name (≤100 bytes) at a slash.
    let prefix = "";
    let name = entry.path;
    if (Buffer.byteLength(name) > 100) {
      const slashes = [...entry.path.matchAll(/\//g)].map((match) => match.index as number);
      const split = slashes.find((index) => Buffer.byteLength(entry.path.slice(index + 1)) <= 100);
      if (split === undefined || Buffer.byteLength(entry.path.slice(0, split)) > 155) {
        throw new Error(`fixture path too long: ${entry.path}`);
      }
      prefix = entry.path.slice(0, split);
      name = entry.path.slice(split + 1);
    }
    Buffer.from(name, "utf8").copy(header, 0);
    Buffer.from(prefix, "utf8").copy(header, 345);
    const octal = (value: number, length: number) =>
      `${value.toString(8).padStart(length - 1, "0")}\0`;
    header.write(octal(entry.mode ?? (entry.type === "5" ? 0o755 : 0o644), 8), 100, "ascii");
    header.write(octal(0, 8), 108, "ascii");
    header.write(octal(0, 8), 116, "ascii");
    header.write(octal(entry.type === "5" ? 0 : body.length, 12), 124, "ascii");
    header.write(octal(0, 12), 136, "ascii");
    header.write("        ", 148, "ascii");
    header.write(entry.type ?? "0", 156, "ascii");
    if (entry.linkname) header.write(entry.linkname, 157, "utf8");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
    blocks.push(header);
    if (entry.type !== "5" && body.length > 0) {
      blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** Every regular file under `root` as a `package/<path>` tar entry, sorted. */
export function packageEntries(root: string): TarEntry[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  return walk(root)
    .map((file) => ({
      path: `package/${relative(root, file).replaceAll("\\", "/")}`,
      body: readFileSync(file),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

export const sri = (algorithm: "sha256" | "sha512", bytes: Uint8Array) =>
  `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`;

type Route = (init: RequestInit | undefined) => Response | Promise<Response>;

/** A fetch double at the network boundary. Honors `redirect: "error"` and abort like fetch. */
export function fakeFetch(routes: Record<string, Route>) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ url, init });
    if (init?.signal?.aborted) throw init.signal.reason;
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    const response = await route(init);
    if (response.status >= 300 && response.status < 400 && init?.redirect === "error") {
      throw new TypeError("fetch failed: redirect");
    }
    return response;
  };
  return { fetch: fetcher as typeof fetch, requests };
}
