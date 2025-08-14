export const runtime = "edge";

// ---- Upstreams (SSE + timestamped JSON) ----
const CANDIDATES = [
  "https://servers-frontend.fivem.net/api/servers/stream",
  () => `https://servers-frontend.fivem.net/api/servers/stream/${Math.floor(Date.now()/1000)}`
];

// Two header variants: one “looks like browser on servers.fivem.net”, one generic
const HEADERS_A = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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

// Strict SSE/CORS headers and no-transform to avoid buffering
function sseHeaders() {
  return new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-transform, no-store, must-revalidate",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    // extra hints for proxies
    "x-accel-buffering": "no",
    "connection": "keep-alive"
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: sseHeaders() });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (s) => controller.enqueue(enc.encode(s));

      // --- FORCE AN IMMEDIATE FLUSH ---
      // padding beats proxy buffers; then first heartbeat
      send(":" + " ".repeat(2048) + "\n");   // padding
      send(`:hello ${Date.now()}\n\n`);

      const hb = setInterval(() => send(`:hb ${Date.now()}\n\n`), 5000);

      try {
        let connected = false;

        for (const cand of CANDIDATES) {
          if (connected) break;
          const url = typeof cand === "function" ? cand() : cand;

          for (const H of [HEADERS_A, HEADERS_B]) {
            if (connected) break;

            const ac = new AbortController();
            const TO = setTimeout(() => ac.abort(), 15000); // 15s/attempt

            try {
              const r = await fetch(url, { headers: H, redirect: "follow", cache: "no-store", signal: ac.signal });
              clearTimeout(TO);
              if (!r.ok) continue;

              const ct = (r.headers.get("content-type") || "").toLowerCase();

              // --- Passthrough SSE ---
              if (ct.includes("event-stream") && r.body) {
                connected = true;
                const reader = r.body.getReader();
                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  if (value && value.byteLength) controller.enqueue(value);
                }
                break;
              }

              // --- JSON snapshot → emit as SSE frames ---
              let data;
              try { data = await r.json(); }
              catch {
                const txt = await r.text();
                try { data = JSON.parse(txt); } catch { continue; }
              }

              connected = true;
              const list =
                Array.isArray(data) ? data :
                Array.isArray(data.servers) ? data.servers :
                Array.isArray(data.data) ? data.data :
                (data.servers && typeof data.servers === "object" ? Object.values(data.servers) :
                  (data && typeof data === "object" ? Object.values(data) : []));

              for (const item of list) send(`data: ${JSON.stringify(item)}\n\n`);
              break;
            } catch {
              clearTimeout(TO); /* try next header/candidate */
            }
          }
        }

        if (!connected) {
          send(`event: error\ndata: {"message":"upstream unreachable"}\n\n`);
        }
      } finally
