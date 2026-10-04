import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readInstalledRelease, resolveRelease } from "../../src/release/node.js";
import { configureItem } from "../../src/release/reader.js";
import { fakeFetch, packageEntries, sri, type TarEntry, tarGz } from "./archive-fixture.js";
import { sha256 } from "./fixtures.js";
import { installedRoot } from "./installed-fixture.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function packageRoot() {
  const fixture = installedRoot("resolve");
  cleanups.push(fixture.cleanup);
  return fixture.root;
}

const REGISTRY = "https://registry.example.org";
const TARBALL = `${REGISTRY}/@aihq/catalog/-/catalog-0.1.0.tgz`;
const METADATA = `${REGISTRY}/@aihq%2fcatalog/0.1.0`;
const reasons = (result: { diagnostics: readonly { reason: string }[] }) =>
  result.diagnostics.map((d) => d.reason);

function registry(archive: Buffer, metadata: Record<string, unknown> = {}) {
  return fakeFetch({
    [METADATA]: () =>
      Response.json({
        name: "@aihq/catalog",
        version: "0.1.0",
        dist: { tarball: TARBALL, integrity: sri("sha512", archive) },
        ...metadata,
      }),
    [TARBALL]: () =>
      new Response(archive, { headers: { "content-length": String(archive.length) } }),
  });
}
const request = { registry: REGISTRY, package: "@aihq/catalog", version: "0.1.0" };
const version = () =>
  JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")).version as string;

