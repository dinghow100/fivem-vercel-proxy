export const runtime = "edge";
export default async function handler() {
  console.log("[ping] hit", Date.now());
  return new Response(JSON.stringify({ ok: true, now: Date.now() }), {
    headers: { "content-type": "application/json" }
  });
}
