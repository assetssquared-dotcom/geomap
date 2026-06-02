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

    // 중첩 JSON 완전 처리
    let data = d.result;
    while (typeof data === "string") {
      try { data = JSON.parse(data); } catch { break; }
    }
    if (Array.isArray(data)) {
      const first = data[0];
      data = typeof first === "string" ? JSON.parse(first) : first;
    }
    if (data && data.value) {
      data = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
