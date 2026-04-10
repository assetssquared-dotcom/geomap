export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const CACHE_KEY = "geomap:country-data:v3";
  const CACHE_TTL = 86400;

  // KV 캐시 확인
  if (kvUrl && kvToken) {
    try {
      const kvRes = await fetch(`${kvUrl}/get/${CACHE_KEY}`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      const kvData = await kvRes.json();
      if (kvData.result) {
        res.setHeader("X-Cache", "HIT");
        return res.status(200).json(JSON.parse(kvData.result));
      }
    } catch (e) { console.warn("KV read:", e.message); }
  }

  const today = new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric" });

  async function callHaiku(prompt, maxTokens) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system: `자산제곱 지정학 분석 지도 데이터 AI. 오늘: ${today}. JSON만 출력. 절대 중간에 끊지 말고 완전한 JSON만.`,
        messages: [{ role:"user", content: prompt }]
      })
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const d = await r.json();
    const raw = d.content[0].text.trim().replace(/```json\n?|\n?```/g,"").trim();
    return JSON.parse(raw);
  }

  // 국가를 4개 배치로 나눠서 토큰 초과 방지
  const BATCHES = [
    ["us","cn","jp","kr","de","ru","in","sa"],
    ["tw","ir","au","br","cl","ua","ng","cd","kp"],
    ["gb","fr","tr","il","pk","vn","id","mx"],
    ["pl","za","eg","ar","ca","my","sg","ae","th"]
  ];

  const CONTEXT = {
    us:"Fed 3.5~3.75% 동결, 파월 5월 임기 만료, 이란 충돌, Section 301",
    cn:"PBoC 3.0% 동결, 부동산 침체, 미중 정상회담, 희토류 통제",
    jp:"BOJ 0.75%, 엔캐리 리스크, TSMC 구마모토, Section 301",
    kr:"BOK 금리, HBM 수율, Section 301, 반도체·배터리",
    de:"ECB 2.25%, 탈산업화, 러시아 가스 단절",
    ru:"금리 21%, 우크라 전쟁, 서방 제재",
    in:"RBI 금리, QUAD, 러시아 원유, PLI",
    sa:"SAMA 금리, 유가 110달러, 이란 위협",
    tw:"TSMC 2nm, 중국 통일 압박, 해협 훈련",
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

  const COUNTRY_PROMPT = (ids) =>
    `오늘(${today}) 아래 국가들 최신 데이터 JSON:\n${ids.map(id=>`${id}:${CONTEXT[id]||id}`).join("\n")}\n\n형식(모든 국가 포함, 완전한 JSON): {"국가ID":{"summary":"2문장","keywords":["k1","k2","k3","k4"],"rate":{"name":"중앙은행","val":"금리","trend":"hawk|dove|hold","trendLabel":"레이블","note":"1~2문장"},"policy":[{"text":"<b>정책</b> — 설명"},{"text":"<b>정책</b> — 설명"}],"watchlist":[{"icon":"📌","text":"<b>항목</b> — 설명"},{"icon":"📌","text":"<b>항목</b> — 설명"}],"risk":["r1","r2","r3"]}} JSON만.`;

  try {
    // 4배치 순차 실행 (병렬 시 rate limit 가능성)
    const results = {};
    for (const batch of BATCHES) {
      const data = await callHaiku(COUNTRY_PROMPT(batch), 2500);
      Object.assign(results, data);
    }

    // 연결선 업데이트
    const KEY_CONNECTIONS = ["us-cn","us-kr","us-jp","us-ir","us-sa","ru-ua","il-ir","pk-in"];
    const connData = await callHaiku(
      `오늘(${today}) 아래 국가 쌍 관계 요약 JSON:\n${KEY_CONNECTIONS.join(", ")}\n\n형식: {"from-to":{"note":"2문장","watch":"투자 시사점 1문장","keyItems":[{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"}]}} JSON만.`,
      1500
    );

    const payload = {
      updates: results,
      connections: connData,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: today,
      source: "claude-haiku"
    };

    // KV 저장
    if (kvUrl && kvToken) {
      try {
        await fetch(`${kvUrl}/set/${CACHE_KEY}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${kvToken}`, "Content-Type":"application/json" },
          body: JSON.stringify({ value: JSON.stringify(payload), ex: CACHE_TTL })
        });
      } catch (e) { console.warn("KV write:", e.message); }
    }

    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(payload);

  } catch (err) {
    console.error("country-updates error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