describe("resolveRelease", () => {
  it("resolves an exact registry version into a checked release and pinned archive source", async () => {
    expect(version()).toBe("0.1.0");
    const archive = tarGz(packageEntries(packageRoot()));
    const network = registry(archive);
    const result = await resolveRelease(request, { fetch: network.fetch });
    expect(reasons(result)).toEqual([]);
    expect(result.source).toEqual({
      kind: "archive",
      url: TARBALL,
      sha256: sha256(archive),
      byteLength: archive.length,
    });
    expect(result.provenance).toMatchObject({
      kind: "registry",
      registry: REGISTRY,
      package: "@aihq/catalog",
      version: "0.1.0",
      integrity: sri("sha512", archive),
      tarball: TARBALL,
      archiveSha256: sha256(archive),
      byteLength: archive.length,
      manifestPath: "release/release.json",
    });
    expect(network.requests.map((r) => [r.url, r.init?.redirect])).toEqual([
      [METADATA, "error"],
      [TARBALL, "error"],
    ]);
  });

  it("maps an archive and an installed root to the same release, recipe and material identities", async () => {
    const root = packageRoot();
    const archive = tarGz(packageEntries(root));
    const resolved = await resolveRelease(request, { fetch: registry(archive).fetch });
    const installed = await readInstalledRelease({ root });
    if (!resolved.release || !resolved.source || !installed.release || !installed.source)
      throw new Error("unread");
    expect(resolved.release.sha256).toBe(installed.release.sha256);
    const identity = (result: ReturnType<typeof configureItem>) => {
      const reference = result.selection?.recipe.reference;
      return [
        reference?.sha256,
        reference?.byteLength,
        reference?.materials.map(({ id, sha256: s, byteLength }) => ({ id, s, byteLength })),
      ];
    };
    const viaArchive = configureItem({
      release: resolved.release,
      itemId: "mattpocock.grill-me",
      configuration: {},
      materialSource: resolved.source,
    });
    const viaRoot = configureItem({
      release: installed.release,
      itemId: "mattpocock.grill-me",
      configuration: {},
      materialSource: installed.source,
    });
    expect(identity(viaArchive)).toEqual(identity(viaRoot));
    expect(viaArchive.selection?.recipe.reference.path).toBe(
      `package/${viaRoot.selection?.recipe.reference.path}`,
    );
    expect(viaArchive.provenance).toEqual(viaRoot.provenance);
  });

  it("accepts an explicitly reviewed archive by exact hash and length", async () => {
    const archive = tarGz(packageEntries(packageRoot()));
    const url = "https://downloads.example.org/catalog-0.1.0.tgz";
    const network = fakeFetch({ [url]: () => new Response(archive) });
    const pinned = { url, sha256: sha256(archive), byteLength: archive.length };
    const result = await resolveRelease({ archive: pinned }, { fetch: network.fetch });
    expect(result.valid).toBe(true);
    expect(result.source).toEqual({ kind: "archive", ...pinned });
    const wrong = await resolveRelease(
      { archive: { ...pinned, sha256: sha256("other") } },
      { fetch: network.fetch },
    );
    expect(reasons(wrong)).toEqual(["archive-identity-mismatch"]);
  });

  it.each([
    [
      "registry SRI",
      { dist: { tarball: TARBALL, integrity: sri("sha512", Buffer.from("other")) } },
      {},
      "integrity-mismatch",
    ],
    ["caller SRI", {}, { integrity: sri("sha256", Buffer.from("other")) }, "integrity-mismatch"],
    ["metadata identity", { version: "0.3.1" }, {}, "registry-metadata-mismatch"],
    [
      "plain HTTP tarball",
      { dist: { tarball: TARBALL.replace("https:", "http:") } },
      {},
      "invalid-tarball-url",
    ],
  ] as [
    string,
    Record<string, unknown>,
    Record<string, string>,
    string,
  ][])("refuses a mismatched %s", async (_name, metadata, extra, reason) => {
    const archive = tarGz(packageEntries(packageRoot()));
    const result = await resolveRelease(
      { ...request, ...extra },
      { fetch: registry(archive, metadata).fetch },
    );
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain(reason);
  });

  it.each([
    ["a version range", { ...request, version: "^0.1.0" }],
    ["a dist-tag", { ...request, version: "latest" }],
    ["an HTTP registry", { ...request, registry: "http://registry.example.org" }],
    [
      "registry credentials in the URL",
      { ...request, registry: "https://user:pass@registry.example.org" },
    ],
    ["an invalid package name", { ...request, package: "../catalog" }],
  ])("refuses %s before any request", async (_name, invalid) => {
    const network = fakeFetch({});
    expect(reasons(await resolveRelease(invalid, { fetch: network.fetch }))).toEqual([
      "invalid-request",
    ]);
    expect(network.requests).toEqual([]);
  });

  it("does not follow redirects", async () => {
    const network = fakeFetch({
      [METADATA]: () => new Response(null, { status: 302, headers: { location: TARBALL } }),
    });
    expect(reasons(await resolveRelease(request, { fetch: network.fetch }))).toEqual([
      "download-failed",
    ]);
  });

  it("refuses an archive whose declared length differs or that exceeds its pin", async () => {
    const archive = tarGz(packageEntries(packageRoot()));
    const url = "https://downloads.example.org/a.tgz";
    const lying = fakeFetch({
      [url]: () => new Response(archive, { headers: { "content-length": "12" } }),
    });
    const pinned = { url, sha256: sha256(archive), byteLength: archive.length };
    expect(reasons(await resolveRelease({ archive: pinned }, { fetch: lying.fetch }))).toEqual([
      "archive-length-mismatch",
    ]);
    const longer = fakeFetch({
      [url]: () => new Response(Buffer.concat([archive, Buffer.from("x")])),
    });
    expect(reasons(await resolveRelease({ archive: pinned }, { fetch: longer.fetch }))).toEqual([
      "archive-length-mismatch",
    ]);
  });

  const archiveWith = async (change: (entries: TarEntry[]) => TarEntry[]) => {
    const archive = tarGz(change(packageEntries(packageRoot())));
    const url = "https://downloads.example.org/case.tgz";
    const network = fakeFetch({ [url]: () => new Response(archive) });
    return resolveRelease(
      { archive: { url, sha256: sha256(archive), byteLength: archive.length } },
      { fetch: network.fetch },
    );
  };

  it.each([
    [
      "a member outside package/",
      (e: TarEntry[]) => [...e, { path: "other/file.txt", body: Buffer.from("x") }],
      "archive-layout",
    ],
    [
      "a different prefix for every member",
      (e: TarEntry[]) => e.map((x) => ({ ...x, path: x.path.replace(/^package\//, "pkg/") })),
      "archive-layout",
    ],
    [
      "a traversal member",
      (e: TarEntry[]) => [...e, { path: "package/../escape.txt", body: Buffer.from("x") }],
      "unsafe-archive-entry",
    ],
    [
      "a symbolic link",
      (e: TarEntry[]) => [...e, { path: "package/link", type: "2", linkname: "/etc/passwd" }],
      "unsafe-archive-entry",
    ],
    [
      "a hard link",
      (e: TarEntry[]) => [
        ...e,
        { path: "package/hard", type: "1", linkname: "package/package.json" },
      ],
      "unsafe-archive-entry",
    ],
    [
      "a duplicate member",
      (e: TarEntry[]) => [...e, { ...(e[0] as TarEntry) }],
      "archive-duplicate-entry",
    ],
    [
      "a case-folded duplicate",
      (e: TarEntry[]) => [...e, { path: "package/PACKAGE.json", body: Buffer.from("{}") }],
      "archive-duplicate-entry",
    ],
    [
      "an undeclared executable",
      (e: TarEntry[]) => [
        ...e,
        { path: "package/bin/run", body: Buffer.from("#!/bin/sh\n"), mode: 0o755 },
      ],
      "archive-executable-member",
    ],
    [
      "a tampered declared member",
      (e: TarEntry[]) =>
        e.map((x) =>
          x.path.endsWith("grilling/SKILL.md") ? { ...x, body: Buffer.from("changed\n") } : x,
        ),
      "member-length-mismatch",
    ],
    [
      "a missing declared member",
      (e: TarEntry[]) => e.filter((x) => !x.path.endsWith("grill-me/SKILL.md")),
      "member-missing",
    ],
  ] as [
    string,
    (e: TarEntry[]) => TarEntry[],
    string,
  ][])("refuses %s", async (_name, change, reason) => {
    const result = await archiveWith(change);
    expect(result.valid).toBe(false);
    expect(reasons(result)).toContain(reason);
  });

  it("refuses an unreadable archive", async () => {
    const archive = tarGz(packageEntries(packageRoot())).subarray(0, 200);
    const url = "https://downloads.example.org/cut.tgz";
    const network = fakeFetch({ [url]: () => new Response(archive) });
    const result = await resolveRelease(
      { archive: { url, sha256: sha256(archive), byteLength: archive.length } },
      { fetch: network.fetch },
    );
    expect(reasons(result)).toEqual(["archive-unreadable"]);
  });

  it("honors cancellation and the acquisition deadline", async () => {
    const controller = new AbortController();
    controller.abort();
    const idle = fakeFetch({});
    expect(
      reasons(await resolveRelease(request, { fetch: idle.fetch, signal: controller.signal })),
    ).toEqual(["cancelled"]);
    expect(idle.requests).toEqual([]);
    const hanging = fakeFetch({
      [METADATA]: (init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        ),
    });
    expect(reasons(await resolveRelease(request, { fetch: hanging.fetch, timeoutMs: 50 }))).toEqual(
      ["timeout"],
    );
  });
});
