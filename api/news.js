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
    if (!d.result) return res.status(200).json({ items: [], source: "pending" });

    // result가 객체면 그대로, 문자열이면 파싱
    let data = d.result;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch(e) {}
    }
    // 배열이면 첫 번째 요소
    if (Array.isArray(data)) {
      data = typeof data[0] === "string" ? JSON.parse(data[0]) : data[0];
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
