import type { Env } from "./types";
import { dispatchDueTasks } from "./scheduler";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return json({ ok: true, service: "ecc-orbit", mode: "development", privileged_routes: "fail-closed" });
    return json({ error: "not_found_or_auth_not_configured" }, 404);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchDueTasks(env));
  }
};
