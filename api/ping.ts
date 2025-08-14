export const runtime = "edge";
export default async function handler(_req: Request) {
  console.log("[ping] hit at", new Date().toISOString());
  return new Response(JSON.stringify({ ok: true, now: Date.now() }), {
    headers: { "content-type": "application/json" }
  });
}
