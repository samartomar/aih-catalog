// Copied into an outside consumer; only public package interfaces are imported.
// Asserts on build/reader outcomes and resolver output and refusals only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compileProducerDeclaration, compileReleaseSets } from "@aihq/catalog/producer";
import { readReleaseContent, readReleaseSets, resolveSelections } from "@aihq/catalog/reader";

const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (text) => new TextEncoder().encode(text);

const AGENT_DIRECTORY = {
  type: "string", required: true, default: ".claude", minLength: 1, maxLength: 64,
  description: "Project directory that receives skills/<name>/ (Claude Code reads .claude).",
};
const skill = (id, extra = {}) => ({
  id, source: "src", label: id, description: `${id} skill`, kind: "skill",
  skillPath: `${id.replaceAll(".", "-")}/SKILL.md`, requires: [], optional: [], conflicts: [],
  clientCapabilities: [], activation: [], configuration: { agentDirectory: AGENT_DIRECTORY },
  provenance: { selectedBy: "packed-consumer" },
  ...extra,
});
const hook = (id, extra = {}) =>
  skill(id, {
    kind: "hook",
    payload: { event: "SessionStart", protocol: "claude-code-hooks", command: { script: "skill" } },
    ...extra,
  });
const skillText = (id, extra = "") => `---\ndescription: ${id}.\n---\n# ${id}\n\nUse ${id}.${extra}\n`;
/** Compiles one release 1.6 framework through producer 3.2 and reads it. */
function framework(id, items, texts = {}) {
  const declaration = {
    schema: "urn:aihq:catalog:producer-declaration:3.2.0",
    format: "aihq-catalog-producer-declaration",
    version: 3,
    framework: { id, name: `${id} framework`, version: "1.0.0", description: `${id} fixture framework.` },
    sources: [{ id: "src", repository: `example/${id}`, licensePath: "LICENSE", license: "MIT" }],
    items,
  };
  const files = { LICENSE: encode("MIT license fixture\n") };
  for (const item of items) files[item.skillPath] = encode(texts[item.id] ?? skillText(item.id));
  const compiled = compileProducerDeclaration({
    declaration,
    sourceFiles: [{ source: "src", revision: "a".repeat(40), files }],
  });
  assert.equal(compiled.status, "ok", JSON.stringify(compiled.diagnostics));
  const read = readReleaseContent(compiled.value.releaseBytes, { expectedSha256: compiled.value.releaseSha256 });
  assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
  return read.release;
}
const results = [];
const case_ = (name, fn) => {
  try {
    fn();
    results.push({ name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: String(error?.stack ?? error) });
  }
};
const reasons = (result) => result.diagnostics.map((d) => d.reason);
const codes = (result) => result.diagnostics.map((d) => d.code);
/** Builds and attaches sets; returns the checked release carrying them. */
function withSets(release, sets) {
  const built = compileReleaseSets({ release, sets });
  assert.equal(built.status, "ok", JSON.stringify(built.diagnostics));
  const read = readReleaseSets(built.value.bytes, { expectedSha256: built.value.sha256, release });
  assert.equal(read.valid, true, JSON.stringify(read.diagnostics));
  return read.release;
}
const member = (framework, itemId, optional = false, defaultOn = true) => ({
  item: { framework, itemId }, optional, defaultOn,
});
const set = (id, members, extra = {}) => ({
  id, name: `${id} set`, description: `${id} description`, members, offer: "pre-ticked", ...extra,
});
const setOf = (release, id) => release.sets.find((entry) => entry.id === id);
const choose = (release, setId, extra = {}) => ({
  release: { releaseSha256: release.sha256, scope: "project" },
  setId,
  setSha256: setOf(release, setId).setSha256,
  ...extra,
});
const resolve = (releases, sets, extra = {}) =>
  resolveSelections({
    releases: Object.fromEntries(releases.map((release) => [release.sha256, release])),
    roots: [],
    skips: [],
    sets,
    ...extra,
  });
const ids = (result) => result.value.selections.map((selection) => selection.item.itemId);
const originsOf = (result, itemId) =>
  result.value.selections.find((selection) => selection.item.itemId === itemId)?.origins;

const kit = framework("kit", [
  skill("kit.base"),
  skill("kit.tdd", { requires: [{ itemId: "kit.base" }] }),
  skill("kit.review"),
  hook("kit.session"),
]);

