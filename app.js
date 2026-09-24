// Съзвездие — GitHub репота като жива галактика.
// Всяко репо е звезда: ръкавът е езикът, разстоянието от ядрото е възрастта,
// размерът е тежестта, пулсът е колко скоро е пипано. Семействата (общ префикс) са съзвездия.

const LANG_COLORS = {
  TypeScript: '#4aa8ff', JavaScript: '#f7d84a', Python: '#5ee0a0', HTML: '#ff7a45', CSS: '#b67cff',
  Swift: '#ff5a36', Kotlin: '#a97bff', Java: '#e8a33d', Go: '#4fd6e8', Rust: '#dea584', Shell: '#9be15d',
  'C++': '#f34b7d', C: '#b0b7c9', Dart: '#40c4ff', PLpgSQL: '#6fb3d2', Vue: '#41d18b', 'Objective-C': '#6a9cff',
};
const OTHER = '#cfd8ff';
const DAY = 864e5;

const $ = id => document.getElementById(id);
const canvas = $('sky');
const ctx = canvas.getContext('2d');

const view = { rotY: 0.4, rotX: 1.05, zoom: 1, autoSpin: true };
let W = 0, H = 0, DPR = 1;
let stars = [], families = [], dust = [];
let tStart = 0, tEnd = 1, cursor = 0, playing = false;
let hovered = null, selected = null;

// ---------- данни ----------

