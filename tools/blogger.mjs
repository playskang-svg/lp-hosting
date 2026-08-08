#!/usr/bin/env node
/**
 * Blogger API v3 CLI — 외부 의존성 없음 (Node 18+)
 *
 *   node tools/blogger.mjs blogs
 *   node tools/blogger.mjs posts [--status live|draft|scheduled] [--max 20]
 *   node tools/blogger.mjs get <postId> [--out 파일]
 *   node tools/blogger.mjs post   --title "제목" --file 본문.html [--labels 라벨1,라벨2] [--publish]
 *   node tools/blogger.mjs update <postId> [--title "제목"] [--file 본문.html] [--labels ...] [--publish]
 *   node tools/blogger.mjs publish <postId>
 *   node tools/blogger.mjs draft   <postId>
 *
 * 계정/블로그가 여러 개면 --env 로 자격증명 파일을 바꿔 지정한다.
 *   node tools/blogger.mjs --env .env.blog2 posts
 *
 * 안전장치: post/update 는 기본이 초안(draft)이다. 공개하려면 --publish 를 명시한다.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const API = "https://www.googleapis.com/blogger/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/* ---------- 인자 파싱 ---------- */
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out.flags[key] = true;
      else { out.flags[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

/* ---------- .env 로딩 (있으면 사용, 이미 설정된 환경변수가 우선) ---------- */
function loadEnv(file) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) {
    if (file !== ".env") die(`자격증명 파일을 찾을 수 없습니다: ${path}`);
    return;
  }
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function die(msg) { console.error("오류: " + msg); process.exit(1); }

function need(key) {
  const v = process.env[key];
  if (!v) die(`환경변수 ${key} 가 없습니다. tools/README.md 의 발급 절차를 참고하세요.`);
  return v;
}

/* ---------- 인증 ---------- */
let cachedToken = null;
async function accessToken() {
  if (cachedToken) return cachedToken;
  const body = new URLSearchParams({
    client_id: need("GOOGLE_CLIENT_ID"),
    client_secret: need("GOOGLE_CLIENT_SECRET"),
    refresh_token: need("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    die(`토큰 갱신 실패 (HTTP ${res.status}): ${json.error_description || json.error || "알 수 없음"}\n` +
        `리프레시 토큰이 만료됐거나 취소됐을 수 있습니다. tools/blogger-auth.mjs 로 다시 발급하세요.`);
  }
  cachedToken = json.access_token;
  return cachedToken;
}

/* ---------- API 호출 ---------- */
async function api(path, { method = "GET", body, query } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + (await accessToken()),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const m = json?.error?.message || text.slice(0, 300);
    die(`API 호출 실패 (HTTP ${res.status}) ${method} ${url.pathname}\n${m}`);
  }
  return json;
}

/* ---------- 블로그 ID 확인 ---------- */
async function blogId() {
  if (process.env.BLOGGER_BLOG_ID) return process.env.BLOGGER_BLOG_ID;
  const url = process.env.BLOGGER_BLOG_URL;
  if (!url) die("BLOGGER_BLOG_ID 또는 BLOGGER_BLOG_URL 중 하나는 있어야 합니다.");
  const blog = await api("/blogs/byurl", { query: { url } });
  console.error(`[정보] ${url} → 블로그 ID ${blog.id} (BLOGGER_BLOG_ID 로 넣어두면 호출이 한 번 줄어듭니다)`);
  return blog.id;
}

function readBody(file) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) die(`본문 파일이 없습니다: ${path}`);
  return readFileSync(path, "utf8");
}

function labelsOf(flags) {
  if (!flags.labels || flags.labels === true) return undefined;
  return String(flags.labels).split(",").map(s => s.trim()).filter(Boolean);
}

