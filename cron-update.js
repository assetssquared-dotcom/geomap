// cron-update.js — 매일 KST 09:00 자동 실행
// 인증 없이 누구나 호출 가능 (어차피 Claude만 호출됨)

export default async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY missing" });
  if (!kvUrl || !kvToken) return res.status(500).json({ error: "KV not configured" });

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric"
  });

  async function callHaiku(system, prompt, maxTokens) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}`);
    const d = await r.json();
    const raw = d.content[0].text.trim().replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(raw);
  }

  async function kvSet(key, value) {
    await fetch(`${kvUrl}/set/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(value), ex: 90000 })
    });
  }

  const SYS = `자산제곱 지정학 분석 지도 데이터 AI. 오늘: ${today}. 최신 지정학·경제 상황 반영. JSON만 출력.`;

  const CONTEXT = {
    us:"Fed 금리, 이란 충돌, 미중 무역전쟁, 트럼프 관세",
    cn:"PBoC 금리, 부동산 침체, 미중 정상회담, 희토류",
    jp:"BOJ 금리, 엔캐리 리스크, 반도체",
    kr:"BOK 금리, HBM 반도체, 관세 영향, 방산",
    de:"ECB 금리, 탈산업화, 에너지",
    ru:"금리, 우크라 전쟁, 제재",
    in:"RBI 금리, 성장률, 러시아 원유",
    sa:"SAMA 금리, 유가, 이란, 비전2030",
    tw:"TSMC, 중국 통일 압박",
    ir:"미국 충돌, 호르무즈, 핵협상",
    au:"RBA 금리, 철광석·LNG, AUKUS",
    br:"SELIC 금리, 대두·철광석",
    cl:"금리, 구리·리튬",
    ua:"전쟁, 트럼프 중재",
    ng:"금리, 나이라, LNG",
    cd:"코발트, 광물 협정",
    kp:"러시아 파병, 핵·미사일",
    gb:"BOE 금리, 미영 협정",
    fr:"ECB, 재정 적자",
    tr:"금리, S-400, 보스포루스",
    il:"BOI 금리, 가자 전쟁",
    pk:"SBP 금리, IMF, CPEC",
    vn:"금리, 삼성, 무역",
    id:"BI 금리, 니켈, EV",
    mx:"금리, USMCA, 트럼프",
    pl:"금리, 방위비, 방산",
    za:"SARB 금리, 팔라듐",
    eg:"CBE 금리, 수에즈",
    ar:"금리, 밀레이, 리튬",
    ca:"BOC 금리, 트럼프 관세",
    my:"BNM 금리, 반도체",
    sg:"MAS, 금융 허브",
    ae:"Fed 연동, 호르무즈",
    th:"BOT 금리, EV, 관광"
  };

  const BATCHES = [
    ["us","cn","jp","kr","de","ru","in","sa"],
    ["tw","ir","au","br","cl","ua","ng","cd","kp"],
    ["gb","fr","tr","il","pk","vn","id","mx"],
    ["pl","za","eg","ar","ca","my","sg","ae","th"]
  ];

  const FMT = `{"국가ID":{"summary":"2문장","keywords":["k1","k2","k3","k4"],"rate":{"name":"중앙은행","val":"금리","trend":"hawk|dove|hold","trendLabel":"기조","note":"1문장"},"policy":[{"text":"<b>정책</b> — 설명"},{"text":"<b>정책</b> — 설명"}],"watchlist":[{"icon":"📌","text":"<b>항목</b> — 설명"},{"icon":"📌","text":"<b>항목</b> — 설명"}],"risk":["r1","r2","r3"]}}`;

  try {
    // 1. 뉴스
    const dateStr = today.replace("년 ",".").replace("월 ",".").replace("일","");
    const newsItems = await callHaiku(SYS,
      `오늘(${today}) 투자자 필수 뉴스 8개 JSON:\n[{"date":"${dateStr}","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"20자 이내","body":"2~3문장","impact":"시사점 1문장"}]\nJSON만.`,
      1500
    );
    await kvSet("geomap:news:v1", {
      items: newsItems,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      nextUpdateKr: "내일 오전 9시",
      source: "cron"
    });

    // 2. 국가 4배치
    const results = {};
    for (const batch of BATCHES) {
      const prompt = `오늘(${today}) 아래 국가 최신 데이터 JSON:\n` +
        batch.map(id=>`${id}: ${CONTEXT[id]}`).join("\n") +
        `\n\n형식: ${FMT}\nJSON만.`;
      const data = await callHaiku(SYS, prompt, 2500);
      Object.assign(results, data);
    }

    // 3. 연결선
    const connData = await callHaiku(SYS,
      `오늘(${today}) 국가 쌍 관계 요약 JSON:\nus-cn,us-kr,us-jp,us-ir,us-sa,ru-ua,il-ir,pk-in\n형식: {"from-to":{"note":"2문장","watch":"시사점 1문장","keyItems":[{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"}]}}\nJSON만.`,
      1500
    );

    await kvSet("geomap:country-data:v3", {
      updates: results,
      connections: connData,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      source: "cron"
    });

    return res.status(200).json({
      success: true,
      date: today,
      news: newsItems.length,
      countries: Object.keys(results).length
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
