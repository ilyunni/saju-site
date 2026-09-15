import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import Anthropic from "@anthropic-ai/sdk";
import { calculateSaju } from "ssaju";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  initDb,
  upsertUser,
  tryConsumeUsage,
  getRemainingUsage,
  hasRemainingUsage,
} from "./db.js";
import {
  verifyGoogleIdToken,
  createSessionToken,
  requireLogin,
  setSessionCookie,
  clearSessionCookie,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DAILY_FREE_LIMIT = Number(process.env.DAILY_FREE_LIMIT || 3);
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// 사주 해석가 페르소나 + 출력 형식 규칙 (시스템 프롬프트로 강하게 강제한다)
const SAJU_SYSTEM_PROMPT = [
  "너는 한국 전통 명리학(사주)을 쉽고 친절하게 설명해주는 상담가야.",
  "사용자가 사주 데이터(원국, 오행, 십성, 대운 등)를 줄 거야.",
  "반드시 아래 6개 마크다운 소제목만, 이 순서 그대로 사용해서 답변해: ## 총운, ## 타고난 성격, ## 연애운, ## 재물운, ## 건강운, ## 직업운.",
  "오늘의 운세, 이번 달 운세, 올해 운세, 일진, 대운 같은 '현재 시점' 분석은 하지 말고, 태어날 때 정해진 원국 자체를 바탕으로 평생 이어지는 성향과 경향을 설명해.",
  "한자나 전문 용어가 나오면 처음 나올 때 쉬운 말로 짧게 풀어서 설명해.",
  "말투는 친절하고 따뜻하게, 단정적이기보다는 참고할 만한 조언 톤으로 써.",
  "데이터에 없는 내용은 지어내지 말고, 전체 분량은 600자에서 1200자 사이로 써.",
].join(" ");

function buildUserMessage(compactSajuText, timeUnknown) {
  const timeNote = timeUnknown
    ? "\n\n(생시(태어난 시간)는 모른다고 했으니, 시주에 근거한 단정적인 해석은 피하고 참고용으로만 가볍게 언급해줘.)"
    : "";
  return `## 사주 데이터\n${compactSajuText}${timeNote}`;
}

async function interpretSaju(compactSajuText, timeUnknown) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000, // 한글은 토큰을 많이 잡아먹어서 문장이 잘리지 않도록 넉넉하게 잡음
    system: SAJU_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(compactSajuText, timeUnknown) }],
  });
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// ── 인증 라우트 ──────────────────────────────────────────

app.get("/api/config", (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || "" });
});

app.post("/auth/google", async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ error: "idToken이 필요합니다." });
  }
  try {
    const { googleSub, email } = await verifyGoogleIdToken(idToken);
    const user = await upsertUser({ googleSub, email });
    const token = createSessionToken(user.id);
    setSessionCookie(res, token);
    res.json({ email: user.email });
  } catch (err) {
    console.error("구글 로그인 실패:", err.message);
    res.status(401).json({ error: "구글 로그인에 실패했습니다." });
  }
});

app.post("/auth/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireLogin, async (req, res) => {
  const remaining = await getRemainingUsage(req.userId, DAILY_FREE_LIMIT);
  res.json({ userId: req.userId, remaining, dailyLimit: DAILY_FREE_LIMIT });
});

// ── 사주 라우트 ──────────────────────────────────────────

app.post("/api/saju", requireLogin, async (req, res) => {
  const { year, month, day, hour, minute, timeUnknown, gender, calendar, leap } =
    req.body || {};

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (!y || !m || !d) {
    return res.status(400).json({ error: "생년월일을 올바르게 입력해주세요." });
  }
  if (gender !== "남" && gender !== "여") {
    return res.status(400).json({ error: "성별을 선택해주세요." });
  }

  if (!(await hasRemainingUsage(req.userId, DAILY_FREE_LIMIT))) {
    return res.status(429).json({
      error: `오늘 무료 사용 횟수(${DAILY_FREE_LIMIT}회)를 다 쓰셨어요. 내일 다시 시도해주세요.`,
    });
  }

  const input = {
    year: y,
    month: m,
    day: d,
    gender,
    calendar: calendar === "lunar" ? "lunar" : "solar",
    leap: Boolean(leap),
  };
  if (!timeUnknown) {
    if (hour !== undefined && hour !== "") input.hour = Number(hour);
    if (minute !== undefined && minute !== "") input.minute = Number(minute);
  }

  let result;
  try {
    result = calculateSaju(input);
  } catch (err) {
    return res.status(400).json({ error: `사주 계산에 실패했습니다: ${err.message}` });
  }

  const markdown = result.toMarkdown();
  const compact = result.toCompact();

  try {
    const interpretation = await interpretSaju(compact, Boolean(timeUnknown));
    // AI 해석까지 성공했을 때만 무료 횟수를 차감한다.
    const usage = await tryConsumeUsage(req.userId, DAILY_FREE_LIMIT);
    res.json({
      markdown,
      interpretation,
      remaining: usage.remaining,
      dailyLimit: DAILY_FREE_LIMIT,
    });
  } catch (err) {
    console.error("AI 해석 실패:", err.message);
    const remaining = await getRemainingUsage(req.userId, DAILY_FREE_LIMIT);
    res.status(502).json({
      markdown,
      error: "AI 해석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      remaining,
      dailyLimit: DAILY_FREE_LIMIT,
    });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`사주풀이 서버 실행 중: http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("데이터베이스 초기화 실패:", err.message);
    process.exit(1);
  });
