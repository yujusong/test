'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const MOBILE_UI = location.pathname.startsWith('/m');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const compactQuery = matchMedia('(max-width: 860px)');

  // ---- 콘텐츠 설정 --------------------------------------------------------
  const THEMES = {
    birthday: { emoji: '🎂', label: '생일', title: n => `${n}님 생일 축하해요!`, fx: ['🎂', '🎉', '🎈', '✨', '🎁'],
      ideas: ['생일 축하해요! 오늘은 하고 싶은 거 다 해요 🎉', '늘 든든한 동료가 되어 줘서 고마워요. 행복한 한 해 되세요!', '맛있는 거 많이 드시고 푹 쉬는 하루 되세요 🍰', '올해는 좋은 일만 가득하길 바랄게요 ✨', '덕분에 회사 오는 게 즐거워요. 생일 축하해요!', '케이크 한 조각은 제 몫으로 남겨 주세요 😋'] },
    farewell: { emoji: '👋', label: '송별', title: n => `${n}님, 그동안 고마웠어요!`, fx: ['👋', '🌷', '✨', '💐'],
      ideas: ['함께해서 정말 즐거웠어요. 새로운 곳에서도 응원할게요!', '덕분에 많이 배웠어요. 종종 연락해요 🙌', '어디서든 잘하실 거예요. 꽃길만 걸으세요 🌷', '같이 먹던 점심이 벌써 그리워질 것 같아요', '떠나도 우리 팀은 영원히 같은 팀이에요!', '새 출발을 진심으로 축하해요 🚀'] },
    welcome: { emoji: '🎉', label: '환영', title: n => `${n}님, 환영합니다!`, fx: ['🎉', '🙌', '✨', '🎊'],
      ideas: ['우리 팀에 오신 걸 환영해요! 궁금한 건 뭐든 물어보세요', '같이 일하게 되어 정말 기뻐요 🙌', '점심 맛집은 제가 알려 드릴게요 🍜', '첫 주는 천천히 적응하셔도 돼요. 반가워요!', '앞으로 재밌는 일 많이 해 봐요 🚀', '환영합니다! 오늘부터 우리는 한 팀 💪'] },
    graduation: { emoji: '🎓', label: '수료·졸업', title: n => `${n} 수료를 축하해요!`, fx: ['🎓', '🎉', '📜', '✨'],
      ideas: ['끝까지 함께해서 정말 고마웠어요. 수료 축하해요!', '같이 밤새 고민하던 순간들 잊지 못할 거예요 🎓', '다음 도전도 멋지게 해낼 거예요!', '덕분에 끝까지 버틸 수 있었어요 💪', '이제 진짜 시작이에요. 응원할게요 🚀', '우리 꼭 다시 만나요!'] },
    thanks: { emoji: '💐', label: '감사', title: n => `${n}님, 늘 고마워요!`, fx: ['💐', '💖', '✨', '🌼'],
      ideas: ['항상 먼저 도와주셔서 감사해요 💐', '덕분에 힘든 일도 즐겁게 할 수 있었어요', '말로 다 못 한 고마움을 여기 남겨요', '당신은 우리 팀의 비타민이에요 🍊', '늘 웃게 해 줘서 고마워요 😊', '고생 많으셨어요. 정말 최고예요!'] },
    feedback: { emoji: '💬', label: '피드백', title: n => `${n} 소감을 남겨 주세요`, fx: ['💬', '👏', '✨', '💡'],
      ideas: ['오늘 가장 좋았던 점은 …', '이 부분은 조금 더 자세히 듣고 싶어요: …', '바로 써먹고 싶은 내용이 있었어요!', '질문이 있어요: …', '다음에는 이런 주제도 다뤄 주세요: …', '실습이 정말 재밌었어요 👏'] },
  };
  const COLORS = [['yellow', '노랑'], ['pink', '분홍'], ['mint', '민트'], ['blue', '파랑']];
  const STICKERS = { '': '없음', cake: '🎂', party: '🎉', heart: '💖', star: '⭐', flower: '🌷', clap: '👏', fire: '🔥', coffee: '☕' };
  const FONTS = [['pen', '손글씨'], ['round', '동글동글'], ['print', '또박또박']];
  const DEADLINES = [
    { id: '10', label: '10분 뒤', at: () => Date.now() + 10 * 6e4 },
    { id: '30', label: '30분 뒤', at: () => Date.now() + 30 * 6e4 },
    { id: '60', label: '1시간 뒤', at: () => Date.now() + 60 * 6e4 },
    { id: 'eve', label: '오늘 18:00', at: () => atHour(0, 18) },
    { id: 'tmr', label: '내일 09:00', at: () => atHour(1, 9) },
    { id: 'custom', label: '직접 입력', at: () => Date.parse($('#create [name=custom]').value) },
  ];

  // ---- 상태 -----------------------------------------------------------------
  const S = {
    session: null, offset: 0, voter: '', code: '', admin: '', board: null, notes: [], sort: 'new',
    fresh: new Set(), photoUrls: new Map(), loaded: false, wasClosed: null, revealing: false,
    rt: null, channel: null, rtReady: false, pulseTimer: 0, refetchTimer: 0, refetching: null,
    deadlineCheck: 0, offline: false, photo: null, typing: false, typingTimer: 0, deadline: '30', titleTouched: false,
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장소가 막혀도 동작 */ } },
  };

  // ---- 공통 도우미 -----------------------------------------------------------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const serverNow = () => Date.now() + S.offset;
  const pick = list => list[Math.floor(Math.random() * list.length)];
  function atHour(dayOffset, hour) { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); return d.getTime(); }
  const fmtTime = t => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(t);
  const fmtClock = t => new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' }).format(t);
  function ago(iso) {
    const s = Math.max(0, (serverNow() - Date.parse(iso)) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return fmtTime(Date.parse(iso));
  }
  function left(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (d) return `${d}일 ${h}시간`;
    if (h) return `${h}시간 ${m}분`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  const tilt = id => (((id * 7919) % 9) - 4) * 0.7;

  function newVoter() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function api(path, opts = {}, retried = false) {
    const headers = { 'X-RP-Voter': S.voter };
    if (S.session) headers['X-RP-Key'] = S.session.key;
    if (S.admin) headers['X-RP-Admin'] = S.admin;
    let body;
    if (opts.body) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
    let res;
    try {
      res = await fetch(path, { method: body ? 'POST' : 'GET', headers, body, cache: 'no-store', credentials: 'same-origin' });
    } catch {
      throw Object.assign(new Error('서비스에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'), { status: 0 });
    }
    if (opts.raw && res.ok) return res;
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && body && !retried && /새로고침/.test(data.error || '')) {
      await loadSession();
      return api(path, opts, true);
    }
    if (!res.ok) throw Object.assign(new Error(data.error || '잠시 문제가 생겼어요.'), { status: res.status });
    return data;
  }

  function toast(text, kind = '') {
    const t = el('div', `toast ${kind}`, text);
    $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), 3000);
    setTimeout(() => t.remove(), 3500);
  }

  function banner(text) {
    const b = $('#banner');
    b.hidden = !text;
    b.textContent = text || '';
  }

  function confetti(emojis, count = 26) {
    if (reduceMotion.matches) return;
    const fx = $('#fx');
    for (let i = 0; i < count; i++) {
      const s = el('span', 'confetti', pick(emojis));
      s.style.left = `${Math.random() * 100}%`;
      s.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
      s.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
      s.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
      s.style.animationDelay = `${Math.random() * 0.4}s`;
      s.style.fontSize = `${18 + Math.random() * 18}px`;
      s.addEventListener('animationend', () => s.remove());
      fx.append(s);
    }
  }

  function burst(target, emoji = '❤️') {
    if (reduceMotion.matches) return;
    const r = target.getBoundingClientRect();
    for (let i = 0; i < 7; i++) {
      const s = el('span', 'burst', emoji);
      s.style.left = `${r.left + r.width / 2}px`;
      s.style.top = `${r.top + r.height / 2}px`;
      s.style.setProperty('--dx', `${(Math.random() - 0.5) * 90}px`);
      s.style.setProperty('--dy', `${-40 - Math.random() * 60}px`);
      s.addEventListener('animationend', () => s.remove());
      $('#fx').append(s);
    }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = el('textarea'); t.value = text; document.body.append(t); t.select();
      document.execCommand('copy'); t.remove();
    }
    toast('📋 복사했어요!');
  }

  function confirmBox(title, text, okLabel = '확인') {
    const d = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('button[value=ok]', d).textContent = okLabel;
    d.returnValue = '';
    d.showModal();
    return new Promise(resolve => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
  }

  function show(view) {
    for (const id of ['loading', 'home', 'board', 'offline']) $(`#${id}`).hidden = id !== view;
  }

  // ---- 동적 레이아웃 --------------------------------------------------------
  function applyLayout() {
    document.body.dataset.ui = MOBILE_UI ? 'mobile' : 'desktop';
    document.body.classList.toggle('compact', MOBILE_UI || compactQuery.matches);
    document.body.classList.toggle('touch', matchMedia('(hover: none)').matches);
    if (!document.body.classList.contains('compact')) closeSheet();
  }

  function setupSwitchLink() {
    const a = $('#switch-ui');
    const q = S.code ? `b=${S.code}` : '';
    if (MOBILE_UI) { a.textContent = '🖥 PC 화면으로 보기'; a.href = `/?view=desktop${q ? '&' + q : ''}`; }
    else { a.textContent = '📱 모바일 화면'; a.href = `/m/${q ? '?' + q : ''}`; }
  }

  function openSheet() {
    if (!document.body.classList.contains('compact')) { $('#note-form textarea').focus(); return; }
    $('#composer').classList.add('open');
    $('#sheet-backdrop').hidden = false;
    document.body.classList.add('sheet-open');
    setTimeout(() => { const t = $('#note-form textarea'); if (!S.board?.closed) t.focus({ preventScroll: true }); }, 250);
  }
  function closeSheet() {
    $('#composer').classList.remove('open');
    $('#sheet-backdrop').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  // ---- 세션 -----------------------------------------------------------------
  async function loadSession() {
    const data = await api('/api/session');
    S.session = data;
    S.offset = data.serverTime - Date.now();
  }

  function showOffline(err) {
    stopRealtime();
    clearTimeout(S.pulseTimer);
    show('offline');
    const ended = err && err.status === 410;
    $('#offline-title').textContent = ended ? '실습 시간이 끝났어요' : '서비스가 쉬고 있어요';
    $('#offline-text').textContent = ended
      ? '1시간 실습 세션이 종료되어 서비스가 닫혔어요. 다시 실습하려면 Docker 컨테이너를 새로 시작해 주세요.'
      : '실습용 Docker 컨테이너가 꺼져 있어서 연결할 수 없어요. 컨테이너를 켠 뒤 다시 시도해 주세요.';
  }

  function tickService() {
    if (!S.session) return;
    const remain = S.session.expiresAt - serverNow();
    $('#service-left').textContent = remain > 0 ? `⏳ 실습 서비스 종료까지 ${left(remain)}` : '실습 서비스가 종료되었어요';
  }

  // ---- 처음 화면 ------------------------------------------------------------
  function renderHome() {
    const themeList = $('#theme-list');
    themeList.replaceChildren(...Object.entries(THEMES).map(([key, t], i) => {
      const label = el('label', 'chip-radio');
      const input = el('input'); input.type = 'radio'; input.name = 'theme'; input.value = key; input.checked = i === 0;
      label.append(input, el('span', '', `${t.emoji} ${t.label}`));
      return label;
    }));
    const dl = $('#deadline-list');
    dl.replaceChildren(...DEADLINES.filter(d => d.id !== 'eve' || atHour(0, 18) > Date.now() + 5 * 6e4).map(d => {
      const label = el('label', 'chip-radio');
      const input = el('input'); input.type = 'radio'; input.name = 'deadline'; input.value = d.id; input.checked = d.id === S.deadline;
      label.append(input, el('span', '', d.label));
      return label;
    }));
    const custom = $('#create [name=custom]');
    const pad = n => String(n).padStart(2, '0');
    const d = new Date(Date.now() + 2 * 3600e3);
    custom.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    autoTitle();
    deadlineHint();
    const recent = store.get('rp.recent', []);
    const admins = store.get('rp.admin', {});
    $('#recent').hidden = !recent.length;
    $('#recent-list').replaceChildren(...recent.map(r => {
      const li = el('li');
      const a = el('a', '', `${THEMES[r.theme]?.emoji || '📝'} ${r.title}`);
      a.href = `${location.pathname}?b=${r.code}`;
      li.append(a);
      if (admins[r.code]) li.append(el('span', 'tag', '관리자'));
      return li;
    }));
  }

  function autoTitle() {
    if (S.titleTouched) return;
    const theme = THEMES[$('#create [name=theme]:checked')?.value || 'birthday'];
    const name = $('#create [name=recipient]').value.trim();
    $('#create [name=title]').value = theme.title(name || (theme === THEMES.feedback || theme === THEMES.graduation ? '오늘' : '우리 팀'));
  }

  function chosenDeadline() {
    const id = $('#create [name=deadline]:checked')?.value || '30';
    return DEADLINES.find(d => d.id === id).at();
  }

  function deadlineHint() {
    const id = $('#create [name=deadline]:checked')?.value;
    $('#create [name=custom]').hidden = id !== 'custom';
    const at = chosenDeadline();
    const hint = $('#deadline-hint');
    if (!Number.isFinite(at)) { hint.textContent = '마감 시각을 골라 주세요.'; return; }
    let text = `🗓 ${fmtTime(at)}에 작성이 잠기고 공개돼요.`;
    if (S.session && at > S.session.expiresAt) text += ` (실습 서비스는 ${fmtClock(S.session.expiresAt)}에 닫혀요. 그 뒤 마감은 서비스를 다시 켤 때 이어져요.)`;
    hint.textContent = text;
  }

  async function createBoard(e) {
    e.preventDefault();
    const f = e.target;
    const err = $('#create-error');
    err.hidden = true;
    const at = chosenDeadline();
    const relative = ['10', '30', '60'].includes(f.deadline.value);
    const titleInput = f.elements.title;
    const title = titleInput.value.trim();
    if (!title) { err.textContent = '보드 제목을 적어 주세요.'; err.hidden = false; titleInput.focus(); return; }
    if (!Number.isFinite(at) || at < Date.now() + 60e3) { err.textContent = '마감은 1분 뒤 이후로 정해 주세요.'; err.hidden = false; return; }
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    btn.textContent = '만드는 중…';
    try {
      const data = await api('/api/boards', { body: {
        title, recipient: f.recipient.value.trim(), theme: f.theme.value,
        deadline: new Date(relative ? at + S.offset : at).toISOString(), secret: f.secret.checked,
      } });
      const admins = store.get('rp.admin', {});
      admins[data.board.code] = data.adminKey;
      store.set('rp.admin', admins);
      try { sessionStorage.setItem('rp.created', data.board.code); } catch { /* 선택 기능 */ }
      location.href = `${location.pathname}?b=${data.board.code}`;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = '보드 만들기 →';
    }
  }

  // ---- 보드 -----------------------------------------------------------------
  function remember(board) {
    const recent = store.get('rp.recent', []).filter(r => r.code !== board.code);
    recent.unshift({ code: board.code, title: board.title, theme: board.theme });
    store.set('rp.recent', recent.slice(0, 8));
  }

  async function openBoard() {
    try {
      await refetch();
    } catch (e) {
      if (e.status === 404) {
        toast(e.message, 'warn');
        history.replaceState(null, '', location.pathname);
        S.code = '';
        renderHome();
        show('home');
        return;
      }
      throw e;
    }
    show('board');
    remember(S.board);
    buildComposer();
    connectRealtime();
    schedulePulse();
    let created = null;
    try { created = sessionStorage.getItem('rp.created'); sessionStorage.removeItem('rp.created'); } catch { /* 선택 기능 */ }
    if (created === S.code) {
      confetti(THEMES[S.board.theme].fx, 30);
      setTimeout(() => openInvite(), 400);
    }
  }

  function refetch() {
    if (S.refetching) { S.refetchAgain = true; return S.refetching; }
    S.refetching = (async () => {
      try {
        const data = await api(`/api/board?b=${S.code}`);
        const before = new Set(S.notes.map(n => n.id));
        const newcomers = data.notes.filter(n => !before.has(n.id));
        const hiddenBefore = S.board ? S.board.count - S.notes.length : 0;
        S.notes = data.notes;
        applyBoard(data.board);
        if (S.loaded && !S.revealing) {
          newcomers.forEach(n => S.fresh.add(n.id));
          if (newcomers.some(n => !n.mine)) toast('📌 새 포스트잇이 붙었어요!');
          const hiddenNow = S.board.count - S.notes.length;
          if (S.board.secret && !S.board.closed && hiddenNow > hiddenBefore) toast('🤫 누군가 비밀 포스트잇을 붙였어요!');
        }
        S.loaded = true;
        renderWall();
      } finally {
        S.refetching = null;
        if (S.refetchAgain) { S.refetchAgain = false; scheduleRefetch(); }
      }
    })();
    return S.refetching;
  }

  function scheduleRefetch() {
    clearTimeout(S.refetchTimer);
    S.refetchTimer = setTimeout(() => refetch().catch(handleDown), 200 + Math.random() * 400);
  }

  function applyBoard(b) {
    const prev = S.board;
    S.board = b;
    const theme = THEMES[b.theme] || THEMES.birthday;
    document.body.dataset.theme = b.theme;
    document.title = `${b.title} · 우리 팀 롤링페이퍼`;
    $('#theme-emoji').textContent = theme.emoji;
    $('#board-title').textContent = b.title;
    $('#board-sub').textContent = [b.recipient && `To. ${b.recipient}`, b.secret ? '🤫 비밀 모드' : '', `마감 ${fmtTime(Date.parse(b.deadline) - S.offset)}`].filter(Boolean).join(' · ');
    $('#stats').textContent = `📝 ${b.count}장 · ❤️ ${b.hearts}`;
    $('#admin-btn').hidden = !S.admin;
    const secretNote = $('#secret-note');
    secretNote.hidden = !(b.secret && !b.closed);
    secretNote.textContent = '🤫 비밀 모드예요. 마감 전까지는 내가 쓴 글만 보이고, 다른 사람 글은 접혀 있어요. 마감 순간 모두 함께 공개됩니다!';
    lockComposer();
    tickCountdown();
    if (S.wasClosed === false && b.closed) onReveal();
    S.wasClosed = b.closed;
    if (prev && prev.deadline !== b.deadline && !b.closed) toast(`⏰ 마감 시간이 ${fmtClock(Date.parse(b.deadline) - S.offset)}로 바뀌었어요`);
  }

  function tickCountdown() {
    const b = S.board;
    if (!b) return;
    const c = $('#countdown');
    const remain = Date.parse(b.deadline) - serverNow();
    c.classList.toggle('urgent', !b.closed && remain < 60e3);
    c.classList.toggle('done', b.closed);
    if (b.closed) { c.textContent = b.secret ? '🔓 공개되었어요' : '🔒 마감'; return; }
    c.textContent = `⏰ 마감까지 ${left(remain)}`;
    if (remain <= 0 && Date.now() - S.deadlineCheck > 3000) {
      S.deadlineCheck = Date.now();
      refetch().catch(handleDown);
    }
  }

  function onReveal() {
    const theme = THEMES[S.board.theme] || THEMES.birthday;
    closeSheet();
    if (S.board.secret) {
      S.revealing = true;
      toast('🎉 마감! 비밀 포스트잇을 모두 공개합니다');
      setTimeout(() => { S.revealing = false; }, 4000);
    } else {
      toast('⏰ 마감되었어요! 🎬 공개 모드로 함께 읽어 보세요');
    }
    confetti(theme.fx, 40);
  }

  function sortedNotes() {
    const list = [...S.notes];
    if (S.sort === 'hearts') list.sort((a, b) => b.hearts - a.hearts || b.id - a.id);
    if (S.sort === 'photos') return list.filter(n => n.photo);
    return list;
  }

  function renderWall() {
    const wall = $('#wall');
    const list = sortedNotes();
    const top = S.notes.reduce((best, n) => (n.hearts >= 2 && (!best || n.hearts > best.hearts) ? n : best), null);
    const frag = document.createDocumentFragment();
    list.forEach((n, i) => frag.append(noteEl(n, top && top.id === n.id, i)));
    const hidden = S.board.secret && !S.board.closed ? Math.max(0, S.board.count - S.notes.length) : 0;
    if (S.sort !== 'photos') {
      for (let i = 0; i < Math.min(hidden, 30); i++) {
        const card = el('article', 'note folded');
        card.style.setProperty('--tilt', `${tilt(i + 1000)}deg`);
        card.append(el('span', 'fold-emoji', '🤫'), el('p', 'msg', '비밀 포스트잇'), el('p', 'by', '마감 후 공개'));
        frag.append(card);
      }
      if (hidden > 30) frag.append(el('p', 'more-hidden', `외 비밀 포스트잇 ${hidden - 30}장`));
    }
    if (!frag.childNodes.length) {
      const empty = el('div', 'empty');
      empty.append(el('p', 'big-emoji', S.sort === 'photos' ? '📷' : '✍️'),
        el('p', '', S.sort === 'photos' ? '아직 사진 포스트잇이 없어요.' : S.board.closed ? '마감된 보드예요. 남겨진 글이 없어요.' : '첫 번째 포스트잇을 붙여 주세요!'));
      if (!S.board.closed && S.sort !== 'photos') {
        const b = el('button', 'primary', '✍️ 첫 글 남기기');
        b.type = 'button';
        b.addEventListener('click', openSheet);
        empty.append(b);
      }
      frag.append(empty);
    }
    wall.replaceChildren(frag);
    observePhotos();
    if (S.fresh.size) setTimeout(() => S.fresh.clear(), 2500);
  }

  function noteEl(n, isTop, index) {
    const a = el('article', `note c-${n.color} f-${n.font}`);
    if (n.photo) a.classList.add('has-photo');
    if (n.mine) a.classList.add('mine');
    if (S.fresh.has(n.id)) a.classList.add('fresh');
    if (S.revealing) { a.classList.add('reveal'); a.style.animationDelay = `${Math.min(index, 24) * 90}ms`; }
    a.style.setProperty('--tilt', `${tilt(n.id)}deg`);
    a.dataset.id = n.id;
    if (isTop) a.append(el('span', 'crown', '👑 인기'));
    if (n.sticker) a.append(el('span', 'sticker', STICKERS[n.sticker] || ''));
    if (n.photo) {
      const p = el('div', 'polaroid');
      const img = el('img');
      img.alt = `${n.author}님이 붙인 사진`;
      img.dataset.note = n.id;
      if (S.photoUrls.has(n.id)) img.src = S.photoUrls.get(n.id);
      p.append(img);
      a.append(p);
    }
    a.append(el('p', 'msg', n.message), el('p', 'by', `- ${n.author}`));
    const foot = el('footer', 'note-foot');
    const heart = el('button', 'heart');
    heart.type = 'button';
    heart.dataset.heart = n.id;
    heart.setAttribute('aria-pressed', String(n.hearted));
    heart.setAttribute('aria-label', `하트 ${n.hearts}개, ${n.hearted ? '하트 취소' : '하트 누르기'}`);
    heart.append(el('span', 'h-icon', n.hearted ? '❤️' : '🤍'), el('span', 'h-count', String(n.hearts)));
    if (S.offline) heart.disabled = true;
    foot.append(heart, el('time', 'when', ago(n.createdAt)));
    if (n.mine || S.admin) {
      const del = el('button', 'del', '🗑');
      del.type = 'button';
      del.dataset.del = n.id;
      del.setAttribute('aria-label', n.mine ? '내 글 지우기' : '관리자 삭제');
      foot.append(del);
    }
    if (n.mine) a.append(el('span', 'mine-tag', '내 글'));
    a.append(foot);
    return a;
  }

  let photoObserver = null;
  function observePhotos() {
    const imgs = $$('#wall img[data-note]:not([src])');
    if (!('IntersectionObserver' in window)) { imgs.forEach(loadPhoto); return; }
    photoObserver ||= new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { photoObserver.unobserve(e.target); loadPhoto(e.target); }
    }), { rootMargin: '300px' });
    imgs.forEach(img => photoObserver.observe(img));
  }

  async function photoUrl(id) {
    if (S.photoUrls.has(id)) return S.photoUrls.get(id);
    const res = await api(`/api/photo?b=${S.code}&id=${id}`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    S.photoUrls.set(id, url);
    return url;
  }

  async function loadPhoto(img) {
    try { img.src = await photoUrl(Number(img.dataset.note)); }
    catch { img.closest('.polaroid')?.classList.add('broken'); }
  }

  async function toggleHeart(btn) {
    if (S.offline) return;
    const id = Number(btn.dataset.heart);
    const n = S.notes.find(x => x.id === id);
    if (!n) return;
    const before = { hearts: n.hearts, hearted: n.hearted };
    n.hearted = !n.hearted;
    n.hearts += n.hearted ? 1 : -1;
    paintHeart(btn, n);
    if (n.hearted) burst(btn);
    try {
      const r = await api('/api/heart', { body: { b: S.code, id } });
      n.hearts = r.hearts;
      n.hearted = r.hearted;
    } catch (e) {
      Object.assign(n, before);
      toast(e.message, 'warn');
    }
    paintHeart(btn, n);
  }

  function paintHeart(btn, n) {
    btn.setAttribute('aria-pressed', String(n.hearted));
    btn.setAttribute('aria-label', `하트 ${n.hearts}개, ${n.hearted ? '하트 취소' : '하트 누르기'}`);
    $('.h-icon', btn).textContent = n.hearted ? '❤️' : '🤍';
    $('.h-count', btn).textContent = String(n.hearts);
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  }

  async function deleteNote(id) {
    const n = S.notes.find(x => x.id === id);
    if (!n) return;
    const ok = await confirmBox('포스트잇 지우기', `"${n.message.slice(0, 30)}" 포스트잇을 지울까요? 되돌릴 수 없어요.`, '지우기');
    if (!ok) return;
    try {
      await api('/api/delete', { body: { b: S.code, id } });
      S.notes = S.notes.filter(x => x.id !== id);
      S.board.count = Math.max(0, S.board.count - 1);
      applyBoard(S.board);
      renderWall();
      toast('🗑 지웠어요');
    } catch (e) { toast(e.message, 'warn'); }
  }

  // ---- 작성 ----------------------------------------------------------------
  function buildComposer() {
    const saved = store.get('rp.style', { color: 'yellow', font: 'pen' });
    const radio = (name, value, checked, child, label) => {
      const l = el('label', name === 'color' ? `swatch c-${value}` : name === 'sticker' ? 'sticker-pick' : 'chip-radio');
      const i = el('input'); i.type = 'radio'; i.name = name; i.value = value; i.checked = checked;
      l.title = label;
      l.append(i, child);
      return l;
    };
    $('#colors').replaceChildren(...COLORS.map(([v, label]) => radio('color', v, v === saved.color, el('span', 'sr', label), label)));
    $('#stickers').replaceChildren(...Object.entries(STICKERS).map(([v, e]) => radio('sticker', v, v === '', el('span', '', v ? e : '∅'), v ? e : '스티커 없음')));
    $('#fonts').replaceChildren(...FONTS.map(([v, label]) => radio('font', v, v === saved.font, el('span', `f-${v}`, label), label)));
    $('#note-form [name=author]').value = store.get('rp.author', '');
    updatePreview();
  }

  function updatePreview() {
    const f = $('#note-form');
    const p = $('#preview');
    const color = f.color?.value || 'yellow';
    const font = f.font?.value || 'pen';
    p.className = `note preview c-${color} f-${font}${S.photo ? ' has-photo' : ''}`;
    const sticker = f.sticker?.value || '';
    $('.sticker', p).textContent = sticker ? STICKERS[sticker] : '';
    $('.msg', p).textContent = f.message.value.trim() || '여기에 마음을 적어 주세요';
    $('.by', p).textContent = `- ${f.author.value.trim() || '익명'}`;
    const pol = $('.polaroid', p);
    pol.hidden = !S.photo;
    if (S.photo) $('img', pol).src = S.photo.url;
    $('#counter').textContent = `${f.message.value.length}/100`;
    $('#counter').classList.toggle('full', f.message.value.length >= 100);
  }

  function lockComposer() {
    const closed = !S.board || S.board.closed;
    $('#note-form').hidden = closed;
    $('#locked').hidden = !closed;
    $('#submit').disabled = S.offline;
    $('#fab').textContent = closed ? '🎬 공개 모드' : '✍️ 남기기';
    $('#fab').dataset.mode = closed ? 'show' : 'write';
  }

  function blobToDataUrl(blob) {
    return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob); });
  }

  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 아래 방식으로 */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  async function shrinkPhoto(file) {
    if (!file.type.startsWith('image/')) throw new Error('사진 파일만 붙일 수 있어요.');
    if (file.size > 30e6) throw new Error('30MB 이하 사진만 붙일 수 있어요.');
    const image = await decodeImage(file);
    const w = image.width, h = image.height;
    for (const [max, q] of [[1080, 0.82], [900, 0.76], [720, 0.7], [560, 0.65]]) {
      const scale = Math.min(1, max / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(image, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= 640 * 1024) return blob;
    }
    throw new Error('사진을 줄이지 못했어요. 다른 사진을 골라 주세요.');
  }

  async function choosePhoto(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const info = $('#photo-info');
    info.textContent = '사진을 줄이는 중…';
    try {
      const blob = await shrinkPhoto(file);
      if (S.photo) URL.revokeObjectURL(S.photo.url);
      S.photo = { blob, url: URL.createObjectURL(blob), data: await blobToDataUrl(blob) };
      info.textContent = `📸 ${Math.round(blob.size / 1024)}KB로 줄였어요 (위치정보 제거)`;
      $('#photo-clear').hidden = false;
    } catch (ex) {
      info.textContent = '';
      toast(ex.message, 'warn');
    }
    updatePreview();
  }

  function clearPhoto() {
    if (S.photo) URL.revokeObjectURL(S.photo.url);
    S.photo = null;
    $('#photo-clear').hidden = true;
    $('#photo-info').textContent = '';
    updatePreview();
  }

  async function submitNote(e) {
    e.preventDefault();
    const f = e.target;
    const err = $('#note-error');
    err.hidden = true;
    const message = f.message.value.trim();
    if (!message) { err.textContent = '메시지를 한 글자 이상 적어 주세요.'; err.hidden = false; f.message.focus(); return; }
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = S.photo ? '사진 올리는 중…' : '붙이는 중…';
    try {
      const { note } = await api('/api/notes', { body: {
        b: S.code, author: f.author.value.trim(), message, color: f.color.value,
        sticker: f.sticker.value, font: f.font.value, photo: S.photo ? S.photo.data : null,
      } });
      if (S.photo) { S.photoUrls.set(note.id, URL.createObjectURL(S.photo.blob)); }
      store.set('rp.author', f.author.value.trim());
      store.set('rp.style', { color: f.color.value, font: f.font.value });
      if (!S.notes.some(n => n.id === note.id)) {
        S.notes.unshift(note);
        S.board.count += 1;
      }
      S.fresh.add(note.id);
      applyBoard(S.board);
      renderWall();
      f.message.value = '';
      $('#stickers input[value=""]').checked = true;
      clearPhoto();
      setTyping(false);
      closeSheet();
      toast('📌 붙였어요! 고마워요');
      confetti([STICKERS[note.sticker] || '✨', '💛', '✨'], 14);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      if (ex.status === 423) refetch().catch(() => {});
    } finally {
      btn.disabled = S.offline;
      btn.textContent = '붙이기 📌';
    }
  }

  function useIdea() {
    const theme = THEMES[S.board?.theme] || THEMES.birthday;
    const t = $('#note-form [name=message]');
    let idea;
    do { idea = pick(theme.ideas); } while (theme.ideas.length > 1 && idea === t.value);
    t.value = idea;
    updatePreview();
    t.focus();
  }

  // ---- 실시간 (Supabase Realtime Broadcast + Presence) ------------------------
  function loadScript(src) {
    return new Promise((ok, fail) => {
      if (window.supabase) return ok();
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = fail;
      document.head.append(s);
    });
  }

  async function connectRealtime() {
    const rt = S.session?.realtime;
    if (!rt || !S.board || S.channel) return;
    try { await loadScript('/vendor/supabase.js'); } catch { return; }
    if (!window.supabase?.createClient) return;
    S.rt ||= window.supabase.createClient(rt.url, rt.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
    const me = S.voter.slice(0, 12);
    const ch = S.rt.channel(`rp-${S.board.id}`, { config: { broadcast: { self: false }, presence: { key: me } } });
    ch.on('broadcast', { event: 'sync' }, () => scheduleRefetch())
      .on('presence', { event: 'sync' }, () => paintPresence(ch, me))
      .subscribe(status => {
        const ready = status === 'SUBSCRIBED';
        if (ready !== S.rtReady) {
          S.rtReady = ready;
          if (ready) { ch.track({ typing: S.typing }); scheduleRefetch(); }
          schedulePulse();
        }
      });
    S.channel = ch;
  }

  function stopRealtime() {
    if (S.channel && S.rt) S.rt.removeChannel(S.channel);
    S.channel = null;
    S.rtReady = false;
    $('#viewers').hidden = true;
    $('#typing').hidden = true;
  }

  function paintPresence(ch, me) {
    const state = ch.presenceState();
    const keys = Object.keys(state);
    const typing = keys.filter(k => k !== me && state[k].some(p => p.typing)).length;
    $('#viewers').hidden = !keys.length;
    $('#viewers').textContent = `👀 ${keys.length}명 보는 중`;
    $('#typing').hidden = !typing;
    $('#typing').textContent = `✍️ ${typing}명이 쓰는 중…`;
  }

  function setTyping(on) {
    clearTimeout(S.typingTimer);
    if (on) S.typingTimer = setTimeout(() => setTyping(false), 3500);
    if (on === S.typing) return;
    S.typing = on;
    if (S.channel && S.rtReady) S.channel.track({ typing: on });
  }

  // ---- 연결 감시: 컨테이너가 꺼지면 바로 잠금 ----------------------------------
  function schedulePulse() {
    clearTimeout(S.pulseTimer);
    if (!S.code || !S.board) return;
    const ms = S.offline ? 8000 : S.rtReady ? 15000 : 4000;
    S.pulseTimer = setTimeout(pulse, ms);
  }

  async function pulse() {
    try {
      const d = await api(`/api/pulse?b=${S.code}`);
      S.offset = d.serverTime - Date.now();
      if (S.offline) await recover();
      S.session.expiresAt = d.expiresAt;
      if (d.board.rev !== S.board.rev || d.board.closed !== S.board.closed) await refetch();
      else applyBoard(d.board);
    } catch (e) {
      handleDown(e);
    } finally {
      schedulePulse();
    }
  }

  function handleDown(e) {
    if (e.status === 410) { showOffline(e); return; }
    if (e.status && e.status < 500 && e.status !== 404) return;
    if (!S.offline) {
      S.offline = true;
      document.body.classList.add('is-offline');
      banner('⚠️ 서비스에 연결할 수 없어요. Docker 컨테이너가 꺼졌을 수 있어요. 다시 연결되면 자동으로 이어져요.');
      stopRealtime();
      lockComposer();
      renderWall();
    }
  }

  async function recover() {
    await loadSession();
    S.offline = false;
    document.body.classList.remove('is-offline');
    banner('');
    toast('✅ 다시 연결되었어요');
    lockComposer();
    connectRealtime();
  }

  // ---- 초대 · 관리 · 공개 모드 ---------------------------------------------
  function shareLink() { return `${location.origin}/?b=${S.code}`; }

  function openInvite() {
    const link = shareLink();
    $('#invite-link').value = link;
    $('#qr').src = `/api/qr?url=${encodeURIComponent(link)}`;
    $('#share').hidden = !navigator.share;
    $('#admin-link-box').hidden = !S.admin;
    if (S.admin) $('#admin-link').value = `${link}#admin=${S.admin}`;
    $('#invite').showModal();
  }

  async function adminDeadline(body, success) {
    try {
      const d = await api('/api/deadline', { body: { b: S.code, ...body } });
      applyBoard(d.board);
      await refetch();
      toast(success);
      $('#admin').close();
    } catch (e) { toast(e.message, 'warn'); }
  }

  async function exportCsv() {
    try {
      const res = await api(`/api/export?b=${S.code}`, { raw: true });
      const url = URL.createObjectURL(await res.blob());
      const a = el('a');
      a.href = url;
      a.download = `${S.board.title}-롤링페이퍼.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('⬇️ CSV를 내려받았어요');
    } catch (e) { toast(e.message, 'warn'); }
  }

  const SHOW = { list: [], i: 0, timer: 0, playing: true, x: null };

  function openShow() {
    if (!S.board) return;
    if (S.board.secret && !S.board.closed) { toast('🤫 비밀 모드는 마감 후에 공개 모드가 열려요', 'warn'); return; }
    if (!S.notes.length) { toast('아직 공개할 포스트잇이 없어요'); return; }
    closeSheet();
    SHOW.list = [...S.notes].sort((a, b) => a.id - b.id);
    SHOW.i = 0;
    SHOW.playing = !reduceMotion.matches;
    $('#show-title').textContent = `${THEMES[S.board.theme]?.emoji || ''} ${S.board.recipient ? `To. ${S.board.recipient}` : S.board.title}`;
    $('#show').hidden = false;
    document.body.classList.add('show-open');
    paintSlide();
    $('#show-next').focus();
  }

  function closeShow() {
    clearTimeout(SHOW.timer);
    $('#show').hidden = true;
    document.body.classList.remove('show-open');
  }

  function paintSlide() {
    clearTimeout(SHOW.timer);
    const stage = $('#show-stage');
    const total = SHOW.list.length;
    $('#show-count').textContent = SHOW.i < total ? `${SHOW.i + 1} / ${total}` : '마지막';
    $('#show-play').textContent = SHOW.playing ? '⏸ 멈춤' : '▶ 재생';
    if (SHOW.i >= total) {
      const end = el('div', 'show-end');
      const top = [...SHOW.list].sort((a, b) => b.hearts - a.hearts)[0];
      end.append(el('p', 'big-emoji', THEMES[S.board.theme]?.emoji || '🎉'),
        el('h2', '', `${total}장의 마음이 모였어요`),
        el('p', '', `❤️ 하트 ${S.board.hearts}개 · ✍️ ${new Set(SHOW.list.map(n => n.author)).size}명 참여`));
      if (top && top.hearts > 0) end.append(el('p', 'hint light', `👑 가장 사랑받은 글: "${top.message}" - ${top.author}`));
      stage.replaceChildren(end);
      confetti(THEMES[S.board.theme]?.fx || ['🎉'], 36);
    } else {
      const n = SHOW.list[SHOW.i];
      const card = noteEl(n, false, 0);
      card.classList.add('slide');
      card.classList.remove('fresh', 'reveal', 'mine');
      $('.mine-tag', card)?.remove();
      $('.note-foot', card).replaceChildren(el('span', 'h-count', `❤️ ${n.hearts}`));
      stage.replaceChildren(card);
      const img = $('img[data-note]', card);
      if (img && !img.src) loadPhoto(img);
    }
    const bar = $('#show-bar span');
    bar.style.width = `${Math.min(100, (SHOW.i + 1) / (total + 1) * 100)}%`;
    if (SHOW.playing && SHOW.i < total) SHOW.timer = setTimeout(() => step(1), 5500);
  }

  function step(dir) {
    SHOW.i = Math.max(0, Math.min(SHOW.list.length, SHOW.i + dir));
    paintSlide();
  }

  // ---- 이벤트 연결 ---------------------------------------------------------
  function wire() {
    compactQuery.addEventListener('change', applyLayout);
    $('#create').addEventListener('submit', createBoard);
    $('#create').addEventListener('change', e => {
      if (e.target.name === 'theme') autoTitle();
      if (e.target.name === 'deadline' || e.target.name === 'custom') deadlineHint();
    });
    $('#create [name=recipient]').addEventListener('input', autoTitle);
    $('#create [name=title]').addEventListener('input', () => { S.titleTouched = true; });

    const form = $('#note-form');
    form.addEventListener('submit', submitNote);
    form.addEventListener('input', e => { updatePreview(); if (e.target.name === 'message') setTyping(true); });
    form.addEventListener('change', updatePreview);
    $('#idea').addEventListener('click', useIdea);
    $('#photo').addEventListener('change', choosePhoto);
    $('#photo-clear').addEventListener('click', clearPhoto);

    $('#wall').addEventListener('click', e => {
      const h = e.target.closest('[data-heart]');
      if (h) return toggleHeart(h);
      const d = e.target.closest('[data-del]');
      if (d) return deleteNote(Number(d.dataset.del));
    });
    $('#wall').addEventListener('dblclick', e => {
      const note = e.target.closest('.note[data-id]');
      const h = note && $('[data-heart]', note);
      if (h && h.getAttribute('aria-pressed') === 'false') toggleHeart(h);
    });

    $$('.seg [data-sort]').forEach(b => b.addEventListener('click', () => {
      S.sort = b.dataset.sort;
      $$('.seg [data-sort]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderWall();
    }));
    document.addEventListener('click', e => {
      const o = e.target.closest('[data-open]');
      if (!o) return;
      const what = o.dataset.open;
      if (what === 'show') openShow();
      if (what === 'invite') openInvite();
      if (what === 'admin') $('#admin').showModal();
    });
    $$('[data-copy]').forEach(b => b.addEventListener('click', () => copy($(`#${b.dataset.copy}`).value)));
    $('#share').addEventListener('click', () => navigator.share({ title: S.board.title, text: '롤링페이퍼에 한마디 남겨 주세요!', url: shareLink() }).catch(() => {}));
    $('#close-now').addEventListener('click', async () => {
      if (await confirmBox('지금 마감할까요?', '작성이 잠기고, 비밀 모드라면 모든 글이 바로 공개돼요.', '마감하기')) adminDeadline({ closeNow: true }, '🔒 마감했어요!');
    });
    $('#extend').addEventListener('click', () => adminDeadline({ addMinutes: 10 }, '➕ 마감을 10분 늘렸어요'));
    $('#export').addEventListener('click', exportCsv);

    $('#fab').addEventListener('click', () => ($('#fab').dataset.mode === 'show' ? openShow() : openSheet()));
    $('#sheet-backdrop').addEventListener('click', closeSheet);
    $('.sheet-close').addEventListener('click', closeSheet);
    $$('.tabbar [data-tab]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.tab === 'top') { closeSheet(); scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); }
      else if (S.board?.closed) openShow();
      else openSheet();
    }));

    $('#show-close').addEventListener('click', closeShow);
    $('#show-prev').addEventListener('click', () => step(-1));
    $('#show-next').addEventListener('click', () => step(1));
    $('#show-play').addEventListener('click', () => { SHOW.playing = !SHOW.playing; paintSlide(); });
    const stage = $('#show');
    stage.addEventListener('pointerdown', e => { SHOW.x = e.clientX; });
    stage.addEventListener('pointerup', e => {
      if (SHOW.x === null || e.target.closest('button')) return;
      const dx = e.clientX - SHOW.x;
      SHOW.x = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    });
    document.addEventListener('keydown', e => {
      if (!$('#show').hidden) {
        if (e.key === 'Escape') closeShow();
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step(1); }
        if (e.key === 'ArrowLeft') step(-1);
      } else if (e.key === 'Escape') closeSheet();
    });
    $('#retry').addEventListener('click', () => location.reload());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && S.board) { clearTimeout(S.pulseTimer); pulse(); }
    });
  }

  async function boot() {
    applyLayout();
    S.voter = store.get('rp.voter', '');
    if (!/^[a-f0-9]{32}$/.test(S.voter)) { S.voter = newVoter(); store.set('rp.voter', S.voter); }
    const params = new URLSearchParams(location.search);
    S.code = (params.get('b') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const m = location.hash.match(/admin=([A-Za-z0-9_-]{16,64})/);
    if (m && S.code) {
      const admins = store.get('rp.admin', {});
      admins[S.code] = m[1];
      store.set('rp.admin', admins);
      history.replaceState(null, '', location.pathname + location.search);
    }
    S.admin = S.code ? (store.get('rp.admin', {})[S.code] || '') : '';
    wire();
    setupSwitchLink();
    try {
      await loadSession();
    } catch (e) {
      showOffline(e);
      return;
    }
    tickService();
    setInterval(() => { tickService(); tickCountdown(); }, 1000);
    setInterval(() => $$('#wall .when').forEach((t, i) => {
      const n = sortedNotes()[i];
      if (n) t.textContent = ago(n.createdAt);
    }), 30000);
    if (S.code) {
      try { await openBoard(); } catch (e) { showOffline(e); }
    } else {
      renderHome();
      show('home');
    }
  }

  boot();
})();
