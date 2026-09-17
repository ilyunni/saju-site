const loginBox = document.getElementById("login-box");
const accountBox = document.getElementById("account-box");
const accountEmailEl = document.getElementById("account-email");
const accountRemainingEl = document.getElementById("account-remaining");
const logoutBtn = document.getElementById("logout-btn");

const form = document.getElementById("saju-form");
const submitBtn = document.getElementById("submit-btn");
const resultSection = document.getElementById("result");
const loadingBox = document.getElementById("loading");
const errorBox = document.getElementById("error-box");
const tableBox = document.getElementById("table-box");
const sajuTableEl = document.getElementById("saju-table");
const interpretationEl = document.getElementById("interpretation");

const calendarSelect = document.getElementById("calendar");
const leapField = document.getElementById("leap-field");
const timeUnknownCheckbox = document.getElementById("timeUnknown");
const hourInput = document.getElementById("hour");
const minuteInput = document.getElementById("minute");

const readingTypeTabs = document.getElementById("reading-type-tabs");
const READING_TYPE_LABELS = {
  base: "사주 보기",
  today: "오늘의 운세 보기",
  newyear: "신년운세 보기",
};
let selectedReadingType = "base";

readingTypeTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  selectedReadingType = btn.dataset.type;
  readingTypeTabs
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("active", t === btn));
  submitBtn.textContent = READING_TYPE_LABELS[selectedReadingType];
});

calendarSelect.addEventListener("change", () => {
  leapField.hidden = calendarSelect.value !== "lunar";
});

timeUnknownCheckbox.addEventListener("change", () => {
  const disabled = timeUnknownCheckbox.checked;
  hourInput.disabled = disabled;
  minuteInput.disabled = disabled;
  if (disabled) {
    hourInput.value = "";
    minuteInput.value = "";
  }
});

// 아주 단순한 마크다운(#, ##, **, - 목록, 표) -> HTML 변환기.
// 별도 라이브러리 없이, AI 해석 결과 정도를 예쁘게 보여줄 수 있을 정도로만 처리한다.
function renderMarkdown(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;

  const escapeHtml = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length + 1, 6); // ## -> h3 정도로 보이게
      html.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const tableLines = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)) // 구분선(---) 제외
        .map((l) =>
          l
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((cell) => cell.trim())
        );
      if (rows.length > 0) {
        const [headerRow, ...bodyRows] = rows;
        const thead = `<thead><tr>${headerRow
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead>`;
        const tbody = `<tbody>${bodyRows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody>`;
        html.push(`<table>${thead}${tbody}</table>`);
      }
      continue;
    }

    const paragraphLines = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
      paragraphLines.push(lines[i]);
      i++;
    }
    html.push(`<p>${paragraphLines.map(inline).join("<br />")}</p>`);
  }

  return html.join("\n");
}

// ── 로그인 상태 관리 ──────────────────────────────────────

function showLoggedOutUI() {
  loginBox.hidden = false;
  accountBox.hidden = true;
  readingTypeTabs.hidden = true;
  form.hidden = true;
}

function showLoggedInUI({ email, remaining, dailyLimit }) {
  loginBox.hidden = true;
  accountBox.hidden = false;
  readingTypeTabs.hidden = false;
  form.hidden = false;
  if (email) accountEmailEl.textContent = email;
  accountRemainingEl.textContent = `오늘 남은 횟수: ${remaining}/${dailyLimit}`;
}

async function refreshLoginState() {
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (!res.ok) {
      showLoggedOutUI();
      return;
    }
    const data = await res.json();
    showLoggedInUI({ remaining: data.remaining, dailyLimit: data.dailyLimit });
  } catch {
    showLoggedOutUI();
  }
}

async function handleGoogleCredential(response) {
  try {
    const res = await fetch("/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ idToken: response.credential }),
    });
    if (!res.ok) throw new Error("login failed");
    const data = await res.json();
    accountEmailEl.textContent = data.email;
    await refreshLoginState();
  } catch {
    errorBox.textContent = "구글 로그인에 실패했습니다. 다시 시도해주세요.";
    errorBox.hidden = false;
  }
}

logoutBtn.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  showLoggedOutUI();
});

// accounts.google.com/gsi/client 스크립트는 async로 불러오기 때문에,
// window.google이 준비될 때까지 잠깐 기다려야 할 수 있다.
function waitForGoogleSignIn(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (window.google?.accounts?.id) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(check, 100);
    })();
  });
}

(async function initGoogleSignIn() {
  const res = await fetch("/api/config");
  const { googleClientId } = await res.json();
  if (!googleClientId) {
    loginBox.innerHTML =
      "<p class='hint'>구글 로그인이 아직 설정되지 않았어요 (관리자: GOOGLE_CLIENT_ID 환경변수를 설정해주세요).</p>";
    return;
  }
  try {
    await waitForGoogleSignIn();
  } catch {
    loginBox.innerHTML = "<p class='hint'>구글 로그인 스크립트를 불러오지 못했어요. 새로고침해주세요.</p>";
    return;
  }
  window.google.accounts.id.initialize({
    client_id: googleClientId,
    callback: handleGoogleCredential,
  });
  window.google.accounts.id.renderButton(document.getElementById("g_id_signin"), {
    theme: "outline",
    size: "large",
    text: "signin_with",
  });
  refreshLoginState();
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    calendar: calendarSelect.value,
    leap: document.getElementById("leap").checked,
    year: document.getElementById("year").value,
    month: document.getElementById("month").value,
    day: document.getElementById("day").value,
    hour: hourInput.value,
    minute: minuteInput.value,
    timeUnknown: timeUnknownCheckbox.checked,
    gender: form.querySelector('input[name="gender"]:checked')?.value,
    readingType: selectedReadingType,
  };

  resultSection.hidden = false;
  loadingBox.hidden = false;
  errorBox.hidden = true;
  tableBox.hidden = true;
  interpretationEl.innerHTML = "";
  submitBtn.disabled = true;
  resultSection.scrollIntoView({ behavior: "smooth" });

  try {
    const res = await fetch("/api/saju", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.status === 401) {
      showLoggedOutUI();
      errorBox.textContent = "로그인이 만료되었어요. 다시 로그인해주세요.";
      errorBox.hidden = false;
      return;
    }

    if (data.markdown) {
      sajuTableEl.textContent = data.markdown;
      tableBox.hidden = false;
    }

    if (!res.ok || data.error) {
      errorBox.textContent = data.error || "알 수 없는 오류가 발생했습니다.";
      errorBox.hidden = false;
    }

    if (data.interpretation) {
      interpretationEl.innerHTML = renderMarkdown(data.interpretation);
    }

    if (typeof data.remaining === "number") {
      accountRemainingEl.textContent = `오늘 남은 횟수: ${data.remaining}/${data.dailyLimit ?? ""}`;
    }
  } catch (err) {
    errorBox.textContent = "서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.";
    errorBox.hidden = false;
  } finally {
    loadingBox.hidden = true;
    submitBtn.disabled = false;
  }
});
