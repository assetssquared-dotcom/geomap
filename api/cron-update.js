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
    // Claude에게 웹 검색 도구 제공
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: `오늘은 ${today}입니다. 반드시 웹 검색을 통해 오늘의 실제 최신 뉴스를 확인하고 정확한 데이터를 바탕으로 JSON을 생성하세요. 유가, 금리, 환율 등 수치는 반드시 실제 검색된 값을 사용하세요.`,
        messages: [{
          role: "user",
          content: `웹 검색으로 오늘(${today}) 실제 최신 지정학·경제 뉴스를 확인한 후, 투자자 필수 뉴스 8개를 아래 JSON 형식으로만 출력하세요:\n[{"date":"${dateStr}","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"15자 이내","body":"2문장 (실제 수치 포함)","impact":"시사점 1문장"}]\nJSON만.`
        }]
      })
    });

    if (!r.ok) throw new Error(`Anthropic ${r.status}`);
    const d = await r.json();

    // 웹 검색 결과 포함 응답에서 최종 텍스트 추출
    const textBlock = d.content.filter(b => b.type === "text").pop();
    if (!textBlock) throw new Error("No text response");

    const raw = textBlock.text.trim().replace(/```json\n?|\n?```/g,"").trim();
    const items = JSON.parse(raw);

    const payload = {
      items,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      nextUpdateKr: "내일 오전 9시",
      source: "cron-web-search"
    };

    // 기존 키 삭제 후 새로 저장
    await fetch(`${kvUrl}/del/geomap:news:v1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}` }
    });

    await fetch(`${kvUrl}/set/geomap:news:v1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    return res.status(200).json({ success: true, date: today, news: items.length, source: "web-search" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
