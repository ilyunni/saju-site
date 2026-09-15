// 구글 로그인 검증 + 세션 쿠키(JWT) 발급/검증을 담당하는 작은 모듈.
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 프론트엔드에서 받은 구글 ID 토큰이 진짜인지 확인하고, 사용자 정보를 꺼낸다.
export async function verifyGoogleIdToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return {
    googleSub: payload.sub,
    email: payload.email,
    name: payload.name,
  };
}

// 로그인 성공 후, "이 사람은 로그인된 상태"임을 증명하는 서명된 토큰을 만든다.
export function createSessionToken(userId) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET 환경변수가 설정되어 있지 않습니다.");
  }
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

// Express 미들웨어: 쿠키의 세션 토큰을 확인해서 req.userId를 채운다.
// 로그인 안 되어 있으면 401을 응답한다.
export function requireLogin(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "로그인이 만료되었습니다. 다시 로그인해주세요." });
  }
}

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30일
};

export function setSessionCookie(res, token) {
  res.cookie("session", token, SESSION_COOKIE_OPTIONS);
}

export function clearSessionCookie(res) {
  res.clearCookie("session");
}
