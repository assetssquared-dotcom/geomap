export default async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY missing" });
  if (!kvUrl || !kvToken) return res.status(500).json({ error: "KV not configured" });

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric"
  });
  const dateStr = today.replace("년 ",".").replace("월 ",".").replace("일","").trim();

  async function callSonnet(prompt, useWebSearch = false, maxTokens = 4000, timeoutMs = 58000) {
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: `오늘은 ${today}입니다. ${useWebSearch ? "반드시 웹 검색으로 실제 최신 데이터를 확인하세요. 수치는 검색된 실제 값만 사용하세요." : ""} 최종 응답은 반드시 JSON 데이터로만 끝나야 합니다. 검색 결과 설명, 서두, 요약 문장을 절대 먼저 출력하지 말고, 마지막 메시지는 순수 JSON(배열 또는 객체)으로만 작성하세요.`,
      messages: [{ role: "user", content: prompt }]
    };
    if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) throw new Error(`Anthropic ${r.status}`);
    const d = await r.json();
    const text = d.content.filter(b => b.type === "text").pop()?.text?.trim() || "";
    let clean = text.replace(/```json\n?|\n?```/g, "").trim();
    const startIdx = Math.min(
      ...[clean.indexOf("{"), clean.indexOf("[")].filter(i => i !== -1)
    );
    const lastBrace = clean.lastIndexOf("}");
    const lastBracket = clean.lastIndexOf("]");
    const endIdx = Math.max(lastBrace, lastBracket);
    if (startIdx >= 0 && endIdx > startIdx) {
      clean = clean.slice(startIdx, endIdx + 1);
    }
    return JSON.parse(clean);
  }

  async function kvSave(key, value) {
    await fetch(`${kvUrl}/del/${key}`, { method: "POST", headers: { Authorization: `Bearer ${kvToken}` } });
    await fetch(`${kvUrl}/set/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
  }

  try {
    // 뉴스만 처리 (국가/연결선 데이터는 /api/cron-countries, /api/cron-connections 에서 별도 처리)
    const newsItems = await callSonnet(
      `오늘(${today}) 주요 지정학·경제 뉴스를 빠르게 검색해서 5개만 JSON으로:\n[{"date":"${dateStr}","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"15자 이내","body":"1~2문장","impact":"시사점 1문장","url":"기사 URL 또는 빈 문자열"}]\n검색은 1~2회만 하고 바로 JSON으로 답하세요. JSON만.`,
      true,
      2500,
      55000
    );
    await kvSave("geomap:news:v1", {
      items: newsItems,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      nextUpdateKr: "내일 오전 9시",
      source: "cron-sonnet-web"
    });

    return res.status(200).json({ success: true, date: today, news: newsItems.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
