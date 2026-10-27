// Catalog-authored MCP adaptations. Upstream source files and raw facts stay intact.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { authorEccCodexMcp } from "./author-ecc-codex-mcp.mjs";

const root = resolve(import.meta.dirname, "..");
const read = name => JSON.parse(readFileSync(resolve(root, `producer/ecc/${name}.json`)));
const declaration = read("declaration"), snapshot = read("snapshot"), inventory = read("inventory");
const acquisition = read("mcp-acquisition");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const variantKeys = ["github-local", "railway-hosted"];
const variantId = id => variantKeys.some(key => id === `ecc.claude.mcp.${key}` || id === `ecc.codex.mcp.${key}`);
declaration.items = declaration.items.filter(item => !variantId(item.id));
for (const key of Object.keys(snapshot.recipes.ecc)) if (variantKeys.some(variant => key.endsWith(`.mcp.${variant}.json`))) delete snapshot.recipes.ecc[key];
for (const key of Object.keys(inventory.itemFacts)) if (variantId(key)) delete inventory.itemFacts[key];
for (const entry of inventory.entries) entry.items = entry.items.filter(id => !variantId(id));
const adaptations = {
  "browser-use": {
    url: "https://api.browser-use.com/v3/mcp",
    reason: "Catalog adaptation: documented v3 Streamable HTTP endpoint; BROWSER_USE_KEY is required. Browser sessions and paid calls require separate authorization. The older endpoint is not declared retired.",
    source: "https://browser-use.com/posts/best-cloud-browser-mcp-servers",
  },
  "parallel-search": {
    url: "https://mcp.parallel.ai/mcp",
    reason: "Catalog adaptation: anonymous limited-access Streamable HTTP endpoint. An optional account/key for higher limits is a separate service choice. No backend binary version is asserted.",
    source: "https://parallel.ai/mcp",
  },
};
for (const [key, adaptation] of Object.entries(adaptations)) {
  const item = declaration.items.find(item => item.id === `ecc.claude.mcp.${key}`);
  const fact = inventory.itemFacts[item.id];
  fact.offeredServer.url = adaptation.url;
  fact.overlay = adaptation.reason;
  fact.adaptationSource = adaptation.source;
  fact.runtimePrerequisites = `${adaptation.reason} Configuration delivery is not approval, authentication or native service qualification.`;
  item.clientCapabilities.find(capability => capability.capability === "native-execution").reason = fact.runtimePrerequisites;
  item.activation[0].instructions = fact.runtimePrerequisites;
  const recipe = JSON.parse(snapshot.recipes.ecc[item.recipePath]);
  recipe.operations.find(operation => operation.kind === "config.entries").entries[0].value.literal = fact.offeredServer;
  snapshot.recipes.ecc[item.recipePath] = `${JSON.stringify(recipe, null, 2)}\n`;
}
for (const [key, provider] of Object.entries(acquisition.providers)) {
  const item = declaration.items.find(item => item.id === `ecc.claude.mcp.${key}`);
  const fact = inventory.itemFacts[item.id];
  const manifest = readFileSync(resolve(root, `producer/ecc/acquisition/${key}/package.json`), "utf8");
  const lockText = readFileSync(resolve(root, `producer/ecc/acquisition/${key}/package-lock.json`), "utf8");
  const lock = JSON.parse(lockText), direct = lock.packages[`node_modules/${provider.package}`];
  const bin = key === "squish" ? direct.bin["squish-mcp"] : Object.values(direct.bin)[0];
  const rootVariable = `AIHQ_MCP_${key.replaceAll("-", "_").toUpperCase()}_ROOT`;
  const entry = `node_modules/${provider.package}/${bin}`;
  const launcher = `const [a,b,c]=process.versions.node.split('.').map(Number);if(a!==26||b<12||(b===12&&c<1))throw Error('incompatible-runtime: Node >=26.12.1 <27 required');const r=process.env.${rootVariable};if(!r)throw Error('missing-runtime: ${rootVariable} must name the reviewed installation directory');const p=require('node:path').join(r,${JSON.stringify(entry)});process.argv.splice(1,0,p);import(require('node:url').pathToFileURL(p).href);`;
  const rawArgs = key === "railway" ? ["mcp"] : key === "filesystem" ? ["${ECC_FILESYSTEM_ROOT}"] : key === "supabase" ? ["--project-ref=${SUPABASE_PROJECT_REF}", "--read-only"] : key === "playwright" ? ["--browser", "chrome"] : [];
  fact.offeredServer = { command: "node", args: ["-e", launcher, "--", ...rawArgs], env: { ...(fact.offeredServer.env ?? {}), [rootVariable]: `\${${rootVariable}}` } };
  if (key === "memory") fact.offeredServer.env.MEMORY_FILE_PATH = "${MEMORY_FILE_PATH}";
  if (key === "browserbase") Object.assign(fact.offeredServer.env, { BROWSERBASE_PROJECT_ID: "${BROWSERBASE_PROJECT_ID}", GEMINI_API_KEY: "${GEMINI_API_KEY}" });
  if (key === "supabase") fact.offeredServer.env.SUPABASE_ACCESS_TOKEN = "${SUPABASE_ACCESS_TOKEN}";
  const variables = [...JSON.stringify(fact.offeredServer).matchAll(/\$\{([A-Z_][A-Z0-9_]*)(:-[^}]*)?\}/g)];
  fact.requiredHostEnvironment = [...new Set(variables.filter(match => !match[2]).map(match => match[1]))].sort();
  fact.optionalHostEnvironment = [...new Set(variables.filter(match => match[2]).map(match => match[1]))].sort();
  const blockers = key === "squish" ? "Blocked on Node 26: locked better-sqlite3 12.9.0 excludes Node 26; do not compile or override." : key === "railway" ? "The npm wrapper requires a separately verified native CLI artifact; lifecycle scripts stay disabled. 'mcp' proxies the hosted service; 'mcp local' is a distinct operation and is not selected." : "Native dependency and platform readiness remain unverified; disabled install scripts are not permission to compile or fetch native binaries.";
  fact.overlay = "Catalog-authored exact npm acquisition and explicit local launcher; raw upstream bytes preserved.";
  fact.adaptationSource = `https://registry.npmjs.org/${provider.package}/${provider.version}`;
  fact.acquisition = { package: provider.package, version: provider.version, integrity: direct.integrity, lockSha256: sha(lockText), node: acquisition.node, npm: acquisition.npm, blockers };
  fact.runtimePrerequisites = `${fact.overlay} Node 26.12.1 and separately selected npm 12.2.1; offline verified-cache retry, no lifecycle scripts. ${rootVariable} must name this recipe's runtime directory. Required host inputs: ${fact.requiredHostEnvironment.join(", ")}. ${blockers} ${key === "playwright" ? "Actual Chrome 156.0.8078.47/browser OS dependencies require separate qualification. " : ""}Package installation, one-server approval, credentials and native/service activation are separate states; no browser, paid API or business operation is authorized by installation.`;
  item.clientCapabilities.find(capability => capability.capability === "native-execution").reason = fact.runtimePrerequisites;
  item.clientCapabilities.find(capability => capability.capability === "native-execution").support = key === "squish" ? "unsupported" : "unknown";
  item.activation[0].instructions = fact.runtimePrerequisites;
  const recipe = JSON.parse(snapshot.recipes.ecc[item.recipePath]);
  recipe.inputs = {
    npmCli: { type: "string", required: true, minLength: 1, description: "Absolute path to the separately acquired npm 12.2.1 npm-cli.js; never inferred from Node's bundled npm." },
    npmCache: { type: "string", required: true, minLength: 1, description: "Absolute path to a caller-owned isolated integrity-verified npm cache." },
    acquisitionMode: { type: "string", required: false, default: "--offline", enum: ["--offline", "--online"], description: "Offline retry by default; online acquisition is an explicit reviewed network choice." },
  };
  item.configuration = recipe.inputs;
  const target = name => ({ root: "project", segments: [".aihq", "ecc", "source", item.id, "runtime", ...(name ? [name] : [])].map(literal => ({ literal })) });
  const authoredFiles = { "package.json": manifest, "package-lock.json": lockText, "acquire.mjs": readFileSync(resolve(root, "producer/ecc/acquire-node-mcp.mjs"), "utf8"), "user.npmrc": "", "global.npmrc": "" };
  const writes = Object.entries(authoredFiles).map(([name, content], index) => ({ id: `write-acquisition-${index}`, purpose: `Deliver Catalog-authored ${provider.package}@${provider.version} ${name}`, kind: "file.write", scope: "project", target: target(name), content: { literal: content }, requires: [], checks: [] }));
  const install = { id: "acquire-server", purpose: `Acquire exact ${provider.package}@${provider.version} closure; never execute lifecycle scripts`, kind: "process.run", scope: "project", executable: { name: "node" }, args: [{ literal: "acquire.mjs" }, { input: "npmCli" }, { input: "npmCache" }, { input: "acquisitionMode" }, { literal: sha(manifest) }, { literal: sha(lockText) }], cwd: target(), env: {}, acceptedExitCodes: [0], timeoutMs: 150000, maxOutputBytes: 1048576, effects: ["Install exact locked packages into this selection's runtime directory using the explicitly selected npm; online mode contacts registry.npmjs.org. No lifecycle, login, service or business operation."], requires: writes.map(write => write.id), checks: [] };
  const register = recipe.operations.find(operation => operation.kind === "config.entries");
  register.entries[0].value.literal = fact.offeredServer;
  register.requires = [install.id];
  recipe.prerequisites = [{ kind: "executable", name: "node" }];
  recipe.operations = [...recipe.operations.filter(operation => operation.kind === "file.write" && operation.material), ...writes, install, register];
  snapshot.recipes.ecc[item.recipePath] = `${JSON.stringify(recipe, null, 2)}\n`;
}
const python = read("python-acquisition");
for (const [key, providerKey, packageName, version, executable] of [["jira", "jira", "mcp-atlassian", "0.23.1", "mcp-atlassian"], ["omega-memory", "omega", "omega-memory", "1.5.20", "omega"]]) {
  const item = declaration.items.find(item => item.id === `ecc.claude.mcp.${key}`), fact = inventory.itemFacts[item.id];
  const variable = `AIHQ_MCP_${providerKey.toUpperCase()}_ROOT`;
  const guard = [
    "import sys,os,re,importlib.metadata as m",
    "from pathlib import Path",
    "if sys.version_info[:3]!=(3,14,10): raise SystemExit('incompatible-runtime: Python 3.14.10 required')",
    `if sys.prefix==sys.base_prefix or os.path.realpath(sys.prefix)!=os.path.realpath(os.environ['${variable}']): raise SystemExit('isolated-environment-required')`,
    "prefix=Path(sys.prefix).resolve()",
    "if re.search(r'^include-system-site-packages\\s*=\\s*true', (prefix/'pyvenv.cfg').read_text().lower(), re.M): raise SystemExit('shared-site-packages-refused')",
    "def require_distribution(name,version):",
    " d=m.distribution(name)",
    " if d.version!=version or not Path(d.locate_file('')).resolve().is_relative_to(prefix): raise SystemExit('incompatible-or-shared-distribution: '+name)",
    "require_distribution('mcp','1.30.0')",
    `require_distribution('${packageName}','${version}')`,
  ].join("\n");
  const launch = `${guard}\n${providerKey === "omega" ? "if not os.path.isabs(os.environ['OMEGA_HOME']): raise SystemExit('explicit absolute OMEGA_HOME required')\nrequire_distribution('onnxruntime','1.31.1')\n" : ""}sys.argv=['${executable}'${providerKey === "omega" ? ",'serve'" : ""}]\nnext(e for e in m.distribution('${packageName}').entry_points if e.group=='console_scripts' and e.name=='${executable}').load()()`;
  fact.offeredServer = { command: "python", args: ["-I", "-c", launch], env: { ...(fact.offeredServer.env ?? {}), [variable]: `\${${variable}}`, ...(providerKey === "omega" ? { OMEGA_HOME: "${OMEGA_HOME}" } : {}) } };
  fact.requiredHostEnvironment = [...new Set([...JSON.stringify(fact.offeredServer).matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map(match => match[1]))].sort();
  fact.optionalHostEnvironment = [];
  fact.overlay = "Catalog adaptation: isolated Python environment, exact server dependency closure, no uvx or shared environment.";
  fact.adaptationSource = `https://pypi.org/pypi/${packageName}/${version}/json`;
  fact.acquisition = { package: providerKey === "omega" ? "omega-memory[server]" : packageName, version, python: "3.14.10", mcp: "1.30.0", targets: python.targets.filter(target => target.provider === providerKey) };
  fact.runtimePrerequisites = `${fact.overlay} ${providerKey === "omega" ? "The [server] extra includes onnxruntime; OMEGA_HOME must name an explicit persistent store. " : "Jira URL/email/token retain their original account scope. "}Prepared hashed wheel-only locks are metadata projections, not installed environments. Exact Python 3.14.10 interpreter artifact, native wheels/import/stdio and platform qualification remain unqualified/unverified; missing artifact cells stay blocked. Preprovision the reviewed isolated environment with pip --require-hashes --only-binary=:all: against the matching lock; never compile, substitute MCP 2, ingest source or use a shared environment. ${variable} must equal the selected interpreter's venv prefix. Per-server approval and service authentication remain separate.`;
  item.clientCapabilities.find(capability => capability.capability === "native-execution").reason = fact.runtimePrerequisites;
  item.activation[0].instructions = fact.runtimePrerequisites;
  const recipe = JSON.parse(snapshot.recipes.ecc[item.recipePath]);
  const target = name => ({ root: "project", segments: [".aihq", "ecc", "source", item.id, "runtime", name].map(literal => ({ literal })) });
  const locks = python.targets.filter(target => target.provider === providerKey && target.lock);
  const writes = locks.map((lock, index) => ({ id: `write-python-lock-${index}`, purpose: `Deliver ${lock.target} exact wheel-only metadata projection; interpreter unqualified`, kind: "file.write", scope: "project", target: target(`${lock.target}.txt`), content: { literal: readFileSync(resolve(root, lock.lock), "utf8") }, requires: [], checks: [] }));
  const register = recipe.operations.find(operation => operation.kind === "config.entries");
  register.entries[0].value.literal = fact.offeredServer;
  recipe.prerequisites = [{ kind: "executable", name: "python" }];
  recipe.operations = [...recipe.operations.filter(operation => operation.kind === "file.write" && operation.material), ...writes, register];
  snapshot.recipes.ecc[item.recipePath] = `${JSON.stringify(recipe, null, 2)}\n`;
}
const routes = read("mcp-routes");
const github = declaration.items.find(item => item.id === "ecc.claude.mcp.github");
const githubFact = inventory.itemFacts[github.id];
githubFact.offeredServer = { type: "http", url: routes.github.hosted.url };
githubFact.requiredHostEnvironment = [];
githubFact.optionalHostEnvironment = [];
githubFact.overlay = "Catalog adaptation: official hosted GitHub MCP read-only route, authenticated by the client's separate OAuth flow; no binary/server pin for the hosted service.";
githubFact.adaptationSource = "https://github.com/github/github-mcp-server/blob/v2.0.3/docs/remote-server.md";
githubFact.runtimePrerequisites = `${githubFact.overlay} The default read-only toolset is explicitly requested; account grants and one-server approval remain separate. The selectable github-local alternative uses exact official 2.0.3 platform artifacts and a host-provided PAT. Configuration does not login, grant permissions, call tools or write repositories.`;
github.clientCapabilities.find(capability => capability.capability === "native-execution").reason = githubFact.runtimePrerequisites;
github.activation[0].instructions = githubFact.runtimePrerequisites;
const githubRecipe = JSON.parse(snapshot.recipes.ecc[github.recipePath]);
githubRecipe.prerequisites = [];
githubRecipe.operations.find(operation => operation.kind === "config.entries").entries[0].value.literal = githubFact.offeredServer;
snapshot.recipes.ecc[github.recipePath] = `${JSON.stringify(githubRecipe, null, 2)}\n`;
for (const [key, originalKey, server, reason] of [
  ["github-local", "github", { command: "github-mcp-server", args: ["stdio", "--read-only", "--toolsets", "repos,issues,pull_requests"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" } }, "Official GitHub MCP 2.0.3 local alternative. Preprovision the exact platform archive identified by the delivered artifact manifest; binary extraction, installed version/digest and native usability remain unqualified. PAT permissions and one-server approval are separate; repos/issues/pull_requests are read-only. No build, login or repository operation occurs at install."],
  ["railway-hosted", "railway", { type: "http", url: routes.railway.hosted.url }, "Official Railway hosted OAuth alternative. No local CLI or fictitious backend version is required. The client performs separately authorized OAuth and one-server approval. The railway choice is the 5.71.0 CLI proxy using 'mcp'; 'mcp local' is a distinct in-process operation and is not selected. No deployment, login or service mutation occurs at installation."],
]) {
  const original = declaration.items.find(item => item.id === `ecc.claude.mcp.${originalKey}`);
  const item = structuredClone(original), fact = structuredClone(inventory.itemFacts[original.id]);
  item.id = `ecc.claude.mcp.${key}`; item.label = item.id; item.recipePath = `catalog-recipes/${item.id}.json`; item.configuration = {};
  fact.sourceKey = key; fact.upstreamSourceKey = originalKey; fact.offeredServer = server; fact.overlay = reason; fact.runtimePrerequisites = reason; fact.variantOf = originalKey;
  fact.requiredHostEnvironment = key === "github-local" ? ["GITHUB_PERSONAL_ACCESS_TOKEN"] : []; fact.optionalHostEnvironment = [];
  delete fact.acquisition;
  item.clientCapabilities.find(capability => capability.capability === "native-execution").reason = reason; item.activation[0].instructions = reason;
  const recipe = JSON.parse(snapshot.recipes.ecc[original.recipePath]);
  recipe.id = item.id; recipe.inputs = {}; recipe.prerequisites = server.command ? [{ kind: "executable", name: server.command }] : [];
  const retarget = target => ({ ...target, segments: target.segments.map(segment => segment.literal === original.id ? { literal: item.id } : segment) });
  recipe.checks = recipe.checks.map(check => ({ ...check, target: retarget(check.target) }));
  const register = recipe.operations.find(operation => operation.kind === "config.entries");
  register.entries = [{ action: "set", path: ["mcpServers", key], value: { literal: server } }]; register.requires = [];
  recipe.operations = [...recipe.operations.filter(operation => operation.kind === "file.write" && operation.material).map(operation => ({ ...operation, target: retarget(operation.target) })), register];
  if (key === "github-local") recipe.operations.splice(-1, 0, { id: "write-artifact-manifest", purpose: "Deliver exact official 2.0.3 per-platform archive identities; no download or execution", kind: "file.write", scope: "project", target: retarget({ root: "project", segments: [".aihq", "ecc", "source", original.id, "github-local-artifacts.json"].map(literal => ({ literal })) }), content: { literal: `${JSON.stringify(routes.github, null, 2)}\n` }, requires: [], checks: [] });
  declaration.items.splice(declaration.items.indexOf(original) + 1, 0, item);
  inventory.itemFacts[item.id] = fact;
  for (const entry of inventory.entries) if (item.materials.some(material => material.path === entry.path)) entry.items.push(item.id);
  snapshot.recipes.ecc[item.recipePath] = `${JSON.stringify(recipe, null, 2)}\n`;
}
const explanations = {
  clickhouse: "Documented hosted ClickHouse Streamable HTTP OAuth service, read-only. No local package/backend version is asserted; account authorization and actual read-only tool scope remain unverified.",
  laraplugins: "Documented anonymous Laraplugins plugin search/details Streamable HTTP endpoint; no key/account prerequisite. Service availability and tools schema remain unverified.",
  vercel: "Documented Vercel project/deployment service via Streamable HTTP OAuth, available on all plans. No global setup helper, credentials or service operations run at installation; native/service scope remains unverified.",
  "token-optimizer": "Unsupported provider: token-optimizer-mcp 2.17.0 is not a maintained runnable baseline. Source configuration is retained as unverified bytes only. Needs a maintained supported successor or explicit retirement decision; no managed acquisition or activation.",
  longhand: "Unverified provider: Longhand 1.2.3 is beta and has no accepted default activation policy. Source configuration only; explicit beta acceptance and consent for session ingestion/hooks are required before activation.",
  nexus: "Unverified provider identity: bare nexus mcp configuration is preserved, but authoritative provider/package/release and command contract are unresolved. No lookalike package or runnable support claim.",
  "ito-compute": "Unverified host-owned entrypoint: ITO_MCP_ENTRYPOINT must name the actual separately built unpublished runtime with verified bytes. No managed acquisition or default activation is offered.",
  devfleet: "Unverified provider/daemon ownership and endpoint contract: localhost configuration is retained as source evidence only. No daemon installation, ingestion or activation is offered.",
  memxus: "Unverified raw MCP path/token contract: retain source configuration and host environment references. Needs authoritative client configuration and separately authorized authentication/handshake; no session ingestion or ready claim.",
};
for (const [key, reason] of Object.entries(explanations)) {
  const item = declaration.items.find(item => item.id === `ecc.claude.mcp.${key}`), fact = inventory.itemFacts[item.id];
  fact.runtimePrerequisites = reason; item.activation[0].instructions = reason;
  const native = item.clientCapabilities.find(capability => capability.capability === "native-execution");
  native.reason = reason;
  if (key === "token-optimizer") native.support = "unsupported";
}
const authored = authorEccCodexMcp(declaration, snapshot, inventory);
for (const [name, value] of Object.entries(authored))
  writeFileSync(resolve(root, `producer/ecc/${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
