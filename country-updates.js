// api/country-updates.js
// 하루 1회 34개국의 동적 데이터(금리·정책·요약·watchlist 등) 재생성
// KV TTL 24시간 → 하루 1회 Claude 호출
// 비용: 1회 × ~6000 tokens × $0.0003/1K ≈ $0.002/일 (하루 3원)

import { kv } from "@vercel/kv";

const CACHE_KEY = "geomap:country-data:v1";
const CACHE_TTL = 86400; // 24시간

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ── 1. KV 캐시 확인 ──
  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "public, s-maxage=3600");
      return res.status(200).json(cached);
    }
  } catch (kvErr) {
    console.warn("KV read failed:", kvErr.message);
  }

  // ── 2. Claude Haiku 호출 (하루 1회) ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric",
  });

  // 34개국을 두 번에 나눠서 호출 (토큰 초과 방지)
  const BATCH1 = ["us","cn","jp","kr","de","ru","in","sa","tw","ir","au","br","cl","ua","ng","cd","kp"];
  const BATCH2 = ["gb","fr","tr","il","pk","vn","id","mx","pl","za","eg","ar","ca","my","sg","ae","th"];

  const CONTEXT = {
    us:"Fed 3.5~3.75% 동결, 파월 5월 임기 만료, 이란 군사 충돌, Section 301 조사",
    cn:"PBoC LPR 3.0% 동결, 부동산 침체, 미중 5월 정상회담, 희토류 수출 통제",
    jp:"BOJ 0.75% 인상 기조, 엔캐리 청산 리스크, TSMC 구마모토 가동, Section 301 대상",
    kr:"BOK 금리, 삼성 HBM 수율, Section 301 대상, 반도체·배터리 수출",
    de:"ECB 2.25% 사실상 동결 완료, 탈산업화, 러시아 가스 단절, 자동차 전동화 비용",
    ru:"금리 21% 전시경제, 루블 불안, 우크라 전쟁 지속, 서방 제재",
    in:"RBI 금리, QUAD 참여, 러시아 원유 구매, 반도체 PLI 투자",
    sa:"SAMA 금리, 유가 110달러 재정 흑자, 이란 위협, 비전2030",
    tw:"TSMC 2nm 양산, 중국 통일 압박, 대만 해협 훈련, 반도체 공급망",
    ir:"미국과 군사 충돌, 호르무즈 봉쇄, 리알 폭락, 원유 수출 제한",
    au:"RBA 금리, 철광석·LNG, AUKUS 핵잠수함, 중국 보복 관세 해제",
    br:"SELIC 금리, 룰라 재정 확대, 대두·철광석 중국 수출, 헤알 약세",
    cl:"BCCh 금리, 구리·리튬 가격, 미국 광물 파트너십, Codelco",
    ua:"전쟁 3년차, 트럼프 중재, 재건 기금, 모스크바 사정권 미사일",
    ng:"CBN 금리, 나이라 절하, 호르무즈 대안 LNG 수혜, 나이지리아 송유관",
    cd:"코발트 공급, 미-DRC 광물 협정, 중국 채굴 독점, 내전",
    kp:"러시아 파병, 핵·ICBM 고도화, 중국 생명선, 한반도 긴장",
    gb:"BOE 4.5% 인하 사이클, 미영 무역협정, AUKUS, 파운드 약세",
    fr:"ECB 연동, 재정 적자 GDP 6%, 방산 수출, 아프리카 사헬 철수",
    tr:"TCMB 42.5% 인하 중, 리라 약세, S-400, 보스포루스 중재",
    il:"BOI 4.5% 전시 동결, 가자 전쟁, 이란 대결, 세켈 약세",
    pk:"SBP 12% 인하 중, IMF 구제금융, CPEC 채무, 인도 핵 대치",
    vn:"SBV 4.5% 완화, 삼성 최대 생산기지, Section 301, 희토류 2위",
    id:"BI 5.75% 동결, 니켈 가격 폭락, 루피아 약세, BYD 공장",
    mx:"Banxico 9% 인하 중, USMCA, 트럼프 관세 위협, 테슬라 기가팩토리",
    pl:"NBP 5.75% 동결, 방위비 GDP 4%, K2·K9 한국 방산, 우크라 재건",
    za:"SARB 7.5% 인하 중, 팔라듐·백금, 로드쉐딩, ICJ 이스라엘 제소",
    eg:"CBE 27.25% 인하 중, 수에즈 수입 감소, IMF 구제금융, 가자 중재",
    ar:"BCRA 35% 인하 중, 밀레이 개혁, 인플레 88%, 리튬 개방",
    ca:"BOC 2.75% 동결, 트럼프 관세 위협, 오일샌드, USMCA",
    my:"BNM 3.0% 동결, 반도체 패키징, 링깃, AI 칩 수요",
    sg:"MAS 환율 밴드 중립, 가족오피스 허브, 중국 자본 유입, 말라카",
    ae:"Fed 연동 5.15%, 호르무즈 피격, 아브라함 협정, 두바이 물류",
    th:"BOT 2.25% 인하, BYD 공장, 관광 회복, 쿠데타 리스크"
  };

  async function generateBatch(ids) {
    const countryList = ids.map(id => `${id}: ${CONTEXT[id]||id}`).join("\n");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        system: `자산제곱 지정학 분석 지도 국가 데이터 업데이트 AI. 오늘: ${today}.
각 국가의 최신 상황을 반영한 데이터를 생성하세요.
JSON만 출력. 마크다운, 설명 텍스트 없이.`,
        messages: [{
          role: "user",
          content: `오늘(${today}) 기준 아래 국가들의 최신 데이터를 JSON으로만 생성하세요.

국가별 현재 상황:
${countryList}

각 국가마다 아래 필드를 업데이트하세요:
{
  "국가ID": {
    "summary": "2~3문장 핵심 현황 요약 (최신 상황 반영)",
    "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5", "키워드6"],
    "geo": ["지정학 이슈1", "지정학 이슈2", "지정학 이슈3", "지정학 이슈4"],
    "rate": {
      "name": "중앙은행 이름",
      "val": "현재 금리",
      "trend": "hawk|dove|hold",
      "trendLabel": "인상 기조|인하 기조|동결",
      "note": "금리 결정 배경 및 전망 2~3문장"
    },
    "policy": [
      {"text": "<b>정책명</b> — 설명"},
      {"text": "<b>정책명</b> — 설명"},
      {"text": "<b>정책명</b> — 설명"}
    ],
    "watchlist": [
      {"icon": "📌", "text": "<b>이벤트명</b> — 투자 시사점"},
      {"icon": "📌", "text": "<b>이벤트명</b> — 투자 시사점"},
      {"icon": "📌", "text": "<b>이벤트명</b> — 투자 시사점"}
    ],
    "risk": ["리스크1", "리스크2", "리스크3", "리스크4"]
  }
}

JSON만 출력.`,
        }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
    const data = await response.json();
    const raw = data.content[0].text.trim();
    const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(clean);
  }

  try {
    // 두 배치로 나눠 호출
    const [batch1Data, batch2Data] = await Promise.all([
      generateBatch(BATCH1),
      generateBatch(BATCH2),
    ]);

    const allUpdates = { ...batch1Data, ...batch2Data };

    const payload = {
      updates: allUpdates,
      fetchedAt: new Date().toISOString(),
      fetchedAtKr: today,
      source: "claude-haiku",
    };

    // KV에 24시간 저장
    try {
      await kv.set(CACHE_KEY, payload, { ex: CACHE_TTL });
    } catch (kvErr) {
      console.warn("KV write failed:", kvErr.message);
    }

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Cache-Control", "public, s-maxage=3600");
    return res.status(200).json(payload);

  } catch (err) {
    console.error("Country updates failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
