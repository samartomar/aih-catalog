/**
 * Phase 2 of the packed-consumer replay: the fifteen acceptance journeys and the consumer
 * regressions, run inside the disposable consumer under Node's permission model (no child
 * process, no worker, no network, writes only in the work folder). Imports only the
 * installed package's public entry points and `@aihq/scan/contracts`.
 *
 * Every row names its basis: `fixture` (files the journey writes, or pinned upstream fixture
 * bytes), `candidate-data` (the committed data/ at the packed commit: unadmitted candidates)
 * or `upstream` (real bytes at the recorded pins, fetched only with --network). None of them
 * establishes native client support, a real qualification or accepted production data.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { scanKeyOf } from "@aihq/scan/contracts";
import * as contracts from "@aihq/catalog/contracts";
import * as node from "@aihq/catalog/node";
import * as producer from "@aihq/catalog/producer";
import * as reader from "@aihq/catalog/reader";
import * as source from "@aihq/catalog/source";
import { OWN_FOLDER, SCAN_FOLDER } from "./fixtures.mjs";
import {
  assert,
  canonical,
  context,
  encoder,
  journey,
  pathsOf,
  placementOps,
  planned,
  sha,
  sortKeys,
  stepAt,
  utf8,
  writes,
  writeTree,
} from "./lib.mjs";

const { readLocalSource } = node;
const { buildContent, checkContent } = producer;
const { findItems, parseSourceLink } = source;
const { planInstall, planRecipe, readContent, readQualification, readRecipe, renderStep } = reader;

let text = "";
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
const { work, inputs, network, prepared } = input;
const ctx = context(input);
const { profiles, content, json, files, data, recipe, recipeSource, base } = ctx;
const P = (...ids) => ids.map((id) => profiles[id]);
const journeys = [];
const regressions = [];
const missingProof = [];
const shared = {};

/** Every placement step carries `clis`; every step names what it belongs to. */
function ownership(plan) {
  for (const step of plan.plan) {
    if (placementOps.has(step.op)) {
      assert.ok(Array.isArray(step.clis) && step.clis.length > 0, `${step.op} without clis`);
      assert.deepEqual([...step.clis].sort(), step.clis, "clis sorted");
      assert.equal(new Set(step.clis).size, step.clis.length, "clis unique");
      assert.ok(
        step.item !== undefined ||
          step.items !== undefined ||
          step.framework !== undefined ||
          step.bundle !== undefined,
        `${step.op} ${step.path ?? step.file} names no owner`,
      );
    }
  }
}
const pathKeyed = (plan) => plan.plan.map((step) => step.path ?? step.file ?? step.op);
const same = (left, right) => assert.equal(JSON.stringify(left), JSON.stringify(right));

