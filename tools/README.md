# Blogger 연동

Google Blogger API v3 를 직접 호출하는 CLI. 외부 의존성이 없어서 `npm install` 없이
Node 18 이상이면 바로 돌아간다.

| 파일 | 역할 |
|---|---|
| `blogger.mjs` | 글 작성 · 수정 · 조회 · 공개 |
| `blogger-auth.mjs` | 리프레시 토큰 발급 (최초 1회) |

---

## 1. 구글 쪽 준비 (최초 1회, 약 10분)

**1) 프로젝트 만들기**
[Google Cloud Console](https://console.cloud.google.com/) → 상단 프로젝트 선택 → **새 프로젝트**

**2) Blogger API 켜기**
**API 및 서비스 → 라이브러리** → `Blogger API v3` 검색 → **사용**

**3) OAuth 동의 화면 구성**
**API 및 서비스 → OAuth 동의 화면**
- User Type: **외부**
- 앱 이름 / 지원 이메일 / 개발자 연락처만 채우면 된다
- 범위(scope)는 추가하지 않아도 된다. 스크립트가 요청한다
- **테스트 사용자**에 본인 구글 계정을 추가한다

> ⚠️ **게시 상태를 "프로덕션"으로 바꿔두세요.**
> "테스트" 상태로 두면 **리프레시 토큰이 7일 뒤 만료**되어 매주 재발급해야 한다.
> 프로덕션으로 게시하면 만료되지 않는다. 본인만 쓰는 앱이라 심사는 필요 없다.

**4) OAuth 클라이언트 만들기**
**API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
- 애플리케이션 유형: **데스크톱 앱**
- 생성 후 나오는 **클라이언트 ID**와 **클라이언트 보안 비밀**을 복사한다

---

## 2. 자격증명 파일 만들기

```bash
cp .env.example .env
```

`.env` 에 클라이언트 ID / 보안 비밀 / 블로그 주소를 채운다.

```bash
node tools/blogger-auth.mjs
```

출력된 주소를 브라우저에서 열어 승인하면 터미널에 리프레시 토큰이 찍힌다.
그 줄을 `.env` 에 붙여넣으면 끝이다.

> 브라우저가 필요하므로 **본인 PC에서** 실행해야 한다.
> "확인되지 않은 앱" 경고가 뜨면 **고급 → 이동**을 누른다. 본인이 만든 앱이라 정상이다.

연결 확인:

```bash
node tools/blogger.mjs blogs
# 1234567890    내 블로그    https://myblog.blogspot.com
```

---

## 3. 사용법

```bash
# 글 목록 (기본 20개)
node tools/blogger.mjs posts
node tools/blogger.mjs posts --status draft

# 초안으로 작성 — 기본값이 초안이다
node tools/blogger.mjs post --title "손해평가사 취득지원" --file blogspot/1.html --labels 자격증,손해평가사

# 확인 후 공개
node tools/blogger.mjs publish <postId>

# 처음부터 공개로 작성
node tools/blogger.mjs post --title "..." --file blogspot/1.html --publish

# 실제로 보내기 전에 내용만 확인
node tools/blogger.mjs post --title "..." --file blogspot/1.html --dry

# 이미 올린 글의 본문 교체 (텐핑 코드나 문구가 바뀌었을 때)
node tools/blogger.mjs update <postId> --file blogspot/1.html

# 현재 올라가 있는 본문 내려받기
node tools/blogger.mjs get <postId> --out 백업.html

# 공개 글을 초안으로 되돌리기
node tools/blogger.mjs draft <postId>
```

### 블로그가 여러 개일 때

계정·블로그마다 자격증명 파일을 따로 두고 `--env` 로 지정한다.

```bash
node tools/blogger.mjs --env .env.blog2 posts
node tools/blogger.mjs --env .env.blog2 post --title "..." --file blogspot/1.html
```

### 여러 글 본문을 한 번에 교체

```bash
for id in 111 222 333; do
  node tools/blogger.mjs update $id --file blogspot/1.html
done
```

---

## 보안

- `.env`, `client_secret*.json` 은 `.gitignore` 에 들어 있다. **절대 커밋하지 말 것.**
- 리프레시 토큰은 비밀번호와 같다. 유출되면
  [계정 권한 페이지](https://myaccount.google.com/permissions)에서 앱 접근을 삭제하면 즉시 무효화된다.
- 스크립트가 요청하는 권한은 `https://www.googleapis.com/auth/blogger` 하나뿐이다.
  블로그 읽기·쓰기 외의 구글 데이터에는 접근하지 않는다.

## 운영 주의

같은 랜딩페이지를 여러 블로그에 대량으로 자동 포스팅하는 것은 Blogger 스팸 정책이
겨냥하는 패턴이다. 계정 정지 위험이 있으니 블로그마다 본문 글을 다르게 쓰고
발행 간격을 두는 편이 안전하다.
