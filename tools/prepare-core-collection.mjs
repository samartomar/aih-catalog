import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INPUT } from "./generate-catalog-collections.mjs";

/**
 * Records which Core release the Core-derived collection currently indexes.
 *
 * This runs when a Catalog content update is prepared, never while the index is
 * read or rendered. It identifies the release from exactly one stated source:
 *
 *   --from-package <core .tgz | package.json>  the Core package being supplied,
 *                                              for example a local preview build
 *   --from-npm-latest                          npm's current `latest` tag
 *
 * It rewrites only the Core collection's `current` release and origin and its
 * seed directory. It never invents seeds: when the Catalog has no seeds for the
 * identified release, the next generation fails and says so, because a new Core
 * content release needs a Catalog content update.
 */
const CORE_PACKAGE = "@aihq/core";
const CORE_COLLECTION = "aih-core";
const RELEASE = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const fail = (message) => {
  throw new Error(`prepare-core-collection: ${message}`);
};

function fromPackage(path) {
  const bytes = readFileSync(path);
  let manifest;
  if (path.endsWith(".tgz")) {
    const extract = spawnSync("tar", ["-xzOf", "-", "package/package.json"], {
      input: bytes,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (extract.status !== 0) fail(`could not read package/package.json from ${path}`);
    manifest = JSON.parse(extract.stdout);
  } else {
    manifest = JSON.parse(bytes.toString("utf8"));
  }
  if (manifest.name !== CORE_PACKAGE) fail(`${path} is ${manifest.name}, not ${CORE_PACKAGE}`);
  if (typeof manifest.version !== "string" || !RELEASE.test(manifest.version)) fail("package version");
  return {
    release: manifest.version,
    origin: {
      kind: "package-file",
      name: CORE_PACKAGE,
      version: manifest.version,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function fromNpmLatest() {
  const cli = process.env.npm_execpath;
  const viaNode = cli && /\.[cm]?js$/.test(cli);
  const args = ["view", CORE_PACKAGE, "dist-tags.latest", "--json"];
  const result = spawnSync(
    viaNode ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm",
    viaNode ? [cli, ...args] : args,
    { encoding: "utf8", windowsHide: true, ...(viaNode || process.platform !== "win32" ? {} : { shell: true }) },
  );
  if (result.status !== 0) fail(`npm view failed: ${(result.stderr ?? "").trim()}`);
  const version = JSON.parse(result.stdout);
  if (typeof version !== "string" || !RELEASE.test(version)) fail("npm returned no latest version");
  return {
    release: version,
    origin: { kind: "npm-dist-tag", name: CORE_PACKAGE, tag: "latest", version },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let identified;
    if (args[0] === "--from-package" && args.length === 2) identified = fromPackage(resolve(args[1]));
    else if (args[0] === "--from-npm-latest" && args.length === 1) identified = fromNpmLatest();
    else fail("usage: node tools/prepare-core-collection.mjs --from-package <path> | --from-npm-latest");

    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const inputPath = resolve(root, INPUT);
    const input = JSON.parse(readFileSync(inputPath, "utf8"));
    const core = input.collections?.find((collection) => collection.id === CORE_COLLECTION);
    if (core === undefined || core.owner?.package !== CORE_PACKAGE) fail(`no ${CORE_COLLECTION} collection`);
    core.current = { release: identified.release, origin: identified.origin };
    core.seedRoot = `workbench/aih-core-${identified.release}/`;
    const temporary = `${inputPath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(input, null, 2)}\n`, { flag: "wx" });
    try {
      renameSync(temporary, inputPath);
    } finally {
      rmSync(temporary, { force: true });
    }
    console.log(`${CORE_COLLECTION}: current release ${identified.release} (${identified.origin.kind})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
