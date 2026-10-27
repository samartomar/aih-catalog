/**
 * The release 1.7 restructuring check, exported by `@aihq/catalog/producer`: an
 * item-by-item comparison of one checked 1.7 release with its framework's amended
 * expected projection. It covers content hashes, supersessions, collapsed MCP
 * pairs and edit digests. A release's index entry ships only after it passes.
 */
import {
  type CatalogItem,
  type CatalogRelease,
  RELEASE_SCHEMA_ID_1_7,
  type Retirement17,
} from "./contracts.js";
import { isRecord } from "./document.js";
import { deepFreeze } from "./json.js";
import { isCheckedRelease } from "./reader.js";

export const RESTRUCTURING_EXPECTATION_SCHEMA_ID =
  "urn:aihq:catalog:restructuring-expectation:1.0.0" as const;

/** One framework's amended expectation. `pending` frameworks cannot pass yet. */
export interface FrameworkExpectation {
  readonly status: "expected" | "pending";
  /** Why a framework is pending, naming the ticket that completes its expectation. */
  readonly reason?: string;
  readonly items: readonly {
    readonly id: string;
    readonly kind: string;
    readonly purpose?: string;
    /** Absent where the expectation does not predict content bytes. */
    readonly contentSha256?: string;
  }[];
  /** Items the projection cannot name yet, admitted by kind and count only. */
  readonly pendingItems?: readonly {
    readonly kind: string;
    readonly count: number;
    readonly reason: string;
  }[];
  readonly supersessions: readonly {
    readonly survivor: string;
    readonly itemId: string;
    readonly match: "hash" | "name+sourcePath" | "split";
    /** Present where the earlier release is fixed, such as the frozen default. */
    readonly releaseSha256?: string;
  }[];
  readonly mcpPairs: readonly { readonly survivor: string; readonly copies: readonly string[] }[];
  readonly edits: readonly {
    readonly survivor: string;
    readonly transform: "identical" | "edited";
    readonly editsSha256?: string;
  }[];
  readonly retired: readonly {
    readonly id: string;
    /** Exact replacements; absent with `pending` when another ticket names them. */
    readonly replacedBy?: readonly { readonly framework: string; readonly itemId: string }[];
    readonly pending?: string;
  }[];
}

export interface RestructuringExpectation {
  readonly schema: typeof RESTRUCTURING_EXPECTATION_SCHEMA_ID;
  readonly frameworks: Readonly<Record<string, FrameworkExpectation>>;
}

export type RestructuringCheck =
  | "framework"
  | "item"
  | "hash"
  | "unexpected-item"
  | "supersession"
  | "mcp-pair"
  | "edits"
  | "retired";

export interface RestructuringRow {
  readonly check: RestructuringCheck;
  readonly subject: string;
  readonly status: "pass" | "fail";
  readonly expected?: string;
  readonly actual?: string;
}

export interface RestructuringResult {
  readonly status: "pass" | "fail";
  readonly framework: string;
  readonly rows: readonly RestructuringRow[];
  readonly counts: Readonly<Record<RestructuringCheck, { pass: number; fail: number }>>;
}

const sameRefs = (
  left: readonly { framework: string; itemId: string }[],
  right: readonly { framework: string; itemId: string }[],
) =>
  left.length === right.length &&
  left.every(
    (ref, index) =>
      ref.framework === right[index]?.framework && ref.itemId === right[index]?.itemId,
  );

