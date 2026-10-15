# 우리 팀 롤링페이퍼 🎂📌

링크 하나로 모두가 포스트잇을 붙이고, 마감 시간이 되면 한 번에 공개하는 **실시간 롤링페이퍼**입니다.
`20261013_Week15_2_Practice_02.pdf` 실습을 기반으로 도전 과제 4개와 재미 요소를 더했습니다.

- 공개 주소: __PUBLIC_URL__ (PC·모바일 같은 주소, 폰으로 열면 `/m/` 모바일 화면으로 자동 전환)
- 소스: https://github.com/yujusong/test/tree/main/rolling-paper
- 현재 실습 세션 종료: __SESSION_END__ (한국 시간). 이후 서비스는 자동으로 닫힙니다.

## 기능

| 구분 | 내용 |
| --- | --- |
| 기본 (PDF) | 닉네임(비우면 익명)·100자 메시지·4색 포스트잇, 기울어져 붙는 애니메이션, 코르크 보드, 새 글 반짝임, 실시간 반영, QR·링크 초대, CSV 보관 |
| 도전 ① 하트 | 포스트잇마다 하트 토글(더블클릭도 가능), 모든 화면에 실시간 숫자 반영, 가장 사랑받은 글에 👑 |
| 도전 ② 사진 | 사진을 브라우저에서 자동 축소(위치정보 제거) → Supabase Storage → 폴라로이드로 표시 |
| 도전 ③ 마감 | 카운트다운, 마감 후 작성 잠금 + 🎬 공개 모드(슬라이드쇼). **비밀 모드**면 마감 전까지 남의 글이 접혀 있다가 마감 순간 한꺼번에 뒤집히며 공개 |
| 도전 ④ GitHub | 이 폴더를 GitHub에 push하면 Vercel이 자동 배포 |
| 재미 요소 | 테마 6종(생일·송별·환영·수료·감사·피드백)별 색·꽃가루·제목 자동 완성, 🎲 문구 아이디어, 스티커 8종, 손글씨 글씨체 3종, 실시간 미리보기, 👀 접속자 수·✍️ 작성 중 표시, 최신/하트/사진 정렬 |
| 관리 | 보드를 만든 브라우저(관리자 링크)만 글 삭제·지금 마감·10분 연장·CSV 내려받기. 작성자는 자기 글 삭제 가능 |
| 화면 | PC: 보드 + 작성 패널 / 모바일(`/m/`): 하단 탭바 + 바텀시트 작성. 창 크기·방향·다크 모드·모션 줄이기 설정에 맞춰 동적으로 전환 |

## 구조와 "컨테이너 종료 = 서비스 종료"

```
브라우저 ──> Vercel 게이트웨이(cloud/) ──> Cloudflare 임시 터널 ──> Docker 컨테이너(server.py)
   │                    │ rp_live()로 현재 터널 주소 조회              │ RPC(anon 키 + 비밀 세션 ID)
   └── Realtime(신호·접속자) ──────────── Supabase (DB·Storage·Realtime) <──┘
```

- 웹 화면·API는 모두 **Docker 컨테이너**가 제공합니다. Vercel은 요청을 전달만 하며 정적 사본을 두지 않습니다.
- 컨테이너는 시작할 때 Supabase에 **1시간짜리 서비스 세션**을 열고, 종료할 때 닫습니다.
  `restart: "no"`이며 3,600초가 지나면 서버·터널이 스스로 종료됩니다.
- 컨테이너가 꺼지면: 게이트웨이는 "서비스가 꺼져 있어요"(503) 또는 "실습 시간이 끝났어요"(410)만 보여 주고,
  이미 열린 화면도 15초 안에 감지해 작성·하트를 잠급니다. 세션이 닫히면 DB RPC·사진 업로드도 거부됩니다.
- 실시간은 Supabase Realtime **Broadcast(신호만)** + **Presence**를 씁니다. 신호를 받으면 화면이 컨테이너에서
  다시 읽어 오므로, 누가 채널에 가짜 메시지를 보내도 내용이 주입되지 않습니다.

## 보안

- Supabase **publishable(anon) 키만** 사용합니다. service_role/secret 키는 어디에도 없습니다.
- 테이블 직접 접근은 모두 막고, 컨테이너만 아는 세션 ID가 있어야 하는 RPC로만 읽기/쓰기합니다.
  세션은 `.env`의 `BOOTSTRAP_SECRET`(해시만 DB에 저장)으로만 열 수 있습니다.
- 사진 버킷은 목록 조회 정책이 없어 나열할 수 없고, 업로드는 살아 있는 세션 폴더에만 허용됩니다(JPEG, 700KB 이하).
- 입력은 서버·DB 양쪽에서 길이·형식을 검사하고, 화면은 모두 텍스트로 출력합니다(HTML 주입 불가).
  CSV는 수식 주입을 막습니다. CSP·nosniff·no-referrer 헤더와 요청 속도 제한을 적용합니다.
- 익명 서비스이므로 "내 글"·하트 중복 방지는 브라우저 식별자 기반입니다(인증을 대신하지 않음).

## 0원 운영

- Vercel Hobby, Supabase Free(점심 룰렛 프로젝트 재사용), Cloudflare Quick Tunnel만 사용합니다. 결제 수단·업그레이드 없음.
- 사진은 업로드 전에 640KB 이하로 줄이고, 컨테이너가 메모리 캐시로 다시 내려받기를 줄입니다.
- 실시간은 신호만 보내고, 연결이 끊겨도 15초 간격 확인으로 따라잡습니다. 보드당 최대 300장.
- Vercel은 `cloud/`가 바뀐 커밋만 빌드합니다(`ignoreCommand`).

## 실행 (모든 도구는 Docker 안에서)

Docker Desktop만 필요합니다. Python·Node·Git·CLI를 PC에 설치하지 않습니다.

```powershell
# 로컬 개발 모드 (SQLite, 실시간은 4초 확인)
docker compose up -d --build paper      # http://localhost:18082
docker compose down                      # 즉시 종료
```

클라우드 모드:

1. `docker run --rm -v "${PWD}:/p" -w /p python:3.12-slim python -I tools/render_sql.py`
   → `.env`에 비밀값 생성, `supabase/schema.local.sql` 생성
2. 기존 Free Supabase 프로젝트 SQL Editor에서 `schema.local.sql` 실행
3. `.env`에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ENABLE_TUNNEL=1` 설정
4. `docker compose up -d --build paper` → 1시간 동안 공개 주소로 서비스

Vercel 프로젝트(Root Directory `rolling-paper/cloud`)에는 `RP_SUPABASE_URL`, `RP_SUPABASE_KEY`(publishable)만
설정되어 있습니다. 터널 주소는 매번 바뀌어도 게이트웨이가 Supabase에서 찾으므로 재배포가 필요 없습니다.

## 검증

| 테스트 | 실행 |
| --- | --- |
| SQL (권한·세션·비밀 모드·Storage 정책) | `tests/sql/run.sh` — 임시 postgres:15 컨테이너 |
| API 38개 계약 | `docker run --rm --add-host host.docker.internal:host-gateway -v "${PWD}/tests:/tests:ro" python:3.12-slim python -I /tests/api_test.py` |
| 브라우저 E2E (PC·모바일·실시간·사진·공개 모드) | `docker compose --profile qa run --rm qa python /tests/browser_test.py` |

세 가지 모두 로컬 모드와 실제 Supabase 모드에서 통과했습니다. 실제 모드에서는 Presence(👀·✍️)로
Realtime 연결도 확인합니다.
