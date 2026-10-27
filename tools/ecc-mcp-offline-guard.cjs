// Fixture guard for known Node network/process surfaces; not an OS sandbox claim.
const { syncBuiltinESMExports } = require("node:module");
const denyNetwork = () => { process.stderr.write("offline-network-refused\n"); throw Error("offline-network-refused"); };
const denyProcess = () => { process.stderr.write("offline-process-refused\n"); throw Error("offline-process-refused"); };
globalThis.fetch = denyNetwork;
for (const module of ["node:http", "node:https"]) {
  const api = require(module);
  api.request = denyNetwork; api.get = denyNetwork;
}
const net = require("node:net");
net.connect = denyNetwork; net.createConnection = denyNetwork;
net.Socket.prototype.connect = denyNetwork; net.Server.prototype.listen = denyNetwork;
const tls = require("node:tls"); tls.connect = denyNetwork;
const dns = require("node:dns"); dns.lookup = denyNetwork; dns.resolve = denyNetwork;
const processes = require("node:child_process");
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) processes[key] = denyProcess;
syncBuiltinESMExports();
