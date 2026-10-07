import { getNodeValue, type Node, type ParseError, parseTree } from "jsonc-parser";
import { assertStrictValues, textDepth } from "../release/json.js";

/** Upstream JSON may be pretty printed; ambiguity and unbounded structure are refused. */
export function readUpstreamObject(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength > 1024 * 1024) throw new TypeError("JSON exceeds 1 MiB");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (textDepth(text) > 32) throw new TypeError("JSON exceeds 32 container levels");
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (errors.length > 0 || root?.type !== "object") throw new TypeError("invalid JSON object");
  const pending: Node[] = [root];
  while (pending.length > 0) {
    const node = pending.pop() as Node;
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value as string;
        if (keys.has(key) || key === "__proto__") throw new TypeError("ambiguous JSON key");
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) pending.push(child);
  }
  const value = getNodeValue(root) as Record<string, unknown>;
  assertStrictValues(value);
  return value;
}
