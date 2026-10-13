'use strict';
const $ = id => document.getElementById(id);
const defaults = [
  {name:'김치찌개',emoji:'🍲',type:'soup'}, {name:'돈까스',emoji:'🍱',type:'hearty'},
  {name:'쌀국수',emoji:'🍜',type:'soup'}, {name:'샐러드',emoji:'🥗',type:'light'},
  {name:'햄버거',emoji:'🍔',type:'hearty'}, {name:'마라탕',emoji:'🌶️',type:'soup'}
];
const colors = ['#ffd795','#fca58c','#e2ebbd','#ffeac3','#f9c2ab','#cbdca7'];
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
let menus = read('lunch-menus', defaults.map(m=>({...m,on:true})));
if (!Array.isArray(menus) || !menus.length || menus.length>12 || !menus.every(m=>typeof m.name==='string' && m.name.length<=20 && typeof m.on==='boolean')) menus = defaults.map(m=>({...m,on:true}));
let voter = read('lunch-voter', null);
if (typeof voter!=='string' || !/^[a-zA-Z0-9-]{16,64}$/.test(voter)) { voter = Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''); save('lunch-voter',voter); }
let team = (new URLSearchParams(location.search).get('team') || '우리팀').trim().slice(0,24) || '우리팀';
let selected = null, spinning = false, voting = false, closed = false, angle = 0, sessionKey = '', expires = 0, offset = 0, today = '';
let toastTimer, resultTimer;
$('team').value = team;
function notify(message) { $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4000); }
function candidates() { return menus.filter(m=>m.on); }
function voteKey() { return 'lunch-voted:'+today+':'+team; }
function refreshButtons() {
  $('spin').disabled = closed || !sessionKey || spinning || candidates().length===0;
  $('vote').disabled = closed || spinning || voting || !!read(voteKey(),false);
  $('vote').textContent=read(voteKey(),false)?'오늘 투표 완료 ✓':voting?'투표 저장 중…':'이걸로 결정! 🙌';
  document.querySelectorAll('#menus input,#menus button,#presets button,#reset,#add-form input,#add-form button,#team-form input,#team-form button').forEach(el=>el.disabled=spinning||closed);
}
function draw() {
  const active=candidates(), c=$('wheel'), ctx=c.getContext('2d'), n=active.length;
  ctx.clearRect(0,0,720,720);
  if(!n){ctx.fillStyle='#f1f0e7';ctx.beginPath();ctx.arc(360,360,350,0,Math.PI*2);ctx.fill();ctx.fillStyle='#777';ctx.font='25px sans-serif';ctx.textAlign='center';ctx.fillText('메뉴를 선택해 주세요',360,260);return;}
  active.forEach((m,i)=>{
    const start=-Math.PI/2+i*2*Math.PI/n, mid=start+Math.PI/n;
    ctx.fillStyle=colors[i%colors.length];ctx.beginPath();ctx.moveTo(360,360);ctx.arc(360,360,350,start,start+2*Math.PI/n);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#ffffffaa';ctx.lineWidth=3;ctx.stroke();ctx.save();ctx.translate(360,360);ctx.rotate(mid+Math.PI/2);
    ctx.textAlign='center';ctx.fillStyle='#373c2d';ctx.font='40px sans-serif';ctx.fillText(m.emoji||'🍽️',0,-235);
    ctx.font=`bold ${n>8?21:26}px sans-serif`;let label=m.name;if(label.length>8)label=label.slice(0,7)+'…';ctx.fillText(label,0,-190);ctx.restore();
  });
}
function renderMenus() {
  $('menus').replaceChildren();
  menus.forEach((m,i)=>{
    const li=document.createElement('li'), label=document.createElement('label'), checkbox=document.createElement('input'), span=document.createElement('span'), remove=document.createElement('button');
    checkbox.type='checkbox';checkbox.checked=m.on;checkbox.setAttribute('aria-label',m.name+' 후보 선택');span.textContent=(m.emoji||'🍽️')+' '+m.name;
    checkbox.addEventListener('change',()=>{menus[i].on=checkbox.checked;changed();});label.append(checkbox,span);
    remove.className='remove';remove.textContent='×';remove.setAttribute('aria-label',m.name+' 삭제');remove.onclick=()=>{if(menus.length===1)return notify('메뉴는 하나 이상 남겨 주세요.');menus.splice(i,1);changed();};
    li.append(label,remove);$('menus').append(li);
  });
  $('candidate-count').textContent=candidates().length+'가지 후보';draw();refreshButtons();
}
function changed(){selected=null;$('vote').hidden=true;$('restaurant').hidden=true;$('result-menu').textContent='후보가 바뀌었어요!';$('result-description').textContent='다시 돌려서 오늘의 메뉴를 골라보세요.';save('lunch-menus',menus);renderMenus();}
function randomIndex(n){const a=new Uint32Array(1), limit=Math.floor(4294967296/n)*n;do{crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%n;}
function celebrate(){const box=$('confetti');box.replaceChildren();for(let i=0;i<38;i++){const piece=document.createElement('i');piece.style.left=(Math.random()*100)+'%';piece.style.background=colors[i%colors.length];piece.style.animationDelay=(Math.random()*.25)+'s';box.append(piece);}setTimeout(()=>box.replaceChildren(),2100);}
$('spin').onclick=()=>{
  if(closed||spinning)return;const active=candidates();if(!active.length)return notify('최소 한 가지 메뉴를 골라 주세요.');
  spinning=true;selected=null;$('vote').hidden=true;$('restaurant').hidden=true;$('result-menu').textContent='맛있는 운명을 고르는 중…';refreshButtons();
  const index=randomIndex(active.length), target=(360-(index+.5)*360/active.length)%360;
  angle+=1800+((target-angle%360+360)%360);$('wheel').style.transform=`rotate(${angle}deg)`;
  resultTimer=setTimeout(()=>{if(closed)return;selected=active[index];spinning=false;$('result-menu').textContent=selected.emoji+' '+selected.name;$('result-description').textContent='오늘은 이 메뉴 어때요? 마음에 들면 결정!';$('vote').hidden=false;$('restaurant').hidden=false;$('restaurant').href='https://map.naver.com/p/search/'+encodeURIComponent(selected.name);refreshButtons();celebrate();},3000);
};
$('add-form').onsubmit=e=>{e.preventDefault();if(spinning||closed)return;const name=$('new-menu').value.trim();if(!name)return;if(menus.length>=12)return notify('메뉴는 최대 12개까지 담을 수 있어요.');if(menus.some(m=>m.name===name))return notify('이미 담긴 메뉴예요.');menus.push({name,emoji:'🍽️',type:'custom',on:true});$('new-menu').value='';changed();};
$('reset').onclick=()=>{menus=defaults.map(m=>({...m,on:true}));document.querySelectorAll('#presets button').forEach(b=>b.classList.toggle('selected',b.dataset.filter==='all'));changed();};
document.querySelectorAll('#presets button').forEach(button=>button.onclick=()=>{menus.forEach(m=>m.on=button.dataset.filter==='all'||m.type===button.dataset.filter);document.querySelectorAll('#presets button').forEach(b=>b.classList.toggle('selected',b===button));changed();});
async function api(path,options={}){const response=await fetch(path,{cache:'no-store',...options});const data=await response.json();if(!response.ok){if(response.status===410)closeSession();const err=new Error(data.error||'연결을 확인해 주세요.');err.status=response.status;throw err;}return data;}
async function loadTop(){
  if(closed)return;const requestedTeam=team;
  try{const data=await api('/api/top?team='+encodeURIComponent(team));if(requestedTeam!==team)return;today=data.day;$('top').replaceChildren();if(!data.rows.length){const li=document.createElement('li');li.className='empty';li.textContent='아직 오늘의 투표가 없어요.\n첫 번째 점심 취향을 남겨주세요!';$('top').append(li);}
    data.rows.forEach((r,i)=>{const li=document.createElement('li'), rank=document.createElement('span'), name=document.createElement('span'), bar=document.createElement('span'), fill=document.createElement('i'), count=document.createElement('span');rank.className='rank';rank.textContent=String(i+1).padStart(2,'0');name.textContent=r.menu;bar.className='bar';fill.style.width=(r.count/data.rows[0].count*100)+'%';bar.append(fill);count.className='votes';count.textContent=r.count+'표';li.append(rank,name,bar,count);$('top').append(li);});refreshButtons();
  }catch(error){$('top').replaceChildren();const li=document.createElement('li');li.className='empty';li.textContent=error.message;$('top').append(li);}
}
$('vote').onclick=async()=>{if(!selected||voting||closed)return;voting=true;refreshButtons();try{await api('/api/vote',{method:'POST',headers:{'Content-Type':'application/json','X-Lunch-Session':sessionKey},body:JSON.stringify({team,menu:selected.name,voter})});save(voteKey(),true);notify('오늘의 점심 결정! 투표에 반영했어요.');await loadTop();}catch(e){if(e.status===409)save(voteKey(),true);notify(e.message);}finally{voting=false;refreshButtons();}};
function inviteUrl(){const url=new URL(location.href);url.search='';url.searchParams.set('team',team);url.hash='';return url.href;}
function updateShare(){$('qr').src='/api/qr?url='+encodeURIComponent(inviteUrl());}
$('team-form').onsubmit=e=>{e.preventDefault();team=$('team').value.trim()||'우리팀';$('team').value=team;history.replaceState(null,'',inviteUrl());updateShare();loadTop();notify(team+' 점심방에 입장했어요.');};
$('refresh').onclick=loadTop;
$('share').onclick=async()=>{try{await navigator.clipboard.writeText(inviteUrl());notify('초대 링크를 복사했어요!');}catch{notify('주소창의 링크를 복사해 주세요.');}};
function closeSession(){closed=true;clearTimeout(resultTimer);spinning=false;$('timer').textContent='서비스 종료';$('result-menu').textContent='오늘의 실습이 종료됐어요';$('result-description').textContent='실행 컨테이너가 종료되었거나 1시간이 지났습니다.';$('vote').hidden=true;document.body.classList.add('closed');refreshButtons();$('refresh').disabled=true;$('share').disabled=true;}
async function session(){try{const s=await api('/api/session');expires=s.expiresAt;offset=s.serverTime-Date.now();sessionKey=s.sessionKey;$('ranking-mode').textContent=s.mode==='supabase'?'Supabase 공유 DB · 팀마다 오늘의 투표를 집계해요.':'컨테이너 DB · 같은 링크로 접속한 브라우저의 투표를 집계해요.';refreshButtons();}catch{closeSession();}}
setInterval(()=>{if(closed||!expires)return;const seconds=Math.max(0,Math.ceil((expires-Date.now()-offset)/1000));$('timer').textContent='종료까지 '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(!seconds)closeSession();},1000);
setInterval(()=>{if(!closed)session();},30000);
setInterval(()=>{if(!closed&&!document.hidden)loadTop();},60000);
renderMenus();updateShare();session().then(loadTop);