/* ---------- 명령 ---------- */
const commands = {
  async blogs() {
    const { items = [] } = await api("/users/self/blogs");
    if (!items.length) return console.log("연결된 블로그가 없습니다.");
    for (const b of items) console.log(`${b.id}\t${b.name}\t${b.url}`);
  },

  async posts(_args, flags) {
    const id = await blogId();
    const status = flags.status && flags.status !== true ? String(flags.status) : "live";
    const { items = [] } = await api(`/blogs/${id}/posts`, {
      query: { status, maxResults: flags.max && flags.max !== true ? flags.max : 20, fetchBodies: false },
    });
    if (!items.length) return console.log(`(${status}) 상태의 글이 없습니다.`);
    for (const p of items) console.log(`${p.id}\t${p.status || status}\t${p.title}\t${p.url || ""}`);
  },

  async get(args, flags) {
    const postId = args[0] || die("사용법: get <postId>");
    const id = await blogId();
    const post = await api(`/blogs/${id}/posts/${postId}`);
    if (flags.out && flags.out !== true) {
      writeFileSync(resolve(process.cwd(), flags.out), post.content ?? "", "utf8");
      console.log(`저장했습니다: ${flags.out}  (제목: ${post.title})`);
    } else {
      console.log(post.content ?? "");
    }
  },

  async post(_args, flags) {
    const title = flags.title && flags.title !== true ? String(flags.title) : die("--title 이 필요합니다.");
    const file = flags.file && flags.file !== true ? String(flags.file) : die("--file 이 필요합니다.");
    const content = readBody(file);
    const id = await blogId();
    const isDraft = !flags.publish;

    if (flags.dry) {
      console.log(`[미리보기] 블로그 ${id} 에 ${isDraft ? "초안" : "공개"} 글 작성`);
      console.log(`  제목: ${title}\n  본문: ${file} (${content.length}자)\n  라벨: ${(labelsOf(flags) || []).join(", ") || "없음"}`);
      return;
    }

    const res = await api(`/blogs/${id}/posts`, {
      method: "POST",
      query: { isDraft },
      body: { kind: "blogger#post", title, content, labels: labelsOf(flags) },
    });
    console.log(`작성 완료 (${isDraft ? "초안" : "공개"})`);
    console.log(`  postId: ${res.id}`);
    console.log(`  URL   : ${res.url || "(초안이라 아직 URL 없음)"}`);
    if (isDraft) console.log(`  공개하려면: node tools/blogger.mjs publish ${res.id}`);
  },

  async update(args, flags) {
    const postId = args[0] || die("사용법: update <postId> [--title ...] [--file ...]");
    const id = await blogId();
    const cur = await api(`/blogs/${id}/posts/${postId}`);

    const next = {
      kind: "blogger#post",
      id: cur.id,
      title: flags.title && flags.title !== true ? String(flags.title) : cur.title,
      content: flags.file && flags.file !== true ? readBody(String(flags.file)) : cur.content,
      labels: labelsOf(flags) ?? cur.labels,
    };

    if (flags.dry) {
      console.log(`[미리보기] ${postId} 수정`);
      console.log(`  제목: ${cur.title} → ${next.title}`);
      console.log(`  본문: ${cur.content?.length ?? 0}자 → ${next.content?.length ?? 0}자`);
      return;
    }

    const res = await api(`/blogs/${id}/posts/${postId}`, {
      method: "PUT",
      query: { publish: flags.publish ? true : undefined },
      body: next,
    });
    console.log(`수정 완료: ${res.title}`);
    console.log(`  URL: ${res.url || "(초안)"}`);
  },

  async publish(args) {
    const postId = args[0] || die("사용법: publish <postId>");
    const id = await blogId();
    const res = await api(`/blogs/${id}/posts/${postId}/publish`, { method: "POST" });
    console.log(`공개 완료: ${res.url}`);
  },

  async draft(args) {
    const postId = args[0] || die("사용법: draft <postId>");
    const id = await blogId();
    const res = await api(`/blogs/${id}/posts/${postId}/revert`, { method: "POST" });
    console.log(`초안으로 되돌렸습니다: ${res.title}`);
  },
};

/* ---------- 진입점 ---------- */
const { _: positional, flags } = parseArgs(process.argv.slice(2));
loadEnv(flags.env && flags.env !== true ? String(flags.env) : ".env");

const cmd = positional[0];
if (!cmd || flags.help || !commands[cmd]) {
  const help = readFileSync(new URL(import.meta.url), "utf8")
    .split("*/")[0].split("\n").slice(2)
    .map(l => l.replace(/^\s*\*ㅤ?/, "").replace(/^\s\*/, ""))
    .join("\n").trim();
  console.log(help);
  if (cmd && !commands[cmd]) console.error(`\n알 수 없는 명령: ${cmd}`);
  process.exit(cmd && !commands[cmd] ? 1 : 0);
}
commands[cmd](positional.slice(1), flags).catch(e => die(e?.message || String(e)));
