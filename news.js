import { Redis } from "@upstash/redis";

const CACHE_KEY = "geomap:news:v1";
const CACHE_TTL = 43200; // 12시간

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // 1. 캐시 확인
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.status(200).json(cached);
    }
  } catch (e) { console.warn("KV read:", e.message); }

  // 2. Claude Haiku 호출
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const now = new Date();
  const today = now.toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric" });
  const krHour = (now.getUTCHours() + 9) % 24;
  const session = krHour < 12 ? "오전 세션" : "오후 세션";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        system: `자산제곱 지정학 분석 지도 뉴스 AI. 오늘: ${today} ${session}. 배경: 이란-미국 군사 충돌·호르무즈 봉쇄·유가 110달러, 미중 Section 301, 우크라 전쟁 3년차, Fed 동결·파월 임기 만료. JSON 배열만 출력.`,
        messages: [{ role:"user", content:`오늘(${today} ${session}) 투자자 필수 지정학·경제 뉴스 8개를 JSON으로만:\n[{"date":"YYYY.MM.DD","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"20자 이내","body":"2~3문장","impact":"투자 시사점 1문장"}]\nJSON만.` }]
      })
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const data = await r.json();
    const items = JSON.parse(data.content[0].text.trim().replace(/```json\n?|\n?```/g,"").trim());
    if (!Array.isArray(items) || !items.length) throw new Error("Invalid");

    const nextUpdate = new Date(now.getTime() + CACHE_TTL * 1000);
    const nextKrHour = (nextUpdate.getUTCHours() + 9) % 24;
    const payload = {
      items,
      fetchedAt: now.toISOString(),
      fetchedAtKr: `${today} ${session}`,
      nextUpdateKr: `${nextUpdate.toLocaleDateString("ko-KR")} ${nextKrHour < 12 ? "오전" : "오후"}`,
      source: "claude-haiku"
    };

    try { await redis.set(CACHE_KEY, payload, { ex: CACHE_TTL }); }
    catch (e) { console.warn("KV write:", e.message); }

    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
