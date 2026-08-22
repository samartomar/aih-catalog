import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

describe("default CatalogHead V2 evidence chain", () => {
  it("binds the public default profile, recipe, closure, and prose artifacts field-by-field", () => {
    const seedPath = resolve(root, "defaults", "default-catalog-v2.json");
    expect(existsSync(seedPath)).toBe(true);
    const seed = JSON.parse(readFileSync(seedPath, "utf8")) as {
      artifacts: Record<"profile" | "recipe" | "closure" | "prose", string>;
      entryId: string;
      subject: { id: string; kind: string };
    };
    expect(seed.entryId).toBe("recipe.default");
    expect(seed.subject).toEqual({ id: "default-profile", kind: "profile" });
    expect(Object.keys(seed.artifacts).sort()).toEqual(["closure", "profile", "prose", "recipe"]);
    const artifactDigests = Object.fromEntries(
      Object.entries(seed.artifacts).map(([kind, relativePath]) => [
        kind,
        sha256(readFileSync(resolve(root, relativePath))),
      ]),
    );
    for (const digest of Object.values(artifactDigests)) expect(digest).toMatch(/^[a-f0-9]{64}$/);
    const expectedEntry = {
      closure: {
        identity: `artifact:${seed.artifacts.closure}`,
        sha256: artifactDigests.closure,
      },
      prose: { identity: `artifact:${seed.artifacts.prose}`, sha256: artifactDigests.prose },
      recipe: { identity: `artifact:${seed.artifacts.recipe}`, sha256: artifactDigests.recipe },
      subject: {
        source: { release: "1.0.0", revision: `sha256:${artifactDigests.profile}`, type: "aih" },
      },
    };
    const qualificationBasis = {
      organizationAdmission: "not-authoritative",
      subjectKind: seed.subject.kind,
    };
    const verificationMode = "cold-external-admin";
    expect(expectedEntry.recipe).toEqual({
      identity: `artifact:${seed.artifacts.recipe}`,
      sha256: artifactDigests.recipe,
    });
    expect(expectedEntry.subject.source.revision).toBe(`sha256:${artifactDigests.profile}`);
    expect(qualificationBasis).toEqual({
      organizationAdmission: "not-authoritative",
      subjectKind: "profile",
    });
    expect(verificationMode).toBe("cold-external-admin");
  });
});
