// cron-update.js
// Vercel Cron이 매일 UTC 00:00 (KST 09:00)에 자동 호출
// 방문자는 절대 이 엔드포인트를 호출할 수 없음

export default async function handler(req, res) {

  // Vercel Cron 자동 호출 검증 — 이 헤더는 Vercel 시스템만 보낼 수 있음
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers["authorization"];
  const isManual = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isVercelCron && !isManual) {
    return res.status(401).json({ error: "Unauthorized - Vercel Cron only" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!apiKey || !kvUrl || !kvToken) {
    return res.status(500).json({ error: "Missing env vars" });
  }

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
    const r = await fetch(`${kvUrl}/set/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ value: JSON.stringify(value), ex: 90000 }) // 25시간
    });
    if (!r.ok) throw new Error(`KV set failed: ${r.status}`);
  }

  const SYS = `자산제곱 지정학 분석 지도 데이터 AI. 오늘: ${today}. 배경: 이란-미국 충돌·호르무즈 봉쇄·유가 110달러, 미중 Section 301, 우크라 전쟁 3년차, Fed 동결. JSON만 출력. 절대 중간에 끊지 말 것.`;

  const CONTEXT = {
    us:"Fed 3.5~3.75% 동결, 파월 5월 임기 만료, 이란 충돌, Section 301",
    cn:"PBoC 3.0% 동결, 부동산 침체, 미중 정상회담, 희토류 통제",
    jp:"BOJ 0.75%, 엔캐리 리스크, TSMC 구마모토",
    kr:"BOK 금리, HBM 수율, Section 301, 반도체·배터리",
    de:"ECB 2.25%, 탈산업화, 러시아 가스 단절",
    ru:"금리 21%, 우크라 전쟁, 서방 제재",
    in:"RBI 금리, QUAD, 러시아 원유",
    sa:"SAMA 금리, 유가 110달러, 이란 위협",
    tw:"TSMC 2nm, 중국 통일 압박",
    ir:"미국 충돌, 호르무즈 봉쇄, 리알 폭락",
    au:"RBA 금리, 철광석·LNG, AUKUS",
    br:"SELIC 금리, 룰라, 대두·철광석",
    cl:"BCCh 금리, 구리·리튬",
    ua:"전쟁 3년차, 트럼프 중재",
    ng:"CBN 금리, 나이라 절하",
    cd:"코발트, 미-DRC 협정",
    kp:"러시아 파병, 핵·ICBM",
    gb:"BOE 4.5%, AUKUS",
    fr:"ECB, 재정 적자 6%",
    tr:"TCMB 42.5% 인하, S-400",
    il:"BOI 4.5%, 가자 전쟁",
    pk:"SBP 12% 인하, IMF",
    vn:"SBV 4.5%, 삼성, Section 301",
    id:"BI 5.75%, 니켈 폭락",
    mx:"Banxico 9% 인하, USMCA",
    pl:"NBP 5.75%, 방위비 4%",
    za:"SARB 7.5% 인하, 팔라듐",
    eg:"CBE 27.25% 인하, 수에즈",
    ar:"BCRA 35% 인하, 밀레이",
    ca:"BOC 2.75%, 트럼프 관세",
    my:"BNM 3.0%, 반도체 패키징",
    sg:"MAS 중립, 가족오피스",
    ae:"Fed 연동 5.15%, 호르무즈",
    th:"BOT 2.25%, BYD, 관광"
  };

  // 국가를 4개 소배치로 나눔 (토큰 초과 방지)
  const BATCHES = [
    ["us","cn","jp","kr","de","ru","in","sa"],
    ["tw","ir","au","br","cl","ua","ng","cd","kp"],
    ["gb","fr","tr","il","pk","vn","id","mx"],
    ["pl","za","eg","ar","ca","my","sg","ae","th"]
  ];

  const COUNTRY_PROMPT = (ids) =>
    `오늘(${today}) 아래 국가들 최신 데이터 JSON (모든 국가 빠짐없이 완전한 JSON 출력):\n` +
    ids.map(id => `${id}: ${CONTEXT[id]||id}`).join("\n") +
    `\n\n형식:\n{"국가ID":{"summary":"2문장","keywords":["k1","k2","k3","k4"],"rate":{"name":"중앙은행명","val":"현재금리","trend":"hawk|dove|hold","trendLabel":"인상기조|인하기조|동결","note":"1~2문장"},"policy":[{"text":"<b>정책명</b> — 설명"},{"text":"<b>정책명</b> — 설명"}],"watchlist":[{"icon":"📌","text":"<b>항목</b> — 설명"},{"icon":"📌","text":"<b>항목</b> — 설명"}],"risk":["r1","r2","r3"]}}\nJSON만.`;

  try {
    console.log(`[Cron] ${today} 업데이트 시작`);
    const results = {};

    // 국가 4배치 순차 처리
    for (let i = 0; i < BATCHES.length; i++) {
      const batch = BATCHES[i];
      console.log(`[Cron] 배치 ${i+1}/4: ${batch.join(",")}`);
      const data = await callHaiku(SYS, COUNTRY_PROMPT(batch), 2500);
      Object.assign(results, data);
    }

    // 뉴스 생성
    console.log(`[Cron] 뉴스 생성`);
    const newsItems = await callHaiku(
      SYS,
      `오늘(${today}) 투자자 필수 지정학·경제 뉴스 8개 JSON:\n[{"date":"YYYY.MM.DD","category":"지정학|전쟁|무역|에너지|금리|외교|자원","title":"20자 이내","body":"2~3문장","impact":"투자 시사점 1문장"}]\nJSON만.`,
      1200
    );

    // 주요 연결선 관계 생성
    console.log(`[Cron] 연결선 업데이트`);
    const KEY_CONNECTIONS = ["us-cn","us-kr","us-jp","us-ir","us-sa","ru-ua","il-ir","pk-in"];
    const connData = await callHaiku(
      SYS,
      `오늘(${today}) 아래 국가 쌍 관계 요약 JSON:\n${KEY_CONNECTIONS.join(", ")}\n형식: {"from-to":{"note":"2문장","watch":"투자 시사점 1문장","keyItems":[{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"}]}}\nJSON만.`,
      1500
    );

    const now = new Date();

    // KV 저장 (25시간 — 다음 cron 실행 전까지 유지)
    await kvSet("geomap:country-data:v3", {
      updates: results,
      connections: connData,
      fetchedAt: now.toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      source: "cron"
    });

    await kvSet("geomap:news:v1", {
      items: newsItems,
      fetchedAt: now.toISOString(),
      fetchedAtKr: `${today} 오전 9시`,
      nextUpdateKr: "내일 오전 9시",
      source: "cron"
    });

    console.log(`[Cron] 완료 — 국가 ${Object.keys(results).length}개, 뉴스 ${newsItems.length}개`);

    return res.status(200).json({
      success: true,
      date: today,
      countries: Object.keys(results).length,
      news: newsItems.length,
      connections: Object.keys(connData).length
    });

  } catch (err) {
    console.error("[Cron] 실패:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
