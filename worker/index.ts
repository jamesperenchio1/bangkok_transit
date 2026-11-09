// The site's only server code: the entry of the paid x402 API for AI agents
// (the app itself is worker/app.ts).
//
// workerd rejects a Worker whose entry module exports anything but handlers or
// classes, so this file exports only the default handler - keep it that way.
import type { ExecutionContext, Hono } from "hono";
import { API_PREFIX, createApp, type Env } from "./app";

let cached: { key: string; app: Hono } | null = null;

const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    // wrangler.jsonc routes only /api/* here; anything else is a static asset.
    if (pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`)) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    const key = [env.X402_PAY_TO, env.X402_NETWORK, env.X402_FACILITATOR_URL].join("|");
    if (!cached || cached.key !== key) cached = { key, app: createApp(env) };
    return cached.app.fetch(request, env, ctx);
  },
};

export default handler;
