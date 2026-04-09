// api/news.js — Vercel 서버리스 함수
// KV 캐시 TTL 12시간 → 하루 최대 2회 Claude 호출
// 비용: 하루 2회 × $0.0003 = $0.0006/일 (하루 1원 미만)

import { kv } from "@vercel/kv";

const CACHE_KEY = "geomap:news:v1";
const CACHE_TTL = 43200; // 12시간(초) = 하루 2회 호출

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ── 1. KV 캐시 확인 (12시간 이내면 Claude 호출 없이 즉시 반환) ──
  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "public, s-maxage=3600");
      return res.status(200).json(cached);
    }
  } catch (kvErr) {
    console.warn("KV read failed:", kvErr.message);
  }

  // ── 2. 캐시 만료 → Claude Haiku 호출 (12시간에 1회) ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const now = new Date();
  const today = now.toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
  });
  // 한국 시간 기준 시간대 계산 (UTC+9)
  const krHour = (now.getUTCHours() + 9) % 24;
  const session = krHour < 12 ? "오전 세션 (아침)" : "오후 세션 (저녁)";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        system: `자산제곱 지정학 분석 지도 뉴스 AI. 오늘: ${today} ${session}.
배경: 이란-미국 군사 충돌·호르무즈 봉쇄·유가 110달러, 미중 Section 301 조사, 우크라 전쟁 3년차, Fed 동결·파월 임기 만료.
JSON 배열만 출력. 다른 텍스트 절대 금지.`,
        messages: [{
          role: "user",
          content: `오늘(${today} ${session}) 투자자 필수 지정학·경제 뉴스 8개를 JSON으로만:
[{"date":"YYYY.MM.DD","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"20자 이내","body":"2~3문장","impact":"투자 시사점 1문장"}]
JSON만.`,
        }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);

    const data = await response.json();
    const raw = data.content[0].text.trim();
    const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
    const items = JSON.parse(clean);
    if (!Array.isArray(items) || !items.length) throw new Error("Invalid response");

    // 다음 업데이트 시각 계산
    const nextUpdate = new Date(now.getTime() + CACHE_TTL * 1000);
    const nextKrHour = (nextUpdate.getUTCHours() + 9) % 24;
    const nextSession = nextKrHour < 12 ? "오전" : "오후";

    const payload = {
      items,
      fetchedAt: now.toISOString(),
      fetchedAtKr: `${today} ${session}`,
      nextUpdateKr: `${nextUpdate.toLocaleDateString("ko-KR")} ${nextSession}`,
      source: "claude-haiku",
    };

    // ── 3. KV에 12시간 저장 ──
    try {
      await kv.set(CACHE_KEY, payload, { ex: CACHE_TTL });
    } catch (kvErr) {
      console.warn("KV write failed:", kvErr.message);
    }

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, s-maxage=3600");
    return res.status(200).json(payload);

  } catch (err) {
    console.error("News generation failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
