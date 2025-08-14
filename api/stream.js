export const runtime = "edge";

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

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = s => controller.enqueue(enc.encode(s));

      // immediate bytes so DevTools shows something right away
      send(":ok\n\n");

      let i = 0;
      const timer = setInterval(() => {
        i += 1;
        send(`data: {"hello": ${i}}\n\n`); // visible in the Response tab
        if (i >= 5) { clearInterval(timer); try { controller.close(); } catch {} }
      }, 1000);
    }
  });

  return new Response(stream, { headers: sseHeaders() });
}