async function loadRepos(user) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&page=${page}&sort=created`);
    if (res.status === 404) throw new Error(`Няма потребител „${user}“.`);
    if (res.status === 403) throw new Error('GitHub ни спря за малко (лимит на заявките). Опитай след минута.');
    if (!res.ok) throw new Error(`GitHub върна ${res.status}.`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

function familyKey(name) {
  const t = name.toLowerCase().split(/[-_.\s]+/)[0].replace(/\d+$/, '');
  return t.length >= 3 ? t : null;
}

// Детерминиран шум, за да стои галактиката на едно място при всяко зареждане.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

function build(repos) {
  const now = Date.now();
  const born = repos.map(r => Date.parse(r.created_at));
  tStart = Math.min(...born) - DAY / 2;
  tEnd = now;
  const span = Math.max(tEnd - tStart, DAY);

  const langs = [...new Set(repos.map(r => r.language || '—'))]
    .sort((a, b) => repos.filter(r => (r.language || '—') === b).length - repos.filter(r => (r.language || '—') === a).length);
  const arms = Math.max(2, Math.min(langs.length, 6));

  stars = repos.map(r => {
    const rand = rng(r.full_name);
    const created = Date.parse(r.created_at);
    const pushed = Date.parse(r.pushed_at || r.updated_at);
    const age = (created - tStart) / span;              // 0 = първото, 1 = днес
    const arm = langs.indexOf(r.language || '—') % arms;
    const radius = 60 + Math.sqrt(age) * 360 + (rand() - .5) * 30;
    const angle = arm / arms * Math.PI * 2 + radius * 0.011 + (rand() - .5) * 0.35;
    const weight = Math.log2(2 + r.size / 50) + r.stargazers_count * 1.5 + r.forks_count;
    return {
      repo: r, created, pushed,
      color: LANG_COLORS[r.language] || OTHER,
      x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, y: (rand() - .5) * 40,
      size: Math.min(3 + weight * 1.1, 16) * (r.fork ? .6 : 1),
      heat: Math.exp(-(now - pushed) / (10 * DAY)),
      phase: rand() * Math.PI * 2,
      family: familyKey(r.name),
      sx: 0, sy: 0, s: 1, depth: 0, birthFlash: 0, visible: false,
    };
  });

  const groups = {};
  for (const s of stars) if (s.family) (groups[s.family] ||= []).push(s);
  families = Object.values(groups).filter(g => g.length > 1).map(g => g.sort((a, b) => a.created - b.created));

  const rand = rng('dust' + repos.length);
  dust = Array.from({ length: 2600 }, () => {
    const arm = Math.floor(rand() * arms);
    const radius = 20 + Math.pow(rand(), .7) * 460;
    const angle = arm / arms * Math.PI * 2 + radius * 0.011 + (rand() - .5) * (0.9 - radius / 900);
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, y: (rand() - .5) * (60 - radius / 12),
      a: .15 + rand() * .45, r: rand() < .04 ? 1.4 : .7 };
  });

  return { langs };
}

// ---------- проекция ----------

function project(p) {
  const cy = Math.cos(view.rotY), sy = Math.sin(view.rotY);
  const cx = Math.cos(view.rotX), sx = Math.sin(view.rotX);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const y1 = p.y * cx - z1 * sx;
  const z2 = p.y * sx + z1 * cx;
  const fit = Math.min(W, H) / 1000;
  const s = 900 / (900 + z2) * view.zoom * fit * .95;
  return { sx: W / 2 + x1 * s, sy: H / 2 - 30 + y1 * s, s, depth: z2 };
}

// ---------- рисуване ----------

const sprites = {};
function sprite(color) {
  if (sprites[color]) return sprites[color];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(.12, color);
  grad.addColorStop(.35, color + '55');
  grad.addColorStop(1, color + '00');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return (sprites[color] = c);
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(t - last, 50); last = t;
  if (view.autoSpin && !drag) view.rotY += dt * 0.00004;
  if (playing) {
    cursor = Math.min(tEnd, cursor + (tEnd - tStart) * dt / 7000);
    if (cursor >= tEnd) { playing = false; $('play').textContent = '▶'; }
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#04050b';
  ctx.fillRect(0, 0, W, H);

  // ядро
  const core = project({ x: 0, y: 0, z: 0 });
  const coreR = 220 * core.s;
  const cg = ctx.createRadialGradient(core.sx, core.sy, 0, core.sx, core.sy, coreR);
  cg.addColorStop(0, 'rgba(255,236,210,.55)');
  cg.addColorStop(.25, 'rgba(160,140,255,.16)');
  cg.addColorStop(1, 'rgba(40,40,120,0)');
  ctx.fillStyle = cg;
  ctx.fillRect(core.sx - coreR, core.sy - coreR, coreR * 2, coreR * 2);

  ctx.globalCompositeOperation = 'lighter';
  const grown = (cursor - tStart) / (tEnd - tStart);
  for (const d of dust) {
    const p = project(d);
    const reach = Math.hypot(d.x, d.z) / 420;
    const a = d.a * Math.max(0, Math.min(1, (grown * 1.15 - reach) * 4 + .15));
    if (a <= 0.01) continue;
    ctx.fillStyle = `rgba(180,195,255,${a})`;
    ctx.fillRect(p.sx, p.sy, d.r * p.s * 1.4, d.r * p.s * 1.4);
  }

  for (const s of stars) {
    const wasVisible = s.visible;
    s.visible = s.created <= cursor;
    if (s.visible && !wasVisible) s.birthFlash = 1;
    s.birthFlash = Math.max(0, s.birthFlash - dt / 900);
    Object.assign(s, project(s));
  }

  // съзвездия
  ctx.lineWidth = 1;
  for (const g of families) {
    const lit = g.includes(selected) || g.includes(hovered);
    ctx.strokeStyle = lit ? 'rgba(200,215,255,.55)' : 'rgba(160,180,255,.14)';
    ctx.setLineDash(lit ? [] : [3, 5]);
    ctx.beginPath();
    let started = false;
    for (const s of g) {
      if (!s.visible) continue;
      started ? ctx.lineTo(s.sx, s.sy) : ctx.moveTo(s.sx, s.sy);
      started = true;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // звезди, далечните първо
  const order = stars.filter(s => s.visible).sort((a, b) => b.depth - a.depth);
  for (const s of order) {
    const pulse = 1 + s.heat * 0.35 * Math.sin(t / 380 + s.phase);
    const focus = s === hovered || s === selected ? 1.5 : 1;
    const base = s.size * s.s * 1.6;
    const r = base * pulse * focus * (1 + s.birthFlash * 1.2);
    ctx.globalAlpha = s.repo.fork ? .55 : Math.min(1, .55 + s.heat * .6 + s.birthFlash);
    ctx.drawImage(sprite(s.color), s.sx - r * 2, s.sy - r * 2, r * 4, r * 4);
    if (s.birthFlash > 0) {
      ctx.globalAlpha = s.birthFlash * .6;
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, base * (1.5 + (1 - s.birthFlash) * 4), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // имена на ярките и избраните
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  for (const s of order) {
    const show = s === selected || s === hovered || (s.heat > .3 && view.zoom > .8) || view.zoom > 1.7;
    if (!show) continue;
    ctx.fillStyle = s === selected || s === hovered ? '#fff' : 'rgba(220,228,255,.6)';
    ctx.fillText(s.repo.name, s.sx, s.sy + s.size * s.s * 2 + 14);
  }

  updateTimeline();
  requestAnimationFrame(frame);
}

// ---------- интерфейс ----------

const fmtDate = t => new Date(t).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', year: 'numeric' });
function ago(t) {
  const d = Math.floor((Date.now() - t) / DAY);
  if (d <= 0) return 'днес';
  if (d === 1) return 'вчера';
  if (d < 30) return `преди ${d} дни`;
  if (d < 365) return `преди ${Math.round(d / 30)} мес.`;
  return `преди ${(d / 365).toFixed(1)} г.`;
}

function updateTimeline() {
  const k = (cursor - tStart) / (tEnd - tStart);
  $('fill').style.width = `${k * 100}%`;
  $('date').textContent = cursor >= tEnd - DAY / 2 ? 'днес' : fmtDate(cursor);
}

function renderTicks() {
  $('ticks').innerHTML = stars.map(s =>
    `<i style="left:${(s.created - tStart) / (tEnd - tStart) * 100}%;background:${s.color}"></i>`).join('');
}

function renderStats(user, langs) {
  const real = stars.filter(s => !s.repo.fork);
  const hottest = [...real].sort((a, b) => b.pushed - a.pushed)[0];
  const days = Math.max(1, Math.round((tEnd - tStart) / DAY));
  const today = real.filter(s => Date.now() - s.pushed < DAY).length;
  const counts = langs.map(l => [l, stars.filter(s => (s.repo.language || '—') === l).length]);

  $('caption').textContent = real.length
    ? `${real.length} звезди за ${days} дни. ${today ? `${today} светят днес.` : ''} Най-ярка сега: ${hottest.repo.name}.`
    : 'Още няма звезди. Всяка вселена започва от едно репо.';

  $('stats').innerHTML = `
    <div><b>${real.length}</b> репота · <b>${stars.length - real.length}</b> форка</div>
    <div><b>${families.length}</b> съзвездия · <b>${(real.length / days * 7).toFixed(1)}</b> нови на седмица</div>
    <div><b>${real.reduce((n, s) => n + s.repo.stargazers_count, 0)}</b> ★ общо</div>
    <div class="langs">${counts.map(([l, n]) =>
      `<span><i style="background:${LANG_COLORS[l] || OTHER}"></i>${l === '—' ? 'друго' : l} ${n}</span>`).join('')}</div>`;
}

function select(s) {
  selected = s;
  $('panel').hidden = !s;
  if (!s) return;
  const r = s.repo;
  $('pLang').innerHTML = `<i style="background:${s.color}"></i>${r.language || 'без език'}${r.fork ? ' · форк' : ''}${r.private ? ' · частно' : ''}`;
  $('pName').textContent = r.name;
  $('pDesc').textContent = r.description || 'Без описание — засега само идея, която свети.';
  $('pMeta').innerHTML = `
    <dt>роден</dt><dd>${fmtDate(s.created)}</dd>
    <dt>пипнат</dt><dd>${ago(s.pushed)}</dd>
    <dt>звезди</dt><dd>${r.stargazers_count} ★</dd>
    <dt>размер</dt><dd>${r.size >= 1024 ? (r.size / 1024).toFixed(1) + ' MB' : r.size + ' KB'}</dd>`;
  const fam = families.find(g => g.includes(s));
  $('pFamily').innerHTML = fam ? `Съзвездие „${s.family}“:<br>` + fam.filter(o => o !== s)
    .map(o => `<button data-id="${o.repo.id}">${o.repo.name}</button>`).join('') : '';
  $('pLink').href = r.html_url;
  view.autoSpin = false;
}

$('pFamily').addEventListener('click', e => {
  const id = e.target.dataset?.id;
  if (id) select(stars.find(s => String(s.repo.id) === id));
});
$('panelClose').onclick = () => { select(null); view.autoSpin = true; };

function pick(x, y) {
  let best = null, bestD = Infinity;
  for (const s of stars) {
    if (!s.visible) continue;
    const d = Math.hypot(s.sx - x, s.sy - y);
    if (d < Math.max(12, s.size * s.s * 2.5) && d < bestD) { best = s; bestD = d; }
  }
  return best;
}

// ---------- управление ----------

let drag = null;
canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    view.rotY += dx * 0.005;
    view.rotX = Math.max(0.15, Math.min(1.5, view.rotX + dy * 0.004));
    drag.x = e.clientX; drag.y = e.clientY;
    return;
  }
  hovered = pick(e.clientX, e.clientY);
  canvas.classList.toggle('hovering', !!hovered);
  const tip = $('tip');
  tip.classList.toggle('on', !!hovered);
  if (hovered) {
    tip.textContent = `${hovered.repo.name} · ${ago(hovered.pushed)}`;
    tip.style.left = `${Math.min(e.clientX + 14, W - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  }
});
canvas.addEventListener('pointerup', e => {
  canvas.classList.remove('dragging');
  if (drag && drag.moved < 6) select(pick(e.clientX, e.clientY));
  drag = null;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  view.zoom = Math.max(.4, Math.min(4, view.zoom * Math.exp(-e.deltaY * 0.0012)));
}, { passive: false });

