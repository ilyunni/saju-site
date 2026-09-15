// 회원 정보 + 무료 사용 횟수를 저장하는 아주 작은 데이터베이스 계층.
// 개인정보 최소화 원칙: 사주 계산에 쓰인 생년월일/성별 등은 절대 저장하지 않는다.
// (계정 식별에 필요한 최소 정보 - 구글 고유 ID, 이메일 - 만 저장)
import pg from "pg";

const { Pool } = pg;

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL 환경변수가 설정되어 있지 않습니다. .env 파일을 확인해주세요."
      );
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function initDb() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// 구글 로그인 성공 시 호출: 있으면 그대로, 없으면 새로 생성.
export async function upsertUser({ googleSub, email }) {
  const { rows } = await getPool().query(
    `INSERT INTO users (google_sub, email)
     VALUES ($1, $2)
     ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, google_sub, email, usage_count, usage_date`,
    [googleSub, email]
  );
  return rows[0];
}

export async function getUserById(id) {
  const { rows } = await getPool().query(
    `SELECT id, google_sub, email, usage_count, usage_date FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// 오늘 사용 가능한 횟수가 남아있으면 카운트를 1 늘리고 true, 다 썼으면 false.
// 날짜가 바뀌었으면 카운트를 0부터 다시 시작한다.
export async function tryConsumeUsage(userId, dailyLimit) {
  const { rows } = await getPool().query(
    `UPDATE users
     SET usage_count = CASE WHEN usage_date = CURRENT_DATE THEN usage_count + 1 ELSE 1 END,
         usage_date = CURRENT_DATE
     WHERE id = $1
       AND (usage_date <> CURRENT_DATE OR usage_count < $2)
     RETURNING usage_count`,
    [userId, dailyLimit]
  );
  if (rows.length === 0) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: dailyLimit - rows[0].usage_count };
}

// 실제로 횟수를 쓰기 전에, 아직 여유가 있는지만 확인한다 (카운트를 늘리지 않음).
export async function hasRemainingUsage(userId, dailyLimit) {
  const remaining = await getRemainingUsage(userId, dailyLimit);
  return remaining > 0;
}

export async function getRemainingUsage(userId, dailyLimit) {
  const user = await getUserById(userId);
  if (!user) return dailyLimit;
  const isToday =
    new Date(user.usage_date).toDateString() === new Date().toDateString();
  return isToday ? Math.max(0, dailyLimit - user.usage_count) : dailyLimit;
}