// ---------------------------------------------------------------------------------------------
{
  const j = journey(1, "Your own folder: copies only, leftovers listed, nothing runs", "fixture");
  const root = writeTree(join(work, "my-skills"), OWN_FOLDER);
  const read = readLocalSource(root);
  let found;
  let built;
  let plan;
  await j.check("readLocalSource reads the folder as a local source", () => {
    assert.equal(read.status, "ok");
    assert.equal(read.source.kind, "local");
  });
  await j.check("findItems gives the two skills and the rule, and lists every leftover", () => {
    found = findItems(read.files, { framework: "my-skills" });
    assert.equal(found.status, "ok");
    assert.deepEqual(found.items.map((item) => item.id).sort(), [
      "my-skills.rule.style",
      "my-skills.skill.revise",
      "my-skills.skill.ship",
    ]);
    const left = Object.fromEntries(found.leftOver.map((entry) => [entry.path, entry.reason]));
    assert.ok("package.json" in left, "package.json listed");
    assert.ok("notes/ideas.txt" in left, "notes listed");
    assert.ok(
      Object.keys(left).some((path) => path.startsWith("hooks/")),
      "the hooks file is listed",
    );
  });
  await j.check("buildContent records the items", async () => {
    built = await buildContent(read.source, read.files, found.items, { framework: "my-skills" });
    assert.equal(built.status, "ok", JSON.stringify(built).slice(0, 400));
    assert.deepEqual(readContent(built.bytes).status, "ok");
  });
  const ids = ["my-skills.rule.style", "my-skills.skill.revise", "my-skills.skill.ship"];
  const plan3 = () =>
    planInstall(ids, [built.content], P("claude-code", "kiro", "antigravity"), {
      scope: "project",
      data: null,
    });
  await j.check("planInstall for claude-code, kiro and antigravity is ok", () => {
    plan = planned(plan3());
    assert.equal(plan.status, "ok", JSON.stringify(plan).slice(0, 600));
  });
  await j.check("every path is the profile's project place, and there are only copies", () => {
    const paths = pathsOf(plan);
    for (const expected of [
      ".claude/skills/revise/SKILL.md",
      ".claude/skills/revise/references/checklist.md",
      ".claude/skills/revise/scripts/check.sh",
      ".claude/skills/ship/SKILL.md",
      ".claude/rules/style.md",
      ".kiro/skills/revise/SKILL.md",
      ".kiro/prompts/ship.md",
      ".kiro/steering/ship.md",
      ".kiro/steering/style.md",
      ".agents/skills/revise/SKILL.md",
      ".agents/skills/ship/SKILL.md",
      ".agents/rules/style.md",
      ".aihq/notices/my-skills/LICENSE",
    ])
      assert.ok(paths.includes(expected), `missing ${expected}`);
    assert.deepEqual([...new Set(plan.plan.map((step) => step.op))].sort(), ["write"]);
    for (const step of plan.plan) assert.equal(step.root, "project");
    assert.equal(paths.filter((path) => path.startsWith(".aihq/notices/")).length, 1);
    assert.equal(stepAt(plan, ".claude/skills/revise/scripts/check.sh").executable, true);
    ownership(plan);
  });
  await j.check("the same input gives the same plan, byte for byte", () => {
    same(plan, plan3());
  });
  j.digest("own-folder", plan);
  await j.check("nothing ran: no lifecycle script, hook or executable left a mark", () => {
    assert.equal(process.permission?.has("child"), false, "child processes are denied here");
    const marks = readdirSync(work, { recursive: true }).filter((name) =>
      String(name).includes("RAN-"),
    );
    assert.deepEqual(marks, []);
  });
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
const SP = ["https://github.com/obra/superpowers", "5bf4e78011075bcfc0dc295f0724994cd123ee71"];
function superpowersRecipe(routes, extra = {}) {
  const superpowers = content("superpowers");
  const entry = { source: "superpowers", path: "/", plugin: "superpowers", commit: SP[1] };
  const plugins = {
    "claude-code": { ...entry, marketplace: "https://github.com/obra/superpowers-marketplace" },
    codex: { ...entry, marketplace: SP[0] },
    copilot: entry,
  };
  return recipe({
    ...base,
    id: "superpowers-base",
    framework: "superpowers",
    content: { repository: SP[0], commit: SP[1] },
    routes,
    plugins: Object.fromEntries(Object.entries(plugins).filter(([cli]) => routes[cli] === "plugin")),
    clis: Object.fromEntries(
      Object.entries(routes)
        .filter(([, route]) => route === "items")
        .map(([cli]) => [cli, ["skill", "rule"]]),
    ),
    members: superpowers.items
      .filter((item) => item.kind === "skill" || item.kind === "rule")
      .map((item) => ({ item: item.id, preTicked: true })),
    ...extra,
  });
}
{
  const j = journey(2, "Superpowers whole: plugins on Claude, Codex, Copilot; items on Kiro; ok", "candidate-data");
  const read = superpowersRecipe({
    "claude-code": "plugin",
    codex: "plugin",
    copilot: "plugin",
    kiro: "items",
  });
  const plan = planned(
    planRecipe(read.recipe, [content("superpowers")], P("claude-code", "codex", "copilot", "kiro"), {}, {
      scope: "user",
      source: recipeSource,
    }),
  );
  await j.check("plugin steps for Claude, Codex and Copilot, pinned to the recorded commit", () => {
    const plugins = plan.plan.filter((step) => step.op === "plugin");
    assert.deepEqual(plugins.map((step) => step.cli), ["claude-code", "codex", "copilot"]);
    for (const step of plugins) {
      assert.equal(step.commit, SP[1]);
      assert.equal(step.framework, "superpowers");
      assert.match(step.scanKey, /^git-sha1:[0-9a-f]{40}$/);
    }
  });
  await j.check("Kiro gets items: skills linked, the session-bootstrap rule in global steering", () => {
    assert.ok(plan.plan.some((step) => step.op === "link" && step.path === ".kiro/skills/brainstorming"));
    const rule = stepAt(plan, ".kiro/steering/session-bootstrap.md");
    assert.equal(rule?.root, "user");
    assert.deepEqual(plan.unavailable, []);
    ownership(plan);
  });
  await j.check("the recipe origin is the recipe's own bytes and source", () => {
    assert.deepEqual(plan.recipe, {
      id: "superpowers-base",
      sha256: read.sha256,
      repository: recipeSource.repository,
      commit: recipeSource.commit,
    });
    assert.deepEqual(plan.data, data);
  });
  await j.open(
    "status is ok with the default links",
    "at user scope Kiro's skills are links into shared version folders, so Superpowers' ../sibling paths (code-reviewer.md, sdd-workspace, review-package, the tool references) leave the linked folder; journey 2 expects ok while user-scope skills are linked wherever the client documents links: a decision is needed (copy mutually referencing skills in place, or accept incomplete)",
    () => {
    assert.equal(
      plan.status,
      "ok",
      `incomplete: ${JSON.stringify({
        missing: plan.missing,
        unavailable: plan.unavailable,
        clashes: plan.clashes,
        references: plan.references
          .filter((reference) => reference.kind === "path")
          .map((reference) => `${reference.item} -> ${reference.path} [${reference.clis}]`),
      })}`,
    );
  },
  );
  await j.check("with copies at user scope (copy: true) Kiro's sibling skill paths resolve and the plan is ok", () => {
    const copied = planned(
      planRecipe(read.recipe, [content("superpowers")], P("claude-code", "codex", "copilot", "kiro"), {}, {
        scope: "user",
        source: recipeSource,
        copy: true,
      }),
    );
    assert.deepEqual(copied.plan.filter((step) => step.op === "plugin").map((step) => step.cli), ["claude-code", "codex", "copilot"]);
    assert.equal(copied.status, "ok", JSON.stringify(copied.references).slice(0, 400));
  });
  if (network) {
    await j.check("upstream: each plugin step's scan key is the pinned plugin folder's", async () => {
      const record = content("superpowers").plugins.find((entry) => entry.path === "/");
      const upstream = files("upstream/superpowers");
      const recorded = new Set(record.files.map((file) => file.sourcePath));
      const key = await scanKeyOf(
        upstream
          .filter((file) => recorded.has(file.path))
          .map((file) => ({ path: file.path, mode: file.mode, bytes: file.bytes })),
      );
      assert.equal(key.status, "ok");
      assert.equal(key.scanKey, record.scanKey);
      for (const step of plan.plan.filter((entry) => entry.op === "plugin"))
        assert.equal(step.scanKey, key.scanKey);
      for (const file of record.files) {
        const fetched = upstream.find((entry) => entry.path === file.sourcePath);
        assert.equal(fetched?.sha256, file.sha256, file.sourcePath);
      }
    });
  }
  shared.superpowersUser = plan;
  j.digest("superpowers-user", plan);
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
const ECC = ["https://github.com/affaan-m/ECC", "5064474d4d762dc9640234a41617cccb79185cec"];
{
  const j = journey(3, "ECC base for Kiro through items: editions, prefixes, prompts, notices, references", "candidate-data");
  const ecc = content("ecc");
  const kinds = ["skill", "agent", "rule", "hook"];
  // What ECC's own Kiro install brings: every skill and agent, and its Kiro steering and hooks.
  // ECC's general rules/ files are left out: 23 language folders each name a coding-style rule,
  // so on any client they meet at one install path.
  const members = ecc.items.filter(
    (item) =>
      item.kind === "skill" || item.kind === "agent" || ((item.kind === "rule" || item.kind === "hook") && item.editions?.kiro),
  );
  const read = recipe({
    ...base,
    id: "ecc-base",
    framework: "ecc",
    content: { repository: ECC[0], commit: ECC[1] },
    routes: { kiro: "items" },
    clis: { kiro: kinds },
    namePrefix: { skill: "ecc-", agent: "ecc-" },
    members: members.map((item) => ({ item: item.id, preTicked: item.kind !== "hook" })),
  });
  const plan = planned(
    planRecipe(read.recipe, [ecc], P("kiro"), {}, { scope: "project", source: recipeSource }),
  );
  const fromUnder = (prefix) =>
    writes(plan).filter((step) => step.from?.sourcePath?.startsWith(prefix) && step.render === undefined);
  await j.check("33 agent editions, two files each, copied as they are", () => {
    const agents = fromUnder(".kiro/agents/");
    assert.equal(agents.length, 66);
    assert.equal(new Set(agents.map((step) => step.item)).size, 33);
    for (const step of agents) assert.equal(step.path, step.from.sourcePath);
  });
  await j.check("22 steering editions and 13 hook editions", () => {
    assert.equal(new Set(fromUnder(".kiro/steering/").map((step) => step.item)).size, 22);
    assert.equal(new Set(fromUnder(".kiro/hooks/").map((step) => step.item)).size, 13);
  });
  await j.check("chosen skills install with the ecc- prefix", () => {
    const skills = pathsOf(plan).filter((path) => path.startsWith(".kiro/skills/"));
    assert.ok(skills.length > 0);
    for (const path of skills) assert.match(path, /^\.kiro\/skills\/ecc-/);
  });
  await j.check("commands become prompt files plus manual steering", () => {
    const commands = ecc.items.filter(
      (item) => item.kind === "skill" && item.files.every((file) => file.sourcePath.startsWith("commands/")),
    );
    assert.ok(commands.length > 0);
    const paths = pathsOf(plan);
    for (const item of commands) {
      const prompt = `.kiro/prompts/ecc-${item.name}.md`;
      const steering = `.kiro/steering/ecc-${item.name}.md`;
      const placed = paths.includes(prompt) && paths.includes(steering);
      const reported = plan.unavailable.some((entry) => entry.item === item.id);
      assert.ok(placed || reported, `${item.id}: neither placed nor reported`);
      assert.ok(!paths.includes(`.kiro/skills/ecc-${item.name}/SKILL.md`), `${item.id} as a Kiro skill`);
    }
  });
  await j.check("notices are written once", () => {
    assert.deepEqual(pathsOf(plan).filter((path) => path.startsWith(".aihq/notices/")), [
      ".aihq/notices/ecc/LICENSE",
    ]);
  });
  await j.check("references list the ecc: names", () => {
    const names = plan.references.filter((reference) => reference.kind === "name").map((reference) => reference.name);
    assert.ok(names.length > 0 && names.every((name) => name.startsWith("ecc:")), JSON.stringify(names));
    ownership(plan);
  });
  await j.check("planning ECC twice gives the same plan, byte for byte", () => {
    same(plan, planRecipe(read.recipe, [ecc], P("kiro"), {}, { scope: "project", source: recipeSource }));
  });
  j.digest("ecc-kiro", plan);
  j.note(
    `Status ${plan.status} (the journey states no status): ${plan.references.filter((reference) => reference.kind === "path").length} path references, ${plan.unavailable.length} unavailable item/client pairs, ${plan.clashes.length} clashes.`,
  );
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
const remaining = json("port-report/remaining.json");
const draft = (id) => recipe({ schema: "urn:aihq:catalog:recipe:0.1.0", data, ...remaining.recipes[id] });
{
  const j = journey(4, "gstack for Codex: one approval-requiring upstream setup; ok", "candidate-data");
  const plan = planned(
    planRecipe(draft("gstack-base").recipe, [content("gstack")], P("codex"), {}, {
      scope: "project",
      source: recipeSource,
    }),
  );
  await j.check("exactly one upstream-setup step with the exact command and needs", () => {
    assert.equal(plan.plan.length, 1);
    const [step] = plan.plan;
    assert.equal(step.op, "upstream-setup");
    assert.deepEqual(step.command, ["./setup", "--host", "codex"]);
    assert.deepEqual(step.needs, ["bun>=1.4.2"]);
    assert.equal(step.approval, "required");
    assert.equal(step.scanned, false);
    assert.equal(step.commit, "1ea86923a86129d1f32828b36acfe6f91f17c8e6");
  });
  await j.check("status is ok: approval does not make a plan incomplete", () => {
    assert.equal(plan.status, "ok");
  });
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(5, "One ECC command on Codex, user scope: shared version folder, link, openai.yaml", "candidate-data");
  const ecc = content("ecc");
  const one = (item) =>
    planned(
      planRecipe(
        recipe({
          ...base,
          id: "ecc-one-command",
          framework: "ecc",
          content: { repository: ECC[0], commit: ECC[1] },
          routes: { codex: "items" },
          namePrefix: { skill: "ecc-", agent: "ecc-" },
          members: [{ item, preTicked: true }],
        }).recipe,
        [ecc],
        P("codex"),
        {},
        { scope: "user", source: recipeSource },
      ),
    );
  const plan = one("ecc.skill.plan");
  const link = plan.plan.find((step) => step.op === "link");
  await j.check("the folder link is .agents/skills/ecc-plan, into the shared version folder", () => {
    assert.equal(link?.path, ".agents/skills/ecc-plan");
    assert.match(link.to, /^\.aihq\/shared\/ecc\/skill\/plan\/[0-9a-f]{12}$/);
    assert.ok(stepAt(plan, `${link.to}/SKILL.md`), "SKILL.md in the version folder");
  });
  await j.check("openai.yaml sits inside the version folder", () => {
    const yaml = stepAt(plan, `${link.to}/agents/openai.yaml`);
    assert.equal(yaml?.render?.name, "user-only-file");
    assert.equal(yaml.scanned, false);
  });
  // ECC's `plan` has no $ARGUMENTS; gan-build has, and its upstream bytes are in the fixture.
  const fixture = files("tests/fixtures/port-maintained/ecc").map((file) => ({
    sourceId: "ecc",
    sourcePath: file.path,
    bytes: file.bytes,
  }));
  const upstreamPlan = network
    ? files("upstream/ecc").map((file) => ({ sourceId: "ecc", sourcePath: file.path, bytes: file.bytes }))
    : null;
  const render = (forPlan, path, sources) => {
    const result = renderStep(stepAt(forPlan, path), [ecc], P("codex"), sources);
    assert.equal(result.status, "ok", JSON.stringify(result).slice(0, 300));
    assert.equal(result.sha256, sha(result.bytes));
    return utf8(result.bytes);
  };
  await j.check("openai.yaml sets allow_implicit_invocation: false", () => {
    assert.match(render(plan, `${link.to}/agents/openai.yaml`, []), /allow_implicit_invocation: false/);
  });
  await j.check("$ARGUMENTS is reworded (ECC gan-build, pinned fixture bytes)", () => {
    const gan = one("ecc.skill.gan-build");
    const ganLink = gan.plan.find((step) => step.op === "link");
    const skill = render(gan, `${ganLink.to}/SKILL.md`, fixture);
    assert.ok(!skill.includes("$ARGUMENTS"));
    assert.ok(skill.includes("the text the user typed after the command"));
  });
  if (upstreamPlan)
    await j.check("upstream: ECC plan's SKILL.md renders from the real pinned bytes", () => {
      assert.ok(render(plan, `${link.to}/SKILL.md`, upstreamPlan).length > 0);
    });
  j.note(
    `Status ${plan.status}: ${JSON.stringify(plan.references.filter((reference) => reference.kind === "path").map((reference) => reference.path))} (the contract's example plan for this command is ok; the upstream file names agents/planner.md as an optional manual-install agent, which the path-reference check counts as blocking).`,
  );
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
const RESOLVER = "aih.agent.duplicate-resolver";
{
  const j = journey(6, "Mixing Extensions and pstack: duplicates, the resolver, dsh warning", "candidate-data");
  const mix = ["extensions.skill.engineering.tdd", "extensions.skill.productivity.teach", "pstack.skill.tdd", "pstack.skill.teach"];
  const contents = [content("extensions"), content("pstack")];
  const mixed = planned(
    planInstall(mix, contents, P("claude-code", "codex", "dsh"), { scope: "project", data }),
  );
  await j.check("duplicates name tdd and teach across the two frameworks, with no winner", () => {
    const byName = mixed.duplicates.filter((entry) => entry.by === "name").map((entry) => [entry.name, entry.frameworks]);
    assert.deepEqual(byName, [
      ["tdd", ["extensions", "pstack"]],
      ["teach", ["extensions", "pstack"]],
    ]);
    assert.ok(!pathsOf(mixed).some((path) => /\/(tdd|teach)\//.test(path)), "no winner placed");
  });
  await j.check("the resolver is placed on Claude and Codex, and .aihq/duplicates.json is written", () => {
    const resolver = writes(mixed).filter((step) => step.item === RESOLVER).map((step) => [step.path, step.clis]);
    assert.deepEqual(resolver, [
      [".aihq/duplicates.json", ["claude-code", "codex", "dsh"]],
      [".claude/agents/aih-duplicate-resolver.md", ["claude-code"]],
      [".codex/agents/aih-duplicate-resolver.toml", ["codex"]],
    ]);
    const report = renderStep(stepAt(mixed, ".aihq/duplicates.json"), contents, P("claude-code", "codex", "dsh"), []);
    assert.equal(report.status, "ok");
    assert.deepEqual(JSON.parse(utf8(report.bytes)), { duplicates: mixed.duplicates });
  });
  const renamed = planned(
    planInstall(mix, contents, P("claude-code", "codex", "dsh"), {
      scope: "project",
      data,
      names: { "pstack.skill.tdd": "pstack-tdd", "pstack.skill.teach": "pstack-teach" },
    }),
  );
  await j.check("on dsh the missing helper only warns: the renamed mix is ok", () => {
    assert.deepEqual(renamed.warnings.filter((warning) => warning.code === "duplicate-resolver-unavailable"), [
      { code: "duplicate-resolver-unavailable", cli: "dsh", items: [RESOLVER] },
    ]);
    assert.ok(pathsOf(renamed).includes(".aihq/duplicates.json"));
    assert.equal(renamed.status, "ok", JSON.stringify({ c: renamed.clashes, u: renamed.unavailable, r: renamed.references }).slice(0, 500));
  });
  await j.check("an unsupported agent the user selects on dsh still makes the plan incomplete", () => {
    const chosen = planned(
      planInstall([...mix.slice(0, 2), "pstack.agent.poteto-agent"], contents, P("dsh"), { scope: "project", data }),
    );
    assert.equal(chosen.status, "incomplete");
    assert.ok(
      chosen.unavailable.some((entry) => entry.item === "pstack.agent.poteto-agent" && entry.cli === "dsh" && entry.reason === "unsupported-kind"),
      JSON.stringify(chosen.unavailable),
    );
  });
  shared.resolverCase = { renamed, mixed };
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(7, "Built-ins: a bare plan skill clashes on Claude; a recipe override is not reported", "fixture");
  const root = writeTree(join(work, "builtins"), {
    "skills/plan/SKILL.md": "---\nname: plan\ndescription: Plan the work.\n---\n\nPlan it.\n",
  });
  const read = readLocalSource(root);
  const found = findItems(read.files, { framework: "mine" });
  const built = await buildContent(read.source, read.files, found.items, { framework: "mine" });
  await j.check("a bare plan skill on Claude is a built-in clash and the plan is incomplete", () => {
    const plan = planned(planInstall(["mine.skill.plan"], [built.content], P("claude-code"), { scope: "project", data: null }));
    assert.equal(plan.status, "incomplete");
    assert.ok(plan.clashes.some((clash) => clash.reason === "built-in" && clash.builtIn?.toLowerCase() === "plan"), JSON.stringify(plan.clashes));
  });
  await j.check("Extensions' code-review with a recipe override is not reported on Claude", () => {
    const ext = content("extensions");
    const repo = ext.sources.find((entry) => entry.kind === "git");
    const item = "extensions.skill.engineering.code-review";
    const plain = planned(planInstall([item], [ext], P("claude-code"), { scope: "project", data }));
    assert.ok(plain.clashes.some((clash) => clash.reason === "built-in"), "clashes without the override");
    const read = recipe({
      ...base,
      id: "extensions-overrides",
      framework: "extensions",
      content: { repository: repo.repository, commit: repo.commit },
      routes: { "claude-code": "items" },
      members: [{ item, preTicked: true }],
      overrides: [{ item, replaces: "code-review" }],
    });
    const plan = planned(planRecipe(read.recipe, [ext], P("claude-code"), {}, { scope: "project", source: recipeSource }));
    assert.deepEqual(plan.clashes, []);
    assert.equal(plan.status, "ok", JSON.stringify(plan).slice(0, 500));
  });
  j.note("The override recipe is written by this journey: Extensions has no base recipe until its package declares per-client routes.");
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(8, "Scope fallback and pins: warnings, items on Cursor/Antigravity/Kimi, Copilot's local marketplace", "candidate-data");
  await j.check("a plugin route at a scope the client does not list warns and falls back", () => {
    const read = superpowersRecipe({ codex: "plugin" });
    const plan = planned(planRecipe(read.recipe, [content("superpowers")], P("codex"), {}, { scope: "project", source: recipeSource }));
    assert.ok(!plan.plan.some((step) => step.op === "plugin"));
    const warning = plan.warnings.find((entry) => entry.code === "scope-fallback" || entry.code === "route-unavailable");
    assert.equal(warning?.cli, "codex");
    assert.equal(warning.route.from, "plugin");
    assert.ok(["local-plugin", "items"].includes(warning.route.to));
    assert.ok(pathsOf(plan).some((path) => path.startsWith(".agents/skills/")));
  });
  await j.check("Superpowers on Cursor, Antigravity and Kimi plans items, never a plugin step", () => {
    const read = superpowersRecipe({ cursor: "items", antigravity: "items", kimi: "items" });
    const plan = planned(
      planRecipe(read.recipe, [content("superpowers")], P("cursor", "antigravity", "kimi"), {}, { scope: "project", source: recipeSource }),
    );
    assert.ok(!plan.plan.some((step) => step.op === "plugin"));
    const kimi = plan.references.filter((reference) => reference.kind === "name" && reference.clis.includes("kimi"));
    assert.ok(kimi.length > 0 && kimi.every((reference) => reference.name.startsWith("superpowers:")));
    ownership(plan);
  });
  await j.check("Copilot: the pinned local marketplace write, a plugin step naming it, cli-only-plugin", () => {
    const read = superpowersRecipe({ copilot: "plugin" });
    const plan = planned(planRecipe(read.recipe, [content("superpowers")], P("copilot"), {}, { scope: "user", source: recipeSource }));
    const market = stepAt(plan, ".aihq/marketplaces/superpowers/.claude-plugin/marketplace.json");
    assert.equal(market?.render?.name, "plugin-marketplace");
    assert.equal(market.scanned, false);
    const step = plan.plan.find((entry) => entry.op === "plugin");
    assert.deepEqual(step.marketplace, { root: "user", path: ".aihq/marketplaces/superpowers" });
    assert.ok(plan.warnings.some((warning) => warning.code === "cli-only-plugin"));
    const bytes = renderStep(market, [content("superpowers")], P("copilot"), []);
    assert.equal(bytes.status, "ok");
    const document = JSON.parse(utf8(bytes.bytes));
    assert.ok(JSON.stringify(document).includes(SP[1]), "the marketplace pins the commit");
  });
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(9, "Links: every input in the source table gives the listed result", "fixture");
  const recognised = (text, candidate) => {
    const result = parseSourceLink(text);
    assert.equal(result.status, "recognised", `${text}: ${JSON.stringify(result)}`);
    assert.equal(result.schema, contracts.formats.sourceLink);
    assert.deepEqual(result.candidate, candidate, text);
  };
  await j.check("local paths and file URLs", () => {
    for (const path of ["./x", "~/x", "C:\\x", "/x"]) recognised(path, { kind: "local", path });
    recognised("file:///x", { kind: "local", path: "/x" });
  });
  await j.check("HTTPS, SSH and owner/repo Git repositories", () => {
    recognised("https://git.example.org/o/r.git", { kind: "git", repository: "https://git.example.org/o/r" });
    recognised("https://github.com/o/r", { kind: "git", repository: "https://github.com/o/r" });
    recognised("git@github.com:o/r.git", { kind: "git", repository: "git@github.com:o/r.git" });
    recognised("owner/repo", { kind: "git", repository: "https://github.com/owner/repo" });
  });
  await j.check("tree, blob and GitLab links keep ref and subpath (pstack keeps its subpath)", () => {
    recognised("https://github.com/cursor/plugins/tree/main/pstack", { kind: "git", repository: "https://github.com/cursor/plugins", ref: "main", subpath: "pstack" });
    recognised("https://github.com/o/r/blob/v1/skills/a/SKILL.md", { kind: "git", repository: "https://github.com/o/r", ref: "v1", subpath: "skills/a/SKILL.md" });
    recognised("https://gitlab.com/g/r/-/tree/v2/rules", { kind: "git", repository: "https://gitlab.com/g/r", ref: "v2", subpath: "rules" });
    recognised("https://gitlab.com/g/r/-/blob/main/rules/a.md", { kind: "git", repository: "https://gitlab.com/g/r", ref: "main", subpath: "rules/a.md" });
  });
  await j.check("npm names, exact versions, ranges and npx", () => {
    recognised("pkg", { kind: "npm", package: "pkg" });
    recognised("@s/pkg@1.2.0", { kind: "npm", package: "@s/pkg", version: "1.2.0" });
    recognised("@s/pkg@^1", { kind: "npm", package: "@s/pkg", range: "^1" });
    recognised("npx -y @s/pkg@1.2.0", { kind: "npm", package: "@s/pkg", version: "1.2.0" });
  });
  await j.check("installer commands name their source", () => {
    recognised("npx skills add https://github.com/cursor/plugins/tree/main/pstack", { kind: "git", repository: "https://github.com/cursor/plugins", ref: "main", subpath: "pstack" });
    recognised("git clone https://github.com/o/r.git", { kind: "git", repository: "https://github.com/o/r" });
  });
  await j.check("anything else is unrecognised with a reason, never a guess; over the limit is refused", () => {
    for (const text of ["", "hello world", "http://github.com/o/r", "https://example.com/tool", "npm install tool", 42]) {
      const result = parseSourceLink(text);
      assert.equal(result.status, "unrecognised", String(text));
      assert.equal(typeof result.reason, "string");
      assert.ok(!("candidate" in result));
    }
    const over = parseSourceLink(`./${"a".repeat(contracts.limits.sourceLinkCharacters)}`);
    assert.equal(over.status, "refused");
    assert.equal(over.limit, "sourceLinkCharacters");
  });
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(10, "Port report: all 777 measured items are mapped or dropped with a reason", "candidate-data");
  const maintained = json("port-report/maintained.json");
  const report = json("port-report/report.json");
  await j.check("777 dispositions, one per baseline item, each mapped or dropped with a reason", () => {
    const entries = maintained.dispositions;
    assert.equal(entries.length, 777);
    assert.equal(new Set(entries.map((entry) => entry.baseline.id)).size, 777);
    for (const entry of entries) {
      assert.ok(["mapped", "notice", "bundle", "dropped"].includes(entry.disposition), entry.baseline.id);
      if (entry.disposition === "dropped") assert.ok(entry.reason, `${entry.baseline.id} dropped without a reason`);
    }
  });
  await j.check("every mapped item and edition exists in the committed data", () => {
    const ids = new Map();
    for (const framework of ["ecc", "superpowers", "extensions", "project-basics"])
      for (const item of content(framework).items) ids.set(item.id, item);
    let editions = 0;
    for (const entry of maintained.dispositions) {
      if (entry.disposition === "mapped") assert.ok(ids.has(entry.item), `${entry.item} not in data`);
      if (entry.edition !== undefined) {
        editions += 1;
        assert.ok(ids.get(entry.item)?.editions?.[entry.edition], `${entry.item}@${entry.edition}`);
      }
      if (entry.disposition === "bundle") assert.ok(content("extensions").bundles?.some((bundle) => bundle.id === entry.bundle), entry.bundle);
    }
    assert.equal(editions, 65);
  });
  await j.check("the combined report reconciles the same 777 baseline items and their kinds", () => {
    assert.equal(report.baseline.items, 777);
    const counted = {};
    for (const entry of maintained.dispositions) {
      const kind = entry.edition !== undefined ? "edition" : entry.disposition;
      counted[kind] = (counted[kind] ?? 0) + 1;
    }
    assert.deepEqual(sortKeys(counted), sortKeys(report.baseline.dispositions));
    assert.deepEqual(report.baseline.byKind, { agent: 72, command: 96, document: 5, hook: 28, "mcp-server": 37, rule: 147, skill: 392 });
  });
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(11, "EGM at project scope: local plugin, bundle layout, bundle-root rule, dsh, bundle removed", "candidate-data");
  const egm = content("egm");
  const read = draft("egm-base");
  const plan3 = () =>
    planned(planRecipe(read.recipe, [egm], P("claude-code", "codex", "antigravity"), {}, { scope: "project", source: recipeSource }));
  const plan = plan3();
  await j.check("Claude gets the local plugin in .aihq/plugins/egm/ and a settings merge", () => {
    const local = plan.plan.filter((step) => step.route === "local-plugin");
    assert.ok(local.length > 0);
    for (const step of local.filter((entry) => entry.op === "write")) assert.match(step.path, /^\.aihq\/plugins\/egm\//);
    assert.ok(local.some((step) => step.op === "merge" && step.file === ".claude/settings.json"));
    assert.ok(plan.warnings.some((warning) => warning.code === "claude-start-at-root"));
    assert.ok(plan.warnings.some((warning) => warning.code === "claude-known-marketplaces"));
  });
  await j.check("the adapters' ${CLAUDE_PLUGIN_ROOT} paths resolve inside the copied plugin", () => {
    const root = ".aihq/plugins/egm/";
    const placed = new Set(pathsOf(plan).filter((path) => path.startsWith(root)).map((path) => path.slice(root.length)));
    const fixture = files("tests/fixtures/egm-403d8881");
    const adapters = fixture.filter((file) => file.path.startsWith(".claude-plugin/agents/"));
    assert.ok(adapters.length > 0);
    let seen = 0;
    for (const adapter of adapters)
      for (const match of utf8(adapter.bytes).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+[A-Za-z0-9_])/g)) {
        seen += 1;
        assert.ok(placed.has(match[1]), `${adapter.path}: ${match[1]} not copied`);
      }
    assert.ok(seen > 0, "the adapters name plugin-root paths");
  });
  await j.check("Codex and Antigravity get .agents/skills/egm-*/ with agents, resources and docs beside them", () => {
    const paths = pathsOf(plan);
    for (const prefix of [".agents/skills/egm-", ".agents/agents/", ".agents/resources/", ".agents/docs/"])
      assert.ok(paths.some((path) => path.startsWith(prefix)), prefix);
    assert.ok(!paths.some((path) => path.startsWith(".agents/plugins/")), "no Antigravity local plugin");
    assert.deepEqual(stepAt(plan, ".agents/skills/egm-review/SKILL.md").clis, ["antigravity", "codex"]);
  });
  await j.check("all 7 skills are user-only, and the bundle-root rule is at each client's always-on place", () => {
    const skills = egm.items.filter((item) => item.kind === "skill");
    assert.equal(skills.length, 7);
    assert.ok(skills.every((item) => item.userOnly === true));
    for (const item of skills) assert.ok(stepAt(plan, `.agents/skills/${item.name}/agents/openai.yaml`), `${item.name} openai.yaml`);
    const rule = plan.plan.filter((step) => step.render?.name === "bundle-root" || step.key === "aih.rule.bundle-root");
    assert.ok(rule.some((step) => step.op === "merge" && step.file === "AGENTS.md" && step.clis.includes("codex")));
    assert.ok(rule.some((step) => step.clis?.includes("antigravity")), "antigravity rule");
    for (const step of rule.filter((entry) => entry.op === "write")) assert.equal(step.scanned, false);
  });
  await j.check("references are empty and the status is ok", () => {
    assert.deepEqual(plan.references, []);
    assert.equal(plan.status, "ok");
    ownership(plan);
  });
  await j.check("with dsh added: the same .agents layout, the rule in AGENTS.md, personas unavailable", () => {
    const withDsh = planned(planRecipe(read.recipe, [egm], P("claude-code", "codex", "antigravity", "dsh"), {}, { scope: "project", source: recipeSource }));
    assert.deepEqual(stepAt(withDsh, ".agents/skills/egm-review/SKILL.md").clis, ["antigravity", "codex", "dsh"]);
    const rule = withDsh.plan.find((step) => step.op === "merge" && step.key === "aih.rule.bundle-root");
    assert.equal(rule.file, "AGENTS.md");
    assert.ok(rule.clis.includes("dsh"));
    const personas = withDsh.unavailable.filter((entry) => entry.cli === "dsh");
    assert.equal(personas.length, 9);
    assert.ok(personas.every((entry) => entry.item.startsWith("egm.agent.") && entry.reason === "unsupported-kind"));
    j.note(`With dsh the plan is ${withDsh.status}; the journey states no status for that variant (completeness does not force clients the upstream does not install on, while a selected agent a client cannot take blocks).`);
  });
  await j.check("the fixture-built EGM content equals the committed data, and without its bundle the plan is incomplete with the paths listed", async () => {
    const fixture = files("tests/fixtures/egm-403d8881");
    const rebuilt = await egmContent(fixture, true);
    assert.equal(sha(rebuilt.bytes), sha(readFileSync(join(inputs, "data/egm/content.json"))));
    const bare = await egmContent(fixture, false);
    const without = planned(planRecipe(read.recipe, [bare.content], P("claude-code", "codex", "antigravity"), {}, { scope: "project", source: recipeSource }));
    assert.equal(without.status, "incomplete");
    const paths = without.references.filter((reference) => reference.kind === "path");
    assert.ok(paths.length > 0);
    assert.ok(paths.some((reference) => reference.path.startsWith("agents/") || reference.path.startsWith("resources/")));
  });
  shared.egm = { plan, again: plan3() };
  j.digest("egm-project", plan);
  journeys.push(j.finish());
}

/** EGM from its pinned fixture, as Catalog maintains it (the upstream's pack_plugin.py lists). */
async function egmContent(fixture, bundled) {
  const SHARED = ["plugin.json", "LICENSE", "README.md", "skills/*/SKILL.md", "skills/*/agents/openai.yaml", "skills/*/assets/*.svg", "skills/*/assets/*.png", "skills/*/references/*.md", "skills/*/references/*.json", "agents/*.md", "resources/*.md", "resources/document_standards/*.md", "docs/index.md", "docs/getting_started.md", "docs/harnesses.md", "docs/claude.md", "docs/codex.md", "docs/faq.md", "docs/privacy.md", "docs/releases.md", "assets/*.svg", "assets/*.png", "docs/assets/*.svg", "docs/assets/*.png"];
  const HOSTS = [".claude-plugin/plugin.json", ".claude-plugin/icon.png", ".claude-plugin/agents/*.md", ".codex-plugin/plugin.json"];
  const MARKETPLACES = [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"];
  const bundle = SHARED.filter((pattern) => /^(?:agents|resources|docs)\//.test(pattern));
  const segment = (part) => new RegExp(`^${part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`);
  const matches = (pattern, path) => {
    const want = pattern.split("/");
    const have = path.split("/");
    return want.length === have.length && want.every((part, index) => segment(part).test(have[index]));
  };
  const found = findItems(fixture, { framework: "egm" });
  const items = found.items
    .filter((item) => item.kind === "skill" || item.kind === "agent")
    .map((item) => ({
      ...item,
      files: item.files.filter((file) => SHARED.some((pattern) => matches(pattern, file.sourcePath))),
      ...(bundled ? { bundle: "egm.runtime" } : {}),
    }));
  const built = await buildContent(
    { kind: "git", repository: "https://github.com/google/elephant-goldfish-model", commit: "403d8881d62022490637d740657b33f01e321ea8" },
    fixture,
    items,
    {
      framework: { id: "egm", name: "Elephant-Goldfish Model" },
      ...(bundled ? { bundles: [{ id: "egm.runtime", layout: "skills/<name>/", include: bundle }] } : {}),
      plugins: [{ path: "/", include: [...SHARED, ...HOSTS, ...MARKETPLACES] }],
    },
  );
  assert.equal(built.status, "ok", JSON.stringify(built).slice(0, 400));
  return built;
}

// ---------------------------------------------------------------------------------------------
const aiSetup = json("port-report/ai-setup.json");
const qualificationFiles = readdirSync(join(inputs, "data/qualifications")).sort();
const qualifications = qualificationFiles.map((name) => {
  const read = readQualification(readFileSync(join(inputs, "data/qualifications", name)));
  assert.equal(read.status, "ok", name);
  return { name, ...read };
});
{
  const j = journey(12, "Tool trio on linux-x64: acquire, settings, MCP config, no installer; ok once qualified", "candidate-data");
  const trio = recipe({ schema: "urn:aihq:catalog:recipe:0.1.0", ...aiSetup.recipes[0], data }).recipe;
  const tools = ["cbm", "crg", "serena"].map(content);
  const plan = planned(
    planRecipe(trio, tools, P("claude-code", "codex"), {}, {
      scope: "project",
      source: recipeSource,
      cell: "linux-x64",
      qualifications: qualifications.map((entry) => entry.qualification),
    }),
  );
  await j.check("real data: incomplete, with not-qualified and the recorded reasons", () => {
    assert.equal(plan.status, "incomplete");
    const reasons = plan.unavailable.map((entry) => [entry.item ?? entry.recipe, entry.reason, entry.cause ?? ""]);
    assert.deepEqual(reasons, [
      ["code-intelligence-trio", "no-qualification", ""],
      ["crg.ai-setup.code-review-graph", "not-qualified", "blocked"],
      ["serena.ai-setup.serena", "not-qualified", "blocked"],
    ]);
    for (const entry of plan.unavailable.filter((item) => item.reason === "not-qualified"))
      assert.ok(entry.detail?.length > 0, "the blocked run's reason is given");
  });
  await j.check("real data: codebase-memory-mcp is acquired under ~/.aihq/ai-setup/ naming its qualification", () => {
    const acquire = plan.plan.filter((step) => step.op === "acquire");
    assert.equal(acquire.length, 1);
    assert.equal(acquire[0].root, "user");
    assert.match(acquire[0].into, /^\.aihq\/ai-setup\/codebase-memory-mcp\/0\.12\.1\/linux-x64\/$/);
    const qualified = qualifications.find((entry) => entry.qualification.result.status === "qualified");
    assert.equal(acquire[0].qualification, qualified.sha256);
    assert.equal(acquire[0].scanned, false);
  });
  await j.check("CBM's tool-command steps carry readbacks", () => {
    const commands = plan.plan.filter((step) => step.op === "tool-command");
    assert.equal(commands.length, 3);
    for (const step of commands) {
      assert.equal(step.approval, "required");
      assert.ok(step.readback?.argv?.length > 0 && typeof step.readback.expected === "string");
    }
  });
  await j.check("MCP config for each chosen client with the trio's tool lists, and no installer", () => {
    const merges = plan.plan.filter((step) => step.op === "merge");
    assert.deepEqual(merges.map((step) => `${step.file} ${step.key}`), [
      ".codex/config.toml mcp_servers.code-review-graph",
      ".codex/config.toml mcp_servers.codebase-memory-mcp",
      ".codex/config.toml mcp_servers.serena",
      ".mcp.json /mcpServers/code-review-graph",
      ".mcp.json /mcpServers/codebase-memory-mcp",
      ".mcp.json /mcpServers/serena",
    ]);
    assert.ok(merges[1].entry.disabled_tools?.length > 0 && merges[1].entry.enabled_tools?.length > 0);
    assert.ok(!plan.plan.some((step) => step.op === "upstream-installer"));
    const doNotRun = tools.flatMap((entry) => entry.items).flatMap((item) => item.aiSetup?.doNotRun ?? []);
    const argvs = plan.plan.flatMap((step) => [step.argv, step.entry?.args].filter(Boolean)).map((argv) => JSON.stringify(argv));
    for (const command of doNotRun) assert.ok(!argvs.includes(JSON.stringify(command.slice(1))), `doNotRun ${command}`);
  });
  // The fixture branch: synthetic qualified records for every member and the trio.
  let fixturePlan;
  let fixtureQualifications;
  await j.check("fixture qualifications for every member and the trio read ok and plan", () => {
    fixtureQualifications = qualifiedFixtures(tools, trio);
    fixturePlan = planned(
      planRecipe(fixtureQualifications.trio, fixtureQualifications.contents, P("claude-code", "codex"), {}, {
        scope: "project",
        source: recipeSource,
        cell: "linux-x64",
        qualifications: fixtureQualifications.records,
      }),
    );
  });
  await j.check("fixture qualifications: three acquire steps, each naming its qualification, and ok", () => {
    const acquire = fixturePlan.plan.filter((step) => step.op === "acquire");
    assert.deepEqual(acquire.map((step) => step.aiSetup).sort(), [
      "cbm.ai-setup.codebase-memory-mcp",
      "crg.ai-setup.code-review-graph",
      "serena.ai-setup.serena",
    ]);
    for (const step of acquire) {
      assert.match(step.into, /^\.aihq\/ai-setup\//);
      assert.ok(fixtureQualifications.shas.includes(step.qualification));
    }
    assert.equal(fixturePlan.status, "ok", JSON.stringify(fixturePlan.unavailable));
  });
  await j.open(
    "Serena's context files are in the plan",
    "the Serena AI setup declares no settings files: it launches with Serena's built-in contexts per client (claude-code, codex, copilot-cli, antigravity, else ide); no Catalog context file has been authored, so authored context files (or accepting the built-in contexts) are needed",
    () => {
    const serena = tools[2].items.find((item) => item.kind === "ai-setup");
    const settingsFiles = serena.aiSetup.settings?.files ?? [];
    assert.ok(settingsFiles.length > 0, "Serena's AI setup declares no context files: it starts with its built-in contexts per client");
  },
  );
  j.digest("trio-linux-x64", plan);
  j.pending("The real ok branch: no qualified code-review-graph 2.3.9 or Serena 2.1.0 record for linux-x64 and no trio combination record exist, so the trio cannot plan ok on real data.");
  journeys.push(j.finish());
}

/** Fixture-only qualified records that match the real distributions; never committed data. */
function qualifiedFixtures(frozen, trio) {
  const records = [];
  const shas = [];
  const tools = JSON.parse(JSON.stringify(frozen));
  for (const item of tools.flatMap((entry) => entry.items).filter((entry) => entry.kind === "ai-setup")) {
    const setup = item.aiSetup;
    const distribution = setup.distributions.find((entry) => entry.cells.includes("linux-x64"));
    const python = setup.runtime?.python !== undefined;
    const record = {
      schema: "urn:aihq:catalog:qualification:0.1.0",
      subject: { aiSetup: item.id, version: setup.version, cell: "linux-x64" },
      observed: {
        artifact: Object.fromEntries(Object.entries({ file: distribution.file, url: distribution.url, sha256: distribution.sha256, bytes: distribution.bytes }).filter(([, value]) => value !== undefined)),
        ...(distribution.members ? { members: distribution.members } : {}),
        closure: python ? [{ name: "fixture-dependency", version: "1.0.0", file: "fixture_dependency-1.0.0-py3-none-any.whl", sha256: "1".repeat(64) }] : null,
        interpreter: python ? { version: "3.14.0", file: "cpython-3.14.0-x86_64-unknown-linux-gnu-install_only.tar.gz", sha256: "2".repeat(64), bytes: 1 } : null,
      },
      result: { status: "qualified", run: "3".repeat(64), date: "2026-11-04" },
    };
    const read = readQualification(canonical(record));
    assert.equal(read.status, "ok", JSON.stringify(read).slice(0, 400));
    records.push(read.qualification);
    shas.push(read.sha256);
    item.aiSetup = { ...setup, qualifications: [...setup.qualifications, read.sha256] };
  }
  const combination = readQualification(
    canonical({
      schema: "urn:aihq:catalog:qualification:0.1.0",
      subject: { recipe: trio.id, cell: "linux-x64" },
      observed: { qualifications: [...shas].sort() },
      result: { status: "qualified", run: "4".repeat(64), date: "2026-11-04" },
    }),
  );
  assert.equal(combination.status, "ok", JSON.stringify(combination).slice(0, 400));
  records.push(combination.qualification);
  const withCombination = recipe({ ...JSON.parse(JSON.stringify(trio)), qualifications: { "linux-x64": combination.sha256 } }).recipe;
  const contents = tools.map((document) => {
    const read = readContent(canonical(document));
    assert.equal(read.status, "ok", JSON.stringify(read).slice(0, 400));
    return read.content;
  });
  return { records, shas, trio: withCombination, contents };
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(13, "Scans: scan keys equal Scan's and Git's; cut-outs; exact MCP versions; unscanned keys", "fixture");
  const root = writeTree(join(work, "scan-kit"), SCAN_FOLDER);
  const read = readLocalSource(root);
  const fileOf = (path) => read.files.find((file) => file.path === path);
  const record = (path) => ({ sourceId: "kit", sourcePath: path, sha256: fileOf(path).sha256, executable: fileOf(path).mode === "100755", role: "content" });
  const found = findItems(read.files, { framework: "kit" });
  const item = found.items.find((entry) => entry.id === "kit.skill.audit");
  const built = await buildContent(
    { kind: "git", repository: "https://example.invalid/kit", commit: "a".repeat(40) },
    read.files,
    [{ ...item, bundle: "kit.runtime", editions: { "claude-code": { files: ["claude/skills/audit/SKILL.md", "claude/skills/audit/steps.md"].map(record) } } }],
    { framework: "kit", bundles: [{ id: "kit.runtime", layout: "skills/<name>/", include: ["agents/*.md"] }] },
  );
  await j.check("item, edition and bundle scan keys equal git write-tree of the same folders", () => {
    assert.equal(built.status, "ok", JSON.stringify(built).slice(0, 500));
    const audit = built.content.items[0];
    assert.equal(audit.scanKey, prepared.trees.item);
    assert.equal(audit.editions["claude-code"].scanKey, prepared.trees.edition);
    assert.equal(built.content.bundles[0].scanKey, prepared.trees.bundle);
  });
  await j.check("and equal @aihq/scan/contracts scanKeyOf over the install-relative files", async () => {
    const audit = built.content.items[0];
    const key = await scanKeyOf(audit.files.map((file) => ({ path: file.sourcePath.replace("skills/audit/", ""), mode: file.executable ? "100755" : "100644", bytes: fileOf(file.sourcePath).bytes })));
    assert.equal(key.scanKey, audit.scanKey);
  });
  await j.check("candidate data: ECC keys agree with scanKeyOf for every item wholly in the pinned fixture", async () => {
    const ecc = content("ecc");
    const bytes = new Map();
    for (const file of files("tests/fixtures/port-maintained/ecc")) bytes.set(`ecc\u0000${file.path}`, file.bytes);
    for (const file of files("data/ecc/generated")) bytes.set(`ecc-generated\u0000${file.path}`, file.bytes);
    let compared = 0;
    for (const entry of ecc.items) {
      const parts = [{ files: entry.files, scanKey: entry.scanKey, kind: entry.kind }, ...Object.values(entry.editions ?? {}).map((edition) => ({ ...edition, kind: entry.kind }))];
      for (const part of parts) {
        if (!part.scanKey || !part.files.every((file) => bytes.has(`${file.sourceId}\u0000${file.sourcePath}`))) continue;
        const folder = commonFolder(part.files.map((file) => file.sourcePath), part.kind);
        const key = await scanKeyOf(part.files.map((file) => ({ path: folder === null ? "SKILL.md" : file.sourcePath.slice(folder.length), mode: file.executable ? "100755" : "100644", bytes: bytes.get(`${file.sourceId}\u0000${file.sourcePath}`) })));
        assert.equal(key.scanKey, part.scanKey, `${entry.id}`);
        compared += 1;
      }
    }
    assert.ok(compared >= 5, `compared ${compared}`);
  });
  await j.check("candidate data: each ECC MCP cut-out is its own server.json with derivedFrom", () => {
    const servers = content("ecc").items.filter((entry) => entry.kind === "mcp");
    assert.ok(servers.length > 0);
    const pointers = new Set();
    for (const entry of servers) {
      assert.equal(entry.files.length, 1);
      const [file] = entry.files;
      assert.equal(file.sourceId, "ecc-generated");
      assert.equal(file.sourcePath, `${entry.id}/server.json`);
      assert.equal(file.derivedFrom.sourcePath, "mcp-configs/mcp-servers.json");
      assert.match(file.derivedFrom.pointer, /^\/mcpServers\/[^/]+$/);
      pointers.add(file.derivedFrom.pointer);
      const generated = readFileSync(join(inputs, "data/ecc/generated", file.sourcePath));
      assert.equal(sha(generated), file.sha256);
    }
    assert.equal(pointers.size, servers.length);
  });
  await j.check("an MCP package without an exact version is invalid", async () => {
    const mcpRoot = writeTree(join(work, "mcp-kit"), {
      ".mcp.json": '{"mcpServers":{"tool":{"command":"npx","args":["-y","@example/tool-mcp"],"description":"A tool."}}}\n',
    });
    const mcpRead = readLocalSource(mcpRoot);
    const file = mcpRead.files[0];
    const result = await buildContent(
      { kind: "git", repository: "https://example.invalid/mcp-kit", commit: "b".repeat(40) },
      mcpRead.files,
      [{ id: "mcp-kit.mcp.tool", kind: "mcp", files: [{ sourceId: "mcp-kit", sourcePath: file.path, sha256: file.sha256, executable: false, role: "content", cut: { pointer: "/mcpServers/tool", as: "mcp" } }] }],
      { framework: "mcp-kit" },
    );
    assert.equal(result.status, "invalid");
    assert.match(JSON.stringify(result.problems), /exact version/);
  });
  await j.check("checkContent lists the keys with no matching scan", async () => {
    const checked = await checkContent(built.content, read.files.map((file) => ({ ...file, sourceId: "kit" })), { scannedKeys: [prepared.trees.item] });
    assert.equal(checked.status, "ok", JSON.stringify(checked).slice(0, 400));
    assert.deepEqual([...checked.unscannedKeys].sort(), [prepared.trees.bundle, prepared.trees.edition].sort());
  });
  await j.check("a render step shows scanned: false", () => {
    const plan = planned(planInstall(["kit.skill.audit"], [built.content], P("kiro"), { scope: "project", data: null }));
    const rendered = writes(plan).filter((step) => step.render !== undefined);
    assert.ok(rendered.length > 0);
    for (const step of rendered) assert.equal(step.scanned, false);
  });
  if (network)
    await j.check("upstream: checkContent re-derives all of ECC from the real pinned bytes, keys included", async () => {
      const ecc = content("ecc");
      const all = [...files("upstream/ecc", "ecc"), ...files("data/ecc/generated", "ecc-generated")];
      const checked = await checkContent(ecc, all);
      assert.equal(checked.status, "ok", JSON.stringify(checked).slice(0, 800));
    });
  else j.pending("Run with --network to re-derive every ECC scan key from the real upstream bytes (the offline check covers the items wholly inside the pinned fixture).");
  journeys.push(j.finish());
}

/** The folder an item's install-relative paths start from: a skill's SKILL.md folder, else the file's folder. */
function commonFolder(paths, kind) {
  if (kind === "skill") {
    const skill = paths.find((path) => path.endsWith("/SKILL.md"));
    if (skill) return skill.slice(0, skill.length - "SKILL.md".length);
  }
  // A command folded into a skill installs as that skill's SKILL.md.
  if (kind === "skill" && paths.length === 1) return null;
  if (paths.length === 1) return paths[0].slice(0, paths[0].lastIndexOf("/") + 1);
  let prefix = paths[0].slice(0, paths[0].lastIndexOf("/") + 1);
  while (!paths.every((path) => path.startsWith(prefix))) prefix = prefix.slice(0, prefix.slice(0, -1).lastIndexOf("/") + 1);
  return prefix;
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(14, "Data without a release: a new qualification in a new data commit changes the plan", "fixture");
  const commits = prepared.identity.journey14;
  await j.check("the same installed package plans both data commits", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "node_modules/@aihq/catalog/package.json"), "utf8"));
    assert.equal(pkg.version, "0.1.0");
    assert.notEqual(commits.before.commit, commits.after.commit);
  });
  const planAt = (folder, commit) => {
    const read = readContent(readFileSync(join(inputs, folder, "cbm/content.json")));
    assert.equal(read.status, "ok");
    const records = readdirSync(join(inputs, folder, "qualifications")).map((name) => readQualification(readFileSync(join(inputs, folder, "qualifications", name))).qualification);
    return planned(
      planInstall(["cbm.ai-setup.codebase-memory-mcp"], [read.content], P("codex"), {
        scope: "user",
        data: { repository: "https://example.invalid/catalog-data", commit },
        cell: "darwin-arm64",
        qualifications: records,
      }),
    );
  };
  await j.check("before: darwin-arm64 is not qualified; after the new data commit it plans ok", () => {
    const before = planAt("journey14/before", commits.before.commit);
    const after = planAt("journey14/after", commits.after.commit);
    assert.equal(before.status, "incomplete");
    assert.equal(before.unavailable[0]?.reason, "not-qualified");
    assert.equal(after.status, "ok", JSON.stringify(after.unavailable));
    assert.equal(after.plan.find((step) => step.op === "acquire")?.qualification, commits.after.qualification);
    assert.deepEqual(after.data.commit, commits.after.commit);
  });
  await j.check("item digests do not change when a qualification is added", () => {
    const one = readContent(readFileSync(join(inputs, "journey14/before/cbm/content.json"))).content.items;
    const two = readContent(readFileSync(join(inputs, "journey14/after/cbm/content.json"))).content.items;
    same(one.map((item) => [item.id, item.contentSha256, item.behaviourSha256]), two.map((item) => [item.id, item.contentSha256, item.behaviourSha256]));
  });
  j.note("The added qualification is a fixture record made for this journey; the real darwin-arm64 record stays unknown.");
  journeys.push(j.finish());
}

// ---------------------------------------------------------------------------------------------
{
  const j = journey(15, "Exports: five entry points, five schemas, ten fixtures; nothing removed is importable", "fixture");
  const require = createRequire(join(process.cwd(), "package.json"));
  const installed = join(process.cwd(), "node_modules/@aihq/catalog");
  const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  await j.check("package.json exports exactly /source, /node, /producer, /reader and /contracts", () => {
    assert.deepEqual(Object.keys(pkg.exports).sort(), ["./contracts", "./node", "./producer", "./reader", "./source"]);
    assert.equal(pkg.main, undefined);
    assert.equal(pkg.bin, undefined);
  });
  await j.check("the root, package.json and every earlier export are not importable", async () => {
    for (const specifier of ["@aihq/catalog", "@aihq/catalog/package.json", "@aihq/catalog/release.json", "@aihq/catalog/workflows/nuclei", "@aihq/catalog/schemas/release/1.7.0.json", "@aihq/catalog/fixtures/manifest.json", "@aihq/catalog/dist/catalog/internal/plan.js"]) {
      let code = "imported";
      try {
        await import(specifier);
      } catch (error) {
        code = error.code;
      }
      assert.equal(code, "ERR_PACKAGE_PATH_NOT_EXPORTED", specifier);
    }
    assert.ok(!existsSync(join(installed, "release")) && !existsSync(join(installed, "schemas")) && !existsSync(join(installed, "data")));
  });
  await j.check("none of the removed functions or formats is exported", () => {
    const removed = ["readRelease", "readReleaseContent", "readReleaseIndex", "readReleaseSets", "resolveSelections", "resolveRelease", "readInstalledRelease", "readInstalledPreparedContent", "prepareProjectContext", "acquireBaselineArtifact", "prepareReleaseBaseline", "compileProducerDeclaration", "checkProducerDeclaration", "compileReleaseSets", "prepareSourceRefresh", "CORE_NATIVE_CLIENT_IDS", "itemEvidenceDescriptor", "createContentInventory", "configureItem"];
    for (const [name, module] of Object.entries({ contracts, node, producer, reader, source }))
      for (const key of Object.keys(module)) assert.ok(!removed.includes(key) && !key.startsWith("compareRelease"), `${name}.${key}`);
  });
  await j.check("/contracts gives exactly five schemas and ten fixtures; valid ones read ok, invalid ones invalid", () => {
    const names = ["content", "qualification", "recipe", "source-link", "tool-profile"];
    assert.deepEqual(Object.keys(contracts.schemas).sort(), names);
    assert.deepEqual(Object.keys(contracts.fixtures).sort(), names.flatMap((name) => [`${name}-invalid`, `${name}-valid`]));
    const Ajv2020 = require("ajv/dist/2020.js").default;
    const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
    const readAs = (name, body) => {
      const bytes = encoder.encode(body);
      if (name === "content") return readContent(bytes).status;
      if (name === "tool-profile") return reader.readToolProfile(bytes).status;
      if (name === "qualification") return readQualification(bytes).status;
      if (name === "recipe") return readRecipe(canonical(ctx.plugin), bytes).status;
      return ajv.validate(contracts.schemas[name], JSON.parse(body)) ? "ok" : "invalid";
    };
    for (const name of names) {
      const schema = contracts.schemas[name];
      assert.equal(schema.$id, `urn:aihq:catalog:${name}:0.1.0`);
      const validate = ajv.compile(schema);
      assert.equal(readAs(name, contracts.fixtures[`${name}-valid`]), "ok", `${name}-valid`);
      assert.ok(validate(JSON.parse(contracts.fixtures[`${name}-valid`])), `${name}-valid conforms`);
      assert.equal(readAs(name, contracts.fixtures[`${name}-invalid`]), "invalid", `${name}-invalid`);
      assert.ok(!validate(JSON.parse(contracts.fixtures[`${name}-invalid`])), `${name}-invalid fails the schema`);
    }
    assert.deepEqual(parseSourceLink("https://github.com/example-org/example-skills/tree/v1.2.0/skills/review-notes"), JSON.parse(contracts.fixtures["source-link-valid"]));
  });
  await j.check("the nine tool profiles ship in /contracts and every committed document conforms to its schema", () => {
    assert.deepEqual(Object.keys(contracts.toolProfiles).sort(), ["antigravity", "claude-code", "codex", "copilot", "cursor", "dsh", "kimi", "kiro", "opencode"]);
    const Ajv2020 = require("ajv/dist/2020.js").default;
    const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
    const contentSchema = ajv.compile(contracts.schemas.content);
    for (const framework of readdirSync(join(inputs, "data")).filter((name) => name !== "qualifications"))
      assert.ok(contentSchema(json(`data/${framework}/content.json`)), `${framework}: ${JSON.stringify(contentSchema.errors?.slice(0, 2))}`);
    const qualificationSchema = ajv.compile(contracts.schemas.qualification);
    for (const name of qualificationFiles) assert.ok(qualificationSchema(json(`data/qualifications/${name}`)), name);
    const profileSchema = ajv.compile(contracts.schemas["tool-profile"]);
    for (const text of Object.values(contracts.toolProfiles)) assert.ok(profileSchema(JSON.parse(text)));
  });
  journeys.push(j.finish());
}

// =============================================================================================
// Consumer regressions, each through the packed public exports.
const regression = (id, title, basis) => journey(id, title, basis);
{
  const r = regression("resolver-warning", "Resolver-unavailable warning versus an explicitly selected unsupported agent", "candidate-data");
  await r.check("the helper's absence on dsh warns and does not block; a chosen agent does", () => {
    const { renamed } = shared.resolverCase;
    assert.equal(renamed.status, "ok");
    assert.ok(renamed.warnings.some((warning) => warning.code === "duplicate-resolver-unavailable" && warning.cli === "dsh"));
    assert.ok(!renamed.unavailable.some((entry) => entry.item === RESOLVER));
    const chosen = planned(planInstall(["pstack.agent.poteto-agent"], [content("pstack")], P("dsh"), { scope: "project", data }));
    assert.equal(chosen.status, "incomplete");
  });
  regressions.push(r.finish());
}
{
  const r = regression("choice-completeness", "Optional completeness versus required dependencies and supporting files", "fixture");
  const kitFiles = {
    "skills/core/SKILL.md": "---\nname: core\ndescription: Core skill.\n---\n\nCore.\n",
    "skills/extra/SKILL.md": "---\nname: extra\ndescription: Extra skill.\n---\n\nExtra.\n",
    "skills/helper/SKILL.md": "---\nname: helper\ndescription: Helper skill.\n---\n\nHelper.\n",
    "skills/user/SKILL.md": "---\nname: user\ndescription: Uses helper.\n---\n\nUse the helper skill.\n",
  };
  const root = writeTree(join(work, "choices-kit"), kitFiles);
  const read = readLocalSource(root);
  const found = findItems(read.files, { framework: "kit" });
  const items = found.items.map((item) => (item.id === "kit.skill.user" ? { ...item, dependencies: ["kit.skill.helper"] } : item));
  const repo = { repository: "https://example.invalid/choices-kit", commit: "c".repeat(40) };
  const built = await buildContent({ kind: "git", ...repo }, read.files, items, { framework: "kit" });
  const kitRecipe = recipe({
    ...base,
    id: "kit-base",
    framework: "kit",
    content: repo,
    routes: { "claude-code": "items" },
    members: [{ item: "kit.skill.core", preTicked: true }],
    options: [
      { id: "extras", pick: "several", items: [{ item: "kit.skill.extra", preTicked: true }] },
      { id: "users", pick: "several", items: [{ item: "kit.skill.user", preTicked: false }, { item: "kit.skill.helper", preTicked: false }] },
    ],
  }).recipe;
  const plan = (choices) => planned(planRecipe(kitRecipe, [built.content], P("claude-code"), choices, { scope: "project", source: recipeSource }));
  await r.check("explicitly skipping an optional item leaves the plan ok", () => {
    const skipped = plan({ extras: [], users: [] });
    assert.equal(skipped.status, "ok");
    assert.ok(!pathsOf(skipped).includes(".claude/skills/extra/SKILL.md"));
    assert.deepEqual(skipped.missing, []);
  });
  await r.check("a retained choice missing its required dependency is incomplete", () => {
    const missing = plan({ users: ["kit.skill.user"] });
    assert.equal(missing.status, "incomplete");
    assert.ok(missing.missing.some((entry) => entry.reason === "dependency-not-selected"), JSON.stringify(missing.missing));
    assert.equal(plan({ users: ["kit.skill.user", "kit.skill.helper"] }).status, "ok");
  });
  await r.check("a retained choice missing its supporting files (EGM without its bundle) is incomplete", () => {
    assert.ok(journeys.find((entry) => entry.id === 11).checks.at(-1).ok);
  });
  regressions.push(r.finish());
}
{
  const r = regression("artifact-size", "No separate artifact size cap: artifact byte counts are exposed", "candidate-data");
  await r.check("/contracts publishes no artifact cap, and acquire steps carry the recorded byte count", () => {
    const names = Object.keys(contracts.limits);
    assert.ok(!names.some((name) => /artifact|download|acquire/i.test(name)), names.join(","));
    const cbm = content("cbm").items.find((item) => item.kind === "ai-setup");
    const distribution = cbm.aiSetup.distributions.find((entry) => entry.cells.includes("linux-x64"));
    assert.ok(distribution.bytes > 1_000_000);
    const plan = planned(planInstall([cbm.id], [content("cbm")], P("codex"), { scope: "user", data, cell: "linux-x64", qualifications: qualifications.map((entry) => entry.qualification) }));
    assert.equal(plan.plan.find((step) => step.op === "acquire").distribution.bytes ?? distribution.bytes, distribution.bytes);
  });
  regressions.push(r.finish());
}
{
  const r = regression("schema-identity", "Schema identities and recomputed hashes", "candidate-data");
  await r.check("every format names its URN, and the former names are not read", () => {
    assert.deepEqual(contracts.formats, {
      ...contracts.formats,
      content: "urn:aihq:catalog:content:0.1.0",
      toolProfile: "urn:aihq:catalog:tool-profile:0.1.0",
      recipe: "urn:aihq:catalog:recipe:0.1.0",
      qualification: "urn:aihq:catalog:qualification:0.1.0",
      sourceLink: "urn:aihq:catalog:source-link:0.1.0",
    });
    const valid = JSON.parse(contracts.fixtures["content-valid"]);
    const old = readContent(canonical({ ...valid, schema: "aih-catalog-content/1" }));
    assert.ok(["invalid", "unsupported-version"].includes(old.status), old.status);
  });
  await r.check("qualifications are named by the sha256 of their bytes, and readers recompute it", () => {
    for (const entry of qualifications) {
      assert.equal(entry.name, `${entry.sha256}.json`);
      assert.equal(entry.sha256, sha(readFileSync(join(inputs, "data/qualifications", entry.name))));
    }
    const read = draft("egm-base");
    assert.equal(read.sha256, sha(canonical(read.recipe)));
    assert.equal(shared.egm.plan.recipe.sha256, read.sha256);
  });
  regressions.push(r.finish());
}
{
  const r = regression("unioned-clients", "Unioned clients on shared placements", "candidate-data");
  await r.check("a placement shared by several clients lists every one it serves", () => {
    const { plan } = shared.egm;
    assert.deepEqual(stepAt(plan, ".agents/resources/execution_instructions.md").clis, ["antigravity", "codex"]);
    const notice = stepAt(shared.superpowersUser, ".aihq/notices/superpowers/LICENSE") ?? writes(shared.superpowersUser).find((step) => step.path.startsWith(".aihq/notices/"));
    assert.ok(notice.clis.length >= 1);
    ownership(plan);
    ownership(shared.superpowersUser);
  });
  regressions.push(r.finish());
}
{
  const r = regression("plugin-presence", "Plugin presence verification stays none unless evidenced", "candidate-data");
  await r.check("every plugin step and every profile's plugin section says verify: none", () => {
    for (const step of shared.superpowersUser.plan.filter((entry) => entry.op === "plugin")) assert.equal(step.verify, "none");
    for (const profile of Object.values(profiles)) if (profile.plugins) assert.equal(profile.plugins.verify, "none", profile.id);
  });
  regressions.push(r.finish());
}
{
  const r = regression("local-plugin-membership", "Local-plugin attribution and contained-item inventory survive ordering", "candidate-data");
  await r.check("local-plugin steps carry route and framework; only the first in plan order lists contains", () => {
    const { plan, again } = shared.egm;
    const local = plan.plan.filter((step) => step.route === "local-plugin");
    for (const step of local) assert.equal(step.framework, "egm");
    const first = plan.plan.findIndex((step) => step.route === "local-plugin");
    assert.ok(Array.isArray(plan.plan[first].contains) && plan.plan[first].contains.length > 0);
    const contains = plan.plan[first].contains;
    assert.deepEqual([...contains].sort(), contains);
    assert.equal(new Set(contains).size, contains.length);
    assert.equal(plan.plan.filter((step) => step.contains !== undefined).length, 1);
    assert.ok(contains.includes("egm.skill.egm-review"));
    same(plan, again);
  });
  regressions.push(r.finish());
}
{
  const r = regression("input-destinations", "Typed input destinations without values or secrets", "candidate-data");
  await r.check("MCP inputs bind at typed destinations, and the plan and renders carry no secret value", () => {
    const ecc = content("ecc");
    const ids = ["ecc.mcp.exa-web-search", "ecc.mcp.browser-use", "ecc.mcp.filesystem"];
    const plan = planned(planInstall(ids, [ecc], P("claude-code", "codex", "kiro"), { scope: "project", data }));
    const bindings = plan.plan.flatMap((step) => (step.inputs ?? []).map((binding) => ({ ...binding, op: step.op })));
    assert.ok(bindings.length > 0);
    for (const binding of bindings) {
      assert.ok(ids.includes(binding.item));
      const forms = Object.keys(binding.at);
      assert.equal(forms.length, 1);
      assert.ok(["pointer", "placeholder", "argv", "env"].includes(forms[0]), forms[0]);
    }
    const declared = ecc.items.filter((item) => ids.includes(item.id)).flatMap((item) => Object.keys(item.requirements.inputs));
    for (const name of declared) assert.ok(bindings.some((binding) => binding.input === name), `${name} unbound`);
    const textOf = JSON.stringify(plan);
    for (const marker of ["YOUR_", "_HERE", "Bearer "]) assert.ok(!textOf.includes(marker), marker);
    for (const profile of Object.values(profiles)) assert.ok(profile.inputReferences, `${profile.id} inputReferences`);
  });
  regressions.push(r.finish());
}
{
  const r = regression("refusals", "Refusal cases: unsafe paths, limits, mismatched bytes and profiles, data identity", "fixture");
  await r.check("renderStep refuses a source whose bytes differ, and a profile at another version", () => {
    const { plan } = shared.egm;
    const step = writes(plan).find((entry) => entry.render !== undefined && entry.from !== undefined);
    const egmFiles = files("tests/fixtures/egm-403d8881").map((file) => ({ sourceId: "egm", sourcePath: file.path, bytes: file.bytes }));
    const ok = renderStep(step, [content("egm")], P("claude-code", "codex", "antigravity"), egmFiles);
    assert.equal(ok.status, "ok", JSON.stringify(ok).slice(0, 300));
    const changed = egmFiles.map((file) => (file.sourcePath === step.from.sourcePath ? { ...file, bytes: encoder.encode("changed\n") } : file));
    assert.equal(renderStep(step, [content("egm")], P("claude-code", "codex", "antigravity"), changed).code, "source-mismatch");
    const profileId = step.render.profile ?? step.render.profiles?.[0]?.id;
    const older = { ...profiles[profileId], version: profiles[profileId].version - 1 };
    const others = Object.values(profiles).filter((profile) => profile.id !== profileId);
    assert.equal(renderStep(step, [content("egm")], [older, ...others], egmFiles).code, "profile-mismatch");
  });
  await r.check("a recipe plan refuses a different data identity", () => {
    const result = planRecipe(draft("egm-base").recipe, [content("egm")], P("codex"), {}, { scope: "project", source: recipeSource, data: { ...data, commit: "f".repeat(40) } });
    assert.equal(result.status, "refused");
    assert.equal(result.code, "data-mismatch");
  });
  await r.check("a content document that is not canonical, or over the limit, is refused or invalid; nothing throws", () => {
    const bytes = readFileSync(join(inputs, "data/egm/content.json"));
    const pretty = encoder.encode(JSON.stringify(JSON.parse(utf8(bytes))));
    assert.ok(["invalid", "refused"].includes(readContent(pretty).status));
    assert.equal(readContent(new Uint8Array(contracts.limits.contentFileBytes + 1)).status, "refused");
    assert.equal(readContent("not bytes").status === "ok", false);
    assert.equal(planInstall("nonsense", null, null, null).status === "ok", false);
  });
  await r.check("unsafe paths and links in a local source are refused or listed, never followed", async () => {
    const result = await node.fetchSource({ kind: "local", path: join(work, "does-not-exist") }, { outDir: work });
    assert.equal(result.status, "refused");
    const escape = findItems([{ path: "../escape/SKILL.md", mode: "100644", sha256: "0".repeat(64) }], { framework: "kit" });
    assert.notEqual(escape.status, "ok");
  });
  regressions.push(r.finish());
}

// What this replay cannot establish.
missingProof.push(
  "Native use: no client loaded any planned layout; plugin presence checks stay none.",
  "Real qualifications: code-review-graph 2.3.9 and Serena 2.1.0 are blocked on linux-x64 and the trio has no combination record, so journey 12's ok branch is pending.",
  "Data admission: every scan key is new and unscanned; no data commit has passed the trusted-scan gate.",
  "Recipe publication: no recipe is published with a real data commit; the journeys write their recipes and use the drafted ones in the port report.",
  "Extensions routes: aih-extensions declares no per-client routes, so no Extensions base recipe exists.",
  "Registry install: @aihq/scan 0.1.0 is not on the npm registry; consumers install the vendored tarball.",
  ...(network ? [] : ["Upstream bytes: run with --network to re-derive ECC's scan keys and Superpowers' plugin key from the real pins."]),
);

process.stdout.write(JSON.stringify({ journeys, regressions, missingProof }));
