import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { verifySignedCatalogV2 } from "../../src/index.js";

// The committed signed Catalog history under catalog/: every head from genesis on stays
// verifiable against its committed predecessor. Continuity only; no head bytes and no member
// inventory are pinned here, so a new head joins the check without a release-specific test.

const root = resolve(import.meta.dirname, "../..");
const catalog = resolve(root, "catalog");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

it("keeps every committed signed head verifiable against its committed predecessor, in one chain from genesis", () => {
  const signerRoot = read(resolve(catalog, "genesis", "catalog-signer-root.json"));
  const genesis = read(resolve(catalog, "genesis", "signed-catalog-v2.json")).head;
  const heads = readdirSync(catalog, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "genesis")
    .map((entry) => resolve(catalog, entry.name))
    .filter((directory) => existsSync(resolve(directory, "signed-catalog-v2.json")))
    .map((directory) => ({
      directory,
      signed: read(resolve(directory, "signed-catalog-v2.json")),
      previous: read(resolve(directory, "previous-head.json")),
    }))
    .sort((left, right) => left.signed.head.sequence - right.signed.head.sequence);
  expect(heads.length).toBeGreaterThan(0);
  expect(heads.map((item) => item.signed.head.sequence)).toEqual(
    heads.map((_, index) => index + 1),
  );
  let predecessor = genesis;
  for (const { directory, signed, previous } of heads) {
    // The predecessor each head was signed over is exactly the previous committed head.
    expect(previous, directory).toEqual(predecessor);
    const head = verifySignedCatalogV2({
      signed,
      catalogSignerRoots: [signerRoot],
      expectedClaims: previous.claims,
      lastAccepted: previous,
      replay: { acceptedIdentities: [] },
      now: signed.head.validFrom,
    });
    expect(head.sequence, directory).toBe(previous.sequence + 1);
    expect(head.previousCatalogHeadSha256, directory).toBe(previous.catalogHeadSha256);
    expect(head, directory).toEqual(signed.head);
    predecessor = signed.head;
  }
});
