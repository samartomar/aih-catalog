import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "workflows/nuclei");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function sourceIdentity() {
  const paths = readdirSync(source).filter((p) => p.endsWith(".go") || ["go.mod", "go.sum"].includes(p)).sort();
  return digest(Buffer.concat(paths.flatMap((p) => [Buffer.from(`${p}\0`), readFileSync(join(source, p)), Buffer.from("\0")])));
}
const manifestFile = join(source, "manifest.json");
const check = process.argv.includes("--check");
const pkg = JSON.parse(readFileSync(join(root, "package.json")));
const platforms = [{ os: "linux", arch: "x64", goos: "linux", file: "linux-x64", magic: "7f454c46" },
  { os: "win32", arch: "x64", goos: "windows", file: "win32-x64.exe", magic: "4d5a" }];
if (!check) {
  const go = process.env.NUCLEI_GO ?? "go";
  const compiler = execFileSync(go, ["version"], { encoding: "utf8" }).trim();
  if (!compiler.startsWith("go version go1.26.9 ")) throw new Error("Use pinned Go 1.26.9 compiler");
  mkdirSync(join(source, "bin"), { recursive: true });
  for (const platform of platforms) {
    const output = join(source, "bin", platform.file);
    execFileSync(go, ["build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", output, "."], {
      cwd: source, env: { ...process.env, CGO_ENABLED: "0", GOOS: platform.goos, GOARCH: "amd64" }, timeout: 120000, stdio: "inherit" });
    chmodSync(output, 0o644);
  }
  writeFileSync(manifestFile, `${JSON.stringify({ schema: "urn:aihq:catalog:nuclei-workflow:1.0.0", package: { name: pkg.name, version: pkg.version },
    workflow: "nuclei-template-scan", compiler: "go1.26.9", sourceSha256: sourceIdentity(),
    helpers: platforms.map(({ os, arch, file }) => {
      const bytes = readFileSync(join(source, "bin", file));
      return { os, arch, path: `workflows/nuclei/bin/${file}`, sha256: digest(bytes), byteLength: bytes.length, archiveMode: "0644" };
    }) }, null, 2)}\n`);
}
const manifest = JSON.parse(readFileSync(manifestFile));
if (manifest.package.name !== pkg.name || manifest.package.version !== pkg.version || manifest.sourceSha256 !== sourceIdentity()) throw new Error("Nuclei helper source/package identity changed; rebuild helper");
for (const [index, platform] of platforms.entries()) {
  const h = manifest.helpers[index];
  const bytes = readFileSync(join(root, h.path));
  if (h.path !== `workflows/nuclei/bin/${platform.file}` || h.os !== platform.os || h.arch !== "x64" || h.archiveMode !== "0644" ||
      h.byteLength !== bytes.length || h.sha256 !== digest(bytes) || bytes.length > 16777216 ||
      !bytes.subarray(0, 4).toString("hex").startsWith(platform.magic)) throw new Error(`Invalid helper ${platform.file}`);
}
console.log(`Nuclei helpers: source and two executable identities verified (${manifest.package.version}, unpublished)`);