case_("a chosen set resolves its default members with qualified origins", () => {
  const release = withSets(kit, [
    set("reviewed-tdd", [member("kit", "kit.tdd"), member("kit", "kit.session", true, false)]),
  ]);
  const digest = setOf(release, "reviewed-tdd").setSha256;
  assert.match(digest, /^[0-9a-f]{64}$/);
  const result = resolve([release], [choose(release, "reviewed-tdd")]);
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(ids(result), ["kit.base", "kit.tdd"]);
  assert.deepEqual(originsOf(result, "kit.tdd"), [
    { reasonIncluded: "in-set", set: { framework: "kit", setId: "reviewed-tdd", setSha256: digest } },
  ]);
  assert.deepEqual(originsOf(result, "kit.base"), [
    { reasonIncluded: "required-by", requiredBy: { framework: "kit", itemId: "kit.tdd" } },
  ]);
});

const build = (release, sets) => compileReleaseSets({ release, sets });
const digestOf = (release, sets, id) => {
  const built = build(release, sets);
  assert.equal(built.status, "ok", JSON.stringify(built.diagnostics));
  return built.value.document.sets.find((entry) => entry.id === id).setSha256;
};
const refusedWith = (result, reason) => {
  assert.equal(result.status ?? (result.valid ? "ok" : "refused"), "refused", JSON.stringify(result));
  assert.ok(reasons(result).includes(reason), `expected ${reason}, got ${JSON.stringify(result.diagnostics)}`);
};
const guard = framework("guard", [skill("guard.security"), skill("guard.lint")]);
const pin = (release, itemId, extra = {}) => {
  const item = release.items.find((entry) => entry.id === itemId);
  return {
    framework: release.framework.id, itemId, releaseVersion: release.framework.version,
    contentSha256: item.contentSha256, behaviourSha256: item.behaviourSha256, ...extra,
  };
};

case_("a behaviour-only member change changes setSha256", () => {
  const changed = framework("kit", [
    skill("kit.base"),
    skill("kit.tdd", {
      requires: [{ itemId: "kit.base" }],
      payload: { dirName: "kit-tdd", invocation: "user-only", invocationBasis: "changed basis" },
    }),
    skill("kit.review"),
    hook("kit.session"),
  ]);
  const before = kit.items.find((item) => item.id === "kit.tdd");
  const after = changed.items.find((item) => item.id === "kit.tdd");
  assert.equal(after.contentSha256, before.contentSha256);
  assert.notEqual(after.behaviourSha256, before.behaviourSha256);
  const sets = [set("tdd", [member("kit", "kit.tdd")])];
  assert.notEqual(digestOf(changed, sets, "tdd"), digestOf(kit, sets, "tdd"));
});

case_("a nested set change changes every set that includes it", () => {
  const sets = (extra) => [
    set("inner", [member("kit", "kit.review", true, extra)]),
    set("outer", [member("kit", "kit.tdd")], { includes: [{ framework: "kit", setId: "inner" }] }),
  ];
  assert.notEqual(digestOf(kit, sets(true), "inner"), digestOf(kit, sets(false), "inner"));
  assert.notEqual(digestOf(kit, sets(true), "outer"), digestOf(kit, sets(false), "outer"));
});

case_("display-only fields stay outside the digest; semantic fields are inside", () => {
  const base = digestOf(kit, [set("tdd", [member("kit", "kit.tdd")])], "tdd");
  const display = digestOf(kit, [set("tdd", [member("kit", "kit.tdd")], {
    name: "Renamed", description: "Reworded", cost: { bytes: 10, chars: 10 }, stability: "deprecated",
  })], "tdd");
  assert.equal(display, base);
  assert.notEqual(digestOf(kit, [set("tdd", [member("kit", "kit.tdd")], { offer: "listed" })], "tdd"), base);
  assert.notEqual(digestOf(kit, [set("tdd", [member("kit", "kit.tdd")], { targets: ["claude-code"] })], "tdd"), base);
});

case_("a cross-framework pin is covered by the digest", () => {
  const sets = (item) => [set("tdd", [member("kit", "kit.tdd"), { item, optional: false, defaultOn: true }])];
  const pinned = digestOf(kit, sets(pin(guard, "guard.security")), "tdd");
  const other = digestOf(kit, sets(pin(guard, "guard.security", { behaviourSha256: "b".repeat(64) })), "tdd");
  assert.notEqual(pinned, other);
});

