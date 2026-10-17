import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { seedConsumerLock } from "../../tools/seed-consumer-lock.mjs";
import { sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");

function npmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const found = candidates.find(
    (candidate) =>
      candidate &&
      isAbsolute(candidate) &&
      basename(candidate) === "npm-cli.js" &&
      existsSync(candidate),
  );
  if (!found) throw new Error("unable to resolve a local npm-cli.js");
  return found;
}
const env = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"),
  );

let fixture = "";
let consumer = "";

beforeAll(() => {
  if (!existsSync(resolve(root, "dist/release/update-facts.js"))) {
    throw new Error("dist/release is missing; run npm run build:dist before the packed test");
  }
  fixture = mkdtempSync(join(tmpdir(), "aih-catalog-update-facts-"));
  const npm = npmCli();
  const [packed] = JSON.parse(
    execFileSync(
      process.execPath,
      [npm, "pack", "--ignore-scripts", "--offline", "--json", "--pack-destination", fixture],
      { cwd: root, env: env(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
    ),
  ) as { filename: string }[];
  if (!packed) throw new Error("npm pack produced no artifact");
  consumer = join(fixture, "consumer");
  seedConsumerLock(consumer, root);
  execFileSync(
    process.execPath,
    [
      npm,
      "install",
      "--prefix",
      consumer,
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      join(fixture, packed.filename),
    ],
    { cwd: fixture, env: env(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180_000 },
  );
}, 400_000);

afterAll(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

it("type-checks and compares two checked releases through the packed reader only", () => {
  const program = `
    import { readFileSync } from "node:fs";
    import { createHash } from "node:crypto";
    import { fileURLToPath } from "node:url";
    import {
      compareReleases,
      readRelease,
      type CompareReleasesResult,
      type ItemComparison,
      type VersionOrder,
    } from "@aihq/catalog/reader";
    import type { CatalogRelease } from "@aihq/catalog/contracts";

    type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
    const canonical = (value: Json): string => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
      return "{" + Object.keys(value).sort().map((key) =>
        JSON.stringify(key) + ":" + canonical(value[key] as Json)).join(",") + "}";
    };
    const checked = (bytes: Uint8Array): CatalogRelease => {
      const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
      const read = readRelease(bytes, { expectedSha256 });
      if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
      return read.release;
    };
    type Item = { id: string; recipe: { sha256: string } };
    type Doc = { package: { name: string; version: string }; items: Item[] };
    const shipped = readFileSync(fileURLToPath(import.meta.resolve("@aihq/catalog/release.json")));
    const derive = (change: (doc: Doc) => void): CatalogRelease => {
      const doc = JSON.parse(new TextDecoder().decode(shipped)) as Doc;
      change(doc);
      return checked(new TextEncoder().encode(canonical(doc as unknown as Json) + "\\n"));
    };
    const first = checked(shipped);
    const second = derive((doc) => {
      doc.package.version = "0.2.0-rc.1";
      doc.items = doc.items.filter((item) => item.id !== "aihq.client.zed");
      const tdd = doc.items.find((item) => item.id === "mattpocock.tdd");
      if (tdd === undefined) throw new Error("fixture item missing");
      tdd.recipe.sha256 = "0".repeat(64);
    });
    const unversioned = derive((doc) => { doc.package.version = "0.1.0-01"; });
    const other = derive((doc) => { doc.package.name = "@example/other-catalog"; });

    const ok = (result: CompareReleasesResult) => {
      if (result.status !== "ok") throw new Error(JSON.stringify(result.diagnostics));
      return result.value;
    };
    const update = ok(compareReleases({ first, second }));
    const describe = (entry: ItemComparison): string =>
      entry.presence === "in-both" ? entry.content : entry.presence;
    const counts: Record<string, number> = {};
    for (const entry of update.items) counts[describe(entry)] = (counts[describe(entry)] ?? 0) + 1;
    const order: VersionOrder = update.version.secondIs;
    const reverse = ok(compareReleases({ first: second, second: first }));
    const invalid = ok(compareReleases({ first, second: unversioned }));
    const unrelated = ok(compareReleases({ first, second: other }));
    const forged = compareReleases({ first, second: JSON.parse(JSON.stringify(second)) });
    console.log(JSON.stringify({
      package: update.package, order, reverse: reverse.version.secondIs,
      versions: [update.version.first, update.version.second],
      changed: update.items.filter((entry) => describe(entry) === "changed").map((entry) => entry.itemId),
      removed: update.items.filter((entry) => entry.presence === "only-in-first").map((entry) => entry.itemId),
      counts, sha256: [update.first.sha256, update.second.sha256],
      invalid: invalid.version, unrelated: { package: unrelated.package, items: unrelated.items.length,
        version: unrelated.version.secondIs },
      forged: forged.status === "refused" ? forged.diagnostics.map((d) => d.path) : [],
    }));
  `;
  const project = join(consumer, "update-facts");
  mkdirSync(project);
  writeFileSync(join(project, "consume.mts"), program);
  writeFileSync(
    join(project, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        skipLibCheck: false,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        lib: ["es2023"],
        types: ["node"],
        typeRoots: [resolve(root, "node_modules/@types")],
        noEmitOnError: true,
        rootDir: ".",
        outDir: "out",
      },
      files: ["consume.mts"],
    }),
  );
  const compiled = spawnSync(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    { cwd: project, encoding: "utf8", timeout: 120_000, windowsHide: true },
  );
  expect(compiled.status, `${compiled.stdout}${compiled.stderr}`).toBe(0);
  const ran = spawnSync(process.execPath, [join(project, "out", "consume.mjs")], {
    cwd: project,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  expect(ran.status, ran.stderr).toBe(0);
  const result = JSON.parse(ran.stdout);
  const shipped = JSON.parse(readFileSync(resolve(root, "release/release.json"), "utf8"));
  const total = shipped.items.length as number;
  expect(result).toMatchObject({
    package: "same-package",
    order: "newer",
    reverse: "older",
    versions: [shipped.package.version, "0.2.0-rc.1"],
    changed: ["mattpocock.tdd"],
    removed: ["aihq.client.zed"],
    counts: { unchanged: total - 2, changed: 1, "only-in-first": 1 },
    invalid: {
      first: shipped.package.version,
      second: "0.1.0-01",
      secondIs: "unknown",
      reason: "version-not-semver",
    },
    unrelated: { package: "different-package", items: 0, version: "unknown" },
    forged: ["/second"],
  });
  expect(result.sha256[0]).toBe(sha256(readFileSync(resolve(root, "release/release.json"))));
}, 180_000);
