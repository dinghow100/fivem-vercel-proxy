export const runtime = "edge";

// Try multiple upstreams; emit SSE even if upstream returns JSON
const CANDIDATES = [
  "https://servers-frontend.fivem.net/api/servers/stream",
  () => `https://servers-frontend.fivem.net/api/servers/stream/${Math.floor(Date.now()/1000)}`
];

const HEADERS_A = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "accept": "text/event-stream",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "origin": "https://servers.fivem.net",
  "referer": "https://servers.fivem.net/"
};
const HEADERS_B = {
  "user-agent": HEADERS_A["user-agent"],
  "accept": "text/event-stream",
  "cache-control": "no-cache",
  "pragma": "no-cache"
};

function sseHeaders() {
  return new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-transform, no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,OPTIONS"
  });
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { headers: sseHeaders() });

  for (const cand of CANDIDATES) {
    const url = typeof cand === "function" ? cand() : cand;

    for (const H of [HEADERS_A, HEADERS_B]) {
      try {
        const r = await fetch(url, { headers: H, redirect: "follow", cache: "no-store" });
        if (!r.ok) continue;

        const ct = (r.headers.get("content-type") || "").toLowerCase();

        // Upstream SSE → pass through
        if (ct.includes("event-stream") && r.body) {
          return new Response(r.body, { headers: sseHeaders() });
        }

        // Upstream JSON → convert to SSE frames
        let data: any;
        try { data = await r.json(); }
        catch {
          const txt = await r.text();
          try { data = JSON.parse(txt); } catch { continue; }
        }

        const list =
          Array.isArray(data) ? data :
          Array.isArray(data.servers) ? data.servers :
          Array.isArray(data.data) ? data.data :
          (data.servers && typeof data.servers === "object" ? Object.values(data.servers) :
            (data && typeof data === "object" ? Object.values(data) : []));

        const stream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            for (const item of list) controller.enqueue(enc.encode("data: " + JSON.stringify(item) + "\n\n"));
            controller.close();
          }
        });

        return new Response(stream, { headers: sseHeaders() });
      } catch { /* try next */ }
    }
  }
  return new Response("Bad gateway", { status: 502, headers: sseHeaders() });
}