case_("the build refuses a hook member that is not optional", () => {
  refusedWith(build(kit, [set("hooks", [member("kit", "kit.session", false, true)])]), "hook-member-required");
});

case_("the build refuses an unpinned cross-framework member", () => {
  refusedWith(build(kit, [set("mixed", [member("guard", "guard.security")])]), "member-unpinned");
});

case_("the build refuses a set in another release without its digest and version", () => {
  refusedWith(
    build(kit, [set("mixed", [member("kit", "kit.tdd")], { includes: [{ framework: "guard", setId: "x" }] })]),
    "set-ref-unpinned",
  );
});

case_("a set cycle fails the build", () => {
  refusedWith(
    build(kit, [
      set("a", [member("kit", "kit.tdd")], { includes: [{ framework: "kit", setId: "b" }] }),
      set("b", [member("kit", "kit.review")], { requires: [{ framework: "kit", setId: "a" }] }),
    ]),
    "set-cycle",
  );
});

case_("nesting deeper than 8 fails the build by name", () => {
  const chain = (levels) =>
    Array.from({ length: levels }, (_, index) =>
      set(`s${index}`, [member("kit", "kit.tdd")], index + 1 < levels ? { includes: [{ framework: "kit", setId: `s${index + 1}` }] } : {}),
    );
  assert.equal(build(kit, chain(9)).status, "ok");
  refusedWith(build(kit, chain(10)), "set-depth-exceeded");
});

const documentBytes = (document) => encode(`${canonical(document)}\n`);
const readSets = (document, release) => {
  const bytes = documentBytes(document);
  return readReleaseSets(bytes, { expectedSha256: sha256(bytes), release });
};
const builtDocument = (release, sets) => structuredClone(build(release, sets).value.document);

case_("the reader recomputes every digest and refuses a changed one", () => {
  const document = builtDocument(kit, [set("tdd", [member("kit", "kit.tdd")])]);
  assert.equal(readSets(document, kit).valid, true);
  document.sets[0].setSha256 = "0".repeat(64);
  refusedWith(readSets(document, kit), "set-digest-mismatch");
});

case_("sets built for earlier item declarations are refused against changed ones", () => {
  const document = builtDocument(kit, [set("tdd", [member("kit", "kit.tdd")])]);
  const changed = framework("kit", [
    skill("kit.base"),
    skill("kit.tdd", { requires: [{ itemId: "kit.base" }], payload: { dirName: "kit-tdd", invocation: "user-only", invocationBasis: "changed" } }),
    skill("kit.review"),
    hook("kit.session"),
  ]);
  refusedWith(readSets(document, changed), "set-digest-mismatch");
});

case_("an unknown sets format or field is refused precisely", () => {
  const document = builtDocument(kit, [set("tdd", [member("kit", "kit.tdd")])]);
  const unknownFormat = readSets({ ...document, schema: "urn:aihq:catalog:release-sets:2.0.0" }, kit);
  assert.equal(unknownFormat.valid, false);
  assert.deepEqual(
    [unknownFormat.diagnostics[0].code, unknownFormat.diagnostics[0].encountered, unknownFormat.diagnostics[0].supported],
    ["SCHEMA_UNSUPPORTED", "urn:aihq:catalog:release-sets:2.0.0", ["urn:aihq:catalog:release-sets:1.0.0"]],
  );
  document.sets[0].kind = "framework";
  refusedWith(readSets(document, kit), "set-invalid");
});

case_("explicit member overrides take or leave members; a required member cannot be left out", () => {
  const release = withSets(kit, [
    set("tdd", [member("kit", "kit.tdd"), member("kit", "kit.review", true, true), member("kit", "kit.session", true, false)]),
  ]);
  const override = (item, include) => ({ item: { framework: "kit", itemId: item }, include });
  const result = resolve([release], [choose(release, "tdd", {
    members: [override("kit.session", true), override("kit.review", false)],
  })], { roots: [{ releaseSha256: release.sha256, itemId: "kit.session", scope: "project", configuration: {} }] });
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(ids(result), ["kit.base", "kit.session", "kit.tdd"]);
  assert.deepEqual(originsOf(result, "kit.session").map((origin) => origin.reasonIncluded), ["chosen", "in-set"]);
  const refused = resolve([release], [choose(release, "tdd", { members: [override("kit.tdd", false)] })]);
  assert.equal(refused.status, "refused");
  assert.deepEqual([codes(refused), reasons(refused)], [["REQUIRED_EXCLUDED"], ["required-excluded"]]);
  refusedWith(resolve([release], [choose(release, "tdd", { members: [override("kit.base", true)] })]), "set-member-unknown");
});

