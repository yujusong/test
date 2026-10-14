# 오늘 뭐 먹지? — 점심클럽

현재 상태: GitHub 소스 업로드와 Vercel Hobby 배포 완료. 기존 Supabase Free
프로젝트에 실제 투표를 저장합니다. 개발 도구와 실행 서버는 Docker 안에 있습니다.

공개 주소: https://lunch-roulette-theta-one.vercel.app
소스: https://github.com/yujusong/test/tree/main/lunch-roulette
현재 실습 종료: 2026-10-14 20:57:48 (한국 시간).
공개 서비스 사용 중에는 이 컴퓨터와 Docker를 켜두어야 합니다.

## 실행과 종료

이 폴더에서 Docker Desktop이 실행된 상태로 실행합니다. Python, Node,
Git, 패키지, 브라우저 테스트 도구는 호스트에 설치하지 않습니다.

```powershell
docker compose up -d --build
```

접속: http://localhost:18081

실행 시점부터 최대 3,600초 후 서버 프로세스가 종료됩니다.
`restart: no`이므로 자동 재시작하지 않습니다. 바로 종료하려면:

```powershell
docker compose down
```

SQLite 모드의 투표는 Docker named volume에, 현재 Supabase 모드의 투표는
Supabase에 보관되며 컨테이너를 종료해도 데이터는 남습니다.
컨테이너를 종료하면 HTTP 서비스는 실행되지 않습니다. 종료 전 열린 화면은
최대 30초 내 연결 종료를 감지해 버튼을 비활성화합니다.

## 기능

- 김치찌개·돈까스·쌀국수·샐러드·햄버거·마라탕의 3초 룰렛
- 꽃가루 효과, 메뉴 추가·삭제·선택, 국물/가벼운 메뉴 필터
- 최대 12개 후보, 브라우저에 후보 저장
- 팀 초대 링크와 QR, 근처 식당 검색 링크
- 한국 시간 기준 오늘의 TOP 5, 분당 갱신과 수동 새로고침
- 동일 브라우저·팀·날짜의 중복 투표 차단
- 서버가 검증하는 투표 입력, 임의 HTML을 텍스트로 출력
- 모바일 레이아웃, 키보드 접근, 모션 감소 설정 지원

익명 실습 서비스입니다. 브라우저 식별자 기반 중복 방지는 인증을 대신하지
않으며 브라우저 저장소를 지우거나 다른 브라우저를 사용하면 다시 투표할 수 있습니다.
샘플 순위나 가짜 투표를 표시하지 않습니다.

## Supabase 연결 준비

기본 설정의 저장소는 컨테이너의 SQLite입니다. 현재 실행 설정은 기존 Free
Supabase 프로젝트를 사용하며 HTTP 입력·중복 투표·팀 분리 검증을 통과했습니다.

1. 기존 **Free** 프로젝트의 SQL Editor에서 `supabase.sql`을 실행합니다.
2. 마지막 주석의 세션 생성 SQL을 실행하여 1시간짜리 세션 ID를 받습니다.
3. `.env.example`을 `.env`로 복사하고 Project URL, publishable key, 세션 ID를 설정합니다.
4. `docker compose up -d --force-recreate`로 컨테이너를 다시 시작합니다.

프로젝트를 자동 생성하거나 플랜을 변경하지 않습니다. `service_role`/secret
키는 사용하지 않습니다. SQL은 직접 테이블 접근을 막고 읽기/투표 RPC만
허용합니다. RPC는 Supabase 서버 시각으로 세션 만료를 검증합니다.

## Vercel 배포 준비

`cloud/`는 Vercel의 모든 요청을 살아 있는 Docker 서버로 전달하는 게이트웨이입니다.
Root Directory를 `lunch-roulette/cloud`로 지정하는 구성을 의도합니다.
Docker 서버의 HTTPS 공개 원본은 Cloudflare Quick Tunnel로 제공합니다.
`ENABLE_TUNNEL=1`로 설정하면 서버가 컨테이너 안에서 터널을 시작합니다.
서버 종료 시 터널 프로세스도 종료하며, 매 실행마다 원본 주소가 바뀝니다.
현재 원본 주소는 `/api/session` 응답의 `publicUrl`에서 확인합니다.

- `LUNCH_ORIGIN`: 컨테이너에 연결된 HTTPS 원본 주소
- `LUNCH_EXPIRES_AT`: 완성 후 1시간의 절대 종료 시각(ISO 8601)

원본 컨테이너가 종료되면 클라우드 요청도 실패합니다. 종료 시각 이후에는
게이트웨이가 410을 반환합니다. 정적 페이지를 Vercel에 독립 배포하면
컨테이너 종료와 무관하게 실행되므로 이 요구사항을 만족하지 않습니다.

Vercel 프로젝트는 GitHub의 main 브랜치와 연결되어 자동 배포됩니다.
종료 시각에 컨테이너 서버와 터널이 종료되고, 게이트웨이가 서비스 요청을 차단합니다.
Vercel 프로젝트와 Supabase 저장 데이터는 남습니다. 유료 리소스 생성이나
플랜 변경은 하지 않았습니다. 다시 실습하려면 DB 세션 만료 시각과 로컬 .env를
갱신하고 컨테이너를 시작한 뒤, 새 원본 주소와 종료 시각을 Vercel 환경변수에
반영하여 재배포합니다. .env는 GitHub에 올리지 않습니다.

## 검증

`tests/api_test.py`는 HTTP 계약과 중복/팀 분리를 검증합니다.
`tests/browser_test.py`는 Docker 안의 headless Chromium으로 화면과 상호작용을
검증합니다. 테스트 화면은 `artifacts/desktop.png`, `artifacts/mobile.png`에 저장됩니다.
별도의 3초 세션 컨테이너로 자동 종료도 검증합니다.
