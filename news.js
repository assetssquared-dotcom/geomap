// news.js — KV에서 읽기만 함. Claude 호출 없음.
// 실제 업데이트는 cron-update.js (매일 KST 09:00) 가 담당

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ error: "KV not configured" });
  }

  try {
    const kvRes = await fetch(`${kvUrl}/get/geomap:news:v1`, {
      headers: { Authorization: `Bearer ${kvToken}` }
    });
    const kvData = await kvRes.json();
    if (kvData.result) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "public, s-maxage=3600");
      return res.status(200).json(JSON.parse(kvData.result));
    }
    // KV에 데이터 없으면 아직 cron이 한 번도 안 돌았음
    return res.status(200).json({ items: [], fetchedAtKr: "업데이트 준비 중 (매일 오전 9시 갱신)", source: "pending" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