case_("a request digest that differs from the checked release's set is refused", () => {
  const release = withSets(kit, [set("tdd", [member("kit", "kit.tdd")])]);
  const result = resolve([release], [choose(release, "tdd", { setSha256: "1".repeat(64) })]);
  assert.deepEqual([codes(result), reasons(result)], [["REFERENCE_AMBIGUOUS"], ["set-digest-mismatch"]]);
});

case_("an excluded hook is never re-added, even when another member requires it", () => {
  const hooked = framework("kit", [
    skill("kit.base"),
    skill("kit.tdd", { requires: [{ itemId: "kit.base" }] }),
    skill("kit.review", { requires: [{ itemId: "kit.session" }] }),
    hook("kit.session"),
  ]);
  const release = withSets(hooked, [
    set("tdd", [member("kit", "kit.tdd"), member("kit", "kit.session", true, true), member("kit", "kit.review", true, false)]),
  ]);
  const skip = { releaseSha256: release.sha256, itemId: "kit.session", scope: "project" };
  const left = resolve([release], [choose(release, "tdd")], { skips: [skip] });
  assert.equal(left.status, "ok", JSON.stringify(left.diagnostics));
  assert.deepEqual(ids(left), ["kit.base", "kit.tdd"]);
  const requiring = resolve([release], [choose(release, "tdd", {
    members: [{ item: { framework: "kit", itemId: "kit.review" }, include: true }],
  })], { skips: [skip] });
  assert.equal(requiring.status, "refused");
  assert.deepEqual(reasons(requiring), ["required-excluded"]);
  assert.equal(requiring.diagnostics[0].reference.itemId, "kit.session");
  assert.equal(requiring.diagnostics[0].declaredBy.itemId, "kit.review");
  const byOverride = resolve([release], [choose(release, "tdd", {
    members: [
      { item: { framework: "kit", itemId: "kit.review" }, include: true },
      { item: { framework: "kit", itemId: "kit.session" }, include: false },
    ],
  })]);
  assert.deepEqual(reasons(byOverride), ["required-excluded"]);
});

case_("conflicting members keep ITEM_CONFLICT", () => {
  const conflicted = framework("kit", [
    skill("kit.base"),
    skill("kit.tdd", { requires: [{ itemId: "kit.base" }] }),
    skill("kit.review", { conflicts: [{ itemId: "kit.tdd" }] }),
    hook("kit.session"),
  ]);
  const release = withSets(conflicted, [set("both", [member("kit", "kit.tdd"), member("kit", "kit.review")])]);
  const result = resolve([release], [choose(release, "both")]);
  assert.equal(result.status, "refused");
  assert.equal(result.diagnostics[0].code, "ITEM_CONFLICT");
  assert.deepEqual([result.diagnostics[0].reference.itemId, result.diagnostics[0].declaredBy.itemId], ["kit.tdd", "kit.review"]);
});

case_("overlapping sets keep every reason", () => {
  const release = withSets(kit, [
    set("one", [member("kit", "kit.tdd")]),
    set("two", [member("kit", "kit.tdd"), member("kit", "kit.review")]),
  ]);
  const result = resolve([release], [choose(release, "two"), choose(release, "one")]);
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(originsOf(result, "kit.tdd").map((origin) => origin.set.setId), ["two", "one"]);
});

