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

  async function callSonnet(prompt, useWebSearch = false) {
    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: `오늘은 ${today}입니다. ${useWebSearch ? "반드시 웹 검색으로 실제 최신 데이터를 확인하세요. 수치는 검색된 실제 값만 사용하세요." : "JSON만 출력하세요."}`,
      messages: [{ role: "user", content: prompt }]
    };
    if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}`);
    const d = await r.json();
    const text = d.content.filter(b => b.type === "text").pop()?.text?.trim() || "";
    return JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
  }

  async function kvSave(key, value) {
    await fetch(`${kvUrl}/del/${key}`, { method: "POST", headers: { Authorization: `Bearer ${kvToken}` } });
    await fetch(`${kvUrl}/set/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
  }

  const results = {};

  try {
    // 1. 뉴스 (웹 검색)
    const newsItems = await callSonnet(
      `웹 검색으로 오늘(${today}) 실제 최신 지정학·경제 뉴스 확인 후 8개를 JSON으로만:\n[{"date":"${dateStr}","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"15자 이내","body":"2문장(실제수치포함)","impact":"시사점 1문장"}]\nJSON만.`,
      true
    );
    await kvSave("geomap:news:v1", {
      items: newsItems,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      nextUpdateKr: "내일 오전 9시",
      source: "cron-sonnet-web"
    });
    results.news = newsItems.length;

    // 2. 주요 국가 금리·정책 (웹 검색)
    const BATCHES = [
      ["us","cn","jp","kr","de","ru","in","sa"],
      ["tw","ir","au","br","cl","ua","gb","fr"],
      ["tr","il","pk","vn","id","mx","pl","za","ae"]
    ];
    const NAMES = {us:"미국",cn:"중국",jp:"일본",kr:"한국",de:"독일",ru:"러시아",in:"인도",sa:"사우디",tw:"대만",ir:"이란",au:"호주",br:"브라질",cl:"칠레",ua:"우크라이나",gb:"영국",fr:"프랑스",tr:"튀르키예",il:"이스라엘",pk:"파키스탄",vn:"베트남",id:"인도네시아",mx:"멕시코",pl:"폴란드",za:"남아공",ae:"UAE"};

    const countryUpdates = {};
    for (const batch of BATCHES) {
      const data = await callSonnet(
        `웹 검색으로 오늘(${today}) 아래 국가들의 최신 금리·정책·주요 이슈를 확인 후 JSON으로:\n${batch.map(id=>`${id}(${NAMES[id]||id})`).join(", ")}\n\n형식: {"국가ID":{"summary":"최신 현황 2문장","rate":{"name":"중앙은행","val":"현재 실제 금리","trend":"hawk|dove|hold","trendLabel":"기조","note":"최근 결정 배경"},"policy":[{"text":"<b>정책명</b> — 설명"},{"text":"<b>정책명</b> — 설명"}],"watchlist":[{"icon":"📌","text":"<b>이벤트</b> — 투자 시사점"}],"risk":["리스크1","리스크2"]}}\nJSON만.`,
        true
      );
      Object.assign(countryUpdates, data);
    }

    // 3. 주요 연결선 관계 (웹 검색)
    const connData = await callSonnet(
      `웹 검색으로 오늘(${today}) 아래 국가 쌍의 최신 관계 상황 확인 후 JSON으로:\nus-cn, us-kr, us-ir, ru-ua, il-ir, cn-tw\n형식: {"from-to":{"note":"최신 관계 2문장","watch":"투자 시사점","keyItems":[{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"}]}}\nJSON만.`,
      true
    );

    await kvSave("geomap:country-data:v3", {
      updates: countryUpdates,
      connections: connData,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      source: "cron-sonnet-web"
    });
    results.countries = Object.keys(countryUpdates).length;
    results.connections = Object.keys(connData).length;

    return res.status(200).json({ success: true, date: today, ...results });

  } catch (err) {
    return res.status(500).json({ error: err.message, partial: results });
  }
}
