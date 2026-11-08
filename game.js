'use strict';
const $ = s => document.querySelector(s);
const SERVER = window.SR_SERVER || '';
const SET = Object.assign({ vib: 1, nick: 1, cam: .5, vol: .5, bgm: .5 }, JSON.parse(localStorage.srset || '{}'));
let ws, myId = 0, myName = '', phase = 'lobby', tleft = 0, roster = [], matching = false, painting = false, eye = false, myAlive = true, lastPhase = 'lobby', pending = {};
const others = new Map();
const buzz = ms => SET.vib && navigator.vibrate && navigator.vibrate(ms);
function toast(t) { const e = $('#toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(toast.h); toast.h = setTimeout(() => e.style.opacity = 0, 2400); }
const me = () => roster.find(r => r.id === myId) || { role: 'hider', in: false, alive: true, score: 0 };

// ---------- three.js scene ----------
const R = new THREE.WebGLRenderer({ antialias: true });
R.setPixelRatio(Math.min(devicePixelRatio, 2)); document.body.prepend(R.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0820); scene.fog = new THREE.Fog(0x0a0820, 35, 90);
const cam = new THREE.PerspectiveCamera(60, 1, .1,200);
function rs() { R.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', rs); rs();
scene.add(new THREE.HemisphereLight(0xffffff, 0x554488, .95));
const dl = new THREE.DirectionalLight(0xffffff, .7); dl.position.set(8, 16, 7); scene.add(dl);
function mkc(w, h, fn) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); if (fn) fn(c, w, h); const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; return { cv, c, tex }; }
const pick = []; // objects the eyedropper can sample

const floor = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1, 48), new THREE.MeshStandardMaterial({ color: 0xe9e4ee, roughness: .35 }));
floor.position.y = -.5; floor.userData.col = '#e9e4ee'; scene.add(floor); pick.push(floor);
const ring = new THREE.Mesh(new THREE.TorusGeometry(14, .25, 8, 64), new THREE.MeshStandardMaterial({ color: 0xf2b21d, metalness: .6, roughness: .3 }));
ring.rotation.x = Math.PI / 2; scene.add(ring);
const base = new THREE.Mesh(new THREE.CylinderGeometry(15, 11, 3, 48), new THREE.MeshStandardMaterial({ color: 0x1a1a24 })); base.position.y = -2.5; scene.add(base);

