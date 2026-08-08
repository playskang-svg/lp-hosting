#!/usr/bin/env node
/**
 * 리프레시 토큰 발급 도우미 — 최초 1회만 실행한다.
 *
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node tools/blogger-auth.mjs
 *   (또는 .env 에 두 값을 넣고 그냥 실행)
 *
 * 브라우저가 있는 PC에서 실행해야 한다. 구글 동의 화면을 거쳐야 하기 때문이다.
 * 출력된 GOOGLE_REFRESH_TOKEN 값을 .env 에 넣으면 끝이다. 토큰은 화면에만 찍고
 * 파일로 저장하지 않는다 — 실수로 저장소에 커밋되는 일을 막기 위해서다.
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
