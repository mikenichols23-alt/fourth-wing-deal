// Fourth Wing Deal — WebSocket server.
// Rooms up to 4 players. Run: node server.js [port]

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { Game } = require('./engine');
const { Bot, BOT_NAMES } = require('./bot');

const PORT = parseInt(process.env.PORT || process.argv[2] || '3000', 10);
const PUBLIC = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  if (p === '/deck.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(fs.readFileSync(path.join(__dirname, 'deck.js')));
  }
  const f = path.join(PUBLIC, p);
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

const wss = new WebSocket.Server({ server });
const rooms = {}; // code -> {players:[{ws,id,name}], game, host}
let nextId = 1;

function code() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms[c]);
  return c;
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  for (const pl of room.players) {
    if (!room.game) {
      send(pl.ws, { t: 'lobby', code: room.code, you: pl.id, host: room.host,
        players: [...room.players.map(q => ({ id: q.id, name: q.name })),
                  ...room.bots.map(b => ({ id: b.id, name: b.name, isBot: true }))] });
    } else {
      send(pl.ws, { t: 'state', code: room.code, ...room.game.publicFor(pl.idx) });
    }
  }
}

function errTo(ws, msg) { send(ws, { t: 'error', msg }); }

wss.on('connection', ws => {
  ws._pid = null; ws._room = null;

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'create') {
      const c = code();
      const id = nextId++;
      rooms[c] = { code: c, host: id, game: null, bots: [], botObjs: [],
        players: [{ ws, id, name: String(m.name || 'Player').slice(0, 16), idx: 0 }] };
      ws._pid = id; ws._room = c;
      broadcast(rooms[c]);
      return;
    }

    if (m.t === 'join') {
      const c = String(m.code || '').toUpperCase().trim();
      const room = rooms[c];
      if (!room) return errTo(ws, 'Room not found.');
      if (room.game) return errTo(ws, 'Game already started.');
      if (room.players.length >= 4) return errTo(ws, 'Room is full (4 max).');
      const id = nextId++;
      room.players.push({ ws, id, name: String(m.name || 'Player').slice(0, 16), idx: room.players.length });
      ws._pid = id; ws._room = c;
      broadcast(room);
      return;
    }

    const room = rooms[ws._room];
    if (!room) return;
    const pl = room.players.find(p => p.id === ws._pid);
    if (!pl) return;

    if (m.t === 'addBot') {
      if (ws._pid !== room.host) return errTo(ws, 'Only the host can add bots.');
      if (room.game) return errTo(ws, 'Game already started.');
      if (room.players.length + room.bots.length >= 4) return errTo(ws, 'Room is full (4 max).');
      const used = new Set([...room.players.map(p => p.name), ...room.bots.map(b => b.name)]);
      const name = BOT_NAMES.find(n => !used.has(n)) || ('Bot ' + (room.bots.length + 1) + ' \u{1F916}');
      const idx = room.players.length + room.bots.length;
      room.bots.push({ id: 'bot-' + idx + '-' + Date.now(), name, idx, isBot: true });
      broadcast(room);
      return;
    }
    if (m.t === 'removeBot') {
      if (ws._pid !== room.host) return errTo(ws, 'Only the host can remove bots.');
      if (room.game) return errTo(ws, 'Game already started.');
      const bi = room.bots.findIndex(b => b.id === m.id);
      if (bi >= 0) room.bots.splice(bi, 1);
      room.bots.forEach((b, k) => b.idx = room.players.length + k);
      broadcast(room);
      return;
    }
    if (m.t === 'start') {
      if (ws._pid !== room.host) return errTo(ws, 'Only the host can start.');
      const total = room.players.length + room.bots.length;
      if (total < 2) return errTo(ws, 'Need at least 2 players (add a bot!).');
      const allNames = [...room.players.map(p => p.name), ...room.bots.map(b => b.name)];
      room.game = new Game(allNames, { signetMode: (m.opts && m.opts.signetMode) || 'random' });
      room.botObjs = room.bots.map(b => new Bot(room.game, b.idx));
      broadcast(room);
      pumpBots(room);
      return;
    }

    const g = room.game;
    if (!g) return;
    const i = pl.idx;
    let r;
    try {
      if (m.t === 'draw') r = g.drawPhase(i);
      else if (m.t === 'play') r = g.play(i, m.card, m.opts || {});
      else if (m.t === 'answer') r = g.answer(i, m.resp || {});
      else if (m.t === 'end') r = g.endTurn(i);
      else if (m.t === 'discard') r = g.discard(i, m.cards || []);
      else if (m.t === 'signet') r = g.chooseSignet(i, m.signet);
      else if (m.t === 'mendingDraw') r = g.mendingDraw(i, m.card, m.target);
      else if (m.t === 'foresightDraw') r = g.foresightDraw(i);
      else if (m.t === 'placeLightning') r = g.placeLightning(i, m.set);
      else if (m.t === 'unblock') r = g.unblockSignet(i, m.cards || []);
      else if (m.t === 'recolor') r = g.recolorWild(i, m.card, m.set);
      else return;
    } catch (e) {
      console.error('game error:', e);
      return errTo(ws, 'Something went wrong — try again.');
    }
    if (r && r.ok === false && (r.err || r.need)) {
      // send the need/error back to just this player so UI can prompt
      send(ws, { t: 'nak', err: r.err, need: r.need, sets: r.sets, forTarget: r.forTarget, for: r.for });
    }
    broadcast(room);
    pumpBots(room);
  });

  ws.on('close', () => {
    const room = rooms[ws._room];
    if (!room) return;
    const ix = room.players.findIndex(p => p.id === ws._pid);
    if (ix >= 0) {
      const [gone] = room.players.splice(ix, 1);
      if (room.game && !room.game.winner) {
        room.game.logMsg(`${gone.name} disconnected.`);
      }
      room.players.forEach((p, k) => (p.idx = k));
      if (!room.players.length) { delete rooms[ws._room]; return; }
      if (room.host === ws._pid) room.host = room.players[0].id;
      // NOTE: player indexes shifted; game player order no longer matches.
      // Simplest: keep game going only if indexes still align (rare). For a friends
      // game, a disconnect mid-game is disruptive; we keep state as-is.
      broadcast(room);
    }
  });
});

