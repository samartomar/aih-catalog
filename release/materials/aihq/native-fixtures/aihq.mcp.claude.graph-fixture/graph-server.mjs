// AIHQ graph fixture: a read-only MCP stdio server over a small fixed call graph.
// Test scope only. It answers one query from the sibling graph.json and implements no
// attestation; the verifier's recorder does that. No network, writes or child processes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOOL = 'aihq_graph_callees';
const MAX_MESSAGES = 512;
const MAX_LINE = 262144;
const MAX_BYTES = 4194304;
const calls = JSON.parse(readFileSync(fileURLToPath(new URL('./graph.json', import.meta.url)), 'utf8')).calls;

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const fail = (id, code, text) => send({ jsonrpc: '2.0', id, error: { code, message: text } });

const tools = [{
  name: TOOL,
  description: 'List the functions that a function directly calls in the fixed fixture call graph.',
  inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false }
}];

const call = (id, params) => {
  if (!isRecord(params) || params.name !== TOOL) return fail(id, -32602, 'unknown tool');
  const args = params.arguments;
  if (!isRecord(args) || Object.keys(args).length !== 1 || typeof args.symbol !== 'string')
    return fail(id, -32602, 'invalid arguments');
  if (!Object.hasOwn(calls, args.symbol)) return fail(id, -32602, 'unknown symbol');
  send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: calls[args.symbol].join(',') }], isError: false } });
};

const handle = line => {
  let message;
  try { message = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
      (Object.hasOwn(message, 'id') && typeof message.id !== 'string' && !Number.isSafeInteger(message.id)))
    return fail(null, -32600, 'invalid request');
  if (!Object.hasOwn(message, 'id')) return;
  const { id, method, params } = message;
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: isRecord(params) && typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'aihq-graph-fixture', version: '1' } } });
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } });
  if (method === 'tools/call') return call(id, params);
  fail(id, -32601, 'method not found');
};

let messages = 0;
let bytes = 0;
let buffer = '';
let stopped = false;
const stop = () => { stopped = true; process.exitCode = 4; process.stdin.destroy(); };
const accept = line => {
  if (stopped) return;
  messages += 1;
  bytes += Buffer.byteLength(line) + 1;
  if (messages > MAX_MESSAGES || bytes > MAX_BYTES || line.length > MAX_LINE) return stop();
  handle(line);
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while (!stopped && (index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    accept(line.endsWith('\r') ? line.slice(0, -1) : line);
  }
  if (!stopped && buffer.length > MAX_LINE) stop();
});
process.stdin.on('end', () => { if (buffer.length > 0) accept(buffer); });