/** Compares one checked release 1.7 with its framework's amended expectation, row by row. */
export function compareRestructuring(request: {
  readonly release: CatalogRelease;
  readonly expectation: RestructuringExpectation;
}): RestructuringResult {
  const { release, expectation } = request ?? ({} as typeof request);
  if (!isCheckedRelease(release) || release.schema !== RELEASE_SCHEMA_ID_1_7)
    throw new TypeError("Expected a checked release 1.7 view.");
  if (!isRecord(expectation) || expectation.schema !== RESTRUCTURING_EXPECTATION_SCHEMA_ID)
    throw new TypeError("Expected a restructuring expectation 1.0.0.");
  const framework = release.framework?.id as string;
  const rows: RestructuringRow[] = [];
  const row = (
    check: RestructuringCheck,
    subject: string,
    pass: boolean,
    expected?: string,
    actual?: string,
  ) =>
    rows.push({
      check,
      subject,
      status: pass ? "pass" : "fail",
      ...(expected === undefined ? {} : { expected }),
      ...(actual === undefined ? {} : { actual }),
    });
  const target = Object.hasOwn(expectation.frameworks, framework)
    ? expectation.frameworks[framework]
    : undefined;
  row(
    "framework",
    framework,
    target?.status === "expected",
    "expected",
    target === undefined
      ? "absent"
      : `${target.status}${target.reason ? `: ${target.reason}` : ""}`,
  );
  if (target !== undefined) {
    const items = new Map(release.items.map((item) => [item.id, item]));
    const purpose = (item: CatalogItem) => {
      const payload = item.payload as Record<string, unknown> | undefined;
      return isRecord(payload) && typeof payload.purpose === "string" ? payload.purpose : undefined;
    };
    for (const expected of target.items) {
      const item = items.get(expected.id);
      const actualKind =
        item === undefined ? "absent" : `${item.kind}${purpose(item) ? `/${purpose(item)}` : ""}`;
      const wantKind = `${expected.kind}${expected.purpose ? `/${expected.purpose}` : ""}`;
      row("item", expected.id, actualKind === wantKind, wantKind, actualKind);
      if (expected.contentSha256 !== undefined)
        row(
          "hash",
          expected.id,
          item?.contentSha256 === expected.contentSha256,
          expected.contentSha256,
          item?.contentSha256 ?? "absent",
        );
    }
    const named = new Set(target.items.map((item) => item.id));
    const allowance = new Map(
      (target.pendingItems ?? []).map((entry) => [entry.kind, entry.count]),
    );
    for (const item of release.items) {
      if (named.has(item.id)) continue;
      const left = allowance.get(item.kind) ?? 0;
      if (left > 0) allowance.set(item.kind, left - 1);
      row("unexpected-item", item.id, left > 0, "named by the expectation", item.kind);
    }
    for (const expected of target.supersessions) {
      const found = (items.get(expected.survivor)?.supersedes ?? []).find(
        (entry) =>
          entry.itemId === expected.itemId &&
          entry.match === expected.match &&
          (expected.releaseSha256 === undefined || entry.releaseSha256 === expected.releaseSha256),
      );
      row(
        "supersession",
        `${expected.survivor} <- ${expected.itemId}`,
        found?.match === expected.match,
        expected.match,
        found?.match ?? "absent",
      );
    }
    for (const pair of target.mcpPairs) {
      const item = items.get(pair.survivor);
      const superseded = new Set((item?.supersedes ?? []).map((entry) => entry.itemId));
      const missing = pair.copies.filter((copy) => copy !== pair.survivor && !superseded.has(copy));
      row(
        "mcp-pair",
        pair.survivor,
        item?.kind === "mcp-server" && missing.length === 0,
        pair.copies.join(", "),
        item === undefined
          ? "absent"
          : missing.length
            ? `missing ${missing.join(", ")}`
            : "collapsed",
      );
    }
    for (const edit of target.edits) {
      const payload = items.get(edit.survivor)?.payload as Record<string, unknown> | undefined;
      const derivation =
        isRecord(payload) && isRecord(payload.derivation) ? payload.derivation : undefined;
      const transform = derivation?.transform ?? "absent";
      const digest = derivation?.editsSha256;
      row(
        "edits",
        edit.survivor,
        transform === edit.transform &&
          (edit.transform !== "edited" ||
            (edit.editsSha256 !== undefined && digest === edit.editsSha256)),
        `${edit.transform}${edit.editsSha256 ? ` ${edit.editsSha256}` : ""}`,
        `${String(transform)}${digest ? ` ${String(digest)}` : ""}`,
      );
    }
    const retired = new Map(
      (release.retired ?? [])
        .filter(
          (entry): entry is Retirement17 =>
            Array.isArray(entry.replacedBy) && entry.replacedBy.every(isRecord),
        )
        .map((entry) => [entry.id, entry]),
    );
    for (const expected of target.retired) {
      const entry = retired.get(expected.id);
      const pass =
        entry !== undefined &&
        (expected.replacedBy === undefined
          ? expected.pending !== undefined && entry.replacedBy.length > 0
          : sameRefs(entry.replacedBy, expected.replacedBy));
      row(
        "retired",
        expected.id,
        pass,
        expected.replacedBy?.map((ref) => `${ref.framework}/${ref.itemId}`).join(", ") ??
          `pending: ${expected.pending}`,
        entry === undefined
          ? "absent"
          : entry.replacedBy.map((ref) => `${ref.framework}/${ref.itemId}`).join(", ") || "none",
      );
    }
  }
  const counts = Object.fromEntries(
    (
      [
        "framework",
        "item",
        "hash",
        "unexpected-item",
        "supersession",
        "mcp-pair",
        "edits",
        "retired",
      ] as const
    ).map((check) => [
      check,
      {
        pass: rows.filter((entry) => entry.check === check && entry.status === "pass").length,
        fail: rows.filter((entry) => entry.check === check && entry.status === "fail").length,
      },
    ]),
  ) as RestructuringResult["counts"];
  return deepFreeze({
    status: rows.every((entry) => entry.status === "pass") ? "pass" : "fail",
    framework,
    rows,
    counts,
  });
}