server.listen(PORT, () => console.log(`Monopoly Deal on http://localhost:${PORT}`));

// Run bots until no bot needs to act. Called after game start and after each human action.
function pumpBots(room) {
  const g = room.game;
  if (!g || !room.botObjs || !room.botObjs.length) return;
  let guard = 0;
  while (guard++ < 50 && !g.winner) {
    let acted = false;
    // 0. Signet draft: bot's turn to pick
    if (g.phase === 'signet') {
      const dIdx = g.signetDraftIdx % g.players.length;
      const dbot = room.botObjs.find(b => b.i === dIdx);
      if (dbot) { dbot.takeTurn(); acted = true; continue; }
      break; // waiting on a human to draft
    }
    // 1. Pending decisions awaiting a bot
    const pd = g.pending;
    if (pd) {
      const awaitIdx = pd.awaits != null ? pd.awaits
        : pd.from != null ? pd.from
        : (pd.type === 'foresight' ? pd.by : null);
      const bot = awaitIdx != null ? room.botObjs.find(b => b.i === awaitIdx) : null;
      if (bot && bot.decidePending()) { acted = true; continue; }
      // If pending awaits a human, stop and wait
      break;
    }
    // 2. Bot's turn
    const bot = room.botObjs.find(b => b.i === g.turn);
    if (bot && g.turn === bot.i) {
      bot.takeTurn();
      acted = true;
      continue;
    }
    break;
  }
  broadcast(room);
}
