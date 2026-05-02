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

  try {
    // Claude Haiku 호출
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: `지정학 투자 뉴스 AI. 오늘: ${today}. JSON 배열만 출력.`,
        messages: [{
          role: "user",
          content: `오늘(${today}) 투자자 필수 지정학·경제 뉴스 8개를 JSON 배열로만 출력:\n[{"date":"${dateStr}","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"15자 이내","body":"2문장","impact":"시사점 1문장"}]\nJSON만.`
        }]
      })
    });

    if (!r.ok) throw new Error(`Anthropic ${r.status}`);
    const d = await r.json();
    const raw = d.content[0].text.trim().replace(/```json\n?|\n?```/g,"").trim();
    const items = JSON.parse(raw);

    const payload = {
      items,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      nextUpdateKr: "내일 오전 9시",
      source: "cron"
    };

    // KV에 직접 JSON 저장 (SET 명령어 사용)
    const kvRes = await fetch(`${kvUrl}/set/geomap:news:v1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([JSON.stringify(payload), "EX", "90000"])
    });

    return res.status(200).json({ success: true, date: today, news: items.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
