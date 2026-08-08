#!/usr/bin/env node
/**
 * 리프레시 토큰 발급 도우미 — 최초 1회만 실행한다.
 *
 * [자동 모드] 브라우저가 있는 PC에서 실행할 때
 *   node tools/blogger-auth.mjs
 *   로컬에 임시 서버를 띄워 승인 결과를 직접 받는다.
 *
 * [수동 모드] 서버(원격 컨테이너 등)에서 실행할 때 — 브라우저가 따로 있는 경우
 *   node tools/blogger-auth.mjs --manual        # 승인 주소를 출력한다
 *   ...주소를 브라우저에서 열고 승인하면 127.0.0.1 로 이동하며 연결 실패 화면이 뜬다.
 *      화면은 무시하고 주소창의 code= 뒤 값만 복사한다...
 *   node tools/blogger-auth.mjs --code <복사한값>   # 토큰으로 교환한다
 *
 * 인증 코드는 한 번만 쓸 수 있고 몇 분 안에 만료되니 바로 교환해야 한다.
 * 토큰은 화면에만 찍고 파일로 저장하지 않는다 — 실수로 커밋되는 것을 막기 위해서다.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 8787;
const REDIRECT = `http://127.0.0.1:${PORT}/`;
const SCOPE = "https://www.googleapis.com/auth/blogger";

// .env 가 있으면 읽어둔다
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("오류: GOOGLE_CLIENT_ID 와 GOOGLE_CLIENT_SECRET 이 필요합니다.");
  console.error("      Google Cloud Console 에서 '데스크톱 앱' 유형 OAuth 클라이언트를 만드세요.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent"); // 매번 리프레시 토큰을 받기 위해 필요

/* ---------- 코드 → 토큰 교환 ---------- */
async function exchange(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.refresh_token) {
    console.error("오류: 토큰 발급 실패 —", JSON.stringify(json, null, 2));
    if (json.error === "invalid_grant") {
      console.error("코드가 이미 사용됐거나 만료됐습니다. --manual 로 주소를 다시 받아 새 코드를 얻으세요.");
    } else if (!json.refresh_token) {
      console.error("리프레시 토큰이 오지 않았다면 이미 승인한 앱일 수 있습니다.");
      console.error("https://myaccount.google.com/permissions 에서 앱 접근 권한을 삭제하고 다시 시도하세요.");
    }
    process.exit(1);
  }
  return json.refresh_token;
}

/* ---------- 수동 모드 ---------- */
const argv = process.argv.slice(2);
const manual = argv.includes("--manual");
const codeIdx = argv.indexOf("--code");

if (codeIdx >= 0) {
  let code = argv[codeIdx + 1];
  if (!code) { console.error("오류: --code 뒤에 인증 코드를 넣으세요."); process.exit(1); }
  // 주소창을 통째로 붙여넣은 경우도 받아준다
  if (code.includes("code=")) code = new URL(code, REDIRECT).searchParams.get("code") || code;
  code = decodeURIComponent(code);
  const token = await exchange(code);
  console.log("\n발급 완료. 아래 줄을 .env 에 추가하세요:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${token}\n`);
  console.log("※ 이 값은 비밀번호와 같습니다. 저장소에 커밋하지 마세요.");
  process.exit(0);
}

if (manual) {
  console.log("\n[1] 아래 주소를 브라우저에서 열고 구글 계정으로 승인하세요.\n");
  console.log(authUrl.toString());
  console.log("\n[2] 승인하면 127.0.0.1 로 이동하면서 '연결할 수 없음' 화면이 뜹니다. 정상입니다.");
  console.log("    화면은 무시하고 주소창에서 code= 뒤의 값을 복사하세요.\n");
  console.log("[3] 복사한 값으로 아래를 실행하세요 (주소창 전체를 넣어도 됩니다).\n");
  console.log("    node tools/blogger-auth.mjs --code '<복사한값>'\n");
  console.log("※ 코드는 한 번만 쓸 수 있고 몇 분 안에 만료됩니다.");
  process.exit(0);
}

console.log("\n아래 주소를 브라우저에서 열고 구글 계정으로 로그인하세요.\n");
console.log(authUrl.toString());
console.log(`\n승인하면 ${REDIRECT} 로 돌아오고, 이 창에 리프레시 토큰이 출력됩니다.\n대기 중...\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>인증이 취소되었습니다.</h2><p>터미널을 확인하세요.</p>");
    console.error("오류: 사용자가 승인을 취소했습니다 — " + error);
    server.close(); process.exit(1);
  }
  if (!code) { res.writeHead(404).end(); return; }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const json = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok || !json.refresh_token) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>토큰 발급 실패</h2><p>터미널을 확인하세요.</p>");
    console.error("오류: 토큰 발급 실패 —", JSON.stringify(json, null, 2));
    console.error("리프레시 토큰이 안 왔다면 이미 승인한 앱일 수 있습니다.");
    console.error("https://myaccount.google.com/permissions 에서 앱 접근 권한을 삭제하고 다시 시도하세요.");
    server.close(); process.exit(1);
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h2>발급 완료</h2><p>터미널로 돌아가 토큰을 .env 에 넣으세요. 이 창은 닫아도 됩니다.</p>");

  console.log("발급 완료. 아래 줄을 .env 에 추가하세요:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${json.refresh_token}\n`);
  console.log("※ 이 값은 비밀번호와 같습니다. 저장소에 커밋하지 마세요.");
  server.close(); process.exit(0);
});

server.listen(PORT, "127.0.0.1");