const ecc = framework("ecc", [
  skill("ecc.rule.common"), skill("ecc.rule.typescript"), skill("ecc.rule.python"), skill("ecc.skill.review"),
]);
const eccSets = [
  set("common-rules", [member("ecc", "ecc.rule.common")]),
  set("typescript", [member("ecc", "ecc.rule.typescript")]),
  set("python", [member("ecc", "ecc.rule.python")]),
  set("developer", [member("ecc", "ecc.skill.review")], {
    offer: "listed",
    options: [{
      id: "languages", name: "Languages",
      always: [{ framework: "ecc", setId: "common-rules" }],
      choices: [
        { id: "typescript", name: "TypeScript", sets: [{ framework: "ecc", setId: "typescript" }] },
        { id: "python", name: "Python", sets: [{ framework: "ecc", setId: "python" }] },
      ],
    }],
  }),
];

case_("an ECC-style profile applies only always-included sets without a choice", () => {
  const release = withSets(ecc, eccSets);
  const result = resolve([release], [choose(release, "developer")]);
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(ids(result), ["ecc.rule.common", "ecc.skill.review"]);
  assert.deepEqual(originsOf(result, "ecc.rule.common"), [{
    reasonIncluded: "in-set",
    set: { framework: "ecc", setId: "developer", setSha256: setOf(release, "developer").setSha256 },
  }]);
});

case_("an ECC-style TypeScript choice adds its set with the option origin", () => {
  const release = withSets(ecc, eccSets);
  const result = resolve([release], [choose(release, "developer", { options: { languages: ["typescript"] } })]);
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(ids(result), ["ecc.rule.common", "ecc.rule.typescript", "ecc.skill.review"]);
  assert.deepEqual(originsOf(result, "ecc.rule.typescript"), [{
    reasonIncluded: "in-set",
    set: { framework: "ecc", setId: "developer", setSha256: setOf(release, "developer").setSha256 },
    options: { languages: ["typescript"] },
  }]);
  const both = resolve([release], [choose(release, "developer", { options: { languages: ["python", "typescript"] } })]);
  assert.deepEqual(ids(both), ["ecc.rule.common", "ecc.rule.python", "ecc.rule.typescript", "ecc.skill.review"]);
  refusedWith(resolve([release], [choose(release, "developer", { options: { languages: ["rust"] } })]), "set-option-unknown");
});

case_("a pinned cross-framework member resolves from its own checked release", () => {
  const release = withSets(kit, [
    set("reviewed-tdd", [member("kit", "kit.tdd"), { item: pin(guard, "guard.security"), optional: false, defaultOn: true }]),
  ]);
  const result = resolve([release, guard], [choose(release, "reviewed-tdd")]);
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.value.selections
      .map((selection) => `${selection.item.releaseSha256 === guard.sha256 ? "guard" : "kit"}:${selection.item.itemId}`)
      .sort(),
    ["guard:guard.security", "kit:kit.base", "kit:kit.tdd"],
  );
  assert.deepEqual(codes(resolve([release], [choose(release, "reviewed-tdd")])), ["RELEASE_UNAVAILABLE"]);
  const changedGuard = framework("guard", [skill("guard.security", { conflicts: [{ itemId: "guard.lint" }] }), skill("guard.lint")]);
  assert.deepEqual(reasons(resolve([release, changedGuard], [choose(release, "reviewed-tdd")])), ["member-pin-mismatch"]);
});

case_("a set in another release resolves by framework version and digest", () => {
  const guardSets = withSets(guard, [set("security", [member("guard", "guard.security")])]);
  const release = withSets(kit, [set("tdd", [member("kit", "kit.tdd")], {
    includes: [{ framework: "guard", setId: "security", setSha256: setOf(guardSets, "security").setSha256, releaseVersion: "1.0.0" }],
  })]);
  const result = resolve([release, guardSets], [choose(release, "tdd")]);
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.ok(ids(result).includes("guard.security"));
  assert.equal(originsOf(result, "guard.security")[0].set.setId, "tdd");
  const stale = withSets(guard, [set("security", [member("guard", "guard.security"), member("guard", "guard.lint", true, false)])]);
  assert.deepEqual(reasons(resolve([release, stale], [choose(release, "tdd")])), ["set-digest-mismatch"]);
});

