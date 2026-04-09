// api/country-updates.js
// 하루 1회: 34개국 동적 데이터 + 주요 연결선 관계 요약 재생성
// KV TTL 24시간

import { kv } from "@vercel/kv";

const CACHE_KEY = "geomap:country-data:v2";
const CACHE_TTL = 86400;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "public, s-maxage=3600");
      return res.status(200).json(cached);
    }
  } catch (e) { console.warn("KV read:", e.message); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not set" });

  const today = new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric" });

  const BATCH1 = ["us","cn","jp","kr","de","ru","in","sa","tw","ir","au","br","cl","ua","ng","cd","kp"];
  const BATCH2 = ["gb","fr","tr","il","pk","vn","id","mx","pl","za","eg","ar","ca","my","sg","ae","th"];

  const CONTEXT = {
    us:"Fed 3.5~3.75% 동결, 파월 5월 임기 만료, 이란 군사 충돌, Section 301 조사",
    cn:"PBoC LPR 3.0% 동결, 부동산 침체, 미중 5월 정상회담, 희토류 수출 통제",
    jp:"BOJ 0.75% 인상 기조, 엔캐리 청산 리스크, TSMC 구마모토 가동, Section 301 대상",
    kr:"BOK 금리, 삼성 HBM 수율, Section 301 대상, 반도체·배터리 수출",
    de:"ECB 2.25% 사실상 인하 완료, 탈산업화, 러시아 가스 단절, 자동차 전동화",
    ru:"금리 21% 전시경제, 루블 불안, 우크라 전쟁 지속, 서방 제재",
    in:"RBI 금리, QUAD 참여, 러시아 원유 구매, 반도체 PLI 투자",
    sa:"SAMA 금리, 유가 110달러 재정 흑자, 이란 위협, 비전2030",
    tw:"TSMC 2nm 양산, 중국 통일 압박, 대만 해협 훈련",
    ir:"미국과 군사 충돌, 호르무즈 봉쇄, 리알 폭락",
    au:"RBA 금리, 철광석·LNG, AUKUS 핵잠수함",
    br:"SELIC 금리, 룰라 재정 확대, 대두·철광석 수출",
    cl:"BCCh 금리, 구리·리튬 가격, 미국 광물 파트너십",
    ua:"전쟁 3년차, 트럼프 중재, 재건 기금",
    ng:"CBN 금리, 나이라 절하, LNG 수혜",
    cd:"코발트 공급, 미-DRC 광물 협정, 내전",
    kp:"러시아 파병, 핵·ICBM 고도화",
    gb:"BOE 4.5% 인하, 미영 무역협정, AUKUS",
    fr:"ECB 연동, 재정 적자 GDP 6%, 사헬 철수",
    tr:"TCMB 42.5% 인하, S-400, 보스포루스 중재",
    il:"BOI 4.5% 동결, 가자 전쟁, 이란 대결",
    pk:"SBP 12% 인하, IMF 구제금융, CPEC 채무",
    vn:"SBV 4.5%, 삼성 최대 생산기지, Section 301",
    id:"BI 5.75%, 니켈 가격 폭락, BYD 공장",
    mx:"Banxico 9% 인하, USMCA, 트럼프 관세",
    pl:"NBP 5.75%, 방위비 GDP 4%, 한국 방산",
    za:"SARB 7.5% 인하, 팔라듐·백금, ICJ 이스라엘 제소",
    eg:"CBE 27.25% 인하, 수에즈 수입 감소, IMF",
    ar:"BCRA 35% 인하, 밀레이 개혁, 리튬 개방",
    ca:"BOC 2.75%, 트럼프 관세, USMCA",
    my:"BNM 3.0%, 반도체 패키징, AI 칩 수요",
    sg:"MAS 중립, 가족오피스 허브, 중국 자본",
    ae:"Fed 연동 5.15%, 호르무즈 위기, 아브라함 협정",
    th:"BOT 2.25%, BYD 공장, 관광 회복"
  };

  // 주요 연결선 (note·watch·keyItems 업데이트 대상)
  const KEY_CONNECTIONS = [
    "us-cn","us-kr","us-jp","us-ir","us-sa","us-tw","us-ru",
    "cn-ru","cn-tw","cn-in","cn-kr","cn-sa",
    "ru-ua","il-ir","pk-in","pk-cn","tr-ru","ae-ir"
  ];

  async function callHaiku(prompt, system, maxTokens=3500) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01"},
      body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:maxTokens, system, messages:[{role:"user",content:prompt}] })
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const d = await r.json();
    const raw = d.content[0].text.trim();
    return JSON.parse(raw.replace(/```json\n?|\n?```/g,"").trim());
  }

  try {
    const SYS = `자산제곱 지정학 분석 지도 데이터 생성 AI. 오늘: ${today}. 배경: 이란-미국 충돌·호르무즈 봉쇄·유가 110달러, 미중 Section 301, 우크라 전쟁 3년차, Fed 동결. JSON만 출력.`;

    // 3개 배치 병렬 실행
    const [b1, b2, connData] = await Promise.all([
      // 국가 배치 1
      callHaiku(
        `오늘(${today}) 기준 아래 국가들 최신 데이터를 JSON으로:\n${BATCH1.map(id=>`${id}:${CONTEXT[id]}`).join("\n")}\n\n각 국가: {"국가ID":{"summary":"2~3문장","keywords":["k1","k2","k3","k4","k5","k6"],"geo":["g1","g2","g3","g4"],"rate":{"name":"중앙은행","val":"금리","trend":"hawk|dove|hold","trendLabel":"레이블","note":"2~3문장"},"policy":[{"text":"<b>정책</b> — 설명"},{"text":"..."},{"text":"..."}],"watchlist":[{"icon":"📌","text":"<b>항목</b> — 설명"},{"icon":"📌","text":"..."},{"icon":"📌","text":"..."}],"risk":["r1","r2","r3","r4"]}} JSON만.`,
        SYS, 4000
      ),
      // 국가 배치 2
      callHaiku(
        `오늘(${today}) 기준 아래 국가들 최신 데이터를 JSON으로:\n${BATCH2.map(id=>`${id}:${CONTEXT[id]}`).join("\n")}\n\n각 국가: {"국가ID":{"summary":"2~3문장","keywords":["k1","k2","k3","k4","k5","k6"],"geo":["g1","g2","g3","g4"],"rate":{"name":"중앙은행","val":"금리","trend":"hawk|dove|hold","trendLabel":"레이블","note":"2~3문장"},"policy":[{"text":"<b>정책</b> — 설명"},{"text":"..."},{"text":"..."}],"watchlist":[{"icon":"📌","text":"<b>항목</b> — 설명"},{"icon":"📌","text":"..."},{"icon":"📌","text":"..."}],"risk":["r1","r2","r3","r4"]}} JSON만.`,
        SYS, 4000
      ),
      // 연결선 관계 업데이트
      callHaiku(
        `오늘(${today}) 기준 아래 국가 쌍의 관계 요약을 JSON으로:\n${KEY_CONNECTIONS.join(", ")}\n\n형식: {"from-to":{"note":"관계 현황 2~3문장","watch":"투자 시사점 1문장 (→ 연결)","keyItems":[{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"},{"l":"항목","v":"설명"}]}} JSON만.`,
        SYS, 2500
      )
    ]);

    const payload = {
      updates: { ...b1, ...b2 },
      connections: connData,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: today,
      source: "claude-haiku",
    };

    try { await kv.set(CACHE_KEY, payload, { ex: CACHE_TTL }); }
    catch (e) { console.warn("KV write:", e.message); }

    res.setHeader("X-Cache","MISS");
    res.setHeader("Cache-Control","public, s-maxage=3600");
    return res.status(200).json(payload);

  } catch (err) {
    console.error("Updates failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
