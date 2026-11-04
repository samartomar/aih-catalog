/**
 * The ten published fixtures: one valid and one invalid document per schema, as the exact
 * canonical text a reader admits. Each valid fixture reads `ok` and conforms to its schema;
 * each invalid one reads `invalid` and does not conform. Pure data.
 */
import { canonicalDocument } from "./json.js";

const EXAMPLE_REPOSITORY = "https://github.com/example-org/example-skills";
const EXAMPLE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** Built by `buildContent` from a three-file Git source: a skill, a rule and a licence. */
const content = {
  schema: "urn:aihq:catalog:content:0.1.0",
  framework: { id: "example", name: "Example skills" },
  sources: [
    {
      id: "example",
      kind: "git",
      repository: EXAMPLE_REPOSITORY,
      commit: EXAMPLE_COMMIT,
      notices: [
        {
          sourcePath: "LICENSE",
          sha256: "b8b61ec39ae350afb8b8604be4c185ce386365bad7d5e2ce8bceec328521e5ba",
          covers: "/",
        },
      ],
    },
  ],
  items: [
    {
      id: "example.rule.plain-language",
      kind: "rule",
      name: "plain-language",
      description: "Prefer plain language in user-facing text.",
      files: [
        {
          sourceId: "example",
          sourcePath: "rules/plain-language.md",
          sha256: "422ae21b350eb6a7455a09d3911a74deda5b86599fe103e48799e8891e4153ad",
          bytes: 143,
          executable: false,
          role: "content",
        },
      ],
      contentSha256: "7b3c63885256a981f57c40bc45a0463e0a716f205334df033d6f08a53ef6026d",
      behaviourSha256: "6502a6dd6502e9c1a76f84d24f9ab380ee187ec29079d370d63284f1b481479f",
      scanKey: "git-sha1:4a5dabce7c834317c38774449ac1be3e46c628f5",
      scope: "always",
    },
    {
      id: "example.skill.review-notes",
      kind: "skill",
      name: "review-notes",
      description: "Summarise review comments into a checklist of follow-up changes.",
      files: [
        {
          sourceId: "example",
          sourcePath: "skills/review-notes/SKILL.md",
          sha256: "5d77163dea4c0c3834585c4be1f847e39e2035089a41774375e7acbe2dc1d39b",
          bytes: 199,
          executable: false,
          role: "content",
        },
      ],
      contentSha256: "f754e1783f3a0181745b79f90ccbb7043b7734471103cab19e0fe472107f0508",
      behaviourSha256: "bb9e7be8cadc066fb19afa89d85e23fd0759772da21397bd593025da09bd91e0",
      scanKey: "git-sha1:7ef55cb7f997b8916cb57748645b9df9ea4cab45",
      userOnly: false,
      arguments: false,
    },
  ],
};

/** A custom client that takes project skills and always-on rules, and nothing else. */
const toolProfile = {
  schema: "urn:aihq:catalog:tool-profile:0.1.0",
  id: "example-cli",
  name: "Example CLI",
  version: 1,
  checkedWith: [{ app: "example-cli", version: "1.0.0", date: "2026-11-01" }],
  places: {
    skill: { project: ".example/skills/<name>/" },
    rule: { project: { always: ".example/rules/<name>.md" } },
  },
  links: { skill: "not-documented" },
  userOnly: "none",
  arguments: "chat-text",
  inputReferences: {
    file: "unknown",
    "mcp-argv": "unknown",
    "mcp-env": "unknown",
    "mcp-header": "unknown",
  },
};

/** A base recipe: Claude Code takes the upstream plugin, every other client takes items. */
const recipe = {
  schema: "urn:aihq:catalog:recipe:0.1.0",
  id: "example-base",
  kind: "base",
  framework: "example",
  content: { repository: EXAMPLE_REPOSITORY, commit: EXAMPLE_COMMIT },
  routes: { "claude-code": "plugin" },
  plugins: {
    "claude-code": {
      source: "example",
      path: "/",
      plugin: "example-skills",
      commit: EXAMPLE_COMMIT,
      marketplace: EXAMPLE_REPOSITORY,
    },
  },
  members: [{ item: "example.skill.review-notes", preTicked: true }],
  options: [
    {
      id: "rules",
      pick: "several",
      items: [{ item: "example.rule.plain-language", preTicked: false }],
    },
  ],
  namePrefix: { skill: "example-" },
  data: {
    repository: "https://github.com/example-org/example-catalog-data",
    commit: "89abcdef0123456789abcdef0123456789abcdef",
  },
};

