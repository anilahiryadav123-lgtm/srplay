// SR Play multiplayer server - Paint to Hide (ek public room, max 9 players)
const http = require('http');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const MAX = 9, HIDE = 60, SEEK = 90, RESULT = 7, MINP = 2;
let nid = 1, phase = 'lobby', left = 0, round = 0, res = '', mcount = 0;
const players = new Map();

const srv = http.createServer((q, r) => { r.writeHead(200); r.end('SR Play server OK'); });
const wss = new WebSocketServer({ server: srv });
const sendRaw = (p, s) => { if (p.ws.readyState === 1) p.ws.send(s); };
const send = (p, o) => sendRaw(p, JSON.stringify(o));
const bc = (o, ex) => { const s = JSON.stringify(o); for (const p of players.values()) if (p !== ex) sendRaw(p, s); };
const roster = () => [...players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, score: p.score, alive: p.alive, in: p.in }));
const state = () => ({ t: 'st', phase, left, round, res, r: roster() });

wss.on('connection', ws => {
  if (players.size >= MAX) { ws.send(JSON.stringify({ t: 'full' })); ws.close(); return; }
  const p = { id: nid++, ws, name: 'Player', role: 'hider', score: 0, alive: true, in: false, x: 0, y: 0, z: 0, ry: 0, mv: 0, tex: {}, matching: false };
  let joined = false;
  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (d.t === 'join' && !joined) {
      joined = true; p.name = String(d.name || 'Player').slice(0, 14);
      players.set(p.id, p);
      send(p, { t: 'hello', id: p.id });
      for (const o of players.values()) if (o !== p) for (const k in o.tex) send(p, { t: 'paint', id: o.id, part: k, img: o.tex[k] });
      bc(state()); return;
    }
    if (!joined) return;
    switch (d.t) {
      case 'pos': if ([d.x, d.y, d.z, d.ry].every(Number.isFinite)) { p.x = d.x; p.y = d.y; p.z = d.z; p.ry = d.ry; p.mv = d.mv ? 1 : 0; } break;
      case 'paint': if (typeof d.img === 'string' && d.img.length < 40000 && /^[a-zA-Z]{3,5}$/.test(d.part)) { p.tex[d.part] = d.img; bc({ t: 'paint', id: p.id, part: d.part, img: d.img }, p); } break;
      case 'emote': bc({ t: 'emote', id: p.id, e: String(d.e).slice(0, 4) }); break;
      case 'match': p.matching = !!d.on; break;
      case 'start': if (phase === 'lobby') begin(true); break;
      case 'shoot': shoot(p, d.target); break;
    }
  });
  ws.on('close', () => { players.delete(p.id); bc({ t: 'gone', id: p.id }); bc(state()); if (phase !== 'lobby') check(); });
});

function begin(forced) {
  let part = [...players.values()].filter(p => p.matching || forced);
  if (part.length < MINP) part = [...players.values()];
  if (part.length < MINP) { bc({ t: 'msg', m: 'Kam se kam 2 player chahiye' }); return; }
  round++; res = '';
  for (const p of players.values()) { p.in = false; p.alive = true; p.role = 'hider'; }
  part.sort(() => Math.random() - .5);
  const ns = Math.max(1, Math.round(part.length * 0.3));
  part.forEach((p, i) => { p.in = true; p.role = i < ns ? 'seeker' : 'hider'; });
  phase = 'hiding'; left = HIDE; bc(state());
}
function shoot(p, tid) {
  if (phase !== 'seeking' || p.role !== 'seeker' || !p.in) return;
  const t = players.get(tid);
  if (!t || !t.in || t.role !== 'hider' || !t.alive) return;
  if (Math.hypot(t.x - p.x, t.z - p.z) > 45) return;
  t.alive = false; p.score += 40;
  bc({ t: 'found', id: t.id, by: p.name, who: t.name }); bc(state()); check();
}
function check() {
  if (phase !== 'seeking' && phase !== 'hiding') return;
  const inr = [...players.values()].filter(p => p.in);
  const h = inr.filter(p => p.role === 'hider' && p.alive).length, s = inr.filter(p => p.role === 'seeker').length;
  if (s === 0 || h === 0) finish(h > 0 ? 'hiders' : 'seekers');
}
function finish(w) {
  if (w === 'hiders') for (const p of players.values()) if (p.in && p.role === 'hider' && p.alive) p.score += 100;
  res = w; phase = 'result'; left = RESULT; bc(state());
}
setInterval(() => {
  if (!players.size) { phase = 'lobby'; return; }
  if (phase === 'lobby') {
    const m = [...players.values()].filter(p => p.matching).length;
    if (m >= MINP) { if (++mcount >= 5) { mcount = 0; begin(false); return; } } else mcount = 0;
  } else {
    left--;
    if (left <= 0) {
      if (phase === 'hiding') { phase = 'seeking'; left = SEEK; }
      else if (phase === 'seeking') { finish('hiders'); return; }
      else { phase = 'lobby'; for (const p of players.values()) { p.in = false; p.alive = true; p.role = 'hider'; p.matching = false; } }
    }
  }
  bc(state());
}, 1000);
setInterval(() => {
  if (players.size < 2) return;
  bc({ t: 'pos', p: [...players.values()].map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(2), p.mv]) });
}, 100);
srv.listen(PORT, () => console.log('SR Play server on ' + PORT));
