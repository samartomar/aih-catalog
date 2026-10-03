// AIHQ Claude Code PreToolUse hook. Exit 2 blocks an Edit or Write call.
// This protects direct file edits only; it is not a sandbox for shell commands.
let payload;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  console.error("Blocked by AIHQ: unreadable hook input. Review this edit manually.");
  process.exit(2);
}
if (payload?.tool_name === "Edit" || payload?.tool_name === "Write") {
  const path = payload?.tool_input?.file_path;
  if (typeof path !== "string") {
    console.error("Blocked by AIHQ: edit path is missing. Review this edit manually.");
    process.exit(2);
  }
  const name = path.replaceAll("\\", "/").split("/").at(-1);
  const normalizedName = name?.toLowerCase();
  if (normalizedName && /^\.env(?:\..+)?$/.test(normalizedName) &&
      ![".env.example", ".env.sample", ".env.template"].includes(normalizedName)) {
    console.error("Blocked by AIHQ: " + name + " is a local environment file. Ask the user to change it.");
    process.exit(2);
  }
}
