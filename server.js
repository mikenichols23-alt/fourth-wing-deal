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
  // Prevent aggressive caching - always get fresh files
  const noCache = { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' };
  if (p === '/deck.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', ...noCache });
    return res.end(fs.readFileSync(path.join(__dirname, 'deck.js')));
  }
  const f = path.join(PUBLIC, p);
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', ...noCache });
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
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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

    if (m.t === 'rejoin') {
      // auto-rejoin after disconnect: restore lobby spot or game seat
      const c = String(m.code || '').toUpperCase().trim();
      const room = rooms[c];
      if (!room) return errTo(ws, 'Room not found.');
      const name = String(m.name || 'Player').slice(0, 16);
      // if game in progress, try to find their seat by name
      if (room.game) {
        const gi = room.game.players.findIndex(p => p.name === name);
        if (gi >= 0) {
          const id = nextId++;
          // restore at ORIGINAL game index, not at end
          const existing = room.players.find(p => p.name === name);
          if (existing) {
            existing.ws = ws; existing.id = id; existing.idx = gi;
            ws._pid = id; ws._room = c;
          } else {
            room.players.push({ ws, id, name, idx: gi });
            ws._pid = id; ws._room = c;
          }
          // sort players by idx so broadcast order matches game order
          room.players.sort((a, b) => a.idx - b.idx);
          send(ws, { t: 'rejoined', code: c });
          broadcast(room);
          return;
        }
        return errTo(ws, 'Game already started.');
      }
      // lobby: re-add if not already there
      if (room.players.length >= 4 && !room.players.some(p => p.name === name)) {
        return errTo(ws, 'Room is full (4 max).');
      }
      let pl = room.players.find(p => p.name === name);
      if (!pl) {
        const id = nextId++;
        pl = { ws, id, name, idx: room.players.length };
        room.players.push(pl);
      } else {
        pl.ws = ws;
      }
      ws._pid = pl.id; ws._room = c;
      broadcast(room);
      return;
    }

    if (m.t === 'join') {
      const c = String(m.code || '').toUpperCase().trim();
      const room = rooms[c];
      if (!room) return errTo(ws, 'Room not found.');
      const name = String(m.name || 'Player').slice(0, 16);
      // Mid-game: if this name already has a seat, restore it (manual rejoin
      // after sessionStorage was cleared — e.g. Safari tab was closed).
      if (room.game) {
        const gi = room.game.players.findIndex(p => p.name === name);
        if (gi >= 0) {
          const id = nextId++;
          const existing = room.players.find(p => p.name === name);
          if (existing) {
            existing.ws = ws; existing.id = id; existing.idx = gi;
            ws._pid = id; ws._room = c;
          } else {
            room.players.push({ ws, id, name, idx: gi });
            ws._pid = id; ws._room = c;
          }
          room.players.sort((a, b) => a.idx - b.idx);
          send(ws, { t: 'rejoined', code: c });
          broadcast(room);
          return;
        }
        return errTo(ws, 'Game already started.');
      }
      if (room.players.length >= 4) return errTo(ws, 'Room is full (4 max).');
      // Prevent duplicate seats: if this name is already in the room,
      // reconnect them instead of adding another seat.
      const dup = room.players.find(p => p.name === name);
      if (dup) {
        try { if (dup.ws && dup.ws !== ws) dup.ws.close(); } catch {}
        dup.ws = ws;
        ws._pid = dup.id; ws._room = c;
        broadcast(room);
        return;
      }
      const id = nextId++;
      room.players.push({ ws, id, name, idx: room.players.length });
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
      pumpBots(room).catch(e => console.error("pump:", e));
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
    pumpBots(room).catch(e => console.error("pump:", e));
  });

  ws.on('close', () => {
    const room = rooms[ws._room];
    if (!room) return;
    const pl = room.players.find(p => p.id === ws._pid);
    if (!pl) return;
    if (room.game && !room.game.winner) {
      // MID-GAME: don't splice — mark disconnected, keep seat idx.
      // Splicing corrupts seat alignment for everyone else.
      pl.ws = null;
      room.game.logMsg(`${pl.name} disconnected.`);
      broadcast(room);
      return;
    }
    // LOBBY: safe to remove
    const ix = room.players.indexOf(pl);
    room.players.splice(ix, 1);
    room.players.forEach((p, k) => (p.idx = k));
    // count bots too — a solo human + bots disconnect shouldn't kill the room
    if (!room.players.length && !room.bots.length) { delete rooms[ws._room]; return; }
    if (room.host === ws._pid && room.players.length) room.host = room.players[0].id;
    broadcast(room);
  });
});

server.listen(PORT, () => console.log(`Monopoly Deal on http://localhost:${PORT}`));

