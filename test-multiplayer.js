// Multiplayer WebSocket integration test for Monopoly Deal: Fourth Wing Edition.
// Spins up server.js, connects 3 clients, plays a full game with simple bots,
// and asserts a winner is declared with no errors.
//
// Run: node test-multiplayer.js
// Exit 0 = pass, exit 1 = fail.

const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const { SETS, SET_BY_ID } = require('./deck');

const PORT = 3999;
const NAMES = ['BotA', 'BotB', 'BotC'];
const MAX_ACTIONS = 4000;

const server = spawn('node', [path.join(__dirname, 'server.js'), String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErr = '';
server.stderr.on('data', d => { serverErr += d.toString(); });

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForServer() {
  for (let k = 0; k < 100; k++) {
    try {
      await new Promise((res, rej) => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        ws.on('open', () => { ws.close(); res(); });
        ws.on('error', rej);
      });
      return;
    } catch { await wait(100); }
  }
  throw new Error('server did not start');
}

const Bot = require('./test-bot-lib');

(async () => {
  await waitForServer();
  const bots = NAMES.map(n => new Bot(PORT, n));
  await Promise.all(bots.map(b => b.ready()));

  // host creates, others join
  bots[0].send({ t: 'create', name: NAMES[0] });
  await wait(300);
  const code = bots[0].roomCode;
  if (!code) throw new Error('no room code from create');
  bots[1].send({ t: 'join', code, name: NAMES[1] });
  bots[2].send({ t: 'join', code, name: NAMES[2] });
  await wait(300);
  bots[0].send({ t: 'start' });

  // wait for a winner (read from the bots' own latest states)
  let winner = null;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await wait(500);
    const total = bots.reduce((n, b) => n + b.actions, 0);
    if (total > MAX_ACTIONS) break;
    const w = bots.map(b => b.lastState && b.lastState.winner).find(Boolean);
    if (w) { winner = w; break; }
  }

  const errs = bots.flatMap(b => b.errors);
  const naks = errs.filter(e => e.startsWith('nak:'));
  const hardErrs = errs.filter(e => !e.startsWith('nak:'));
  const totalActions = bots.reduce((n, b) => n + b.actions, 0);
  console.log('winner:', winner ? `${winner.name} (player ${winner.idx})` : 'NONE');
  console.log('total bot actions:', totalActions);
  console.log('hard errors:', hardErrs.length ? hardErrs.slice(0, 10) : 'none');
  console.log('nak warnings:', naks.length ? naks.slice(0, 5) : 'none');
  if (serverErr) console.log('server stderr:', serverErr.slice(0, 2000));

  bots.forEach(b => b.ws.close());
  server.kill();
  await wait(300);

  if (!winner) { console.log('FAIL: no winner declared'); process.exit(1); }
  if (hardErrs.length) { console.log('FAIL: hard errors during play'); process.exit(1); }
  if (serverErr.includes('game error')) { console.log('FAIL: server game errors'); process.exit(1); }
  console.log('PASS: 3-player WebSocket game completed with a winner, no errors');
  process.exit(0);
})().catch(e => {
  console.error('FAIL:', e.message);
  try { server.kill(); } catch {}
  process.exit(1);
});
