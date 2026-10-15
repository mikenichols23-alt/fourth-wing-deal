// 30-game stress test: catches glitches, stalls, and errors across many games.
// Reuses test-bot-lib. Exit 0 = all clean, 1 = problems found.

const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const Bot = require('./test-bot-lib');

const PORT = 3998;
const GAMES = 30;
const NAMES = ['BotA', 'BotB', 'BotC'];
const GAME_TIMEOUT = 90000;

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

async function playOne(gameNum) {
  const bots = NAMES.map(n => new Bot(PORT, `${n}${gameNum}`));
  await Promise.all(bots.map(b => b.ready()));
  bots[0].send({ t: 'create', name: bots[0].name });
  await wait(250);
  const code = bots[0].roomCode;
  if (!code) throw new Error(`game ${gameNum}: no room code`);
  bots[1].send({ t: 'join', code, name: bots[1].name });
  bots[2].send({ t: 'join', code, name: bots[2].name });
  await wait(250);
  bots[0].send({ t: 'start' });

  let winner = null;
  const deadline = Date.now() + GAME_TIMEOUT;
  while (Date.now() < deadline) {
    await wait(400);
    const w = bots.map(b => b.lastState && b.lastState.winner).find(Boolean);
    if (w) { winner = w; break; }
  }
  const errs = bots.flatMap(b => b.errors);
  const result = {
    game: gameNum,
    winner: winner ? winner.name : null,
    actions: bots.reduce((n, b) => n + b.actions, 0),
    hardErrs: errs.filter(e => !e.startsWith('nak:')),
    naks: errs.filter(e => e.startsWith('nak:')),
  };
  bots.forEach(b => { try { b.ws.close(); } catch {} });
  await wait(200);
  return result;
}

(async () => {
  await waitForServer();
  const results = [];
  for (let g = 1; g <= GAMES; g++) {
    process.stdout.write(`\rGame ${g}/${GAMES}...`);
    try {
      results.push(await playOne(g));
    } catch (e) {
      results.push({ game: g, winner: null, actions: 0, hardErrs: [e.message], naks: [] });
    }
  }
  console.log('\n');

  const noWinner = results.filter(r => !r.winner);
  const withHardErrs = results.filter(r => r.hardErrs.length);
  const nakKinds = {};
  results.forEach(r => r.naks.forEach(n => {
    const k = n.slice(0, 80);
    nakKinds[k] = (nakKinds[k] || 0) + 1;
  }));

  console.log(`=== 30-game results ===`);
  console.log(`Winners: ${GAMES - noWinner.length}/${GAMES}`);
  if (noWinner.length) console.log(`  NO WINNER in games: ${noWinner.map(r => r.game).join(', ')}`);
  console.log(`Games with hard errors: ${withHardErrs.length}`);
  withHardErrs.slice(0, 5).forEach(r =>
    console.log(`  game ${r.game}: ${r.hardErrs.slice(0, 3).join(' | ')}`));
  console.log(`Nak types seen:`);
  Object.entries(nakKinds).forEach(([k, n]) => console.log(`  ×${n} ${k}`));
  if (serverErr.includes('game error')) {
    console.log('SERVER GAME ERRORS:', serverErr.slice(0, 1500));
  } else {
    console.log('server stderr: clean');
  }
  const avgActions = Math.round(results.reduce((n, r) => n + r.actions, 0) / GAMES);
  console.log(`avg actions/game: ${avgActions}`);

  server.kill();
  await wait(300);
  if (noWinner.length || withHardErrs.length) {
    console.log('FAIL: glitches found');
    process.exit(1);
  }
  console.log('PASS: all 30 games completed cleanly');
  process.exit(0);
})().catch(e => {
  console.error('FAIL:', e.message);
  try { server.kill(); } catch {}
  process.exit(1);
});
