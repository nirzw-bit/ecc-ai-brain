export interface Env { DB: D1Database; BACKUPS: R2Bucket; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return json({ ok: true, service: "ecc-orbit", mode: "development", privileged_routes: "fail-closed" });
    // No privileged route is exposed until a verified owner identity adapter exists.
    return json({ error: "not_found_or_auth_not_configured" }, 404);
  },
  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Dispatcher remains inert until its lease/claim implementation and tests are merged.
  }
};
