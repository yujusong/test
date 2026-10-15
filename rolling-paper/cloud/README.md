# Vercel 게이트웨이

Vercel 프로젝트 `rolling-paper`의 Root Directory입니다. GitHub `main`에 이 폴더가 바뀐 커밋이
push되면 자동 배포됩니다(그 외 커밋은 `ignoreCommand`로 빌드를 건너뜀).

- `api/proxy.js`: Supabase `rp_live()`로 살아 있는 Docker 컨테이너의 터널 주소를 찾아 요청을 전달합니다.
  컨테이너가 꺼져 있거나 1시간 세션이 끝나면 안내 페이지(503/410)만 응답합니다.
- 환경변수: `RP_SUPABASE_URL`, `RP_SUPABASE_KEY`(publishable/anon 키). 비밀 키는 쓰지 않습니다.