function scrub(e) {
  const r = $('timeline').getBoundingClientRect();
  const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  cursor = tStart + k * (tEnd - tStart);
  playing = false; $('play').textContent = '▶';
}
$('timeline').addEventListener('pointerdown', e => {
  scrub(e);
  const move = ev => scrub(ev);
  addEventListener('pointermove', move);
  addEventListener('pointerup', () => removeEventListener('pointermove', move), { once: true });
});

function bigBang() {
  cursor = tStart; playing = true; $('play').textContent = '❚❚';
  stars.forEach(s => { s.visible = false; });
}
$('play').onclick = () => {
  if (playing) { playing = false; $('play').textContent = '▶'; }
  else if (cursor >= tEnd) bigBang();
  else { playing = true; $('play').textContent = '❚❚'; }
};

$('shot').onclick = () => {
  const a = document.createElement('a');
  a.download = `sazvezdie-${$('user').value}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
};

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); $('play').click(); }
  if (e.key === 'Escape') $('panelClose').click();
});

$('who').addEventListener('submit', e => {
  e.preventDefault();
  const u = $('user').value.trim();
  if (!u) return;
  history.replaceState(null, '', `?u=${encodeURIComponent(u)}`);
  start(u);
});

// ---------- старт ----------

async function start(user) {
  $('user').value = user;
  $('loading').classList.remove('gone');
  $('loading').textContent = 'Сглобявам галактиката…';
  select(null);
  try {
    const repos = await loadRepos(user);
    if (!repos.length) throw new Error(`${user} още няма публични репота.`);
    const { langs } = build(repos);
    renderStats(user, langs);
    renderTicks();
    document.title = `Съзвездие · ${user}`;
    $('loading').classList.add('gone');
    $('loading').textContent = '';
    if (new URLSearchParams(location.search).has('still')) { cursor = tEnd; stars.forEach(s => { s.visible = true; }); }
    else bigBang();
  } catch (err) {
    $('loading').textContent = err.message;
  }
}

resize();
addEventListener('resize', resize);
requestAnimationFrame(frame);
start(new URLSearchParams(location.search).get('u') || 'me7ko-dev');
