import { vi } from "vitest";
import type { Arrivals } from "../../../lib/bts";

/** A minimal valid upstream payload for `code`, stamped like the real API (naive UTC). */
export function arrivalsFor(code: string, at = Date.now()): Arrivals {
  return {
    station: { code, name_en: code, name_th: code, line_color: "#76b729" },
    platforms: [
      {
        platform: "1",
        line_color: "#76b729",
        line_id: 1,
        direction: "เคหะฯ | Kheha",
        direction_key: "E23",
        trains: [{ train_no: "1", destination: "Kheha", destination_key: "E23", eta_minutes: 3, status: "" }],
      },
    ],
    near_end_of_service: false,
    service_active: true,
    next_service: "",
    server_time: new Date(at).toISOString(),
    timestamp: new Date(at).toISOString().replace("Z", ""),
  };
}

type Responder = (code: string) => Response | Promise<Response>;

/**
 * Replaces the global fetch for the upstream API only. Returns the list of
 * station codes requested, in order.
 */
export function mockUpstream(respond: Responder): string[] {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const match = /^\/arrivals\/(.+)$/.exec(url.pathname);
    // Anything else (the test runtime's own plumbing) goes through untouched.
    if (url.hostname !== "bts-api.topmile.com" || !match) return realFetch(input, init);
    calls.push(match[1]);
    return respond(match[1]);
  });
  return calls;
}

export const ok: Responder = (code) => Response.json(arrivalsFor(code));
export const status = (code: number): Responder => () => new Response("error", { status: code });
