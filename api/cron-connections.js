export default async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY missing" });
  if (!kvUrl || !kvToken) return res.status(500).json({ error: "KV not configured" });

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric"
  });

  async function callSonnet(prompt, useWebSearch = false, maxTokens = 2500, timeoutMs = 50000) {
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

  async function kvGet(key) {
    const r = await fetch(`${kvUrl}/get/${key}`, { headers: { Authorization: `Bearer ${kvToken}` } });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.result) return null;
    try { return typeof d.result === "string" ? JSON.parse(d.result) : d.result; }
    catch { return null; }
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
    const connData = await callSonnet(
      `웹 검색으로 오늘(${today}) 아래 국가 쌍의 최신 관계 상황 확인 후 JSON으로:\nus-cn, us-kr, us-ir, ru-ua, il-ir, cn-tw\n형식: {"from-to":{"note":"최신 관계 2문장","watch":"투자 시사점","keyItems":[{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"}]}}\nJSON만.`,
      true
    );

    const existing = (await kvGet("geomap:country-data:v3")) || { updates: {}, connections: {} };

    await kvSave("geomap:country-data:v3", {
      updates: existing.updates || {},
      connections: connData,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      source: "cron-connections"
    });

    return res.status(200).json({ success: true, date: today, connections: Object.keys(connData).length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
