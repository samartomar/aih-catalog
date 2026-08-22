// @ts-nocheck -- the external JSON grammar is intentionally validated at runtime.
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
  MAX_SIGNED = 24 * 1024 * 1024;
export const STRICT_V2_CORE_LOCK = Object.freeze({
  coreCommit: "e27a55dcebb635c8298aa4fd6fd871f59089bcf7",
  schemaSha256: "27295aee8d8be333abe2c73adc72884b534b1c9980a9b7a39d12be8d34c5caff",
});
const fail = (code: string): never => {
  throw new Error(code);
};
const rec = (v: unknown, c = "invalid"): R =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as R) : fail(c);
const keys = (v: R, wanted: readonly string[], c: string) => {
  const got = Object.keys(v).sort();
  const exp = [...wanted].sort();
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
  const d = Date.parse(s);
  if (!Number.isFinite(d) || new Date(d).toISOString().replace(".000Z", "Z") !== s) fail(c);
  return s;
};
const sorted = (v: unknown, c: string, re = /^.{1,256}$/): string[] => {
  if (!Array.isArray(v) || !v.length || v.length > 64) fail(c);
  const a = v.map((x) => text(x, c, re));
  if (a.some((x, i) => i && a[i - 1] >= x)) fail(c);
  return a;
};
const base64 = (v: unknown, c: string) => {
  const s = text(v, c, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
  if (Buffer.from(s, "base64").toString("base64") !== s) fail(c);
  return s;
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
  const shape = shapes[type];
  if (!shape) fail("source");
  keys(s, shape, "source");
  for (const [k, x] of Object.entries(s)) {
    if (k === "type") continue;
    if (k.includes("Digest") || k === "sha256" || k === "revision") phex(x, "source digest");
    else if (k === "platform") {
      const p = rec(x, "platform");
      keys(p, ["architecture", "os"], "platform");
      text(p.os, "platform", /^[a-z0-9-]+$/);
      text(p.architecture, "platform", /^[a-z0-9-]+$/);
    } else text(x, "source");
  }
  return s;
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
    identity: text(s.identity, "identity", /^administrator:[a-z0-9:/._-]+$/),
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
    ref: text(x.ref, "ref", /^refs\/heads\/main$/),
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
function evidence(v: unknown, c: string): R[] {
  if (!Array.isArray(v) || !v.length || v.length > 64) fail(c);
  const a = v.map((x) => descriptor(x, c));
  if (a.some((x, i) => i && String(a[i - 1]!.identity) >= String(x.identity))) fail(c);
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
      /^https:\/\/[a-z0-9.-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/,
    ),
    hooks: sorted(cap.hooks, "hooks"),
    mcpTools: sorted(cap.mcpTools, "mcp"),
    permissions: sorted(cap.permissions, "permissions"),
  };
  const q = rec(x.qualification, "qualification");
  keys(q, ["findings", "gaps", "rights"], "qualification");
  const ver = rec(x.versions, "versions");
  keys(ver, ["effect", "schema"], "versions");
  const versions = {
    effect: text(ver.effect, "effect", /^\d+$/),
    schema: text(ver.schema, "schema", /^\d+$/),
  };
  if (!eff.includes(versions.effect) || !sch.includes(versions.schema)) fail("compatible version");
  if (!Array.isArray(x.platforms) || !x.platforms.length || x.platforms.length > 64)
    fail("platforms");
  const platforms = x.platforms.map((p) => {
    const y = rec(p, "platform");
    keys(y, ["architecture", "os"], "platform");
    return {
      architecture: text(y.architecture, "arch", /^[a-z0-9-]+$/),
      os: text(y.os, "os", /^[a-z0-9-]+$/),
    };
  });
  if (platforms.some((p, i) => i && canon(platforms[i - 1] as J) >= canon(p as J)))
    fail("platforms");
  const base = {
    capabilities: caps,
    closure: descriptor(x.closure, "closure"),
    entryId: text(x.entryId, "entry id", /^[a-z][a-z0-9.-]{0,63}$/),
    platforms,
    prose: descriptor(x.prose, "prose"),
    qualification: {
      findings: evidence(q.findings, "findings"),
      gaps: evidence(q.gaps, "gaps"),
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
  if (!Array.isArray(x.entries) || !x.entries.length || x.entries.length > 4096) fail("entries");
  if (!requireDerived && x.entries.some((e) => Object.hasOwn(rec(e, "entry"), "memberSha256")))
    fail("member digest");
  const es = x.entries
    .map((e) => entry(e, ef, sc))
    .sort((a, b) => String(a.entryId).localeCompare(String(b.entryId)));
  if (new Set(es.map((e) => e.entryId)).size !== es.length) fail("entries");
  const sequence = x.sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 0) fail("sequence");
  const previous = hex(x.previousCatalogHeadSha256, "previous");
  if ((sequence === 0) !== (previous === ZERO)) fail("predecessor");
  const from = iso(x.validFrom, "valid from"),
    until = iso(x.validUntil, "valid until"),
    ms = Date.parse(until) - Date.parse(from);
  if (ms <= 0 || ms > 90 * 86400000) fail("validity");
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
  return result;
}
export function createCatalogHeadV2(v: unknown): R {
  return Object.freeze(head(v));
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
  return Object.freeze(h);
}
const pae = (t: string, p: Buffer) =>
  Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(t)} ${t} ${p.length} `), p]);
function privateKey(v: unknown): KeyObject {
  try {
    const k = v instanceof Buffer || typeof v === "string" ? createPrivateKey(v) : (v as KeyObject);
    if (k.type !== "private" || k.asymmetricKeyType !== "ed25519") fail("private key");
    return k;
  } catch {
    fail("private key");
  }
}
export function signCatalogHeadV2(v: unknown): R {
  const x = rec(v, "sign input");
  keys(x, ["head", "privateKey"], "sign input");
  const h = head(x.head, true),
    k = privateKey(x.privateKey);
  const spki = createPublicKey(k).export({ format: "der", type: "spki" }) as Buffer;
  if (`ed25519:${sha(spki)}` !== h.signer.keyId) fail("private key");
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
      signer: h.signer,
      validFrom: h.validFrom,
      validUntil: h.validUntil,
    },
    predicateType: "https://aih.dev/SupportedCatalogV2",
    subject: [{ digest: { sha256: h.catalogHeadSha256 }, name: "aih-supported/CatalogHeadV2" }],
  };
  const p = Buffer.from(canon(statement as J));
  return {
    envelope: {
      payload: p.toString("base64"),
      payloadType: "application/vnd.in-toto+json",
      signatures: [
        {
          keyid: h.signer.keyId,
          sig: sign(null, pae("application/vnd.in-toto+json", p), k).toString("base64"),
        },
      ],
    },
    head: h,
  };
}
function verified(v: unknown): { head: R; opaque: boolean } {
  const x = rec(v, "verify"),
    allow = ["catalogSignerRoots", "expectedClaims", "lastAccepted", "now", "replay", "signed"];
  keys(
    x,
    Object.keys(x)
      .sort()
      .filter((k) => allow.includes(k)),
    "verify",
  );
  if (!("now" in x)) fail("now");
  const now = iso(x.now, "now"),
    signed = rec(x.signed, "signed"),
    env = rec(signed.envelope ?? signed, "envelope");
  keys(env, ["payload", "payloadType", "signatures"], "envelope");
  if (
    env.payloadType !== "application/vnd.in-toto+json" ||
    !Array.isArray(env.signatures) ||
    env.signatures.length !== 1
  )
    fail("envelope");
  const payload = Buffer.from(base64(env.payload, "payload"), "base64");
  if (payload.length > MAX_SIGNED) fail("signed-too-large");
  let st: R;
  try {
    st = JSON.parse(payload.toString("utf8")) as R;
  } catch {
    fail("payload");
  }
  if (canon(st as J) !== payload.toString("utf8")) fail("payload");
  keys(st, ["_type", "predicate", "predicateType", "subject"], "statement");
  if (
    st._type !== "https://in-toto.io/Statement/v1" ||
    st.predicateType !== "https://aih.dev/SupportedCatalogV2" ||
    !Array.isArray(st.subject) ||
    st.subject.length !== 1
  )
    fail("statement");
  const pr = rec(st.predicate, "predicate"),
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
  const roots = x.catalogSignerRoots;
  if (!Array.isArray(roots) || !roots.length || roots.length > 64) fail("roots");
  const sig = rec(env.signatures[0], "signature"),
    keyid = text(sig.keyid, "keyid", /^ed25519:[0-9a-f]{64}$/),
    sigBytes = Buffer.from(base64(sig.sig, "signature"), "base64");
  let root: R | undefined;
  for (const r of roots) {
    const q = rec(r, "root");
    keys(
      q,
      ["class", "identity", "keyId", "publicKeySpkiDerBase64", "publicKeySpkiSha256"],
      "root",
    );
    if (q.keyId === keyid) root = q;
  }
  if (!root) fail("root");
  const der = Buffer.from(base64(root.publicKeySpkiDerBase64, "root"), "base64");
  if (sha(der) !== root.publicKeySpkiSha256 || root.keyId !== `ed25519:${sha(der)}`) fail("root");
  let pub: KeyObject;
  try {
    pub = createPublicKey({ key: der, format: "der", type: "spki" });
    if (pub.asymmetricKeyType !== "ed25519") fail("root");
  } catch {
    fail("root");
  }
  if (!verify(null, pae(env.payloadType as string, payload), pub, sigBytes)) fail("signature");
  const raw = rec(pr.catalogHead, "catalog head"),
    unknown = raw.schemaVersion !== "2" || raw.effectVersion !== "2";
  if (unknown) {
    if (
      pr.protocol !== "CatalogHeadV2" ||
      pr.candidateSha256 !== sha(Buffer.from(canon(raw as J))) ||
      pr.catalogHeadSha256 !== st.subject[0]?.digest?.sha256
    )
      fail("binding");
    claims(pr.claims);
    signer(pr.signer);
    iso(pr.validFrom, "from");
    iso(pr.validUntil, "until");
    if (now < pr.validFrom || now >= pr.validUntil) fail("time");
    return { head: pr, opaque: true };
  }
  const h = head(raw, true);
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
    st.subject[0]?.name !== "aih-supported/CatalogHeadV2" ||
    st.subject[0]?.digest?.sha256 !== h.catalogHeadSha256 ||
    pr.replayIdentity !== `catalog-head:${h.catalogHeadSha256}:${pr.candidateSha256}`
  )
    fail("binding");
  if (
    canon({
      class: root.class,
      identity: root.identity,
      keyId: root.keyId,
      publicKeySpkiSha256: root.publicKeySpkiSha256,
    } as J) !== canon(h.signer as J)
  )
    fail("signer");
  if (canon(claims(x.expectedClaims) as J) !== canon(h.claims as J)) fail("claims");
  if (now < h.validFrom || now >= h.validUntil) fail("time");
  const last = x.lastAccepted;
  if (last !== undefined && last !== null) {
    const l = head(last, true);
    if (
      h.catalogHeadSha256 !== l.catalogHeadSha256 &&
      (h.sequence !== l.sequence + 1 || h.previousCatalogHeadSha256 !== l.catalogHeadSha256)
    )
      fail("continuity");
  } else if (h.sequence !== 0) fail("continuity");
  const replay = x.replay;
  if (replay !== undefined) {
    const rr = rec(replay, "replay");
    keys(rr, ["acceptedIdentities"], "replay");
    if (
      !Array.isArray(rr.acceptedIdentities) ||
      rr.acceptedIdentities.length > 4096 ||
      rr.acceptedIdentities.includes(pr.replayIdentity)
    )
      fail("replay");
  }
  return { head: h, opaque: false };
}
export function verifySignedCatalogV2(v: unknown): R {
  const q = verified(v);
  if (q.opaque) fail("unsupported-version");
  return Object.freeze(q.head);
}
export function inspectSignedCatalogV2(v: unknown): R {
  const q = verified(v);
  return q.opaque
    ? Object.freeze({
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
    : Object.freeze({ kind: "materializable", head: q.head });
}
export function deriveQualificationBasisV2(v: unknown): R {
  const x = rec(v, "basis");
  keys(x, ["entryId", "head"], "basis");
  const h = head(x.head, true),
    e = (h.entries as R[]).find((z) => z.entryId === x.entryId);
  if (!e || (e.versions && ((e.versions as R).effect !== "2" || (e.versions as R).schema !== "2")))
    fail("basis");
  return {
    catalogDigest: `sha256:${h.catalogSha256}`,
    catalogHeadDigest: `sha256:${h.catalogHeadSha256}`,
    catalogMemberDigest: `sha256:${e.memberSha256}`,
    catalogSignerIdentity: (h.signer as R).identity,
    kind: "aih-supported",
    subjectDigest: (e.subject as R).subjectDigest,
    subjectKind: (e.subject as R).kind,
  };
}
export function planCatalogPromotionV2(v: unknown): R {
  const x = rec(v, "promotion");
  keys(x, ["candidateHead", "lastGood", "now"], "promotion");
  const l = head(x.lastGood, true),
    c = head(x.candidateHead, true),
    n = iso(x.now, "now");
  if (n < c.validFrom || n >= c.validUntil) fail("time");
  if (c.catalogHeadSha256 === l.catalogHeadSha256)
    return { kind: "unchanged", head: x.lastGood as R };
  if (c.sequence !== l.sequence + 1 || c.previousCatalogHeadSha256 !== l.catalogHeadSha256)
    fail("continuity");
  const surfaces = ["claims", "compatibleEffectVersions", "compatibleSchemaVersions", "signer"];
  const facts: R[] = [];
  for (const s of surfaces)
    if (canon(c[s] as J) !== canon(l[s] as J))
      facts.push({
        surface:
          s === "compatibleEffectVersions"
            ? "compatible-effect-versions"
            : s === "compatibleSchemaVersions"
              ? "compatible-schema-versions"
              : s,
        identity: s.startsWith("compatible") ? "catalog" : "catalog",
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
      ["capabilities", a.capabilities, b.capabilities],
      ["qualification", a.qualification, b.qualification],
      ["closure", a.closure, b.closure],
      ["recipe", a.recipe, b.recipe],
      ["prose", a.prose, b.prose],
      ["platform", a.platforms, b.platforms],
      ["versions", a.versions, b.versions],
    ] as const)
      if (canon(av as J) !== canon(bv as J))
        facts.push({
          surface: s,
          identity: id,
          lastGoodSurfaceSha256: sha(canon(av as J)),
          candidateSurfaceSha256: sha(canon(bv as J)),
        });
  }
  return facts.length
    ? { kind: "last-good", head: x.lastGood as R, facts }
    : { kind: "promoted", head: c };
}

// Directly importable only from the implementation boundary; the package root exports no CLI loader.
export function runCatalogV2Cli(argv: readonly string[]): number {
  try {
    const [command, ...rest] = argv;
    const args: R = {};
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i],
        v = rest[i + 1];
      if (!k?.startsWith("--") || v === undefined || k in args) fail("arguments");
      args[k.slice(2)] = v;
    }
    const read = (p: unknown, limit: number, code: string) => {
      const s = text(p, code);
      const st = lstatSync(s);
      if (!st.isFile() || st.isSymbolicLink() || st.size > limit) fail(code);
      return readFileSync(s, "utf8");
    };
    const write = (p: unknown, data: string) => {
      const s = text(p, "output");
      try {
        lstatSync(s);
        fail("output-exists");
      } catch (e) {
        if ((e as Error).message === "output-exists") throw e;
      }
      writeFileSync(s, data, { flag: "wx" });
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
      const artifact = (name: string) => {
        const path = text(
          artifactPaths[name],
          "seed-artifact",
          /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!\/|\\|[A-Za-z]:|\/\/)[A-Za-z0-9._/-]+$/,
        );
        const target = resolve(base, path);
        if (relative(base, target).startsWith("..")) fail("seed-artifact");
        const st = lstatSync(target);
        if (!st.isFile() || st.isSymbolicLink()) fail("seed-artifact-not-regular");
        return { path, sha256: sha(readFileSync(target)) };
      };
      const profile = artifact("profile"),
        recipe = artifact("recipe"),
        closure = artifact("closure"),
        prose = artifact("prose");
      const source = { release: "1.0.0", revision: `sha256:${profile.sha256}`, type: "aih" };
      const sourceDigest = `sha256:${digest("aih-governance-decision-source/v2", source)}`;
      const subjectSeed = rec(seed.subject, "subject");
      const subjectValue = {
        id: subjectSeed.id,
        kind: subjectSeed.kind,
        source,
        sourceDigest,
        subjectDigest: `sha256:${digest("aih-governance-decision-subject/v2", { id: subjectSeed.id, kind: subjectSeed.kind, sourceDigest })}`,
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
            qualification: seed.qualification,
            recipe: { identity: `artifact:${recipe.path}`, sha256: recipe.sha256 },
            subject: subjectValue,
            versions: { effect: "2", schema: "2" },
          },
        ],
        previousCatalogHeadSha256: args["previous-catalog-head-sha256"],
        protocol: "CatalogHeadV2",
        schemaVersion: "2",
        sequence: Number(args.sequence),
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
            privateKey: read(args["private-key"], 65536, "private-key-too-large"),
          }) as J,
        ),
      );
      return 0;
    }
    if (command === "inspect") {
      const need = [
        "catalog-signer-root",
        "continuity",
        "expected-claims",
        "now",
        "signed-catalog",
      ];
      for (const k of need) if (!(k in args)) fail("arguments");
      const signedText = read(args["signed-catalog"], MAX_SIGNED, "signed-catalog-too-large");
      const roots = JSON.parse(read(args["catalog-signer-root"], 1024 * 1024, "root-too-large"));
      const expected = JSON.parse(read(args["expected-claims"], 1024 * 1024, "claims-too-large"));
      const last = args["last-accepted-head"]
        ? parseCatalogHeadV2Json(
            read(args["last-accepted-head"], MAX_HEAD, "last-accepted-head-too-large"),
          )
        : null;
      const out = inspectSignedCatalogV2({
        signed: JSON.parse(signedText),
        catalogSignerRoots: Array.isArray(roots)
          ? roots
          : roots.catalogSignerRoots
            ? [...roots.catalogSignerRoots]
            : [roots],
        expectedClaims: expected,
        lastAccepted: last,
        now: args.now,
      });
      if (args["qualification-basis"] !== undefined) {
        if (!args["entry-id"]) fail("arguments");
        (out as R).qualificationBasis = deriveQualificationBasisV2({
          head: (out as R).head,
          entryId: args["entry-id"],
        });
      }
      (out as R).organizationAdmission = "not-authoritative";
      (out as R).verificationMode = "cold-external-admin";
      process.stdout.write(canon(out as J));
      return 0;
    }
    fail("arguments");
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 2;
  }
}
