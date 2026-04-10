import { Redis } from "@upstash/redis";

const CACHE_KEY = "geomap:country-data:v2";
const CACHE_TTL = 86400;

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const BATCH1 = ["us","cn","jp","kr","de","ru","in","sa","tw","ir","au","br","cl","ua","ng","cd","kp"];
const BATCH2 = ["gb","fr","tr","il","pk","vn","id","mx","pl","za","eg","ar","ca","my","sg","ae","th"];
const KEY_CONNECTIONS = ["us-cn","us-kr","us-jp","us-ir","us-sa","us-tw","us-ru","cn-ru","cn-tw","cn-in","cn-kr","cn-sa","ru-ua","il-ir","pk-in","pk-cn","tr-ru","ae-ir"];
const CONTEXT = {
  us:"Fed 3.5~3.75% 동결, 파월 5월 임기 만료, 이란 군사 충돌, Section 301",
  cn:"PBoC LPR 3.0% 동결, 부동산 침체, 미중 5월 정상회담, 희토류 수출 통제",
  jp:"BOJ 0.75% 인상 기조, 엔캐리 리스크, TSMC 구마모토, Section 301",
  kr:"BOK 금리, 삼성 HBM, Section 301, 반도체·배터리",
  de:"ECB 2.25%, 탈산업화, 러시아 가스 단절",
  ru:"금리 21% 전시경제, 우크라 전쟁, 서방 제재",
  in:"RBI 금리, QUAD, 러시아 원유, 반도체 PLI",
  sa:"SAMA 금리, 유가 110달러, 이란 위협, 비전2030",
  tw:"TSMC 2nm, 중국 통일 압박, 대만 해협",
  ir:"미국 군사 충돌, 호르무즈 봉쇄, 리알 폭락",
  au:"RBA 금리, 철광석·LNG, AUKUS",
  br:"SELIC 금리, 룰라, 대두·철광석",
  cl:"BCCh 금리, 구리·리튬, 미국 광물 파트너십",
  ua:"전쟁 3년차, 트럼프 중재, 재건 기금",
  ng:"CBN 금리, 나이라 절하, LNG 수혜",
  cd:"코발트, 미-DRC 협정, 내전",
  kp:"러시아 파병, 핵·ICBM",
  gb:"BOE 4.5%, 미영 무역협정, AUKUS",
  fr:"ECB, 재정 적자 6%, 사헬 철수",
  tr:"TCMB 42.5% 인하, S-400, 보스포루스",
  il:"BOI 4.5%, 가자 전쟁, 이란 대결",
  pk:"SBP 12% 인하, IMF, CPEC",
  vn:"SBV 4.5%, 삼성, Section 301",
  id:"BI 5.75%, 니켈 폭락, BYD",
  mx:"Banxico 9% 인하, USMCA, 트럼프 관세",
  pl:"NBP 5.75%, 방위비 4%, 한국 방산",
  za:"SARB 7.5% 인하, 팔라듐·백금, ICJ",
  eg:"CBE 27.25% 인하, 수에즈, IMF",
  ar:"BCRA 35% 인하, 밀레이, 리튬",
  ca:"BOC 2.75%, 트럼프 관세, USMCA",
  my:"BNM 3.0%, 반도체 패키징",
  sg:"MAS 중립, 가족오피스, 중국 자본",
  ae:"Fed 연동 5.15%, 호르무즈, 아브라함",
  th:"BOT 2.25%, BYD, 관광"
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.status(200).json(cached);
    }
  } catch (e) { console.warn("KV read:", e.message); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const today = new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric" });
  const SYS = `자산제곱 지정학 분석 지도 데이터 AI. 오늘: ${today}. 배경: 이란-미국 충돌·호르무즈 봉쇄·유가 110달러, 미중 Section 301, 우크라 전쟁 3년차, Fed 동결. JSON만 출력.`;

  async function callHaiku(prompt, maxTokens=4000) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01"},
      body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:maxTokens, system:SYS, messages:[{role:"user",content:prompt}] })
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const d = await r.json();
    return JSON.parse(d.content[0].text.trim().replace(/```json\n?|\n?```/g,"").trim());
  }

  const COUNTRY_PROMPT = (ids) =>
    `오늘(${today}) 기준 아래 국가들 최신 데이터를 JSON으로:\n${ids.map(id=>`${id}:${CONTEXT[id]}`).join("\n")}\n\n형식: {"국가ID":{"summary":"2~3문장","keywords":["k1","k2","k3","k4","k5","k6"],"geo":["g1","g2","g3","g4"],"rate":{"name":"중앙은행","val":"금리","trend":"hawk|dove|hold","trendLabel":"레이블","note":"2~3문장"},"policy":[{"text":"<b>정책</b> — 설명"},{"text":"..."},{"text":"..."}],"watchlist":[{"icon":"📌","text":"<b>항목</b> — 설명"},{"icon":"📌","text":"..."},{"icon":"📌","text":"..."}],"risk":["r1","r2","r3","r4"]}} JSON만.`;

  const CONN_PROMPT =
    `오늘(${today}) 기준 아래 국가 쌍의 관계 요약 JSON으로:\n${KEY_CONNECTIONS.join(", ")}\n\n형식: {"from-to":{"note":"관계 현황 2~3문장","watch":"투자 시사점 1문장","keyItems":[{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"}]}} JSON만.`;

  try {
    const [b1, b2, connData] = await Promise.all([
      callHaiku(COUNTRY_PROMPT(BATCH1)),
      callHaiku(COUNTRY_PROMPT(BATCH2)),
      callHaiku(CONN_PROMPT, 2500)
    ]);

    const payload = {
      updates: { ...b1, ...b2 },
      connections: connData,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: today,
      source: "claude-haiku"
    };

    try { await redis.set(CACHE_KEY, payload, { ex: CACHE_TTL }); }
    catch (e) { console.warn("KV write:", e.message); }

    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(payload);

  } catch (err) {
    console.error("Updates failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
