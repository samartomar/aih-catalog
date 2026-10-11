/** Author caller-owned Core policies. This module performs no acquisition or execution. */
const text = (value, name) => {
  if (typeof value !== "string" || !value || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value))
    throw new Error(`Invalid ${name}`);
  return value;
};
const integer = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
};
const hash = (value) => {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("Expected lowercase SHA-256");
  return value;
};
const absolute = (value, name) => {
  text(value, name);
  if (!/^(?:\/|[A-Za-z]:[\\/])/u.test(value) || value.includes(",")) throw new Error(`Expected absolute ${name} without Docker mount separators`);
  return value;
};
const warning = "Docker daemon power is required. Bridge networking does not enforce target-only egress. Daemon/Desktop proxies may reroute or block traffic. Templates can change target data. Reports are untrusted data; retain until explicit deletion.";
function base(options, command, args, check = false) {
  if (!["linux", "win32"].includes(options.platform)) throw new Error("Only Linux x64 and Windows x64 are selected");
  const h = options.helper;
  if (!h || h.id !== "nuclei-helper") throw new Error("Expected pinned nuclei-helper material");
  hash(h.sha256); integer(h.byteLength, 1, 16777216, "helper length");
  text(h.path, "helper member");
  if (h.path !== `${h.source?.kind === "archive" ? "package/" : ""}workflows/nuclei/bin/${options.platform}-x64${options.platform === "win32" ? ".exe" : ""}`)
    throw new Error("Helper member/platform mismatch");
  if (h.source?.kind === "archive") {
    const url = new URL(h.source.url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Expected pinned HTTPS Catalog archive");
    hash(h.source.sha256); integer(h.source.byteLength, 1, 67108864, "Catalog archive length");
  } else if (h.source?.kind !== "local" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(h.source.input)) {
    throw new Error("Expected explicit Catalog material source");
  }
  const timeoutMs = integer(options.timeoutMs ?? 300000, 10000, 890000, "Core run timeout");
  const invocation = (values, timeout) => ({ executable: { material: h.id },
    args: values.map((literal) => ({ literal: String(literal) })),
    cwd: { root: "project", segments: [] }, env: {}, timeoutMs: timeout,
    maxOutputBytes: 16384, acceptedExitCodes: [0] });
  const recipe = { schema: "urn:aihq:core:recipe:1.0.0", id: `nuclei-${command}`,
    description: `${command} Nuclei workflow. ${warning}`, inputs: {}, materials: [structuredClone(h)],
    targets: ["project"], prerequisites: [{ kind: "platform", os: options.platform, architectures: ["x64"] }],
    operations: [{ id: command, purpose: `${command} reviewed Nuclei inputs`, kind: "process.run", scope: "project",
      requires: [], checks: check ? ["validate"] : [], effects: [warning, command === "prepare"
        ? "Fetch selected templates via api.github.com and raw.githubusercontent.com; write immutable preparation bundle. No assessment."
        : "Use the reviewed local Docker daemon, mounts, network and target. Write retained native reports and disposable staging."],
      ...invocation([command, ...args], timeoutMs) }], checks: check ? [{ id: "validate", purpose: "Independently require complete artifacts and cleanup",
      kind: "process.exit", ...invocation(["validate", "--run-dir", options.runDirectory, "--timeout-seconds", 5, "--max-output-bytes", 8192], 10000) }] : [] };
  return { schema: "urn:aihq:core:execution-policy:1.0.0", mode: "vibe", selections: [{
    id: `nuclei-${command}`, managementId: `nuclei-${command}`, scope: "project", requires: [],
    configuration: {}, recipe: { inline: recipe } }] };
}
export function authorPreparationPolicy(options) {
  const timeout = options.timeoutMs ?? 300000;
  const args = ["--output", absolute(options.output, "preparation directory"), "--timeout-seconds", Math.floor(timeout / 1000) - 5,
    "--max-output-bytes", 8192, "--max-download-bytes", integer(options.maxDownloadBytes ?? 67108864, 1, 67108864, "download limit")];
  if (options.reuse) {
    args.push("--reuse-bundle", absolute(options.reuse.path, "prior bundle"), "--reuse-sha256", hash(options.reuse.sha256),
      "--reuse-bytes", integer(options.reuse.byteLength, 1, 67108864, "prior bundle length"));
  } else {
    const official = options.official ?? ["http/technologies/tech-detect.yaml"];
    for (const path of official) {
      text(path, "official path");
      if (!/^http\/[A-Za-z0-9_./-]+\.ya?ml$/u.test(path) || path.split("/").includes("..")) throw new Error("Expected explicit official HTTP template path");
      args.push("--official", path);
    }
    for (const path of options.officialData ?? []) args.push("--official-data", text(path, "declared official data path"));
    for (const custom of options.custom ?? []) {
      args.push("--custom", `${absolute(custom.source, "custom source")}=${text(custom.path, "custom member")}`);
    }
    for (const data of options.customData ?? []) {
      args.push("--custom-data", `${absolute(data.source, "custom data source")}=${text(data.path, "custom data member")}`);
    }
    if (!official.length && !options.custom?.length) throw new Error("Select at least one template");
  }
  return base(options, "prepare", args);
}
export function authorAssessmentPolicy(options) {
  const target = text(options.target, "target");
  const url = new URL(target);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || target.startsWith("-")) throw new Error("Expected one unauthenticated HTTP(S) target");
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (!Array.isArray(options.allowHosts) || !options.allowHosts.includes(hostname)) throw new Error("Target outside explicit reviewed host allowlist");
  if (!["public", "private", "local-host"].includes(options.targetMode)) throw new Error("Choose explicit target network mode");
  if (typeof options.hostGateway !== "boolean") throw new Error("Choose explicit host-gateway mapping");
  const containerUser = text(options.containerUser, "container UID:GID");
  if (!/^(?:0|[1-9][0-9]{0,9}):(?:0|[1-9][0-9]{0,9})$/u.test(containerUser) || containerUser.split(":").some((v) => Number(v) > 4294967294)) throw new Error("Expected numeric container UID:GID");
  const daemon = text(options.daemon, "daemon");
  if (options.platform === "linux" ? !/^unix:\/\/\/[^\s]+$/u.test(daemon) : daemon !== "npipe:////./pipe/docker_engine") throw new Error("Expected local platform Docker endpoint");
  if (!/^projectdiscovery\/nuclei@sha256:[a-f0-9]{64}$/u.test(options.image)) throw new Error("Expected pinned Nuclei image digest");
  const timeout = options.timeoutMs ?? 300000;
  const runSeconds = Math.floor(timeout / 1000) - 5;
  const cleanup = integer(options.cleanupTimeoutSeconds ?? 20, 2, 60, "cleanup timeout");
  const toolSeconds = integer(options.toolTimeoutSeconds ?? Math.max(1, runSeconds - cleanup - 30), 1, runSeconds - cleanup - 10, "tool timeout");
  const args = ["--run-dir", absolute(options.runDirectory, "run directory"), "--bundle", absolute(options.bundle, "template bundle"),
    "--bundle-sha256", hash(options.bundleSha256), "--bundle-bytes", integer(options.bundleBytes, 1, 67108864, "bundle length"),
    "--target", target];
  for (const host of options.allowHosts) args.push("--allow-host", text(host, "allowed host"));
  args.push("--daemon", daemon, "--docker-cli", absolute(options.dockerCli, "Docker CLI"), "--image", options.image,
    "--container", resource(options.container), "--network", resource(options.network), "--target-mode", options.targetMode,
    "--container-user", containerUser,
    `--host-gateway=${options.hostGateway}`, "--cpus", integer(options.cpus ?? 1, 1, 4, "CPUs"),
    "--memory-mib", integer(options.memoryMiB ?? 512, 128, 4096, "memory"), "--pids", integer(options.pids ?? 128, 16, 256, "PIDs"),
    "--rate-limit", integer(options.rateLimit ?? 5, 1, 20, "request rate"), "--tool-timeout-seconds", toolSeconds,
    "--timeout-seconds", runSeconds, "--cleanup-timeout-seconds", cleanup,
    "--max-report-bytes", integer(options.maxReportBytes ?? 16777216, 1024, 67108864, "report bound"), "--max-output-bytes", 8192);
  return base(options, "run", args, true);
}
function resource(value) {
  text(value, "resource name");
  if (!/^aih-nuclei-[a-z0-9][a-z0-9-]{0,50}$/u.test(value)) throw new Error("Expected unique aih-nuclei- resource name");
  return value;
}
export function authorReconciliationPolicy(options) {
  const timeout = integer(options.timeoutMs ?? 300000, 10000, 890000, "Core reconciliation timeout");
  const helperSeconds = Math.floor(timeout / 1000) - 5;
  const cleanup = integer(options.cleanupTimeoutSeconds ?? Math.min(20, helperSeconds - 1), 2, Math.min(60, helperSeconds - 1), "cleanup timeout");
  return base(options, "reconcile", ["--run-dir", absolute(options.runDirectory, "run directory"),
    "--daemon", text(options.daemon, "daemon"), "--docker-cli", absolute(options.dockerCli, "Docker CLI"),
    "--container", resource(options.container), "--network", resource(options.network),
    "--timeout-seconds", helperSeconds, "--cleanup-timeout-seconds", cleanup, "--max-output-bytes", 8192]);
}
