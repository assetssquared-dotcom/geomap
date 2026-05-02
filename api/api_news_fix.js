// api/news.js — KV에서 읽기만 함
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

    if (d.result) {
      // result가 문자열이면 파싱, 아니면 그대로
      const parsed = typeof d.result === "string" ? JSON.parse(d.result) : d.result;
      // parsed가 또 문자열이면 한 번 더 파싱
      const final = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
      // value 키가 있으면 그 안의 데이터 사용
      const data = final.value ? (typeof final.value === "string" ? JSON.parse(final.value) : final.value) : final;
      return res.status(200).json(data);
    }

    return res.status(200).json({ items: [], fetchedAtKr: "매일 오전 9시 자동 업데이트", source: "pending" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