case_("nesting deeper than 8 across releases is a named refusal", () => {
  const chain = Array.from({ length: 9 }, (_, index) =>
    set(`s${index}`, [member("guard", "guard.security")], index < 8 ? { includes: [{ framework: "guard", setId: `s${index + 1}` }] } : {}),
  );
  const deep = withSets(guard, chain);
  const release = withSets(kit, [set("top", [member("kit", "kit.tdd")], {
    includes: [{ framework: "guard", setId: "s0", setSha256: setOf(deep, "s0").setSha256, releaseVersion: "1.0.0" }],
  })]);
  const result = resolve([release, deep], [choose(release, "top")]);
  assert.deepEqual([codes(result), reasons(result)], [["SET_LIMIT_EXCEEDED"], ["set-depth-exceeded"]]);
  const within = resolve([deep], [choose(deep, "s0")]);
  assert.equal(within.status, "ok", JSON.stringify(within.diagnostics));
});

case_("more than 5,000 resolved members is a named refusal, never truncation", () => {
  const own = Array.from({ length: 2600 }, (_, index) => skill(`big.s${index}`));
  const other = Array.from({ length: 2401 }, (_, index) => skill(`more.s${index}`));
  const more = framework("more", other);
  const release = withSets(framework("big", own), [
    set("first", own.map((item) => member("big", item.id))),
    set("second", other.map((item) => ({ item: pin(more, item.id), optional: false, defaultOn: true }))),
  ]);
  const result = resolve([release, more], [choose(release, "first"), choose(release, "second")]);
  assert.deepEqual([result.status, codes(result), reasons(result)], ["refused", ["SET_LIMIT_EXCEEDED"], ["set-members-exceeded"]]);
  assert.equal("value" in result, false);
});

case_("item roots keep their existing shape and gain the chosen origin", () => {
  const result = resolveSelections({
    releases: { [kit.sha256]: kit },
    roots: [{ releaseSha256: kit.sha256, itemId: "kit.tdd", scope: "project", configuration: {} }],
    skips: [{ releaseSha256: kit.sha256, itemId: "kit.base", scope: "project" }],
  });
  assert.deepEqual([codes(result), reasons(result)], [["REQUIRED_ITEM_SKIPPED"], [undefined]]);
  const ok = resolveSelections({
    releases: { [kit.sha256]: kit },
    roots: [{ releaseSha256: kit.sha256, itemId: "kit.tdd", scope: "project", configuration: {} }],
    skips: [],
  });
  assert.deepEqual(Object.keys(ok.value).sort(), ["inclusions", "optional", "removalImpact", "selections"]);
  assert.deepEqual(originsOf(ok, "kit.tdd"), [{ reasonIncluded: "chosen" }]);
});

case_("expansion is depth-first and keeps each distinct origin in published order", () => {
  const release = withSets(ecc, [
    ...eccSets.slice(0, 3),
    set("base", [member("ecc", "ecc.skill.review")]),
    set("profile", [member("ecc", "ecc.rule.typescript")], {
      includes: [{ framework: "ecc", setId: "base" }],
      requires: [{ framework: "ecc", setId: "python" }],
      optional: [{ framework: "ecc", setId: "common-rules" }],
      options: [{
        id: "languages", name: "Languages",
        choices: [{ id: "typescript", name: "TypeScript", sets: [{ framework: "ecc", setId: "typescript" }] }],
      }],
    }),
  ]);
  const result = resolve([release], [choose(release, "profile", { options: { languages: ["typescript"] } })]);
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(ids(result), ["ecc.rule.python", "ecc.rule.typescript", "ecc.skill.review"]);
  const identity = { framework: "ecc", setId: "profile", setSha256: setOf(release, "profile").setSha256 };
  assert.deepEqual(originsOf(result, "ecc.rule.typescript"), [
    { reasonIncluded: "in-set", set: identity },
    { reasonIncluded: "in-set", set: identity, options: { languages: ["typescript"] } },
  ]);
});

case_("malformed set selections are refused, never thrown", () => {
  const release = withSets(kit, [set("tdd", [member("kit", "kit.tdd")])]);
  for (const extra of [{ options: ["typescript"] }, { options: { languages: "typescript" } }, { members: {} }, { kind: "set" }])
    refusedWith(resolve([release], [choose(release, "tdd", extra)]), "set-selection-invalid");
  assert.deepEqual(codes(resolve([release], { setId: "tdd" })), ["INPUT_INVALID"]);
  assert.deepEqual(codes(resolve([kit], [choose(release, "tdd", { release: { releaseSha256: kit.sha256, scope: "project" } })])), ["SET_UNAVAILABLE"]);
});

process.stdout.write(JSON.stringify({ results }));
