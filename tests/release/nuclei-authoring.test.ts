import { describe, expect, it } from "vitest";

const author = await import(new URL("../../workflows/nuclei/author.mjs", import.meta.url).href);
const helper = {
  id: "nuclei-helper",
  source: { kind: "local", input: "catalog" },
  path: "workflows/nuclei/bin/linux-x64",
  sha256: "a".repeat(64),
  byteLength: 8000000,
};
const assessment = {
  platform: "linux",
  helper,
  runDirectory: "/tmp/assessment-one",
  bundle: "/tmp/templates.tgz",
  bundleSha256: "b".repeat(64),
  bundleBytes: 1024,
  target: "http://host.docker.internal:8080/",
  allowHosts: ["host.docker.internal"],
  targetMode: "local-host",
  hostGateway: true,
  daemon: "unix:///var/run/docker.sock",
  dockerCli: "/usr/bin/docker",
  image: `projectdiscovery/nuclei@sha256:${"c".repeat(64)}`,
  container: "aih-nuclei-test-one",
  network: "aih-nuclei-net-one",
};
describe("Nuclei local policy authoring", () => {
  it("binds the helper and every assessment-specific dependency before Core review", () => {
    const policy = author.authorAssessmentPolicy(assessment);
    const recipe = policy.selections[0].recipe.inline;
    expect(recipe.materials).toEqual([helper]);
    expect(recipe.prerequisites).toContainEqual({
      kind: "platform",
      os: "linux",
      architectures: ["x64"],
    });
    const args = recipe.operations[0].args.map((slot: { literal: string }) => slot.literal);
    expect(args).toContain(assessment.target);
    expect(args).toContain(assessment.bundleSha256);
    expect(args).toContain(assessment.image);
    expect(args).toContain("local-host");
    expect(args).toContain("--host-gateway=true");
    expect(recipe.operations[0].executable).toEqual({ material: "nuclei-helper" });
    expect(recipe.operations[0].acceptedExitCodes).toEqual([0]);
    expect(recipe.checks[0].kind).toBe("process.exit");
    expect(recipe.checks[0].acceptedExitCodes).toEqual([0]);
    expect(recipe.operations[0].timeoutMs + recipe.checks[0].timeoutMs).toBeLessThanOrEqual(900000);
    expect(JSON.stringify(recipe)).toContain("proxies");
  });
  it("authors preparation independently and never transfers its approval to assessment", () => {
    const policy = author.authorPreparationPolicy({
      platform: "linux",
      helper,
      output: "/tmp/prepared-one",
      official: ["http/technologies/tech-detect.yaml"],
      custom: [],
    });
    const recipe = policy.selections[0].recipe.inline;
    expect(recipe.operations[0].args[0]).toEqual({ literal: "prepare" });
    expect(JSON.stringify(recipe)).not.toContain(assessment.target);
    expect(recipe.checks).toEqual([]);
    expect(JSON.stringify(recipe)).toContain("api.github.com");
  });
  it("binds explicit local custom data without treating it as another template", () => {
    const policy = author.authorPreparationPolicy({
      platform: "linux",
      helper,
      output: "/tmp/prepared-data",
      official: [],
      custom: [{ source: "/tmp/http.yaml", path: "http.yaml" }],
      customData: [{ source: "/tmp/words.txt", path: "words.txt" }],
    });
    const args = policy.selections[0].recipe.inline.operations[0].args.map(
      (slot: { literal: string }) => slot.literal,
    );
    expect(args).toContain("--custom-data");
    expect(args).toContain("/tmp/words.txt=words.txt");
  });
  it("refuses ambiguous target, helper, runtime and capability choices", () => {
    for (const target of [
      "-x",
      "file:///tmp/a",
      "https://user:pass@example.com",
      "https://other.invalid",
    ])
      expect(() => author.authorAssessmentPolicy({ ...assessment, target })).toThrow();
    expect(() =>
      author.authorAssessmentPolicy({ ...assessment, helper: { ...helper, byteLength: 16777217 } }),
    ).toThrow();
    expect(() =>
      author.authorAssessmentPolicy({ ...assessment, daemon: "tcp://remote:2375" }),
    ).toThrow();
    expect(() => author.authorAssessmentPolicy({ ...assessment, platform: "darwin" })).toThrow();
    expect(() =>
      author.authorAssessmentPolicy({ ...assessment, image: "projectdiscovery/nuclei:latest" }),
    ).toThrow();
  });
});
