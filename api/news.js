// KV에서 읽기만 함 — Claude 절대 호출 안 함
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(500).json({ error: "KV not configured" });
  try {
    const r = await fetch(`${kvUrl}/get/geomap:news:v1`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const d = await r.json();
    if (d.result) return res.status(200).json(JSON.parse(d.result));
    return res.status(200).json({ items: [], fetchedAtKr: "매일 오전 9시 자동 업데이트", source: "pending" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
