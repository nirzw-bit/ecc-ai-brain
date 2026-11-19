import { spawn } from "node:child_process";

const port = 8787;
const base = "http://127.0.0.1:" + port;
const child = spawn("npx", ["wrangler","dev","--local","--config","wrangler.local.toml","--port",String(port),"--ip","127.0.0.1"], {
  stdio: "ignore", env: process.env
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error("Wrangler dev exited before serving requests");
    try {
      const response = await fetch(base + "/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
    } catch {}
    await sleep(250);
  }
  throw new Error("Wrangler local server did not become ready");
}
async function assertStatus(path, expected, init) {
  const response = await fetch(base + path, init);
  if (response.status !== expected)
    throw new Error(path + " expected HTTP " + expected + " but received " + response.status);
  return response;
}
try {
  const health = await waitForServer();
  const payload = await health.json();
  if (payload.ok !== true || payload.service !== "ecc-orbit")
    throw new Error("health response shape mismatch");
  await assertStatus("/api/me", 401);
  await assertStatus("/api/memory?key=unauthorized", 401);
  await assertStatus("/api/approvals", 401);
  await assertStatus("/api/tasks", 401, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskType: "backup", taskKey: "unauthorized", dueAt: new Date().toISOString() })
  });
  await assertStatus("/api/memory", 401, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ memoryKey: "unauthorized", content: "must not persist", provenance: {} })
  });
  await assertStatus("/auth/github/start", 503);
  console.log("PASS: local Worker boots; public health is minimal; all privileged routes reject unauthenticated requests; OAuth fails closed without server secrets");
} finally {
  child.kill("SIGTERM");
}