// Run bots step-by-step with pauses so each move is visible (cards slide).
// Called after game start and after each human action.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pumpBots(room) {
  const g = room.game;
  if (!g || !room.botObjs || !room.botObjs.length) return;
  if (room._pumping) return; // already running — it will pick up new state
  room._pumping = true;
  try {
    let guard = 0;
    while (guard++ < 300 && g.winner == null) {
      let acted = false;
      // 0. Signet draft: bot's turn to pick
      if (g.phase === 'signet') {
        const dIdx = g.signetDraftIdx % g.players.length;
        const dbot = room.botObjs.find(b => b.i === dIdx);
        if (dbot && dbot.step()) acted = true;
        else break; // waiting on a human to draft
      } else if (g.pending) {
        // 1. Pending decision awaiting a bot
        const pd = g.pending;
        const awaitIdx = pd.awaits != null ? pd.awaits
          : pd.from != null ? pd.from
          : (pd.type === 'foresight' ? pd.by : null);
        const bot = awaitIdx != null ? room.botObjs.find(b => b.i === awaitIdx) : null;
        if (bot && bot.step()) acted = true;
        else break; // pending awaits a human — wait for them
      } else {
        // 2. Bot's turn: single step
        const bot = room.botObjs.find(b => b.i === g.turn);
        if (bot && g.turn === bot.i && bot.step()) {
          acted = true;
          broadcast(room); // broadcast after EACH move so client sees them one at a time
          await sleep(3500); // 3.5s pause - matches banner duration, no overlap
        }
        else break;
      }
      if (!acted) break;
    }
    broadcast(room);
  } finally {
    room._pumping = false;
  }
  // Watchdog: if the game is left on a bot's turn, re-check in 8s. If the bot
  // hasn't advanced the game by then, force it forward — a stuck bot must
  // never freeze the table.
  const gg = room.game;
  if (gg && gg.winner == null) {
    const botTurn = room.botObjs.some(b => b.i === gg.turn);
    const pd = gg.pending;
    const botAwaited = pd && room.botObjs.some(b => {
      const ai = pd.awaits != null ? pd.awaits : pd.from != null ? pd.from
        : (pd.type === 'foresight' ? pd.by : null);
      return ai === b.i;
    });
    if (botTurn || botAwaited) {
      if (room._watchdog) clearTimeout(room._watchdog);
      const snapshot = JSON.stringify({ t: gg.turn, ph: gg.phase, p: gg.pending,
        h: gg.players.map(p => p.hand.length) });
      room._watchdog = setTimeout(() => {
        room._watchdog = null;
        const g2 = room.game;
        if (!g2 || g2.winner) return;
        const now = JSON.stringify({ t: g2.turn, ph: g2.phase, p: g2.pending,
          h: g2.players.map(p => p.hand.length) });
        if (now === snapshot) {
          // NEVER time out a pending that a human needs to answer — wait for them
          const pd2 = g2.pending;
          const humanAwaited = pd2 && !room.botObjs.some(b => {
            const ai = pd2.awaits != null ? pd2.awaits : pd2.from != null ? pd2.from
              : (pd2.type === 'foresight' ? pd2.by : null);
            return ai === b.i;
          });
          if (humanAwaited) return; // human is thinking — do not clear, do not skip
          if (unstickBot(room)) pumpBots(room).catch(e => console.error("pump:", e));
          else { // last resort: clear pending and force next turn (bots only)
            try { g2.pending = null; g2._nextTurn(); } catch (e) {}
            broadcast(room);
            pumpBots(room).catch(e => console.error("pump:", e));
          }
        }
      }, 8000);
      if (room._watchdog.unref) room._watchdog.unref();
    } else if (room._watchdog) {
      clearTimeout(room._watchdog);
      room._watchdog = null;
    }
  }
}

// Failsafe: if pumpBots leaves the game on a bot's turn with no progress,
// force the turn forward so a stuck bot can never freeze the game.
function unstickBot(room) {
  const g = room.game;
  if (!g || g.winner != null || !room.botObjs || !room.botObjs.length) return false;
  const bot = room.botObjs.find(b => b.i === g.turn);
  if (!bot) return false;
  // NEVER unstick if a human needs to answer a pending — wait for them
  const pd = g.pending;
  if (pd) {
    const humanAwaited = !room.botObjs.some(b => {
      const ai = pd.awaits != null ? pd.awaits : pd.from != null ? pd.from
        : (pd.type === 'foresight' ? pd.by : null);
      return ai === b.i;
    });
    if (humanAwaited) return false;
  }
  const key = g.turn + '|' + g.phase + '|' + JSON.stringify(g.pending) + '|' +
    g.players.map(p => p.hand.length + '/' + p.table.length + '/' + p.bank.length).join(',');
  if (room._lastBotKey === key && (room._botStuckCount = (room._botStuckCount || 0) + 1) >= 2) {
    room._botStuckCount = 0;
    try { g.logMsg(`${g.me(g.turn).name} timed out — turn skipped.`); } catch (e) {}
    g.pending = null;
    try { g.endTurn(g.turn); } catch (e) {}
    // discard down if needed, then force next turn
    const p = g.me(g.turn);
    if (p && p.hand.length > 7) {
      const excess = p.hand.length - 7;
      for (let k = 0; k < excess; k++) g.discardPile.push(p.hand.pop());
    }
    if (g.turn === bot.i) { try { g._nextTurn(); } catch (e) {} }
    room._lastBotKey = null;
    broadcast(room);
    return true;
  }
  room._lastBotKey = key;
  return false;
}
// Deploy trigger 1792191388
// Restart trigger 1792194405
