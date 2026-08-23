import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

type R = Record<string, unknown>;
type J = null | boolean | number | string | J[] | { [key: string]: J };
const ZERO = "0".repeat(64),
  MAX_HEAD = 8 * 1024 * 1024,
  MAX_SIGNED = 24 * 1024 * 1024,
  MAX_SEED_ARTIFACT = 1024 * 1024,
  MAX_QUALIFICATION_RECEIPT = 4096;
export const STRICT_V2_CORE_LOCK = Object.freeze({
  coreCommit: "e27a55dcebb635c8298aa4fd6fd871f59089bcf7",
  schemaSha256: "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff",
});
const fail = (code: string): never => {
  throw new Error(code);
};
const rec = (v: unknown, c = "invalid"): R => {
  try {
    if (v === null || typeof v !== "object" || Array.isArray(v)) fail(c);
    const object = v as object;
    if (
      Object.getPrototypeOf(object) !== Object.prototype ||
      Object.getOwnPropertySymbols(object).length
    )
      fail(c);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(object)))
      if (!("value" in descriptor) || !descriptor.enumerable) fail(c);
    return object as R;
  } catch {
    return fail(c);
  }
};
const array = (v: unknown, c: string): unknown[] => {
  if (Array.isArray(v)) return v;
  return fail(c);
};
const frozen = <T>(value: T): T => {
  if (Array.isArray(value)) {
    for (const item of value) frozen(item);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) frozen(item);
  }
  return Object.freeze(value);
};
const order = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const keys = (v: R, wanted: readonly string[], c: string) => {
  const got = Object.getOwnPropertyNames(v).sort(order);
  const exp = [...wanted].sort(order);
  if (got.length !== exp.length || got.some((x, i) => x !== exp[i])) fail(c);
};
const text = (v: unknown, c: string, re = /^.{1,4096}$/): string =>
  typeof v === "string" &&
  re.test(v) &&
  v.normalize("NFC") === v &&
  [...v].every((x) => {
    const point = x.codePointAt(0) ?? 0;
    return point > 31 && point !== 127;
  })
    ? v
    : fail(c);
const hex = (v: unknown, c = "digest"): string => text(v, c, /^[0-9a-f]{64}$/);
const phex = (v: unknown, c = "digest"): string => text(v, c, /^sha256:[0-9a-f]{64}$/);
const canon = (v: J): string =>
  v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(canon).join(",")}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canon(v[k] as J)}`)
          .join(",")}}`;
const digest = (domain: string, v: J) =>
  createHash("sha256")
    .update(`${domain}\0${canon(v)}`)
    .digest("hex");
