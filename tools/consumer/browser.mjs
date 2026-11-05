/**
 * Browser-safe entry points: `/source`, `/reader` and `/contracts` are loaded from the installed
 * package as ES modules through a linker that refuses every Node built-in, and are evaluated
 * and called with Node's own globals (`process`, `Buffer`, `require`, `global`, `setImmediate`)
 * hidden, so only what a browser also has is reachable. Run with --experimental-vm-modules.
 * Prints one journey record.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { journey } from "./lib.mjs";

const j = journey(
  "browser",
  "Browser-safe /source, /reader and /contracts import no Node built-in and run without Node globals",
  "fixture",
);
const modules = new Map();
const builtins = new Set();

function load(url) {
  if (modules.has(url)) return modules.get(url);
  const module = new vm.SourceTextModule(readFileSync(fileURLToPath(url), "utf8"), {
    identifier: url,
    initializeImportMeta(meta) {
      meta.url = url;
    },
  });
  modules.set(url, module);
  return module;
}
async function linker(specifier, referencing) {
  if (specifier.startsWith("node:") || !/^[./@a-z]/.test(specifier) || isBuiltin(specifier)) {
    builtins.add(`${specifier} (from ${shortName(referencing.identifier)})`);
    throw new Error(`Node built-in ${specifier}`);
  }
  const resolved = specifier.startsWith(".")
    ? new URL(specifier, referencing.identifier).href
    : resolveBrowser(specifier);
  return load(resolved);
}

/** A bare specifier resolved the way a browser bundler would: `browser`, `import`, `default`. */
function resolveBrowser(specifier) {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const subpath = `.${specifier.slice(name.length)}`;
  const folder = join(process.cwd(), "node_modules", name);
  const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  let target = manifest.exports?.[subpath] ?? (subpath === "." ? manifest.exports : undefined);
  while (target && typeof target === "object")
    target = target.browser ?? target.import ?? target.default;
  if (typeof target !== "string") throw new Error(`${specifier} is not exported`);
  const path = join(folder, target);
  if (!existsSync(path)) throw new Error(`${specifier}: ${target} missing`);
  return pathToFileURL(path).href;
}
const nodeBuiltins = new Set((await import("node:module")).builtinModules);
const isBuiltin = (specifier) =>
  nodeBuiltins.has(specifier.split("/")[0]) || nodeBuiltins.has(specifier);
const shortName = (url) => url.replace(/^.*node_modules\//, "");

const hidden = ["process", "Buffer", "require", "global", "setImmediate", "clearImmediate"];
async function withoutNodeGlobals(body) {
  const saved = hidden.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const name of hidden)
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: true,
      writable: true,
    });
  try {
    return await body();
  } finally {
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  }
}

const entries = {};
for (const name of ["source", "reader", "contracts"]) {
  await j.check(`@aihq/catalog/${name} links and evaluates with no Node built-in`, async () => {
    const url = resolveBrowser(`@aihq/catalog/${name}`);
    const module = load(url);
    if (module.status === "unlinked") await module.link(linker);
    if (module.status === "linked") await withoutNodeGlobals(() => module.evaluate());
    if (module.status !== "evaluated") throw new Error(`status ${module.status}`);
    entries[name] = module.namespace;
    if (builtins.size > 0) throw new Error([...builtins].join(", "));
  });
}

await j.check("parsing, reading and planning run in that realm", async () => {
  await withoutNodeGlobals(async () => {
    const { parseSourceLink, findItems } = entries.source;
    const { readToolProfile, readContent, planInstall, renderStep } = entries.reader;
    const { toolProfiles, fixtures } = entries.contracts;
    const encode = (text) => new TextEncoder().encode(text);
    if (parseSourceLink("owner/repo").status !== "recognised") throw new Error("parseSourceLink");
    const skill = encode("---\nname: revise\ndescription: Review.\n---\n\nReview.\n");
    const found = findItems(
      [{ path: "skills/revise/SKILL.md", mode: "100644", sha256: "0".repeat(64), bytes: skill }],
      { framework: "web" },
    );
    if (found.status === "refused") throw new Error(`findItems ${JSON.stringify(found)}`);
    const content = readContent(encode(fixtures["content-valid"]));
    if (content.status !== "ok")
      throw new Error(`readContent ${JSON.stringify(content).slice(0, 300)}`);
    const profile = readToolProfile(encode(toolProfiles["claude-code"]));
    if (profile.status !== "ok") throw new Error("readToolProfile");
    const item = content.content.items[0];
    const plan = planInstall([item.id], [content.content], [profile.profile], {
      scope: "project",
      data: null,
    });
    if (plan.status !== "ok" && plan.status !== "incomplete")
      throw new Error(`planInstall ${JSON.stringify(plan).slice(0, 300)}`);
    const rendered = plan.plan.find((step) => step.render !== undefined);
    if (rendered) {
      const result = renderStep(rendered, [content.content], [profile.profile], []);
      if (!["ok", "refused", "invalid"].includes(result.status)) throw new Error("renderStep");
    }
  });
});

await j.check("/node and /producer are the Node-only entry points", async () => {
  for (const name of ["node", "producer"]) {
    const module = load(resolveBrowser(`@aihq/catalog/${name}`));
    let refused = false;
    try {
      await module.link(linker);
    } catch {
      refused = true;
    }
    if (name === "node" && !refused) throw new Error("/node linked without a Node built-in");
  }
});

process.stdout.write(JSON.stringify(j.finish()));
