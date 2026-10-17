/** Package version grammars shared by release admission, acquisition and comparison. */

/**
 * Admission form for an exact package version: three numeric parts with optional
 * pre-release and build identifiers, never a range or tag. Looser than strict
 * Semantic Versioning: numeric pre-release identifiers may have leading zeros.
 */
export const EXACT_VERSION =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// Semantic Versioning 2.0.0 grammar: no leading zeros in numeric identifiers.
const NUMBER = "0|[1-9][0-9]*";
const PRERELEASE_PART = `(?:${NUMBER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
/** Strict Semantic Versioning 2.0.0; groups 1–3 are the core parts, 4 the pre-release. */
export const SEMVER = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})` +
    `(?:-(${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*))?` +
    "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
);
const NUMERIC = /^[0-9]+$/;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Orders canonical decimal strings of any length without precision loss. */
const numeric = (a: string, b: string) =>
  a.length === b.length ? compare(a, b) : a.length - b.length;

/**
 * Semantic Versioning 2.0.0 precedence: negative when `a` is lower, zero for equal
 * precedence (build metadata ignored), undefined when either is not strict semver.
 */
export function semverPrecedence(a: string, b: string): number | undefined {
  const [x, y] = [SEMVER.exec(a), SEMVER.exec(b)];
  if (x === null || y === null) return undefined;
  for (const index of [1, 2, 3]) {
    const order = numeric(x[index] as string, y[index] as string);
    if (order !== 0) return order;
  }
  const [p, q] = [x[4], y[4]];
  // A version without pre-release identifiers has higher precedence.
  if (p === undefined || q === undefined)
    return (p === undefined ? 1 : 0) - (q === undefined ? 1 : 0);
  const [left, right] = [p.split("."), q.split(".")];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const [l, r] = [left[index] as string, right[index] as string];
    if (l === r) continue;
    const [ln, rn] = [NUMERIC.test(l), NUMERIC.test(r)];
    if (ln && rn) return numeric(l, r);
    if (ln !== rn) return ln ? -1 : 1;
    return compare(l, r);
  }
  return left.length - right.length;
}