const PAT = [
  (c, w, h) => { for (let y = 0; y < h; y += 40) for (let x = 0; x < w; x += 40) { c.fillStyle = ((x + y) / 40) % 2 ? '#f0dcc8' : '#b5552e'; c.fillRect(x, y, 40, 40); } },
  (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + 32, y); c.lineTo(x + 16, y + 32); c.fill(); } },
  (c, w, h) => { for (let x = 0; x < w; x += 16) { c.fillStyle = `hsl(22,${55 + x % 5 * 4}%,${28 + (x / 16) % 3 * 6}%)`; c.fillRect(x, 0, 16, h); } },
  (c, w, h) => { c.fillStyle = '#8a3b2a'; c.fillRect(0, 0, w, h); c.fillStyle = '#c9694f'; for (let y = 0, r = 0; y < h; y += 24, r++) for (let x = -(r % 2) * 32; x < w; x += 64) c.fillRect(x + 2, y + 2, 60, 20); },
  (c, w, h) => { c.fillStyle = '#8f9296'; c.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},.08)`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); } }
];
function silhouette(c, w, h) { // dashed hider outline, jaisa WePlay me hota hai
  c.setLineDash([9, 7]); c.lineWidth = 4; c.strokeStyle = '#fff'; const cx = w / 2;
  c.beginPath(); c.arc(cx, h - 140, 38, 0, 7); c.stroke();
  c.strokeRect(cx - 40, h - 100, 80, 80); c.strokeRect(cx - 36, h - 20, 30, 20); c.strokeRect(cx + 6, h - 20, 30, 20);
}
for (let i = 0; i < 5; i++) {
  const t = mkc(256, 336, (c, w, h) => { PAT[i](c, w, h); silhouette(c, w, h); });
  const side = new THREE.MeshStandardMaterial({ color: 0x15151c });
  const front = new THREE.MeshStandardMaterial({ map: t.tex });
  const m = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.4, .3), [side, side, side, side, front, side]);
  const a = i / 5 * Math.PI * 2; m.position.set(Math.sin(a) * 12.4, 2.2, Math.cos(a) * 12.4); m.lookAt(0, 2.2, 0);
  m.userData.cv = t.cv; scene.add(m); pick.push(m);
  const car = new THREE.Group(), cc = [0xffb300, 0x2e9e4f, 0x7a2fe0, 0xe53935, 0x1e88e5][i];
  car.add(new THREE.Mesh(new THREE.BoxGeometry(1.7, .6, .9), new THREE.MeshStandardMaterial({ color: cc })));
  const cab = new THREE.Mesh(new THREE.BoxGeometry(.9, .5, .8), new THREE.MeshStandardMaterial({ color: cc })); cab.position.set(-.1, .5, 0); car.add(cab);
  for (const [x, z] of [[.55, .45], [-.55, .45], [.55, -.45], [-.55, -.45]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .15, 12), new THREE.MeshStandardMaterial({ color: 0x111111 })); w.rotation.x = Math.PI / 2; w.position.set(x, -.25, z); car.add(w); }
  const b = a + Math.PI / 5; car.position.set(Math.sin(b) * 11.6, .6, Math.cos(b) * 11.6); car.rotation.y = b + 1.57; scene.add(car);
}
const ART = [
  (c, w, h) => { c.fillStyle = '#10286b'; c.fillRect(0, 0, w, h); for (let i = 0; i < 70; i++) { c.strokeStyle = `hsl(${200 + Math.random() * 60},80%,${40 + Math.random() * 30}%)`; c.lineWidth = 5; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 10 + Math.random() * 50, 0, Math.random() * 6); c.stroke(); } },
  (c, w, h) => { c.fillStyle = '#e8501f'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 14) { c.strokeStyle = `hsl(${(y * 1.2) % 60},90%,55%)`; c.lineWidth = 8; c.beginPath(); for (let x = 0; x <= w; x += 8) c.lineTo(x, y + Math.sin(x / 20 + y) * 8); c.stroke(); } },
  (c, w, h) => { c.fillStyle = '#1b0f08'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffb300'; c.beginPath(); c.arc(w / 2, h / 2, 70, 0, 7); c.fill(); c.fillStyle = '#111'; c.fillRect(w / 2 - 36, h / 2 - 22, 72, 14); c.fillStyle = '#f5f5f5'; c.beginPath(); c.arc(w / 2, h / 2 + 20, 30, 0, Math.PI); c.fill(); }
];
for (let i = 0; i < 3; i++) {
  const t = mkc(256, 190, ART[i]); const a = (i + .5) / 3 * Math.PI * 2 + .6;
  const fr = new THREE.Mesh(new THREE.BoxGeometry(9, 6.8, .4), new THREE.MeshStandardMaterial({ color: 0x8a5a2b }));
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 6.1), new THREE.MeshBasicMaterial({ map: t.tex })); pic.position.z = .22; fr.add(pic);
  fr.position.set(Math.sin(a) * 24, 7, Math.cos(a) * 24); fr.lookAt(0, 7, 0); scene.add(fr);
}
for (let i = 0; i < 26; i++) { // neon triangles
  const g = new THREE.Mesh(new THREE.TorusGeometry(1 + Math.random() * 1.5, .05, 4, 3), new THREE.MeshBasicMaterial({ color: [0xff3b6b, 0x37e2d5, 0xb04bff, 0xffd23f][i % 4] }));
  const a = Math.random() * 6.28, d = 28 + Math.random() * 18; g.position.set(Math.sin(a) * d, 2 + Math.random() * 20, Math.cos(a) * d); g.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); scene.add(g);
}

// ---------- characters ----------
const DEF = {
  head: [() => new THREE.SphereGeometry(.5, 24, 16), 0, 1.85], torso: [() => new THREE.CylinderGeometry(.42, .5, 1, 20), 0, 1.05],
  armL: [() => new THREE.CylinderGeometry(.14, .13, .9, 12), -.62, 1.1], armR: [() => new THREE.CylinderGeometry(.14, .13, .9, 12), .62, 1.1],
  legL: [() => new THREE.CylinderGeometry(.19, .16, .9, 12), -.22, .45], legR: [() => new THREE.CylinderGeometry(.19, .16, .9, 12), .22, .45]
};
function label(txt) {
  const t = mkc(256, 64, (c, w, h) => { c.fillStyle = '#0007'; c.beginPath(); c.roundRect ? c.roundRect(10, 8, 236, 48, 24) : c.rect(10, 8, 236, 48); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.fillText(txt, w / 2, 44); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, depthTest: false, transparent: true })); s.scale.set(2, .5, 1); s.position.y = 2.7; s.renderOrder = 9; return s;
}
function mkChar(name) {
  const g = new THREE.Group(), P = {};
  for (const k in DEF) {
    const t = mkc(128, 128, (c, w, h) => { c.fillStyle = '#dcdcdc'; c.fillRect(0, 0, w, h); });
    const m = new THREE.Mesh(DEF[k][0](), new THREE.MeshStandardMaterial({ map: t.tex, roughness: .8 }));
    m.position.set(DEF[k][1], DEF[k][2], 0); m.userData = { part: k, cv: t.cv, c: t.c, tex: t.tex, dirty: false }; g.add(m); P[k] = m;
  }
  const lb = label(name); g.add(lb); const emo = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false })); emo.scale.set(1, 1, 1); emo.position.y = 3.4; emo.visible = false; g.add(emo);
  scene.add(g); return { g, P, lb, emo, name, tx: 0, ty: 0, tz: 0, try: 0, mv: 0, ph: 0, et: 0 };
}
function paintImg(ch, part, img) { const i = new Image(); i.onload = () => { const m = ch.P[part]; if (!m) return; m.userData.c.drawImage(i, 0, 0, 128, 128); m.userData.tex.needsUpdate = true; }; i.src = img; }
function emote(ch, e) { const t = mkc(128, 128, (c) => { c.font = '90px sans-serif'; c.textAlign = 'center'; c.fillText(e, 64, 96); }); ch.emo.material.map = t.tex; ch.emo.material.needsUpdate = true; ch.emo.visible = true; ch.et = 2.5; }
function animChar(ch, dt, mv) {
  ch.ph += mv ? dt * 10 : 0; const s = mv ? Math.sin(ch.ph) * .7 : 0;
  ch.P.legL.rotation.x = s; ch.P.legR.rotation.x = -s; ch.P.armL.rotation.x = -s; ch.P.armR.rotation.x = s;
  if (ch.et > 0 && (ch.et -= dt) <= 0) ch.emo.visible = false;
}
const mine = mkChar('');
function setMyName(n) { mine.g.remove(mine.lb); mine.lb = label(n); mine.g.add(mine.lb); }
const pos = new THREE.Vector3(0, 0, 8); let vy = 0, ry = 0, yaw = 0, pit = .35, dist = 6.5, mvNow = 0;

// ---------- input ----------
const K = {}; addEventListener('keydown', e => { K[e.code] = 1; if (e.code === 'Space') jump(); }); addEventListener('keyup', e => K[e.code] = 0);
const J = { id: null, x: 0, y: 0, ox: 0, oy: 0 }; const zone = $('#joyZone'), knob = $('#knob');
zone.addEventListener('pointerdown', e => { J.id = e.pointerId; J.ox = e.clientX; J.oy = e.clientY; zone.setPointerCapture(e.pointerId); knob.style.display = 'block'; knob.style.left = e.clientX - 32 + 'px'; knob.style.top = e.clientY - 32 + 'px'; });
zone.addEventListener('pointermove', e => { if (e.pointerId !== J.id) return; let dx = e.clientX - J.ox, dy = e.clientY - J.oy; const l = Math.hypot(dx, dy), m = Math.min(l, 55); if (l > 0) { dx = dx / l * m; dy = dy / l * m; } J.x = dx / 55; J.y = dy / 55; knob.style.left = J.ox + dx - 32 + 'px'; knob.style.top = J.oy + dy - 32 + 'px'; });
const jend = e => { if (e.pointerId === J.id) { J.id = null; J.x = J.y = 0; knob.style.display = 'none'; } };
zone.addEventListener('pointerup', jend); zone.addEventListener('pointercancel', jend);
function jump() { if (pos.y <= 0.001 && !painting) { vy = 7.5; } }
$('#jump').onclick = jump;
const EM = ['😜', '😂', '👍', '❤️', '😎', '🔥']; let ei = 0;
$('#emo').onclick = () => { const e = EM[ei++ % EM.length]; emote(mine, e); net({ t: 'emote', e }); };

// camera drag / painting / eyedropper on canvas
const ray = new THREE.Raycaster(), cv = R.domElement; let drag = null, strokes = [], cur = null, lastHit = null, brush = { s: 12, col: '#e53935' };
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  if (painting) { if (eye) { sample(e); return; } cur = []; strokes.push(cur); lastHit = null; paintAt(e); drag = { paint: 1 }; }
  else drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
cv.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.paint) paintAt(e);
  else { const k = .003 + SET.cam * .009; yaw -= (e.clientX - drag.x) * k; pit = Math.max(-.1, Math.min(1.2, pit + (e.clientY - drag.y) * k)); drag.x = e.clientX; drag.y = e.clientY; }
});
const up = () => { if (drag && drag.paint) shareDirty(); drag = null; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
function hitAt(e, objs) { ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), cam); return ray.intersectObjects(objs, false)[0]; }
function paintAt(e) {
  const h = hitAt(e, Object.values(mine.P)); if (!h || !h.uv) { lastHit = null; return; }
  const u = h.object.userData, x = h.uv.x * 128, y = (1 - h.uv.y) * 128;
  if (!cur.some(s => s.part === u.part)) cur.push({ part: u.part, img: u.c.getImageData(0, 0, 128, 128) });
  const c = u.c; c.fillStyle = c.strokeStyle = brush.col; c.lineCap = 'round'; c.lineWidth = brush.s * .8;
  if (lastHit && lastHit.o === h.object && Math.abs(lastHit.x - x) < 40) { c.beginPath(); c.moveTo(lastHit.x, lastHit.y); c.lineTo(x, y); c.stroke(); } else { c.beginPath(); c.arc(x, y, brush.s * .4, 0, 7); c.fill(); }
  lastHit = { o: h.object, x, y }; u.tex.needsUpdate = true; u.dirty = true;
}
function sample(e) {
  const h = hitAt(e, pick.concat(Object.values(mine.P))); if (!h) return;
  const u = h.object.userData; let hex;
  if (u.cv && h.uv) { const d = (u.c || u.cv.getContext('2d')).getImageData(Math.floor(h.uv.x * u.cv.width), Math.floor((1 - h.uv.y) * u.cv.height), 1, 1).data; hex = '#' + [...d].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join(''); }
  else if (u.col) hex = u.col;
  if (hex) { brush.col = hex; $('#col').value = hex; eye = false; $('#eye').classList.remove('on'); toast('Rang utha liya'); }
}
function shareDirty() {
  for (const k in mine.P) { const u = mine.P[k].userData; if (u.dirty) { u.dirty = false; net({ t: 'paint', part: k, img: u.cv.toDataURL('image/jpeg', .7) }); } }
}
$('#undo').onclick = () => { const s = strokes.pop(); if (!s) return; for (const e of s) { const u = mine.P[e.part].userData; u.c.putImageData(e.img, 0, 0); u.tex.needsUpdate = true; u.dirty = true; } shareDirty(); };
document.querySelectorAll('.sz').forEach(b => b.onclick = () => { document.querySelectorAll('.sz').forEach(x => x.classList.remove('on')); b.classList.add('on'); brush.s = +b.dataset.s; });
$('#col').oninput = e => brush.col = e.target.value;
$('#eye').onclick = () => { eye = !eye; $('#eye').classList.toggle('on', eye); };
$('#rot').onclick = () => { ry += Math.PI / 2; };
function canPaint() { return phase === 'lobby' || (phase === 'hiding' && me().role === 'hider'); }
function openPaint() { if (!canPaint()) return toast('Abhi paint nahi kar sakte'); painting = true; $('#paint').style.display = 'flex'; $('#brush').style.display = 'none'; ui(); }
function closePaint() { painting = false; eye = false; $('#paint').style.display = 'none'; ui(); }
$('#fit').onclick = () => painting ? closePaint() : openPaint(); $('#brush').onclick = openPaint; $('#pclose').onclick = closePaint;

// shooting (seeker)
const fireBtn = $('#fire'); let cool = 0;
fireBtn.onclick = () => {
  if (cool > 0 || phase !== 'seeking' || me().role !== 'seeker') return; cool = .4; buzz(30);
  ray.setFromCamera(new THREE.Vector2(0, 0), cam); const objs = []; for (const [id, o] of others) if (o.g.visible) for (const k in o.P) { o.P[k].userData.pid = id; objs.push(o.P[k]); }
  const h = ray.intersectObjects(objs, false)[0];
  const sp = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0x4fc3f7 })); sp.position.copy(cam.position).add(new THREE.Vector3(0, -.4, 0)); scene.add(sp);
  const tgt = h ? h.point.clone() : ray.ray.at(40, new THREE.Vector3()); let n = 0; const iv = setInterval(() => { sp.position.lerp(tgt, .35); if (++n > 8) { clearInterval(iv); scene.remove(sp); } }, 16);
  if (h) net({ t: 'shoot', target: h.object.userData.pid });
};

// ---------- network ----------
function net(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function connect() {
  $('#st').textContent = 'Server se jud raha hai...';
  if (!SERVER || SERVER.includes('YOUR-SERVER')) { $('#st').textContent = 'config.js me server ka address daalo'; return; }
  ws = new WebSocket(SERVER);
  ws.onopen = () => { net({ t: 'join', name: myName }); $('#intro').style.display = 'none'; $('#hud').hidden = false; ui(); };
  ws.onerror = () => { $('#st').textContent = 'Server nahi mila. (Render free server 1 minute me jaagta hai, dobara try karo)'; };
  ws.onclose = () => { if ($('#intro').style.display === 'none') { toast('Connection toot gaya'); setTimeout(() => location.reload(), 1800); } };
  ws.onmessage = ev => handle(JSON.parse(ev.data));
}
function getOther(id) { let o = others.get(id); if (!o) { const r = roster.find(x => x.id === id); o = mkChar(r ? r.name : '?'); others.set(id, o); for (const k in pending[id] || {}) paintImg(o, k, pending[id][k]); } return o; }
function handle(d) {
  switch (d.t) {
    case 'hello': myId = d.id; break;
    case 'full': alert('Room full hai (9 player)'); location.reload(); break;
    case 'msg': toast(d.m); break;
    case 'st': onState(d); break;
    case 'pos': for (const [id, x, y, z, r, mv] of d.p) if (id !== myId) { const o = getOther(id); o.tx = x; o.ty = y; o.tz = z; o.try = r; o.mv = mv; } break;
    case 'paint': { const o = others.get(d.id); if (o) paintImg(o, d.part, d.img); else (pending[d.id] = pending[d.id] || {})[d.part] = d.img; break; }
    case 'emote': { const o = others.get(d.id); if (o) emote(o, d.e); break; }
    case 'gone': { const o = others.get(d.id); if (o) { scene.remove(o.g); others.delete(d.id); } break; }
    case 'found': toast(d.by + ' ne ' + d.who + ' ko dhoondh liya'); if (d.id === myId) { myAlive = false; buzz(200); } break;
  }
}
function onState(d) {
  roster = d.r; tleft = d.left; const prev = phase; phase = d.phase;
  for (const r of roster) if (r.id !== myId) { const o = getOther(r.id); if (o.name !== r.name) { o.g.remove(o.lb); o.lb = label(r.name); o.g.add(o.lb); o.name = r.name; } }
  if (phase !== prev) {
    if (phase === 'hiding') { myAlive = true; if (painting && me().role !== 'hider') closePaint(); const s = me(); if (s.in) { if (s.role === 'seeker') pos.set(0, 0, 0); else { const a = Math.random() * 6.28, r = 2 + Math.random() * 8; pos.set(Math.sin(a) * r, 0, Math.cos(a) * r); } } }
    if (phase === 'seeking' && me().role === 'seeker') { pos.set(0, 0, 0); closePaint(); }
    if (phase === 'lobby') { myAlive = true; pos.set(0, 0, 8); matching = false; $('#match').textContent = 'Match'; }
    if (phase !== 'hiding' && phase !== 'lobby') closePaint();
  }
  const mr = me();
  if (phase === 'hiding' && mr.in && mr.role === 'seeker') { ov('You are the Seeker!', 'Seeker ko chhupne ka time khatam hone tak wait karna hai.', false); }
  else if (phase === 'result') { const w = d.res; ov(w === 'hiders' ? '🎨 Hiders jeete!' : '🔫 Seekers jeete!', mr.in ? ((w === 'hiders') === (mr.role === 'hider') ? 'Tum jeet gaye! 🏆' : 'Agli baar zaroor!') : '', false); }
  else ov();
  ui();
}
function ov(t, p, btn) { const o = $('#ov'); if (!t) { o.style.display = 'none'; return; } o.style.display = 'grid'; $('#ovt').textContent = t; $('#ovp').textContent = p || ''; $('#ovb').style.display = 'none'; }

// ---------- HUD ----------
function ui() {
  const lobby = phase === 'lobby', mr = me(), playing = (phase === 'hiding' || phase === 'seeking') && mr.in;
  $('#mst').style.display = lobby && !painting ? 'flex' : 'none'; $('#pill').style.display = lobby && matching ? 'block' : 'none';
  $('#brush').style.display = canPaint() && !painting ? 'block' : 'none'; $('#fit').style.display = canPaint() ? 'block' : 'none';
  $('#sb').style.display = playing || phase === 'result' ? 'block' : 'none'; $('#tm').style.display = phase === 'lobby' ? 'none' : 'block';
  $('#cross').style.display = fireBtn.style.display = (phase === 'seeking' && mr.role === 'seeker' && mr.in) ? 'block' : 'none';
  $('#slots').style.display = lobby || painting ? 'flex' : 'none'; $('#pub').style.display = lobby ? 'block' : 'none';
  $('#tl').textContent = { hiding: 'Hiding Time', seeking: 'Seeking Time', result: 'Result' }[phase] || '';
  const sl = $('#slots'); sl.innerHTML = '';
  for (let i = 0; i < 9; i++) { const r = roster[i]; const d = document.createElement('div'); d.className = 'sl'; d.innerHTML = r ? `<i style="background:hsl(${r.id * 67 % 360},60%,45%)">${r.name[0].toUpperCase()}</i>${r.name}` : '<i>+</i>&nbsp;'; sl.appendChild(d); }
  const h = roster.filter(r => r.in && r.role === 'hider' && r.alive).length, s = roster.filter(r => r.in && r.role === 'seeker').length;
  $('#sb').innerHTML = `<b>Hider &nbsp;${h} : ${s}&nbsp; Seeker</b>` + roster.filter(r => r.in).sort((a, b) => b.score - a.score).map(r => `<div class="sr ${r.id === myId ? 'me' : ''}"><span>${r.role === 'seeker' ? '🔫' : r.alive ? '🎨' : '💀'} ${r.name}</span><b>${r.score}</b></div>`).join('');
  const m = Math.floor(Math.max(0, tleft) / 60), sc = Math.max(0, tleft) % 60; $('#tv').textContent = `${String(m).padStart(2, '0')}:${String(sc).padStart(2, '0')}`;
}
$('#match').onclick = () => { matching = !matching; $('#match').textContent = matching ? 'Cancel' : 'Match'; net({ t: 'match', on: matching }); ui(); };
$('#start').onclick = () => net({ t: 'start' });
const setUI = () => { $('#set').style.display = 'grid'; for (const k of ['vib', 'nick']) $('#s_' + k).checked = !!SET[k]; for (const k of ['cam', 'vol', 'bgm']) $('#s_' + k).value = SET[k]; };
$('#gear').onclick = setUI; $('#sclose').onclick = () => { $('#set').style.display = 'none'; };
for (const k of ['vib', 'nick']) $('#s_' + k).onchange = e => { SET[k] = e.target.checked ? 1 : 0; localStorage.srset = JSON.stringify(SET); };
for (const k of ['cam', 'vol', 'bgm']) $('#s_' + k).oninput = e => { SET[k] = +e.target.value; localStorage.srset = JSON.stringify(SET); };
$('#guide').onclick = () => alert('🎨 Hider: Brush se apne ko deewar ke rang me paint karo (💧 se rang uthao) aur dashed outline ke saamne khade ho jao.\n🔫 Seeker: Hiding time ke baad crosshair se hiders ko dhoondho aur 🔫 se shoot karo.\n⏱ Time khatam hone tak bache hiders jeette hain.');
$('#unstuck').onclick = () => { pos.set(0, 0, 4); vy = 0; $('#set').style.display = 'none'; };
$('#exit').onclick = () => location.reload();
$('#go').onclick = () => { myName = ($('#nm').value.trim() || 'Player').slice(0, 14); localStorage.srname = myName; setMyName(myName); try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); screen.orientation.lock('landscape'); } catch (e) { } connect(); };
$('#nm').value = localStorage.srname || '';

// ---------- main loop ----------
const clock = new THREE.Clock(); let sendT = 0;
function frame() {
  requestAnimationFrame(frame); const dt = Math.min(.05, clock.getDelta()); cool -= dt;
  const mr = me(), locked = phase === 'hiding' && mr.in && mr.role === 'seeker' || painting;
  let jx = J.x + (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), jy = J.y + (K.KeyS ? 1 : 0) - (K.KeyW ? 1 : 0); const jl = Math.hypot(jx, jy); if (jl > 1) { jx /= jl; jy /= jl; }
  mvNow = 0;
  if (!locked && jl > .12) {
    const sp = 7, mx = Math.cos(yaw) * jx + Math.sin(yaw) * jy, mz = Math.cos(yaw) * jy - Math.sin(yaw) * jx;
    pos.x += mx * sp * dt; pos.z += mz * sp * dt; mvNow = 1; let a = Math.atan2(mx, mz), d = a - ry; d = Math.atan2(Math.sin(d), Math.cos(d)); ry += d * Math.min(1, dt * 14);
  }
  const rr = Math.hypot(pos.x, pos.z); if (rr > 13.2) { pos.x *= 13.2 / rr; pos.z *= 13.2 / rr; }
  vy -= 20 * dt; pos.y = Math.max(0, pos.y + vy * dt); if (pos.y === 0) vy = 0;
  mine.g.position.copy(pos); mine.g.rotation.y = ry; animChar(mine, dt, mvNow && pos.y === 0);
  mine.lb.visible = !!SET.nick && !painting; mine.g.visible = !(phase === 'hiding' && mr.in && mr.role === 'seeker') && myAlive;
  if (painting) { const f = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)); cam.position.copy(pos).add(f.multiplyScalar(3.6)).add(new THREE.Vector3(0, 1.7, 0)); cam.lookAt(pos.x, pos.y + 1.2, pos.z); }
  else { const seek = phase === 'seeking' && mr.role === 'seeker', d = seek ? 4 : dist, t = new THREE.Vector3(pos.x, pos.y + (seek ? 2 : 1.7), pos.z); cam.position.set(t.x + Math.sin(yaw) * Math.cos(pit) * d, t.y + Math.sin(pit) * d, t.z + Math.cos(yaw) * Math.cos(pit) * d); cam.lookAt(t); }
  for (const [id, o] of others) {
    const r = roster.find(x => x.id === id); o.g.position.x += (o.tx - o.g.position.x) * .25; o.g.position.y += (o.ty - o.g.position.y) * .25; o.g.position.z += (o.tz - o.g.position.z) * .25;
    let d = o.try - o.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); o.g.rotation.y += d * .25; animChar(o, dt, o.mv);
    o.lb.visible = !!SET.nick; o.g.visible = !!r && !(r.in && !r.alive) && !(phase === 'hiding' && r.in && r.role === 'seeker' && mr.role !== 'seeker');
    if (phase === 'seeking' && mr.role === 'seeker') o.lb.visible = false; // seeker ko naam se nahi, rang se dhoondhna hai
  }
  sendT += dt; if (sendT > .1) { sendT = 0; net({ t: 'pos', x: pos.x, y: pos.y, z: pos.z, ry, mv: mvNow }); }
  R.render(scene, cam);
}
frame();