const sha = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const iso = (v: unknown, c: string) => {
  const s = text(v, c, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(s);
  if (match === null) return fail(c);
  const parts = match;
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]);
  const hour = Number(parts[4]),
    minute = Number(parts[5]),
    second = Number(parts[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (days[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    fail(c);
  return s;
};
const epochSeconds = (value: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
  if (match === null) return fail("time");
  const parts = match;
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]);
  const leapYears = (n: number) => Math.floor(n / 4) - Math.floor(n / 100) + Math.floor(n / 400);
  const daysBeforeYear = 365 * (year - 1970) + (leapYears(year - 1) - leapYears(1969));
  const monthDays = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const daysBeforeMonth = monthDays.slice(0, month - 1).reduce((total, days) => total + days, 0);
  return (
    ((daysBeforeYear + daysBeforeMonth + day - 1) * 24 + Number(parts[4])) * 3600 +
    Number(parts[5]) * 60 +
    Number(parts[6])
  );
};
const sorted = (v: unknown, c: string, re = /^.{1,256}$/): string[] => {
  if (!Array.isArray(v) || !v.length || v.length > 64) fail(c);
  const a = (v as unknown[]).map((x: unknown) => text(x, c, re));
  if (a.some((x, i) => i && (a[i - 1] ?? "") >= x)) fail(c);
  return a;
};
const base64 = (v: unknown, c: string) => {
  const s = text(v, c, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
  if (Buffer.from(s, "base64").toString("base64") !== s) fail(c);
  return s;
};
const replayIdentities = (v: unknown): string[] => {
  const state = rec(v, "replay");
  keys(state, ["acceptedIdentities"], "replay");
  const identities = array(state.acceptedIdentities, "replay");
  if (identities.length > 4096) fail("4096 replay");
  const normalized = identities.map((identity) =>
    text(identity, "replay", /^catalog-head:[0-9a-f]{64}:[0-9a-f]{64}$/),
  );
  if (normalized.some((identity, index) => index > 0 && (normalized[index - 1] ?? "") >= identity))
    fail("replay");
  return normalized;
};
function source(v: unknown): R {
  const s = rec(v, "source"),
    type = text(s.type, "source type", /^(github|npm|pypi|oci|remote|aih)$/);
  const shapes: Record<string, string[]> = {
    github: ["commit", "path", "repository", "type"],
    npm: ["integrity", "package", "registry", "type", "version"],
    pypi: ["filename", "package", "registry", "sha256", "type", "version"],
    oci: ["indexDigest", "manifestDigest", "platform", "registry", "repository", "type"],
    remote: ["contentDigest", "endpoint", "type"],
    aih: ["release", "revision", "type"],
  };
  const shape = shapes[type] ?? fail("source");
  keys(s, shape, "source");
  const semver =
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const value = (x: unknown, c = "source") => (typeof x === "string" ? x : fail(c));
  const match = (x: unknown, expression: RegExp, c = "source") => {
    const raw = value(x, c);
    return expression.test(raw) ? raw : fail(c);
  };
  const httpsBase = (x: unknown) => {
    const raw = value(x);
    try {
      const url = new URL(raw);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        raw !== url.href ||
        !url.pathname.endsWith("/")
      )
        fail("source");
      return raw;
    } catch {
      return fail("source");
    }
  };
  const httpsEndpoint = (x: unknown) => {
    const raw = value(x);
    try {
      const url = new URL(raw);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        raw !== url.href ||
        !url.pathname.startsWith("/")
      )
        fail("source");
      return raw;
    } catch {
      return fail("source");
    }
  };
  const ociRegistry = (x: unknown) => {
    const raw = value(x);
    try {
      const url = new URL(`https://${raw}`);
      const dnsHost =
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
      if (
        url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        url.hash !== "" ||
        raw !== url.host ||
        !(url.hostname.startsWith("[") || dnsHost.test(url.hostname))
      )
        fail("source");
      return raw;
    } catch {
      return fail("source");
    }
  };
  const sri = (x: unknown) => {
    const raw = value(x);
    const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(raw);
    if (match?.[1] === undefined) return fail("source");
    const encoded = match[1];
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length !== 64 || decoded.toString("base64") !== encoded) fail("source");
    return raw;
  };
  const stable = (x: unknown, c = "source") => match(x, /^[a-z][a-z0-9-]{0,63}$/, c);
  // These deliberately mirror the locked Core decision-v2 source grammar. The
  // catalog adds no provider interpretation; it only validates and binds bytes.
  if (type === "github") {
    const path = value(s.path);
    if (
      path.length < 1 ||
      path.length > 500 ||
      path !== path.trim() ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
      /[\p{C}]/u.test(path)
    )
      fail("source");
    return {
      commit: match(s.commit, /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
      path,
      repository: match(s.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      type,
    };
  } else if (type === "npm") {
    return {
      integrity: sri(s.integrity),
      package: match(s.package, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
      registry: httpsBase(s.registry),
      type,
      version: match(s.version, semver),
    };
  } else if (type === "pypi") {
    return {
      filename: match(s.filename, /^[A-Za-z0-9][A-Za-z0-9._+-]*$/),
      package: match(s.package, /^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      registry: httpsBase(s.registry),
      sha256: phex(s.sha256, "source digest"),
      type,
      version: match(s.version, /^[A-Za-z0-9][A-Za-z0-9.!+_-]{0,127}$/),
    };
  } else if (type === "oci") {
    const repository = value(s.repository);
    if (
      repository.length < 1 ||
      repository.length > 500 ||
      !repository.split("/").every((segment) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(segment))
    )
      fail("source");
    const platform = rec(s.platform, "platform");
    keys(
      platform,
      Object.hasOwn(platform, "variant")
        ? ["architecture", "os", "variant"]
        : ["architecture", "os"],
      "platform",
    );
    return {
      indexDigest: phex(s.indexDigest, "source digest"),
      manifestDigest: phex(s.manifestDigest, "source digest"),
      platform: {
        architecture: stable(platform.architecture, "platform"),
        os: stable(platform.os, "platform"),
        ...(Object.hasOwn(platform, "variant")
          ? { variant: stable(platform.variant, "platform") }
          : {}),
      },
      registry: ociRegistry(s.registry),
      repository,
      type,
    };
  } else if (type === "remote") {
    return {
      contentDigest: phex(s.contentDigest, "source digest"),
      endpoint: httpsEndpoint(s.endpoint),
      type,
    };
  } else if (type === "aih") {
    return { release: match(s.release, semver), revision: phex(s.revision, "source digest"), type };
  }
  return fail("source");
}
function subject(v: unknown): R {
  const s = rec(v, "subject");
  keys(s, ["id", "kind", "source", "sourceDigest", "subjectDigest"], "subject");
  const id = text(s.id, "subject id", /^[a-z][a-z0-9-]{0,63}$/),
    kind = text(s.kind, "subject kind", /^(tool|skill|mcp|package|profile)$/),
    src = source(s.source);
  const sd = `sha256:${digest("aih-governance-decision-source/v2", src as J)}`;
  if (s.sourceDigest !== sd) fail("source digest");
  const sub = `sha256:${digest("aih-governance-decision-subject/v2", { id, kind, sourceDigest: sd })}`;
  if (s.subjectDigest !== sub) fail("subject digest");
  return { id, kind, source: src, sourceDigest: sd, subjectDigest: sub };
}
function signer(v: unknown): R {
  const s = rec(v, "signer");
  keys(s, ["class", "identity", "keyId", "publicKeySpkiSha256"], "signer");
  const fp = hex(s.publicKeySpkiSha256, "spki");
  const out = {
    class: text(s.class, "class", /^administrator-ed25519$/),
    identity: text(s.identity, "identity", /^administrator:[a-z0-9:/._-]{1,242}$/),
    keyId: text(s.keyId, "key id", /^ed25519:[0-9a-f]{64}$/),
    publicKeySpkiSha256: fp,
  };
  if (out.keyId !== `ed25519:${fp}`) fail("key binding");
  return out;
}
function claims(v: unknown): R {
  const x = rec(v, "claims");
  keys(
    x,
    [
      "environment",
      "eventName",
      "issuer",
      "jobWorkflowRef",
      "ref",
      "repository",
      "repositoryId",
      "repositoryOwnerId",
    ],
    "claims",
  );
  const o = {
    environment: text(x.environment, "environment", /^[a-z0-9-]+$/),
    eventName: text(x.eventName, "event", /^workflow_dispatch$/),
    issuer: text(x.issuer, "issuer", /^https:\/\/token\.actions\.githubusercontent\.com$/),
    jobWorkflowRef: text(
      x.jobWorkflowRef,
      "workflow",
      /^samartomar\/aih-supported\/.+@refs\/heads\/main$/,
    ),
    ref: text(x.ref, "ref", /^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]+$/),
    repository: text(x.repository, "repository", /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/),
    repositoryId: text(x.repositoryId, "repo id", /^[1-9][0-9]*$/),
    repositoryOwnerId: text(x.repositoryOwnerId, "owner id", /^[1-9][0-9]*$/),
  };
  return o;
}
function descriptor(v: unknown, c: string): R {
  const x = rec(v, c);
  keys(x, ["identity", "sha256"], c);
  return { identity: text(x.identity, c, /^[a-z][a-z0-9:./_-]{0,255}$/), sha256: hex(x.sha256, c) };
}
function evidence(v: unknown, c: string, minimum = 1): R[] {
  if (!Array.isArray(v) || v.length < minimum || v.length > 64) fail(c);
  const a = (v as unknown[]).map((x: unknown) => descriptor(x, c));
  if (a.some((x, i) => i && String(a[i - 1]?.identity) >= String(x.identity))) fail(c);
  return a;
}
function entry(v: unknown, eff: string[], sch: string[]): R {
  const x = rec(v, "entry");
  keys(
    x,
    Object.hasOwn(x, "memberSha256")
      ? [
          "capabilities",
          "closure",
          "entryId",
          "memberSha256",
          "platforms",
          "prose",
          "qualification",
          "recipe",
          "subject",
          "versions",
        ]
      : [
          "capabilities",
          "closure",
          "entryId",
          "platforms",
          "prose",
          "qualification",
          "recipe",
          "subject",
          "versions",
        ],
    "entry",
  );
  const cap = rec(x.capabilities, "capabilities");
  keys(cap, ["commands", "egress", "hooks", "mcpTools", "permissions"], "capabilities");
  const caps = {
    commands: sorted(cap.commands, "commands"),
    egress: sorted(
      cap.egress,
      "egress",
      /^https:\/\/[a-z0-9.-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$/,
    ),
    hooks: sorted(cap.hooks, "hooks"),
    mcpTools: sorted(cap.mcpTools, "mcp"),
    permissions: sorted(cap.permissions, "permissions"),
  };
  const q = rec(x.qualification, "qualification");
  keys(q, ["findings", "gaps", "report", "rights"], "qualification");
  const ver = rec(x.versions, "versions");
  keys(ver, ["effect", "schema"], "versions");
  const versions = {
    effect: text(ver.effect, "effect", /^\d+$/),
    schema: text(ver.schema, "schema", /^\d+$/),
  };
  if (!eff.includes(versions.effect) || !sch.includes(versions.schema)) fail("compatible version");
  if (!Array.isArray(x.platforms) || !x.platforms.length || x.platforms.length > 64)
    fail("platforms");
  const platforms = (x.platforms as unknown[]).map((p: unknown) => {
    const y = rec(p, "platform");
    keys(y, ["architecture", "os"], "platform");
    return {
      architecture: text(y.architecture, "arch", /^[a-z0-9-]+$/),
      os: text(y.os, "os", /^[a-z0-9-]+$/),
    };
  });
  if (
    platforms.some((p: R, i: number) => i && canon((platforms[i - 1] ?? {}) as J) >= canon(p as J))
  )
    fail("platforms");
  const base = {
    capabilities: caps,
    closure: descriptor(x.closure, "closure"),
    entryId: text(x.entryId, "entry id", /^[a-z][a-z0-9.-]{0,63}$/),
    platforms,
    prose: descriptor(x.prose, "prose"),
    qualification: {
      findings: evidence(q.findings, "findings", 0),
      gaps: evidence(q.gaps, "gaps", 0),
      report: descriptor(q.report, "report"),
      rights: evidence(q.rights, "rights"),
    },
    recipe: descriptor(x.recipe, "recipe"),
    subject: subject(x.subject),
    versions,
  };
  const result = { ...base, memberSha256: digest("aih-supported-catalog-member/v2", base as J) };
  if (Object.hasOwn(x, "memberSha256") && x.memberSha256 !== result.memberSha256)
    fail("member digest");
  return result;
}
function head(v: unknown, requireDerived = false): R {
  const x = rec(v, "head"),
    derived = ["catalogHeadSha256", "catalogSha256"],
    base = [
      "claims",
      "compatibleEffectVersions",
      "compatibleSchemaVersions",
      "effectVersion",
      "entries",
      "previousCatalogHeadSha256",
      "protocol",
      "schemaVersion",
      "sequence",
      "signer",
      "validFrom",
      "validUntil",
    ];
  keys(x, requireDerived ? [...base, ...derived] : base, "head");
  if (x.protocol !== "CatalogHeadV2" || x.schemaVersion !== "2" || x.effectVersion !== "2")
    fail("version");
  const ef = sorted(x.compatibleEffectVersions, "effect versions", /^\d+$/),
    sc = sorted(x.compatibleSchemaVersions, "schema versions", /^\d+$/);
  if (!ef.includes("2") || !sc.includes("2")) fail("versions");
  const rawEntries = array(x.entries, "entries");
  if (!rawEntries.length) fail("entries");
  if (rawEntries.length > 4096) fail("4096 entries");
  if (
    !requireDerived &&
    rawEntries.some((e: unknown) => Object.hasOwn(rec(e, "entry"), "memberSha256"))
  )
    fail("member digest");
  const es = rawEntries
    .map((e: unknown) => entry(e, ef, sc))
    .sort((a: R, b: R) => order(String(a.entryId), String(b.entryId)));
  if (new Set(es.map((e: R) => e.entryId)).size !== es.length) fail("entries");
  const sequence = x.sequence;
  if (
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    Object.is(sequence, -0)
  )
    fail("sequence");
  const previous = hex(x.previousCatalogHeadSha256, "previous");
  if ((sequence === 0) !== (previous === ZERO)) fail("predecessor");
  const from = iso(x.validFrom, "valid from"),
    until = iso(x.validUntil, "valid until"),
    seconds = epochSeconds(until) - epochSeconds(from);
  if (seconds <= 0 || seconds > 90 * 86400) fail("validity");
  const baseHead = {
    claims: claims(x.claims),
    compatibleEffectVersions: ef,
    compatibleSchemaVersions: sc,
    effectVersion: "2",
    entries: es,
    previousCatalogHeadSha256: previous,
    protocol: "CatalogHeadV2",
    schemaVersion: "2",
    sequence,
    signer: signer(x.signer),
    validFrom: from,
    validUntil: until,
  };
  const catalogSha256 = digest("aih-supported-catalog/v2", es as J);
  const full = { ...baseHead, catalogSha256 };
  const catalogHeadSha256 = digest("aih-supported-catalog-head/v2", full as J);
  if (
    requireDerived &&
    (x.catalogSha256 !== catalogSha256 || x.catalogHeadSha256 !== catalogHeadSha256)
  )
    fail("head digest");
  const result = { ...full, catalogHeadSha256 };
  if (Buffer.byteLength(canon(result as J)) > MAX_HEAD) fail("head-too-large");
  return frozen(result);
}
export function createCatalogHeadV2(v: unknown): R {
  const x = rec(v, "head");
  const hasCatalog = Object.hasOwn(x, "catalogSha256");
  const hasHead = Object.hasOwn(x, "catalogHeadSha256");
  if (hasCatalog !== hasHead) fail("head");
  return head(x, hasCatalog);
}
export function canonicalCatalogHeadV2Bytes(v: unknown): Buffer {
  return Buffer.from(canon(head(v, true) as J));
}
export function parseCatalogHeadV2Json(v: string): R {
  if (Buffer.byteLength(v) > MAX_HEAD || v !== v.trim() || v.startsWith("\ufeff"))
    fail("head json");
  let x: unknown;
  try {
    x = JSON.parse(v);
  } catch {
    fail("head json");
  }
  const h = head(x, true);
  if (v !== canon(h as J)) fail("head json");
  return h;
}
const pae = (t: string, p: Buffer) =>
  Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(t)} ${t} ${p.length} `), p]);
function privateKey(v: unknown): KeyObject {
  try {
    if (typeof v === "string" && (v.match(/-----BEGIN [^-]+-----/g) ?? []).length !== 1)
      fail("private key");
    if (
      v instanceof Buffer &&
      (v.toString("utf8").match(/-----BEGIN [^-]+-----/g) ?? []).length !== 1
    )
      fail("private key");
    const k = v instanceof Buffer || typeof v === "string" ? createPrivateKey(v) : (v as KeyObject);
    if (k.type !== "private" || k.asymmetricKeyType !== "ed25519") fail("private key");
    return k;
  } catch {
    return fail("private key");
  }
}
export function signCatalogHeadV2(v: unknown): R {
  const x = rec(v, "sign input");
  keys(x, ["head", "privateKey"], "sign input");
  const h = head(x.head, true),
    k = privateKey(x.privateKey);
  const privatePem = k.export({ format: "pem", type: "pkcs8" });
  if (typeof privatePem !== "string") fail("private key");
  const exported = createPublicKey(privatePem).export({ format: "der", type: "spki" });
  if (!Buffer.isBuffer(exported)) fail("private key");
  const spki = exported;
  if (`ed25519:${sha(spki)}` !== signer(h.signer).keyId) fail("private key");
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicate: {
      candidateSha256: sha(Buffer.from(canon(h as J))),
      catalogHead: h,
      catalogHeadSha256: h.catalogHeadSha256,
      claims: h.claims,
      effectVersion: h.effectVersion,
      protocol: h.protocol,
      replayIdentity: `catalog-head:${h.catalogHeadSha256}:${sha(Buffer.from(canon(h as J)))}`,
      schemaVersion: h.schemaVersion,
      signer: signer(h.signer),
      validFrom: h.validFrom,
      validUntil: h.validUntil,
    },
    predicateType: "https://aih.dev/SupportedCatalogV2",
    subject: [{ digest: { sha256: h.catalogHeadSha256 }, name: "aih-supported/CatalogHeadV2" }],
  };
  const p = Buffer.from(canon(statement as J));
  return frozen({
    envelope: {
      payload: p.toString("base64"),
      payloadType: "application/vnd.in-toto+json",
      signatures: [
        {
          keyid: signer(h.signer).keyId,
          sig: sign(null, pae("application/vnd.in-toto+json", p), k).toString("base64"),
        },
      ],
    },
    head: h,
  });
}
function verified(v: unknown): { head: R; opaque: boolean } {
  const x = rec(v, "verify"),
    allow = ["catalogSignerRoots", "expectedClaims", "lastAccepted", "now", "replay", "signed"];
  if (Object.hasOwn(x, "skipContinuity")) fail("verify");
  if (Object.keys(x).some((key) => !allow.includes(key))) fail("verify");
  if (!("now" in x)) fail("now");
  const now = iso(x.now, "now"),
    signed = rec(x.signed, "signed"),
    env = rec(signed.envelope ?? signed, "envelope");
  if (Object.hasOwn(signed, "envelope"))
    keys(signed, Object.hasOwn(signed, "head") ? ["envelope", "head"] : ["envelope"], "signed");
  keys(env, ["payload", "payloadType", "signatures"], "envelope");
  if (typeof env.payload === "string" && Buffer.byteLength(env.payload, "utf8") > MAX_SIGNED)
    fail("24 MiB size limit");
  if (
    env.payloadType !== "application/vnd.in-toto+json" ||
    !Array.isArray(env.signatures) ||
    env.signatures.length !== 1
  )
    fail("envelope");
  const payload = Buffer.from(base64(env.payload, "payload"), "base64");
  if (payload.length > MAX_SIGNED) fail("signed-too-large");
  let st: R | undefined;
  try {
    st = JSON.parse(payload.toString("utf8")) as R;
  } catch {
    return fail("payload");
  }
  const statement = st ?? fail("payload");
  if (canon(statement as J) !== payload.toString("utf8")) fail("payload");
  keys(statement, ["_type", "predicate", "predicateType", "subject"], "statement");
  if (
    statement._type !== "https://in-toto.io/Statement/v1" ||
    statement.predicateType !== "https://aih.dev/SupportedCatalogV2" ||
    !Array.isArray(statement.subject) ||
    statement.subject.length !== 1
  )
    fail("statement");
  const pr = rec(statement.predicate, "predicate"),
    pk = [
      "candidateSha256",
      "catalogHead",
      "catalogHeadSha256",
      "claims",
      "effectVersion",
      "protocol",
      "replayIdentity",
      "schemaVersion",
      "signer",
      "validFrom",
      "validUntil",
    ];
  keys(pr, pk, "predicate");
  const rootValues = array(x.catalogSignerRoots, "roots");
  if (!rootValues.length) fail("roots");
  if (rootValues.length > 64) fail("64 roots");
  const roots = rootValues.map((value) => {
    const q = rec(value, "root");
    keys(
      q,
      ["class", "identity", "keyId", "publicKeySpkiDerBase64", "publicKeySpkiSha256"],
      "root",
    );
    const projection = signer({
      class: q.class,
      identity: q.identity,
      keyId: q.keyId,
      publicKeySpkiSha256: q.publicKeySpkiSha256,
    });
    const der = Buffer.from(base64(q.publicKeySpkiDerBase64, "root"), "base64");
    if (sha(der) !== projection.publicKeySpkiSha256) fail("root");
    let pub: KeyObject;
    try {
      pub = createPublicKey({ key: der, format: "der", type: "spki" });
      if (pub.asymmetricKeyType !== "ed25519") fail("root");
    } catch {
      return fail("root");
    }
    return { projection, pub };
  });
  if (new Set(roots.map((root) => root.projection.keyId)).size !== roots.length)
    fail("duplicate root");
  const signatures = array(env.signatures, "envelope");
  const sig = rec(signatures[0], "signature");
  keys(sig, ["keyid", "sig"], "signature");
  const keyid = text(sig.keyid, "keyid", /^ed25519:[0-9a-f]{64}$/),
    sigBytes = Buffer.from(base64(sig.sig, "signature"), "base64");
  const trustedRoot = roots.find((root) => root.projection.keyId === keyid) ?? fail("root");
  if (!verify(null, pae(env.payloadType as string, payload), trustedRoot.pub, sigBytes))
    fail("signature");
  const replay = x.replay;
  const acceptedReplay = replay === undefined ? undefined : replayIdentities(replay);
  if (replay !== undefined) {
    if (acceptedReplay === undefined) fail("replay");
  }
  const subjects = array(statement.subject, "statement");
  const statementSubject = rec(subjects[0], "statement subject");
  keys(statementSubject, ["digest", "name"], "statement subject");
  const statementDigestRecord = rec(statementSubject.digest, "statement digest");
  keys(statementDigestRecord, ["sha256"], "statement digest");
  const statementDigest = hex(statementDigestRecord.sha256, "statement digest");
  const statementName = text(
    statementSubject.name,
    "statement subject",
    /^aih-supported\/CatalogHeadV2$/,
  );
  const raw = rec(pr.catalogHead, "catalog head"),
    unknown = raw.schemaVersion !== "2" || raw.effectVersion !== "2";
  if (unknown) {
    if (
      pr.protocol !== "CatalogHeadV2" ||
      pr.candidateSha256 !== sha(Buffer.from(canon(raw as J))) ||
      pr.catalogHeadSha256 !== statementDigest ||
      statementName !== "aih-supported/CatalogHeadV2" ||
      pr.replayIdentity !== `catalog-head:${pr.catalogHeadSha256}:${pr.candidateSha256}`
    )
      fail("binding");
    claims(pr.claims);
    if (canon(claims(x.expectedClaims) as J) !== canon(pr.claims as J)) fail("claims");
    const opaqueSigner = signer(pr.signer);
    if (
      canon({
        ...trustedRoot.projection,
      } as J) !== canon(opaqueSigner as J)
    )
      fail("signer");
    iso(pr.validFrom, "from");
    iso(pr.validUntil, "until");
    const opaqueFrom = iso(pr.validFrom, "from"),
      opaqueUntil = iso(pr.validUntil, "until");
    if (now < opaqueFrom || now >= opaqueUntil) fail("time");
    if (acceptedReplay?.includes(text(pr.replayIdentity, "replay"))) fail("replay");
    return { head: pr, opaque: true };
  }
  const h = head(raw, true);
  if (Object.hasOwn(signed, "head") && canon(head(signed.head, true) as J) !== canon(h as J))
    fail("signed head");
  for (const k of [
    "catalogHeadSha256",
    "claims",
    "effectVersion",
    "protocol",
    "schemaVersion",
    "signer",
    "validFrom",
    "validUntil",
  ]) {
    if (canon(pr[k] as J) !== canon(h[k] as J)) fail("binding");
  }
  if (
    pr.candidateSha256 !== sha(Buffer.from(canon(h as J))) ||
    statementName !== "aih-supported/CatalogHeadV2" ||
    statementDigest !== h.catalogHeadSha256 ||
    pr.replayIdentity !== `catalog-head:${h.catalogHeadSha256}:${pr.candidateSha256}`
  )
    fail("binding");
  if (
    canon({
      ...trustedRoot.projection,
    } as J) !== canon(signer(h.signer) as J)
  )
    fail("signer");
  if (canon(claims(x.expectedClaims) as J) !== canon(h.claims as J)) fail("claims");
  const knownFrom = iso(h.validFrom, "from"),
    knownUntil = iso(h.validUntil, "until");
  if (now < knownFrom || now >= knownUntil) fail("time");
  const last = x.lastAccepted;
  if (last !== undefined && last !== null) {
    const l = head(last, true);
    const lastSequence = l.sequence;
    if (typeof lastSequence !== "number") return fail("continuity");
    if (
      h.catalogHeadSha256 !== l.catalogHeadSha256 &&
      (h.sequence !== lastSequence + 1 || h.previousCatalogHeadSha256 !== l.catalogHeadSha256)
    )
      fail("continuity");
  } else if (h.sequence !== 0) fail("continuity");

  if (replay !== undefined) {
    if (acceptedReplay?.includes(text(pr.replayIdentity, "replay"))) fail("replay");
  }
  return { head: h, opaque: false };
}
export function verifySignedCatalogV2(v: unknown): R {
  const q = verified(v);
  if (q.opaque) fail("unsupported-version");
  return q.head;
}
export function inspectSignedCatalogV2(v: unknown): R {
  const q = verified(v);
  return q.opaque
    ? frozen({
        kind: "unsupported-version",
        record: {
          candidateSha256: q.head.candidateSha256,
          catalogHeadSha256: q.head.catalogHeadSha256,
          claims: q.head.claims,
          effectVersion: q.head.effectVersion,
          protocol: q.head.protocol,
          replayIdentity: q.head.replayIdentity,
          schemaVersion: q.head.schemaVersion,
          signer: q.head.signer,
          validFrom: q.head.validFrom,
          validUntil: q.head.validUntil,
        },
      })
    : frozen({ kind: "materializable", head: q.head });
}
export function deriveQualificationBasisV2(v: unknown): R {
  const x = rec(v, "basis");
  keys(x, ["entryId", "head"], "basis");
  const h = head(x.head, true),
    e = (h.entries as R[]).find((z) => z.entryId === x.entryId);
  if (!e || (e.versions && ((e.versions as R).effect !== "2" || (e.versions as R).schema !== "2")))
    fail("basis");
  const selected = e as R;
  return frozen({
    catalogDigest: `sha256:${h.catalogSha256}`,
    catalogHeadDigest: `sha256:${h.catalogHeadSha256}`,
    catalogMemberDigest: `sha256:${selected.memberSha256}`,
    catalogSignerIdentity: (h.signer as R).identity,
    kind: "aih-supported",
    subjectDigest: (selected.subject as R).subjectDigest,
    subjectKind: (selected.subject as R).kind,
  });
}
function qualificationBasis(v: unknown): R {
  const x = rec(v, "qualification-basis");
  keys(
    x,
    [
      "catalogDigest",
      "catalogHeadDigest",
      "catalogMemberDigest",
      "catalogSignerIdentity",
      "kind",
      "subjectDigest",
      "subjectKind",
    ],
    "qualification-basis",
  );
  return {
    catalogDigest: phex(x.catalogDigest, "qualification-basis"),
    catalogHeadDigest: phex(x.catalogHeadDigest, "qualification-basis"),
    catalogMemberDigest: phex(x.catalogMemberDigest, "qualification-basis"),
    catalogSignerIdentity: text(
      x.catalogSignerIdentity,
      "qualification-basis",
      /^[A-Za-z0-9][A-Za-z0-9:._@/-]{0,255}$/,
    ),
    kind: text(x.kind, "qualification-basis", /^aih-supported$/),
    subjectDigest: phex(x.subjectDigest, "qualification-basis"),
    subjectKind: text(x.subjectKind, "qualification-basis", /^(tool|skill|mcp|package|profile)$/),
  };
}
function qualificationReceipt(v: unknown): R {
  const x = rec(v, "qualification-receipt");
  keys(
    x,
    [
      "expiresAt",
      "format",
      "issuedAt",
      "notBefore",
      "organizationAdmission",
      "qualificationBasis",
      "subject",
      "version",
    ],
    "qualification-receipt",
  );
  if (x.format !== "aih-supported-qualification-receipt" || x.version !== 1)
    fail("qualification-receipt");
  if (x.organizationAdmission !== "not-authoritative") fail("qualification-receipt");
  const issuedAt = iso(x.issuedAt, "qualification-receipt"),
    notBefore = iso(x.notBefore, "qualification-receipt"),
    expiresAt = iso(x.expiresAt, "qualification-receipt");
  const duration = epochSeconds(expiresAt) - epochSeconds(issuedAt);
  if (
    epochSeconds(issuedAt) > epochSeconds(notBefore) ||
    epochSeconds(notBefore) >= epochSeconds(expiresAt) ||
    duration > 90 * 86400
  )
    fail("qualification-receipt");
  const receiptSubject = subject(x.subject);
  const receiptBasis = qualificationBasis(x.qualificationBasis);
  if (
    receiptBasis.subjectDigest !== receiptSubject.subjectDigest ||
    receiptBasis.subjectKind !== receiptSubject.kind
  )
    fail("qualification-receipt");
  const result = {
    expiresAt,
    format: "aih-supported-qualification-receipt",
    issuedAt,
    notBefore,
    organizationAdmission: "not-authoritative",
    qualificationBasis: receiptBasis,
    subject: receiptSubject,
    version: 1,
  };
  if (Buffer.byteLength(canon(result as J), "utf8") > MAX_QUALIFICATION_RECEIPT)
    fail("qualification-receipt-too-large");
  return frozen(result);
}
export function canonicalQualificationReceiptBytes(v: unknown): Buffer {
  return Buffer.from(canon(qualificationReceipt(v) as J), "utf8");
}
export function emitQualificationReceipt(v: unknown): R {
  const x = rec(v, "qualification-receipt");
  keys(
    x,
    Object.hasOwn(x, "lastAccepted")
      ? [
          "catalogSignerRoots",
          "entryId",
          "expectedClaims",
          "lastAccepted",
          "now",
          "replay",
          "signed",
        ]
      : ["catalogSignerRoots", "entryId", "expectedClaims", "now", "replay", "signed"],
    "qualification-receipt",
  );
  const inspected = inspectSignedCatalogV2({
    catalogSignerRoots: x.catalogSignerRoots,
    expectedClaims: x.expectedClaims,
    lastAccepted: x.lastAccepted ?? null,
    now: x.now,
    replay: x.replay,
    signed: x.signed,
  });
  if (inspected.kind !== "materializable") fail("qualification-receipt");
  const h = inspected.head as R;
  const selected = (h.entries as R[]).find((candidate) => candidate.entryId === x.entryId);
  if (!selected) fail("qualification-receipt");
  const selectedEntry = selected as R;
  const issuedAt = iso(x.now, "qualification-receipt");
  return qualificationReceipt({
    expiresAt: h.validUntil,
    format: "aih-supported-qualification-receipt",
    issuedAt,
    notBefore: issuedAt,
    organizationAdmission: "not-authoritative",
    qualificationBasis: deriveQualificationBasisV2({ entryId: x.entryId, head: h }),
    subject: selectedEntry.subject,
    version: 1,
  });
}
export function planCatalogPromotionV2(v: unknown): R {
  const x = rec(v, "promotion");
  keys(x, ["candidateHead", "lastGood", "now"], "promotion");
  const l = head(x.lastGood, true),
    c = head(x.candidateHead, true),
    n = iso(x.now, "now");
  const candidateFrom = iso(c.validFrom, "from"),
    candidateUntil = iso(c.validUntil, "until");
  if (n < candidateFrom || n >= candidateUntil) fail("time");
  if (c.catalogHeadSha256 === l.catalogHeadSha256) return frozen({ kind: "unchanged", head: l });
  const candidateSequence = c.sequence,
    previousSequence = l.sequence;
  if (typeof candidateSequence !== "number" || typeof previousSequence !== "number")
    return fail("continuity");
  if (
    candidateSequence !== previousSequence + 1 ||
    c.previousCatalogHeadSha256 !== l.catalogHeadSha256
  )
    fail("continuity");
  const versionEffectChanged = (l.entries as R[]).some(
    (entry, index) =>
      (entry.versions as R).effect !== ((c.entries as R[])[index]?.versions as R)?.effect,
  );
  const versionSchemaChanged = (l.entries as R[]).some(
    (entry, index) =>
      (entry.versions as R).schema !== ((c.entries as R[])[index]?.versions as R)?.schema,
  );
  const surfaces = ["claims", "compatibleEffectVersions", "compatibleSchemaVersions", "signer"];
  const facts: R[] = [];
  for (const s of surfaces)
    if (
      canon(c[s] as J) !== canon(l[s] as J) &&
      !(s === "compatibleEffectVersions" && versionEffectChanged) &&
      !(s === "compatibleSchemaVersions" && versionSchemaChanged)
    )
      facts.push({
        surface:
          s === "compatibleEffectVersions"
            ? "compatible-effect-versions"
            : s === "compatibleSchemaVersions"
              ? "compatible-schema-versions"
              : s,
        identity: s === "signer" ? String((c.signer as R).identity) : "catalog",
        lastGoodSurfaceSha256: sha(canon(l[s] as J)),
        candidateSurfaceSha256: sha(canon(c[s] as J)),
      });
  const lm = new Map((l.entries as R[]).map((e) => [e.entryId, e]));
  const cm = new Map((c.entries as R[]).map((e) => [e.entryId, e]));
  for (const id of new Set([...lm.keys(), ...cm.keys()])) {
    const a = lm.get(id),
      b = cm.get(id);
    if (!a || !b) {
      facts.push({
        surface: !a ? "entry-added" : "entry-removed",
        identity: id,
        lastGoodSurfaceSha256: sha(canon((a ?? {}) as J)),
        candidateSurfaceSha256: sha(canon((b ?? {}) as J)),
      });
      continue;
    }
    for (const [s, av, bv] of [
      ["subject", a.subject, b.subject],
      ["closure", a.closure, b.closure],
      ["recipe", a.recipe, b.recipe],
      ["prose", a.prose, b.prose],
      ["platform", a.platforms, b.platforms],
    ] as const)
      if (canon(av as J) !== canon(bv as J))
        facts.push({
          surface: s,
          identity: id,
          lastGoodSurfaceSha256: sha(canon(av as J)),
          candidateSurfaceSha256: sha(canon(bv as J)),
        });
    if ((a.versions as R).effect !== (b.versions as R).effect)
      facts.push({
        surface: "effect",
        identity: id,
        lastGoodSurfaceSha256: sha(canon((a.versions as R).effect as J)),
        candidateSurfaceSha256: sha(canon((b.versions as R).effect as J)),
      });
    if ((a.versions as R).schema !== (b.versions as R).schema)
      facts.push({
        surface: "schema",
        identity: id,
        lastGoodSurfaceSha256: sha(canon((a.versions as R).schema as J)),
        candidateSurfaceSha256: sha(canon((b.versions as R).schema as J)),
      });
    for (const [surface, key] of [
      ["command", "commands"],
      ["egress", "egress"],
      ["hook", "hooks"],
      ["mcp-tool", "mcpTools"],
      ["permission", "permissions"],
    ] as const) {
      const av = (a.capabilities as R)[key],
        bv = (b.capabilities as R)[key];
      if (canon(av as J) !== canon(bv as J))
        facts.push({
          surface,
          identity: id,
          lastGoodSurfaceSha256: sha(canon(av as J)),
          candidateSurfaceSha256: sha(canon(bv as J)),
        });
    }
    for (const surface of ["findings", "gaps", "report", "rights"]) {
      const av = (a.qualification as R)[surface];
      const bv = (b.qualification as R)[surface];
      if (canon(av as J) !== canon(bv as J))
        facts.push({
          surface: surface === "report" ? "report" : surface.slice(0, -1),
          identity: id,
          lastGoodSurfaceSha256: sha(canon(av as J)),
          candidateSurfaceSha256: sha(canon(bv as J)),
        });
    }
  }
  return facts.length
    ? frozen({ kind: "last-good", head: l, facts })
    : frozen({ kind: "promoted", head: c });
}

// Directly importable only from the implementation boundary; the package root exports no CLI loader.
export function runCatalogV2Cli(argv: readonly string[]): number {
  try {
    const [command, ...rest] = argv;
    const args: Record<string, string | true> = Object.create(null) as Record<
      string,
      string | true
    >;
    for (let i = 0; i < rest.length; i += 1) {
      const raw = rest[i];
      if (typeof raw !== "string" || !raw.startsWith("--")) return fail("arguments");
      const name = raw.slice(2);
      if (!/^[a-z][a-z0-9-]*$/.test(name) || Object.hasOwn(args, name)) fail("arguments");
      if (name === "qualification-basis") {
        args[name] = true;
        continue;
      }
      const value = rest[i + 1];
      if (typeof value !== "string") return fail("arguments");
      args[name] = value;
      i += 1;
    }
    const isEnoent = (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT";
    const read = (p: unknown, limit: number, code: string) => {
      const s = text(p, code);
      try {
        const st = lstatSync(s);
        if (!st.isFile() || st.isSymbolicLink() || st.size > limit) fail(code);
        return readFileSync(s, "utf8");
      } catch (error) {
        if (error instanceof Error && error.message === code) throw error;
        return fail(code);
      }
    };
    const protectedPrivateKey = (p: unknown) => {
      const path = text(p, "private-key-too-large");
      try {
        const status = lstatSync(path);
        if (!status.isFile() || status.isSymbolicLink()) fail("private-key-too-large");
        if (status.size > 65536) fail("private-key-too-large");
        if (process.platform !== "win32" && (status.mode & 0o077) !== 0)
          fail("private-key-permissions");
        return readFileSync(path, "utf8");
      } catch (error) {
        if (error instanceof Error && /^[a-z0-9-]+$/.test(error.message)) throw error;
        return fail("private-key-too-large");
      }
    };
    const write = (p: unknown, data: string) => {
      const s = text(p, "output");
      let parent = dirname(resolve(s));
      while (parent !== dirname(parent)) {
        try {
          if (lstatSync(parent).isSymbolicLink()) fail("unsafe-output-path");
        } catch (error) {
          if ((error as Error).message === "unsafe-output-path") throw error;
          if (!isEnoent(error)) return fail("output");
        }
        parent = dirname(parent);
      }
      try {
        lstatSync(s);
        fail("output-exists");
      } catch (e) {
        if ((e as Error).message === "output-exists") throw e;
        if (!isEnoent(e)) return fail("output");
      }
      try {
        writeFileSync(s, data, { flag: "wx" });
      } catch {
        fail("output");
      }
    };
    if (command === "generate-candidate") {
      keys(
        args,
        [
          "claims",
          "output",
          "previous-catalog-head-sha256",
          "seed",
          "sequence",
          "signer",
          "valid-from",
          "valid-until",
        ],
        "arguments",
      );
      const seedPath = text(args.seed, "seed");
      const sequenceText = text(args.sequence, "sequence", /^(0|[1-9][0-9]*)$/);
      const sequence = Number(sequenceText);
      if (!Number.isSafeInteger(sequence)) fail("sequence");
      const seedText = read(seedPath, MAX_HEAD, "seed-too-large");
      const seed = rec(JSON.parse(seedText), "seed");
      keys(
        seed,
        ["artifacts", "capabilities", "entryId", "platforms", "qualification", "subject"],
        "seed",
      );
      const artifactPaths = rec(seed.artifacts, "artifacts");
      keys(artifactPaths, ["closure", "profile", "prose", "recipe"], "artifacts");
      const base = dirname(seedPath);
      const safePath = (value: unknown, code: string, malformedCode = code) => {
        const path = text(
          value,
          malformedCode,
          /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!\/|\\|[A-Za-z]:|\/\/)[A-Za-z0-9._/-]+$/,
        );
        if (!/\.[a-z0-9]+$/.test(path)) fail(malformedCode);
        const target = resolve(base, path);
        if (relative(base, target).startsWith("..")) fail(malformedCode);
        try {
          let traversed = base;
          for (const segment of path.split("/")) {
            traversed = resolve(traversed, segment);
            if (lstatSync(traversed).isSymbolicLink()) fail("seed-artifact-not-regular");
          }
          const st = lstatSync(target);
          if (!st.isFile() || st.isSymbolicLink()) fail("seed-artifact-not-regular");
          return { path, target, size: st.size };
        } catch (error) {
          if (error instanceof Error && /^[a-z0-9-]+$/.test(error.message)) throw error;
          return fail(code);
        }
      };
      const boundedSeedBytes = (
        location: { readonly size: number; readonly target: string },
        limit: number,
        code: string,
        unreadableCode = code,
      ): Buffer => {
        if (location.size > limit) fail(code);
        let bytes: Buffer;
        try {
          bytes = readFileSync(location.target);
        } catch {
          return fail(unreadableCode);
        }
        if (bytes.length > limit) fail(code);
        return bytes;
      };
      const artifact = (name: string) => {
        const location = safePath(
          artifactPaths[name],
          "seed-artifact-unreadable",
          "unsafe-seed-artifact",
        );
        const bytes = boundedSeedBytes(
          location,
          MAX_SEED_ARTIFACT,
          "artifact-too-large",
          "seed-artifact-unreadable",
        );
        return { path: location.path, sha256: sha(bytes) };
      };
      const profile = artifact("profile"),
        recipe = artifact("recipe"),
        closure = artifact("closure"),
        prose = artifact("prose");
      const subjectSeed = rec(seed.subject, "subject");
      keys(subjectSeed, ["id", "kind", "source"], "subject");
      const subjectId = text(subjectSeed.id, "subject id", /^[a-z][a-z0-9-]{0,63}$/);
      const subjectKind = text(
        subjectSeed.kind,
        "subject kind",
        /^(tool|skill|mcp|package|profile)$/,
      );
      const sourceValue = source(subjectSeed.source);
      if (sourceValue.type === "aih" && sourceValue.revision !== `sha256:${profile.sha256}`)
        fail("aih source revision");
      const sourceDigest = `sha256:${digest("aih-governance-decision-source/v2", sourceValue as J)}`;
      const qualificationSeed = rec(seed.qualification, "qualification");
      keys(qualificationSeed, ["findings", "gaps", "report", "rights"], "qualification");
      const evidenceDescriptor = (kind: "finding" | "gap" | "report" | "right", value: unknown) => {
        const location = safePath(value, "evidence-unreadable");
        const bytes = boundedSeedBytes(
          location,
          MAX_SEED_ARTIFACT,
          "evidence-too-large",
          "evidence-unreadable",
        );
        let envelope: R;
        try {
          envelope = rec(JSON.parse(bytes.toString("utf8")), "evidence");
        } catch {
          return fail("evidence-unreadable");
        }
        keys(
          envelope,
          ["attestor", "format", "id", "kind", "subjectDigest", "summary"],
          "evidence",
        );
        if (envelope.format !== "aih-supported-evidence/v2" || envelope.kind !== kind)
          fail("evidence");
        if (envelope.subjectDigest !== subjectValue.subjectDigest) fail("evidence-subject");
        text(envelope.id, "evidence", /^[a-z][a-z0-9._-]{0,63}$/);
        text(envelope.attestor, "evidence", /^[A-Za-z0-9][A-Za-z0-9:._@/-]{0,255}$/);
        text(envelope.summary, "evidence", /^.{1,1024}$/);
        return { identity: `evidence:${kind}:${location.path}`, sha256: sha(bytes) };
      };
      const subjectValue = {
        id: subjectId,
        kind: subjectKind,
        source: sourceValue,
        sourceDigest,
        subjectDigest: `sha256:${digest("aih-governance-decision-subject/v2", { id: subjectId, kind: subjectKind, sourceDigest })}`,
      };
      const evidenceList = (kind: "finding" | "gap" | "right", value: unknown, minimum: number) => {
        const paths = array(value, "evidence");
        if (paths.length < minimum || paths.length > 64) fail("evidence");
        const descriptors = paths.map((path: unknown) => evidenceDescriptor(kind, path));
        if (
          descriptors.some(
            (descriptor, index) =>
              index > 0 && (descriptors[index - 1]?.identity ?? "") >= descriptor.identity,
          )
        )
          fail("evidence");
        return descriptors;
      };
      const qualification = {
        findings: evidenceList("finding", qualificationSeed.findings, 0),
        gaps: evidenceList("gap", qualificationSeed.gaps, 0),
        report: evidenceDescriptor("report", qualificationSeed.report),
        rights: evidenceList("right", qualificationSeed.rights, 1),
      };
      const created = createCatalogHeadV2({
        claims: JSON.parse(read(args.claims, 1024 * 1024, "claims-too-large")),
        compatibleEffectVersions: ["2"],
        compatibleSchemaVersions: ["2"],
        effectVersion: "2",
        entries: [
          {
            capabilities: seed.capabilities,
            closure: { identity: `artifact:${closure.path}`, sha256: closure.sha256 },
            entryId: seed.entryId,
            platforms: seed.platforms,
            prose: { identity: `artifact:${prose.path}`, sha256: prose.sha256 },
            qualification,
            recipe: { identity: `artifact:${recipe.path}`, sha256: recipe.sha256 },
            subject: subjectValue,
            versions: { effect: "2", schema: "2" },
          },
        ],
        previousCatalogHeadSha256: args["previous-catalog-head-sha256"],
        protocol: "CatalogHeadV2",
        schemaVersion: "2",
        sequence,
        signer: JSON.parse(read(args.signer, 1024 * 1024, "signer-too-large")),
        validFrom: args["valid-from"],
        validUntil: args["valid-until"],
      });
      write(args.output, canon(created as J));
      return 0;
    }
    if (command === "sign-candidate") {
      keys(args, ["candidate", "output", "private-key"], "arguments");
      const h = parseCatalogHeadV2Json(read(args.candidate, MAX_HEAD, "candidate-too-large"));
      write(
        args.output,
        canon(
          signCatalogHeadV2({
            head: h,
            privateKey: protectedPrivateKey(args["private-key"]),
          }) as J,
        ),
      );
      return 0;
    }
    if (command === "inspect") {
      if (Object.hasOwn(args, "catalog")) fail("unsigned-catalog");
      const allowed = [
        "catalog-signer-root",
        "continuity",
        "entry-id",
        "expected-claims",
        "last-accepted-head",
        "now",
        "qualification-basis",
        "replay-state",
        "signed-catalog",
      ];
      keys(
        args,
        allowed.filter((key) => Object.hasOwn(args, key)),
        "arguments",
      );
      const need = ["catalog-signer-root", "expected-claims", "now", "signed-catalog"];
      for (const k of need) if (!Object.hasOwn(args, k)) fail("arguments");
      const continuity = args.continuity;
      const hasLast = Object.hasOwn(args, "last-accepted-head");
      if (
        (continuity === "genesis") === hasLast ||
        (continuity !== undefined && continuity !== "genesis")
      )
        fail("arguments");
      const signedText = read(args["signed-catalog"], MAX_SIGNED, "signed-catalog-too-large");
      const signedValue = JSON.parse(signedText);
      if (!rec(signedValue, "unsigned-catalog").envelope) fail("unsigned-catalog");
      const expected = JSON.parse(read(args["expected-claims"], 1024 * 1024, "claims-too-large"));
      const roots = JSON.parse(
        read(args["catalog-signer-root"], 1024 * 1024, "catalog-signer-root-too-large"),
      );
      const last = args["last-accepted-head"]
        ? parseCatalogHeadV2Json(
            read(args["last-accepted-head"], MAX_HEAD, "last-accepted-head-too-large"),
          )
        : null;
      const replay = args["replay-state"]
        ? JSON.parse(read(args["replay-state"], 1024 * 1024, "replay-state-too-large"))
        : undefined;
      const inspected = inspectSignedCatalogV2({
        signed: signedValue,
        catalogSignerRoots: Array.isArray(roots)
          ? roots
          : roots.catalogSignerRoots
            ? [...roots.catalogSignerRoots]
            : [roots],
        expectedClaims: expected,
        lastAccepted: last,
        now: args.now,
        replay,
      });
      const out: R = { ...inspected };
      if (args["qualification-basis"] !== undefined) {
        if (!args["entry-id"]) fail("arguments");
        if (out.kind !== "materializable") fail("basis");
        out.qualificationBasis = deriveQualificationBasisV2({
          head: out.head,
          entryId: args["entry-id"],
        });
      }
      out.organizationAdmission = "not-authoritative";
      out.verificationMode = "cold-external-admin";
      process.stdout.write(canon(out as J));
      return 0;
    }
    if (command === "emit-qualification-receipt") {
      const allowed = [
        "catalog-signer-root",
        "continuity",
        "entry-id",
        "expected-claims",
        "last-accepted-head",
        "now",
        "output",
        "replay-state",
        "signed-catalog",
      ];
      keys(
        args,
        allowed.filter((key) => Object.hasOwn(args, key)),
        "arguments",
      );
      for (const key of [
        "catalog-signer-root",
        "entry-id",
        "expected-claims",
        "now",
        "output",
        "replay-state",
        "signed-catalog",
      ])
        if (!Object.hasOwn(args, key)) fail("arguments");
      const hasLast = Object.hasOwn(args, "last-accepted-head");
      if (
        (args.continuity === "genesis") === hasLast ||
        (args.continuity !== undefined && args.continuity !== "genesis")
      )
        fail("arguments");
      const signedText = read(args["signed-catalog"], MAX_SIGNED, "signed-catalog-too-large");
      if (signedText.startsWith("\ufeff") || signedText !== signedText.trim())
        fail("signed-catalog");
      const signed = JSON.parse(signedText);
      if (signedText !== canon(signed as J)) fail("signed-catalog");
      if (!rec(signed, "unsigned-catalog").envelope) fail("unsigned-catalog");
      const roots = JSON.parse(
        read(args["catalog-signer-root"], 1024 * 1024, "catalog-signer-root-too-large"),
      );
      const receipt = emitQualificationReceipt({
        catalogSignerRoots: Array.isArray(roots)
          ? roots
          : roots.catalogSignerRoots
            ? [...roots.catalogSignerRoots]
            : [roots],
        entryId: args["entry-id"],
        expectedClaims: JSON.parse(read(args["expected-claims"], 1024 * 1024, "claims-too-large")),
        ...(hasLast
          ? {
              lastAccepted: parseCatalogHeadV2Json(
                read(args["last-accepted-head"], MAX_HEAD, "last-accepted-head-too-large"),
              ),
            }
          : {}),
        now: args.now,
        replay: JSON.parse(read(args["replay-state"], 1024 * 1024, "replay-state-too-large")),
        signed,
      });
      write(args.output, canonicalQualificationReceiptBytes(receipt).toString("utf8"));
      return 0;
    }
    fail("arguments");
  } catch (e) {
    const code = e instanceof Error && /^[a-z0-9-]+$/.test(e.message) ? e.message : "arguments";
    process.stderr.write(`error: ${code}\n`);
    return 2;
  }
  return 2;
}
