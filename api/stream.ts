export const runtime = "edge";

/** FiveM proxy → always emit SSE.
 * - Immediate heartbeat so client sees bytes right away
 * - Heartbeat every 5s while connecting/streaming
 * - Tries multiple upstream URLs and header sets
 * - If upstream returns JSON, convert to SSE frames
 */
const CANDIDATES = [
  "https://servers-frontend.fivem.net/api/servers/stream",
  () => `https://servers-frontend.fivem.net/api/servers/stream/${Math.floor(Date.now() / 1000)}`
];

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

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (s: string) => controller.enqueue(enc.encode(s));

      // Send an immediate byte so browsers show data right away
      send(`:hello ${Date.now()}\n\n`);
      const hb = setInterval(() => send(`:hb ${Date.now()}\n\n`), 5000);

      try {
        let connected = false;

        for (const cand of CANDIDATES) {
          if (connected) break;
          const url = typeof cand === "function" ? cand() : cand;

          for (const H of [HEADERS_A, HEADERS_B]) {
            if (connected) break;

            // 15s connect/read timeout for each attempt
            const ac = new AbortController();
            const to = setTimeout(() => ac.abort(), 15000);

            try {
              const r = await fetch(url, { headers: H, redirect: "follow", cache: "no-store", signal: ac.signal });
              clearTimeout(to);
              if (!r.ok) continue;

              const ct = (r.headers.get("content-type") || "").toLowerCase();

              if (ct.includes("event-stream") && r.body) {
                connected = true;
                // Pipe upstream SSE through untouched
                const reader = r.body.getReader();
                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  if (value && value.byteLength) controller.enqueue(value);
                }
                break;
              }

              // Upstream JSON → convert to SSE frames
              let data: any;
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
              clearTimeout(to);
              // try next header set / candidate
            }
          }
        }

        if (!connected) {
          send(`event: error\ndata: {"message":"upstream unreachable"}\n\n`);
        }
      } finally {
        clearInterval(hb);
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: sseHeaders() });
}
