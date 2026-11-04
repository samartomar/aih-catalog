import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterEach } from "vitest";

/** One tar entry: a regular file (default), folder, symlink, hard link or FIFO. */
export interface TarEntry {
  readonly path: string;
  readonly text?: string;
  readonly bytes?: Uint8Array;
  /** Declared size; defaults to the data length. */
  readonly size?: number;
  readonly mode?: number;
  readonly type?: "0" | "1" | "2" | "5" | "6";
  readonly link?: string;
}

const encoder = new TextEncoder();

function header(entry: TarEntry, size: number, type: string, name: string): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  block.write(
    `${(entry.mode ?? (type === "5" ? 0o755 : 0o644)).toString(8).padStart(7, "0")}\0`,
    100,
  );
  block.write("0000000\0", 108);
  block.write("0000000\0", 116);
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  block.write("00000000000\0", 136);
  block.write(type, 156);
  if (entry.link) block.write(entry.link, 157, 100, "utf8");
  block.write("ustar\0", 257);
  block.write("00", 263);
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}

const pad = (length: number) => Buffer.alloc((512 - (length % 512)) % 512);

/** An uncompressed tar, written independently of the reader under test. */
export function tar(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.bytes ?? encoder.encode(entry.text ?? ""));
    const type = entry.type ?? "0";
    const size = entry.size ?? (type === "0" ? data.byteLength : 0);
    let name = entry.path;
    if (Buffer.byteLength(name) > 100) {
      const record = ` path=${name}\n`;
      let length = record.length;
      while (`${length}${record}`.length !== length) length = `${length}${record}`.length;
      const pax = Buffer.from(`${length}${record}`);
      parts.push(
        header({ path: "pax" }, pax.byteLength, "x", "PaxHeader"),
        pax,
        pad(pax.byteLength),
      );
      name = name.slice(0, 100);
    }
    parts.push(header(entry, size, type, name));
    if (type === "0") parts.push(data, pad(data.byteLength));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** A gzipped npm tarball: every path is placed under `package/`. */
export const tarball = (entries: readonly TarEntry[], gzip = true): Buffer => {
  const raw = tar(entries.map((entry) => ({ ...entry, path: `package/${entry.path}` })));
  return gzip ? gzipSync(raw) : raw;
};

export const integrity = (bytes: Uint8Array): string =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

/** A package.json naming `name@version`, with `scripts` that must never run. */
export const manifest = (name: string, version: string, scripts: Record<string, string> = {}) =>
  JSON.stringify({ name, version, scripts });

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((done) => server.close(() => done(null)))),
  );
});

/**
 * A disposable local npm registry serving each package's versions as given tarballs, with
 * the given `latest` tag. Returns its URL and every path requested.
 */
export async function registry(
  packages: Readonly<
    Record<string, { readonly latest: string; readonly versions: Readonly<Record<string, Buffer>> }>
  >,
): Promise<{ readonly url: string; readonly requests: readonly string[] }> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
    requests.push(path);
    const tarballMatch = /^\/(.+)\/-\/[^/]+-(\d[^/]*)\.tgz$/.exec(path);
    if (tarballMatch) {
      const bytes = packages[tarballMatch[1] as string]?.versions[tarballMatch[2] as string];
      if (bytes === undefined) return response.writeHead(404).end();
      return response.writeHead(200, { "content-type": "application/octet-stream" }).end(bytes);
    }
    const name = path.slice(1);
    const entry = packages[name];
    if (entry === undefined) return response.writeHead(404).end("{}");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const short = name.split("/").at(-1);
    const versions = Object.fromEntries(
      Object.entries(entry.versions).map(([version, bytes]) => [
        version,
        {
          name,
          version,
          dist: {
            tarball: `${base}/${name}/-/${short}-${version}.tgz`,
            integrity: integrity(bytes),
          },
        },
      ]),
    );
    return response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ name, "dist-tags": { latest: entry.latest }, versions }));
  });
  servers.push(server);
  await new Promise((done) => server.listen(0, "127.0.0.1", () => done(null)));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, requests };
}
