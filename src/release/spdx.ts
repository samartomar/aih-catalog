/**
 * Portable SPDX licence validation over the embedded SPDX License List data.
 * Validates licence identifiers and the SPDX expression subset Catalog
 * publishes: identifiers joined by AND/OR, parentheses, and WITH exceptions.
 * No network, filesystem or dependency: data only.
 */
import { SPDX_EXCEPTION_IDS, SPDX_LICENSE_IDS } from "./spdx-data.js";

const TOKEN = /^[A-Za-z0-9.:+-]+$/;

interface Parser {
  readonly tokens: readonly string[];
  index: number;
}

const peek = (parser: Parser): string | undefined => parser.tokens[parser.index];
const take = (parser: Parser): string | undefined => parser.tokens[parser.index++];

function parseExpression(parser: Parser): boolean {
  if (!parseTerm(parser)) return false;
  while (peek(parser) === "AND" || peek(parser) === "OR") {
    take(parser);
    if (!parseTerm(parser)) return false;
  }
  return true;
}

function parseTerm(parser: Parser): boolean {
  const token = take(parser);
  if (token === undefined) return false;
  if (token === "(") {
    if (!parseExpression(parser)) return false;
    return take(parser) === ")";
  }
  if (!TOKEN.test(token) || !SPDX_LICENSE_IDS.has(token)) return false;
  if (peek(parser) === "WITH") {
    take(parser);
    const exception = take(parser);
    if (exception === undefined || !TOKEN.test(exception) || !SPDX_EXCEPTION_IDS.has(exception)) {
      return false;
    }
  }
  return true;
}

/**
 * True when `value` is a valid SPDX licence: a listed identifier or an
 * expression over listed identifiers with AND/OR, parentheses and WITH
 * exceptions, per the SPDX specification.
 */
export function isSpdxLicenseId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false;
  if (SPDX_LICENSE_IDS.has(value)) return true;
  const tokens = value.match(/\(|\)|[^\s()]+/g);
  if (tokens === null || tokens.length === 0 || tokens.length > 128) return false;
  const parser: Parser = { tokens, index: 0 };
  if (!parseExpression(parser)) return false;
  return parser.index === tokens.length;
}
