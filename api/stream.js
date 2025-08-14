export const runtime = "edge";

// Upstream candidates
const CANDIDATES = [
  "https://servers-frontend.fivem.net/api/servers/stream",
  () => `https://servers-frontend.fivem.net/api/servers/stream/${Math.floor(Date.now()/1000)}`
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

// Minimal, allowed headers for Edge responses
function sseHeaders() {
  return new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,OPTIONS"
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: sseHeaders() });

  try {
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = s => controller.enqueue(enc.encode(s));
        const close = () => { try { controller.close(); } catch {} };

        // Force immediate bytes so the browser shows activity
        send(":ok\n\n");
        const hb = setInterval(() => send(`:hb ${Date.now()}\n\n`), 5000);

        let connected = false;
        try {
          for (const cand of CANDIDATES) {
            if (connected) break;
            const url = typeof cand === "function" ? cand() : cand;

            for (const H of [HEADERS_A, HEADERS_B]) {
              if (connected) break;

              const ac = new AbortController();
              const to = setTimeout(() => ac.abort(), 15000); // 15s per attempt

              try {
                const r = await fetch(url, { headers: H, redirect: "follow", cache: "no-store", signal: ac.signal });
                clearTimeout(to);
                if (!r.ok) continue;

                const ct = (r.headers.get("content-type") || "").toLowerCase();

                // Upstream SSE passthrough
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

                // Upstream JSON → emit as SSE frames
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
              } catch (err) {
                clearTimeout(to);
                console.error("fetch error", err?.name || err);
              }
            }
          }

          if (!connected) {
            send(`event: error\ndata: {"message":"upstream unreachable"}\n\n`);
          }
        } finally {
          clearInterval(hb);
          close();
        }
      }
    });

    return new Response(stream, { headers: sseHeaders() });
  } catch (e) {
    console.error("handler error", e?.message || e);
    return new Response("internal error", { status: 500, headers: sseHeaders() });
  }
}
