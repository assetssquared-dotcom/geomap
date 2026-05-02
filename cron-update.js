// cron-update.js — 매일 KST 09:00 자동 실행
// Vercel Cron 전용 + CRON_SECRET으로 수동 실행 가능

export default async function handler(req, res) {
  // Vercel Cron 자동 호출 OR 수동 실행 허용
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  const secret = process.env.CRON_SECRET;
  const auth = req.headers["authorization"];
  const isManual = secret && auth === `Bearer ${secret}`;

  if (!isVercelCron && !isManual) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
    const d = await r.json();
    const raw = d.content[0].text.trim().replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(raw);
  }

  async function kvSet(key, value) {
    const r = await fetch(`${kvUrl}/set/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ value: JSON.stringify(value), ex: 90000 })
    });
    if (!r.ok) throw new Error(`KV set failed: ${r.status}`);
  }

  const SYS = `자산제곱 지정학 분석 지도 데이터 AI. 오늘: ${today}. 최신 지정학·경제 상황 반영. JSON만 출력. 절대 중간에 끊지 말 것.`;

  const CONTEXT = {
    us:"Fed 금리, 이란 충돌, 미중 무역전쟁, 트럼프 관세",
    cn:"PBoC 금리, 부동산 침체, 미중 정상회담, 희토류",
    jp:"BOJ 금리, 엔캐리 리스크, TSMC 구마모토",
    kr:"BOK 금리, HBM 반도체, 관세 영향, 방산 수출",
    de:"ECB 금리, 탈산업화, 에너지 비용",
    ru:"금리, 우크라 전쟁, 서방 제재",
    in:"RBI 금리, 성장률, 러시아 원유",
    sa:"SAMA 금리, 유가, 이란 위협, 비전2030",
    tw:"TSMC, 중국 통일 압박, 반도체",
    ir:"미국 충돌, 호르무즈, 핵협상",
    au:"RBA 금리, 철광석·LNG, AUKUS",
    br:"SELIC 금리, 대두·철광석, 헤알",
    cl:"금리, 구리·리튬, 광물 파트너십",
    ua:"전쟁, 트럼프 중재, 재건",
    ng:"금리, 나이라, LNG",
    cd:"코발트, 광물 협정, 내전",
    kp:"러시아 파병, 핵·미사일",
    gb:"BOE 금리, 미영 협정, AUKUS",
    fr:"ECB, 재정 적자, 방산",
    tr:"금리, S-400, 보스포루스",
    il:"BOI 금리, 가자 전쟁, 이란",
    pk:"SBP 금리, IMF, CPEC",
    vn:"금리, 삼성 생산, 무역",
    id:"BI 금리, 니켈, EV",
    mx:"금리, USMCA, 트럼프 관세",
    pl:"금리, 방위비, 한국 방산",
    za:"SARB 금리, 팔라듐·백금",
    eg:"CBE 금리, 수에즈, IMF",
    ar:"금리, 밀레이 개혁, 리튬",
    ca:"BOC 금리, 트럼프 관세, 자원",
    my:"BNM 금리, 반도체 패키징",
    sg:"MAS, 금융 허브",
    ae:"Fed 연동, 호르무즈, 두바이",
    th:"BOT 금리, EV, 관광"
  };

  const BATCHES = [
    ["us","cn","jp","kr","de","ru","in","sa"],
    ["tw","ir","au","br","cl","ua","ng","cd","kp"],
    ["gb","fr","tr","il","pk","vn","id","mx"],
    ["pl","za","eg","ar","ca","my","sg","ae","th"]
  ];

  const COUNTRY_PROMPT = (ids) =>
    `오늘(${today}) 아래 국가 최신 데이터를 완전한 JSON으로 (절대 중간에 끊지 말 것):\n` +
    ids.map(id => `${id}: ${CONTEXT[id]}`).join("\n") +
    `\n\n형식: {"국가ID":{"summary":"2문장","keywords":["k1","k2","k3","k4"],"rate":{"name":"중앙은행","val":"금리","trend":"hawk|dove|hold","trendLabel":"기조","note":"1~2문장"},"policy":[{"text":"<b>정책</b> — 설명"},{"text":"<b>정책</b> — 설명"}],"watchlist":[{"icon":"📌","text":"<b>항목</b> — 설명"},{"icon":"📌","text":"<b>항목</b> — 설명"}],"risk":["r1","r2","r3"]}} JSON만.`;

  try {
    const log = [];

    // 1. 뉴스 먼저 (가장 중요)
    log.push("뉴스 생성 시작");
    const newsItems = await callHaiku(
      SYS,
      `오늘(${today}) 투자자 필수 지정학·경제 뉴스 8개 JSON:\n[{"date":"${today.replace(/년 /,'.').replace(/월 /,'.').replace('일','')}","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"20자 이내 제목","body":"2~3문장 핵심","impact":"투자 시사점 1문장"}]\nJSON만.`,
      1500
    );
    await kvSet("geomap:news:v1", {
      items: newsItems,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      nextUpdateKr: "내일 오전 9시",
      source: "cron"
    });
    log.push(`뉴스 ${newsItems.length}개 저장 완료`);

    // 2. 국가 데이터 (4배치 순차)
    const results = {};
    for (let i = 0; i < BATCHES.length; i++) {
      const batch = BATCHES[i];
      log.push(`국가 배치 ${i+1}/4 시작: ${batch.join(",")}`);
      const data = await callHaiku(SYS, COUNTRY_PROMPT(batch), 2500);
      Object.assign(results, data);
      log.push(`배치 ${i+1} 완료: ${Object.keys(data).length}개국`);
    }

    // 3. 연결선
    log.push("연결선 업데이트 시작");
    const KEY_CONNECTIONS = ["us-cn","us-kr","us-jp","us-ir","us-sa","ru-ua","il-ir","pk-in"];
    const connData = await callHaiku(
      SYS,
      `오늘(${today}) 아래 국가 쌍 관계 요약 JSON:\n${KEY_CONNECTIONS.join(", ")}\n형식: {"from-to":{"note":"2문장","watch":"투자 시사점 1문장","keyItems":[{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"}]}}\nJSON만.`,
      1500
    );

    await kvSet("geomap:country-data:v3", {
      updates: results,
      connections: connData,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      source: "cron"
    });
    log.push(`국가 ${Object.keys(results).length}개 + 연결선 저장 완료`);

    return res.status(200).json({
      success: true,
      date: today,
      news: newsItems.length,
      countries: Object.keys(results).length,
      connections: Object.keys(connData).length,
      log
    });

  } catch (err) {
    console.error("[Cron] 실패:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
