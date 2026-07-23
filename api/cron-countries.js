export default async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY missing" });
  if (!kvUrl || !kvToken) return res.status(500).json({ error: "KV not configured" });

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric"
  });

  async function callSonnet(prompt, useWebSearch = false, maxTokens = 4000, timeoutMs = 55000) {
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: `오늘은 ${today}입니다. ${useWebSearch ? "반드시 웹 검색으로 실제 최신 데이터를 확인하세요. 수치는 검색된 실제 값만 사용하세요." : ""} 최종 응답은 반드시 JSON 데이터로만 끝나야 합니다. 검색 결과 설명, 서두, 요약 문장을 절대 먼저 출력하지 말고, 마지막 메시지는 순수 JSON(배열 또는 객체)으로만 작성하세요.`,
      messages: [{ role: "user", content: prompt }]
    };
    // 웹검색 비활성화 (비용 절감 - 주 1회 실행)
    // if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

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

  const BATCHES = [
    ["us","cn","jp"],
    ["kr","de","ru"],
    ["in","sa","tw"],
    ["ir","au","br"],
    ["cl","ua","gb"],
    ["fr","tr","il"],
    ["pk","vn","id"],
    ["mx","pl","za"],
    ["ae"]
  ];
  const NAMES = {us:"미국",cn:"중국",jp:"일본",kr:"한국",de:"독일",ru:"러시아",in:"인도",sa:"사우디",tw:"대만",ir:"이란",au:"호주",br:"브라질",cl:"칠레",ua:"우크라이나",gb:"영국",fr:"프랑스",tr:"튀르키예",il:"이스라엘",pk:"파키스탄",vn:"베트남",id:"인도네시아",mx:"멕시코",pl:"폴란드",za:"남아공",ae:"UAE"};

  const countryUpdates = {};
  const batchErrors = [];

  const batchResults = await Promise.allSettled(
    BATCHES.map(batch =>
      callSonnet(
        `오늘(${today}) 기준 아래 국가들의 금리·정책·주요 이슈를 JSON으로:\n${batch.map(id=>`${id}(${NAMES[id]||id})`).join(", ")}\n\n형식: {"국가ID":{"summary":"최신 현황 2문장","rate":{"name":"중앙은행","val":"현재 실제 금리","trend":"hawk|dove|hold","trendLabel":"기조","note":"최근 결정 배경"},"policy":[{"text":"<b>정책명</b> — 설명"},{"text":"<b>정책명</b> — 설명"}],"watchlist":[{"icon":"📌","text":"<b>이벤트</b> — 투자 시사점"}],"risk":["리스크1","리스크2"]}}\nJSON만.`,
        true,
        4000,
        58000
      ).then(data => ({ batch, data }))
       .catch(err => { throw { batch, err }; })
    )
  );

  for (const r of batchResults) {
    if (r.status === "fulfilled") {
      Object.assign(countryUpdates, r.value.data);
    } else {
      const b = r.reason?.batch || [];
      const msg = r.reason?.err?.message || r.reason?.message || "unknown error";
      batchErrors.push(`[${b.join(",")}] ${msg}`);
    }
  }

  // 기존 country-data 읽어서 connections는 보존, updates만 병합 갱신
  const existing = (await kvGet("geomap:country-data:v3")) || { updates: {}, connections: {} };
  const mergedUpdates = { ...existing.updates, ...countryUpdates };

  await kvSave("geomap:country-data:v3", {
    updates: mergedUpdates,
    connections: existing.connections || {},
    fetchedAt: new Date().toISOString(),
    fetchedAtKr: `${today} 오전 9시`,
    source: "cron-countries"
  });

  const result = { success: true, date: today, countriesUpdated: Object.keys(countryUpdates).length };
  if (batchErrors.length) result.batchErrors = batchErrors;
  return res.status(200).json(result);
}