const exampleInterpreter = {
  version: "3.14.10",
  file: "cpython-3.14.10-x86_64-unknown-linux-gnu.tar.gz",
  sha256: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  bytes: 38_000_000,
};

/** Synthetic format example: a wheel closure with one isolated source-built dependency. */
const qualification = {
  schema: "urn:aihq:catalog:qualification:0.1.0",
  subject: { aiSetup: "example.ai-setup.example-tool", version: "1.4.0", cell: "linux-x64" },
  observed: {
    artifact: {
      file: "example_tool-1.4.0-py3-none-any.whl",
      sha256: "3f7d1c2a9b8e4f6051d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f3a2b1c",
      bytes: 4_194_304,
    },
    closure: [
      {
        name: "example-dependency",
        version: "2.0.0",
        file: "example_dependency-2.0.0-py3-none-any.whl",
        sha256: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
        build: {
          source: {
            file: "example_dependency-2.0.0.tar.gz",
            url: "https://example.org/releases/example_dependency-2.0.0.tar.gz",
            sha256: "3f7d1c2a9b8e4f6051d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f3a2b1c",
            bytes: 80_000,
          },
          interpreter: exampleInterpreter,
          dependencies: [
            {
              name: "setuptools",
              version: "84.2.1",
              file: "setuptools-84.2.1-py3-none-any.whl",
              sha256: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
            },
          ],
          tools: [],
          isolated: true,
        },
      },
    ],
    interpreter: exampleInterpreter,
  },
  result: {
    status: "qualified",
    run: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
    date: "2026-11-01",
  },
};

const sourceLink = {
  schema: "urn:aihq:catalog:source-link:0.1.0",
  status: "recognised",
  candidate: {
    kind: "git",
    repository: EXAMPLE_REPOSITORY,
    ref: "v1.2.0",
    subpath: "skills/review-notes",
  },
};

const [rule, skill] = content.items;

export const fixtureTexts = {
  "content-valid": canonicalDocument(content),
  /** An install name must be kebab-case. */
  "content-invalid": canonicalDocument({
    ...content,
    items: [rule, { ...skill, name: "Review Notes" }],
  }),
  "qualification-valid": canonicalDocument(qualification),
  /** Source archives describe build inputs; they cannot replace installed closure wheels. */
  "qualification-invalid": canonicalDocument({
    ...qualification,
    observed: {
      artifact: {
        file: "example_tool-1.4.0-py3-none-any.whl",
        sha256: qualification.observed.artifact.sha256,
        bytes: 81_920,
      },
      closure: [
        {
          name: "example-dependency",
          version: "2.0.0",
          file: "example_dependency-2.0.0.tar.gz",
          sha256: exampleInterpreter.sha256,
        },
      ],
      interpreter: null,
    },
    result: { ...qualification.result, status: "blocked", reason: "no wheel for one dependency" },
  }),
  "recipe-valid": canonicalDocument(recipe),
  /** An add-on recipe names the recipes it requires. */
  "recipe-invalid": canonicalDocument({ ...recipe, id: "example-extra", kind: "add-on" }),
  "source-link-valid": canonicalDocument(sourceLink),
  /** A candidate is a local folder, a Git repository or an npm package. */
  "source-link-invalid": canonicalDocument({
    ...sourceLink,
    candidate: { kind: "ftp", path: "ftp://example.org/skills" },
  }),
  "tool-profile-valid": canonicalDocument(toolProfile),
  /** A skill place is a folder template naming `<name>`. */
  "tool-profile-invalid": canonicalDocument({
    ...toolProfile,
    places: { ...toolProfile.places, skill: { project: ".example/skills/" } },
  }),
} as const;
