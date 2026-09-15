# 사주풀이

생년월일(과 태어난 시간)을 입력하면 [`ssaju`](https://github.com/golbin/ssaju) 라이브러리로 사주팔자를 계산하고, **Anthropic API**로 AI가 사주 해석을 작성해주는 웹사이트입니다. 구글 로그인 + 계정당 하루 무료 사용 횟수 제한이 있습니다.

> 로컬 전용 버전(개인 Claude 구독으로만 동작)은 git 히스토리 이전 버전을 참고하세요. 이 버전은 **인터넷에 공개하는 것을 전제**로, 종량제 API 키를 사용합니다.

## 사전 준비 (계정 발급)

아래 항목은 본인이 직접 가입/발급해야 합니다.

1. **Anthropic API 키**: [platform.claude.com](https://platform.claude.com) 가입 → API 키 발급 → 결제수단 등록
2. **Google OAuth 클라이언트 ID**: [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 동의 화면 설정 → "OAuth 클라이언트 ID" 생성 (유형: 웹 애플리케이션)
   - 승인된 자바스크립트 원본에 `http://localhost:3000` (로컬 테스트용)과 배포 후 실제 주소를 등록
3. **Postgres 데이터베이스**: [Neon](https://neon.tech) 무료 프로젝트 생성 → 연결 문자열(connection string) 복사

## 로컬 실행

1. `.env.example`을 복사해서 `.env`로 저장하고 위에서 발급받은 값들을 채워넣습니다.
2. 설치 및 실행:

```bash
npm install
npm run dev
```

3. 브라우저에서 [http://localhost:3000](http://localhost:3000) 접속 → 구글 로그인 → 사주 입력

## 배포 (Render 기준)

1. 이 프로젝트를 GitHub 저장소에 올립니다 (`git init` → `git add .` → `git commit` → GitHub에 push). `.env`는 `.gitignore`에 있어 올라가지 않습니다.
2. [render.com](https://render.com)에서 새 **Web Service** 생성 → 방금 만든 GitHub 저장소 연결
3. Build Command: `npm install`, Start Command: `npm start`
4. **Environment** 탭에서 `.env`에 넣었던 값들을 그대로 하나씩 등록 (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GOOGLE_CLIENT_ID`, `JWT_SECRET`, `DATABASE_URL`, `DAILY_FREE_LIMIT`, `NODE_ENV=production`)
5. 배포되면 Render가 주는 `https://xxx.onrender.com` 주소가 공개 URL입니다. 이 주소를 Google Cloud Console의 "승인된 자바스크립트 원본"에도 추가해야 로그인이 동작합니다.

## 동작 방식

1. 브라우저에서 구글 로그인 → 서버가 ID 토큰을 검증하고 세션 쿠키 발급, Postgres에 계정 upsert
2. 사주 입력 후 서버가 오늘 사용 횟수를 확인 (기본 하루 3회, `DAILY_FREE_LIMIT`로 조정 가능)
3. 한도 내라면 `ssaju`로 사주 계산 → Anthropic API(`@anthropic-ai/sdk`)로 AI 해석 요청
4. 사주표와 AI 해석 글을 화면에 표시

## 개인정보

생년월일·성별 등 사주 계산에 쓰이는 정보는 **DB에 저장하지 않습니다**. 자세한 내용은 `public/privacy.html`을 확인하세요. 실제 서비스로 운영하기 전 전문가 검토를 권장합니다.

## 문제 해결

- **구글 로그인 버튼이 안 보임**: `GOOGLE_CLIENT_ID` 환경변수가 비어있지 않은지 확인하세요.
- **로그인은 되는데 사주 조회가 안 됨**: `ANTHROPIC_API_KEY`가 유효한지, Anthropic Console에 결제수단이 등록되어 있는지 확인하세요.
- **"DATABASE_URL 환경변수가 설정되어 있지 않습니다" 에러**: `.env`(로컬) 또는 Render의 Environment 설정(배포)에 `DATABASE_URL`을 등록했는지 확인하세요.
