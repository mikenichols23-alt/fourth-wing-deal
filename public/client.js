// Fourth Wing Deal — client
let ws, S = null, myIdx = 0, myId = null, roomCode = null, isHost = false;
let selCard = null;          // selected hand card id
let selTableWild = null;      // selected table wild {cardId, setId} for free flipping
let selSet = [];             // selected table cards (for pay) / hand cards (for discard)
let discardMode = false;     // true while tapping hand cards to choose discards
let mustDiscard = false;     // true after End Turn with >7 cards — big red discard UI
let announcedDiscard = false;
let endTurnTapped = false;   // true after tapping End Turn (to trigger must-discard)
let flow = null;             // {kind, ...} multi-step flow
let soundOn = true;          // audio toggle
let voiceOn = true;          // voice announcements toggle
let lastLogLen = 0;          // track new log entries for voice announcements
let dealPlayed = false;      // deal animation played for this game
let announcedTurn = false;   // "your turn" said for current turn
let announcedPay = false;    // "you owe" said for current payment
let announcedWards = null;   // wards prompt announced (tracks pending ref)
let prevS = null;            // previous state for play-animation diffing
let lastPlayInfo = null;     // {playerIdx, cardId} of most recent table play, for turnBar

// ---------- card flight animation: cards slide instead of appearing ----------
function elCenter(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function flyCard(fromEl, toEl, faceText, color) {
  const a = elCenter(fromEl), b = elCenter(toEl);
  if (!a || !b) return;
  const el = document.createElement('div');
  el.className = 'fly-card' + (faceText ? ' face' : '');
  if (faceText) { el.textContent = faceText; if (color) el.style.borderColor = color; }
  el.style.left = (a.x - 28) + 'px'; el.style.top = (a.y - 39) + 'px';
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px) rotate(${(Math.random() - .5) * 30}deg)`;
    el.style.opacity = '0.15';
  }));
  AudioSys.deal();
  setTimeout(() => el.remove(), 600);
}
// Money fly animation - slower, golden coins
function flyMoney(fromEl, toEl) {
  const a = elCenter(fromEl), b = elCenter(toEl);
  if (!a || !b) return;
  const el = document.createElement('div');
  el.className = 'fly-money';
  el.textContent = '🪙';
  el.style.left = (a.x - 16) + 'px'; el.style.top = (a.y - 16) + 'px';
  el.style.position = 'fixed'; el.style.zIndex = '999';
  el.style.fontSize = '32px'; el.style.pointerEvents = 'none';
  el.style.transition = 'transform 0.8s ease-in-out, opacity 0.8s';
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px)`;
    el.style.opacity = '0.3';
  }));
  setTimeout(() => el.remove(), 900);
}
// Payment banner - shows who paid whom
// Banner queue - show one banner at a time, no overlap
let bannerQueue = [];
let bannerBusy = false;
function queueBanner(html, duration) {
  bannerQueue.push({ html, duration: duration || 2500 });
  if (!bannerBusy) processBannerQueue();
}
function processBannerQueue() {
  if (!bannerQueue.length) { bannerBusy = false; return; }
  bannerBusy = true;
  const { html, duration } = bannerQueue.shift();
  let banner = $('paymentBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'paymentBanner';
    document.body.appendChild(banner);
  }
  banner.innerHTML = html;
  banner.classList.remove('hidden');
  banner.classList.add('show');
  setTimeout(() => {
    banner.classList.remove('show');
    setTimeout(() => {
      banner.classList.add('hidden');
      // Small gap before next banner
      setTimeout(processBannerQueue, 300);
    }, 500);
  }, duration);
}
function showPaymentBanner(from, to, amount) {
  queueBanner(`💰 <b>${esc(from)}</b> pays <b>${esc(to)}</b> ${amount}M`, 2500);
}
// Play announcement - shows what card an opponent played (queued, no overlap)
function showPlayBanner(playerName, cardName) {
  queueBanner(`🃏 <b>${esc(playerName)}</b> plays <b>${esc(cardName)}</b>`, 3000);
  AudioSys.pop();
}
// Center-stage card reveal - shows played card large, then flies to destination
// Queue for center-stage card reveals - show one at a time, no overlap
let centerQueue = [];
let centerBusy = false;
function queueCenterCard(card, playerName, isMe) {
  if (!card || !card.name) return;
  centerQueue.push({ card, playerName, isMe });
  if (!centerBusy) processCenterQueue();
}
function processCenterQueue() {
  if (!centerQueue.length) { centerBusy = false; return; }
  // If a selection modal/panel is open, wait - don't overlap
  const modalOpen = document.querySelector('#stealPanel:not(.hidden), #payModal:not(.hidden), .modal:not(.hidden)');
  if (modalOpen) {
    setTimeout(processCenterQueue, 500);
    return;
  }
  centerBusy = true;
  const { card, playerName, isMe } = centerQueue.shift();
  showCenterCardNow(card, playerName, isMe);
}
function showCenterCard(card, playerName, isMe) {
  // Legacy wrapper - use queue
  queueCenterCard(card, playerName, isMe);
}
function showCenterCardNow(card, playerName, isMe) {
  let stage = $('centerStage');
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'centerStage';
    document.body.appendChild(stage);
  }
  // Render the actual card large
  const el = cardEl(card, false, '', false);
  el.style.width = '140px';
  el.style.height = '200px';
  stage.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'center-label';
  label.innerHTML = `<b>${esc(playerName)}</b> plays`;
  stage.appendChild(label);
  stage.appendChild(el);
  stage.classList.remove('hidden');
  stage.classList.add('show');
  AudioSys.pop();
  // After 1.6s, fly to discard pile (actions) or fade (properties stay on table)
  setTimeout(() => {
    if (card.kind === 'action' || card.kind === 'rent') {
      // Fly to discard pile
      const r = el.getBoundingClientRect();
      const d = $('discardPile')?.getBoundingClientRect();
      if (d) {
        el.style.transition = 'transform 0.7s ease-in-out, opacity 0.7s';
        el.style.transform = `translate(${d.left + d.width/2 - (r.left + r.width/2)}px, ${d.top + d.height/2 - (r.top + r.height/2)}px) scale(0.4)`;
        el.style.opacity = '0.3';
      }
    }
    setTimeout(() => {
      stage.classList.remove('show');
      setTimeout(() => {
        stage.classList.add('hidden');
        // Process next in queue
        setTimeout(processCenterQueue, 300);
      }, 400);
    }, 700);
  }, 2200); // Show for 2.2s (was 1.6s) - enough time to read
}
function tableIds(p) { return (p.table || []).map(e => e.id || e.card); }
function animatePlays() {
  if (!prevS || !S) return;
  // for each player: new table cards fly from hand area to their actual card spot
  S.players.forEach((p, i) => {
    const pp = prevS.players[i];
    if (!pp) return;
    const prevTable = new Set(tableIds(pp));
    const newOnTable = (p.table || []).filter(e => !prevTable.has(e.id || e.card));
    if (!newOnTable.length) return;
    const isMe = i === myIdx;
    const oppEls = document.querySelectorAll('#opponents .oppcol');
    const oppEl = oppEls[i < myIdx ? i : i - 1];
    const fromEl = isMe ? $('hand') : oppEl;
    newOnTable.slice(0, 3).forEach((e, k) => {
      const cid = e.id || e.card;
      if (k === 0) {
        lastPlayInfo = { playerIdx: i, cardId: cid };
        // Show the played card LARGE in center so everyone sees it
        const c = S.cardMap[cid];
        if (c) {
          showCenterCard(c, p.name, isMe);
        }
        // Announce what was played
        if (!isMe) {
          const cardName = c ? c.name : 'a card';
          showPlayBanner(p.name, cardName);
        }
      }
      setTimeout(() => {
        // find the actual card element in the DOM for a precise landing spot
        const cardEl = document.querySelector(`.card[data-cid="${cid}"]`);
        const toEl = cardEl || (isMe ? $('mySets') : oppEl?.querySelector('.opp-area'));
        const c = S.cardMap[cid];
        flyCard(fromEl, toEl, c ? c.name : '', c ? (c.kind === 'property' ? setColor(c.set) : '#d4af37') : '');
      }, k * 160);
    });
  });
  // draws: hands grew -> cards fly from the deck
  const oppEls = document.querySelectorAll('#opponents .oppcol');
  S.players.forEach((p, i) => {
    const pp = prevS.players[i];
    if (!pp || p.hand.length <= pp.hand.length) return;
    const drew = p.hand.length - pp.hand.length;
    const isMe = i === myIdx;
    const toEl = isMe ? $('hand') : oppEls[i < myIdx ? i : i - 1];
    for (let k = 0; k < Math.min(drew, 5); k++) {
      setTimeout(() => flyCard($('drawPile'), toEl, '', ''), k * 180);
    }
  });
  // banking: bankTotal grew -> fly to the armory (not the discard pile!)
  const me = S.players[myIdx], pm = prevS.players[myIdx];
  if (pm && me.bankTotal > pm.bankTotal && me.hand.length < pm.hand.length) {
    flyCard($('hand'), $('myBankRow'), '', '');
    AudioSys.clink();
  }
  // PAYMENT ANIMATION: detect any player's bank change (rent/money transfers)
  // Slow, visible, with audio - show money going to the correct person
  S.players.forEach((p, i) => {
    const pp = prevS.players[i];
    if (!pp || i === myIdx) return; // skip me (handled above)
    if (p.bankTotal > pp.bankTotal) {
      // Find who actually PAID: bank decreased OR table shrank (paid with property).
      // A self-bank has no payer — only show the payment banner for real payments.
      const payerIdx = S.players.findIndex((q, j) => {
        if (j === i || !prevS.players[j]) return false;
        const pq = prevS.players[j];
        return q.bankTotal < pq.bankTotal || q.table.length < pq.table.length;
      });
      const amount = p.bankTotal - pp.bankTotal;
      // No payer found → self-bank, not a payment. Subtle bank animation only.
      if (payerIdx < 0) {
        const oppEls2 = document.querySelectorAll('#opponents .oppcol');
        const bankEl = i < myIdx ? oppEls2[i]?.querySelector('.opp-bank') : oppEls2[i - 1]?.querySelector('.opp-bank');
        if (bankEl) { flyMoney($('midbar'), bankEl); AudioSys.clink(); }
        return;
      }
      // Real payment: show banner
      const receiverName = p.name;
      const payerName = S.players[payerIdx].name;
      // Show payment banner
      showPaymentBanner(payerName, receiverName, amount);
      // Fly coins from payer to receiver (slower, multiple coins)
      const oppEls = document.querySelectorAll('#opponents .oppcol');
      const toEl = i < myIdx ? oppEls[i] : oppEls[i - 1];
      const fromEl = payerIdx === myIdx ? $('handInfo') : (payerIdx >= 0 ? (payerIdx < myIdx ? oppEls[payerIdx] : oppEls[payerIdx - 1]) : $('midbar'));
      for (let k = 0; k < Math.min(5, amount); k++) {
        setTimeout(() => {
          flyMoney(fromEl, toEl);
          AudioSys.clink();
        }, k * 300); // slower - 300ms between coins
      }
    }
  });
  // I RECEIVED money from someone
  if (pm && me.bankTotal > pm.bankTotal && me.hand.length >= pm.hand.length) {
    const amount = me.bankTotal - pm.bankTotal;
    const payerIdx = S.players.findIndex((q, j) => j !== myIdx && prevS.players[j] && q.bankTotal < prevS.players[j].bankTotal);
    const payerName = payerIdx >= 0 ? S.players[payerIdx].name : 'Someone';
    showPaymentBanner(payerName, 'You', amount);
    const oppEls = document.querySelectorAll('#opponents .oppcol');
    const fromEl = payerIdx >= 0 ? (payerIdx < myIdx ? oppEls[payerIdx] : oppEls[payerIdx - 1]) : $('midbar');
    for (let k = 0; k < Math.min(5, amount); k++) {
      setTimeout(() => {
        flyMoney(fromEl, $('handInfo'));
        AudioSys.clink();
      }, k * 300);
    }
  }
  // discards: hand shrank, table didn't grow, bank didn't grow -> fly to discard pile
  else if (pm && me.hand.length < pm.hand.length && me.table.length <= pm.table.length) {
    flyCard($('hand'), $('discardPile'), '', '');
  }
}

// ---------- audio: synthesized SFX + human voice ----------
const AudioSys = {
  ctx: null,
  ensure() {
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
    } catch {}
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  noiseBuf(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },
  // card shuffle: rapid papery bursts
  shuffle() {
    if (!soundOn) return; this.ensure(); if (!this.ctx) return;
    for (let i = 0; i < 7; i++) {
      const t = this.ctx.currentTime + i * 0.09;
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf(0.07);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500 + Math.random() * 2000; f.Q.value = 1.2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
      src.connect(f); f.connect(g); g.connect(this.ctx.destination);
      src.start(t); src.stop(t + 0.09);
    }
  },
  // single card deal swoosh
  deal() {
    if (!soundOn) return; this.ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf(0.25);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(800, t); f.frequency.exponentialRampToValueAtTime(4500, t + 0.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.01, t + 0.24);
    src.connect(f); f.connect(g); g.connect(this.ctx.destination);
    src.start(t); src.stop(t + 0.26);
  },
  // blades clink on payment
  clink() {
    if (!soundOn) return; this.ensure(); if (!this.ctx) return;
    [523, 659, 784].forEach((fr, i) => {
      const t = this.ctx.currentTime + i * 0.07;
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
      o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.2);
    });
  },
  // EPIC win fanfare - triumphant horns + drums + sparkle
  fanfare() {
    if (!soundOn) return; this.ensure(); if (!this.ctx) return;
    const ctx = this.ctx;
    // Triumphant horn melody (C E G C E G C up)
    const melody = [523, 659, 784, 1047, 784, 1047, 1319, 1568];
    melody.forEach((fr, i) => {
      const t = ctx.currentTime + i * 0.16;
      // Main horn (sawtooth for brass feel)
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
      o.connect(f); f.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.45);
      // Harmony octave up (softer)
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = fr * 2;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.001, t);
      g2.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
      o2.connect(g2); g2.connect(ctx.destination);
      o2.start(t); o2.stop(t + 0.35);
    });
    // Drum hits on beats
    [0, 4, 8, 12].forEach(i => {
      const t = ctx.currentTime + i * 0.16;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.25);
    });
    // Sparkle shimmer at the end
    const endT = ctx.currentTime + melody.length * 0.16;
    [2093, 2637, 3136, 4186].forEach((fr, i) => {
      const t = endT + i * 0.08;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.55);
    });
  },
  // soft tap
  tap() {
    if (!soundOn) return; this.ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 660;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.07);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.08);
  },
  // Business Deals style: satisfying "pop" when selecting a card
  pop() {
    if (!soundOn) return; this.ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(800, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.13);
  },
  // Business Deals style: "whoosh" when playing a card
  whoosh() {
    if (!soundOn) return; this.ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(200, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.22);
  },
  // human voice announcement
  speak(text) {
    if (!voiceOn || !('speechSynthesis' in window)) return;
    try {
      // iOS fix: if speech is stuck (speaking for >10s), force reset
      const now = Date.now();
      if (speechSynthesis.speaking && this._speakStart && (now - this._speakStart > 10000)) {
        speechSynthesis.cancel();
      }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 1.0; u.volume = 0.9;
      this._speakStart = now;
      u.onend = () => { this._speakStart = 0; };
      u.onerror = () => { this._speakStart = 0; };
      speechSynthesis.speak(u);
    } catch {}
  },
  // iOS: unlock audio on first user tap (must be called from a touch handler)
  unlock() {
    if (this._unlocked) return;
    this._unlocked = true;
    try {
      this.ensure();
      if ('speechSynthesis' in window) {
        const warm = new SpeechSynthesisUtterance(' ');
        warm.volume = 0;
        speechSynthesis.speak(warm);
      }
    } catch {}
  }
};
// unlock iOS audio on first tap anywhere
document.addEventListener('touchend', () => AudioSys.unlock(), { once: true, passive: true });
document.addEventListener('click', () => AudioSys.unlock(), { once: true });

const $ = id => document.getElementById(id);
const SETMAP = {};
function setColor(id) { const s = SETMAP[id]; return s ? s.color : '#555'; }
function setGlow(id) { const s = SETMAP[id]; return s ? s.glow : '#aaa'; }
// thematic colors + icons for action cards (match the physical deck)
const ACTION_STYLE = {
  fonilee:        { color: '#c2185b', icon: '🫐' },
  dragonscale:    { color: '#2e7d32', icon: '🛡️' },
  tairn_wisdom:   { color: '#b8860b', icon: '🐉' },
  dragons_fire:   { color: '#d84315', icon: '🔥' },
  leighorrel:     { color: '#7b1fa2', icon: '🍄' },
  dagger_acro:    { color: '#455a64', icon: '🗡️' },
  double_relics:  { color: '#1565c0', icon: '🏺' },
  memory_reading: { color: '#3949ab', icon: '🧠' },
  search_arch:    { color: '#6d4c41', icon: '🔍' },
  time_stopping:  { color: '#00838f', icon: '⏸️' },
  outsmart:       { color: '#4a148c', icon: '🎭' },
};
function actionStyle(c) { return ACTION_STYLE[c.action] || { color: '#2a3560', icon: '⚡' }; }
function splitGrad(sets) {
  const cols = sets.map(setColor);
  if (cols.length === 1) return cols[0];
  const step = 100 / cols.length;
  return 'linear-gradient(90deg,' + cols.map((c, i) => `${c} ${i * step}%,${c} ${(i + 1) * step}%`).join(',') + ')';
}
// wild cards: top/bottom split like the physical cards (flip = rotate 180°)
function wildGrad(sets) {
  const cols = sets.map(setColor);
  if (cols.length === 1) return cols[0];
  const step = 100 / cols.length;
  return 'linear-gradient(180deg,' + cols.map((c, i) => `${c} ${i * step}%,${c} ${(i + 1) * step}%`).join(',') + ')';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host);
  ws.onopen = () => {
    $('connStatus').textContent = '';
    // auto-rejoin after disconnect or page refresh: restore room/game seat.
    // (uses sessionStorage, not the in-memory roomCode, so it survives reloads)
    try {
      const rc = sessionStorage.getItem('fw_room');
      const nm = sessionStorage.getItem('fw_name');
      if (rc && nm) {
        roomCode = rc;
        send({ t: 'rejoin', code: rc, name: nm });
      }
    } catch {}
  };
  ws.onmessage = ev => handle(JSON.parse(ev.data));
  ws.onclose = () => { $('connStatus').textContent = '⚠️ Connecting to server…'; setTimeout(connect, 2000); };
}
// remember room for auto-rejoin
function rememberRoom(code, name) {
  try {
    sessionStorage.setItem('fw_room', code);
    sessionStorage.setItem('fw_name', name);
  } catch {}
}
let lastSendWarn = 0;
function send(m) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return; }
  // socket not open: don't silently drop the tap — say so (throttled)
  const now = Date.now();
  if (now - lastSendWarn > 4000) {
    lastSendWarn = now;
    toast('Reconnecting to server… one sec');
  }
}

function handle(m) {
  if (m.t === 'lobby') {
    roomCode = m.code; myId = m.you; isHost = m.you === m.host;
    try { sessionStorage.setItem('fw_room', m.code); } catch {}
    $('roomCode').textContent = m.code;
    $('roomInfo').classList.remove('hidden');
    $('lobbyCount').textContent = m.players.length;
    const avatars = ['🐉', '🔥', '⚡', '🌿'];
    $('playerList').innerHTML = m.players.map((p, i) =>
      `<li class="lobby-player"><span class="lp-avatar">${avatars[i % 4]}</span><span class="lp-name">${esc(p.name)}</span>${p.id === m.host ? ' <span class="lp-host">👑 HOST</span>' : ''}${p.isBot ? ' <span class="lp-bot">🤖 BOT</span> <button class="btn" style="padding:2px 8px;font-size:12px" data-rmbot="${p.id}">✖</button>' : ''}</li>`).join('');
    $('startBtn').classList.toggle('hidden', !isHost);
    $('signetModeRow').classList.toggle('hidden', !isHost);
    $('addBotBtn').classList.toggle('hidden', !isHost || m.players.length >= 4);
    $('playerList').querySelectorAll('[data-rmbot]').forEach(b => b.onclick = () => send({ t: 'removeBot', id: b.dataset.rmbot }));
  } else if (m.t === 'state') {
    const oldS = S;
    myIdx = m.you;
    const first = !S;
    S = m;
    if (first) {
      $('lobby').classList.add('hidden'); 
      const g = $('game'); g.classList.remove('hidden'); g.style.display = '';
      lastLogLen = 0; dealPlayed = false;
      announcedTurn = false; announcedPay = false; announcedWards = null;      // cinematic deal: shuffle + cards fly to each player (overlay covers the game)
      playDealAnimation(m.players.length, null);
      dealPlayed = true;
    }
    selCard = null; selSet = [];
    render();
    announceEvents();
    if (!first && oldS) { prevS = oldS; animatePlays(); }
    prevS = S;
  } else if (m.t === 'error') {
    $('lobbyErr').textContent = m.msg;
    setTimeout(() => $('lobbyErr').textContent = '', 4000);
    toast(m.msg);
    // if rejoin failed because the room is gone, don't leave them on a dead screen
    if (m.msg === 'Room not found.' && roomCode) {
      try { sessionStorage.removeItem('fw_room'); } catch {}
      roomCode = null; S = null;
      const g = $('game'); g.classList.add('hidden'); g.style.display = 'none';
      $('lobby').classList.remove('hidden');
      setTimeout(() => {
        toast('That game ended. Start a new one!');
      }, 1500);
    }
  } else if (m.t === 'nak') {
    handleNak(m);
  }
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(msg) {
  const b = $('banner'); b.textContent = msg; b.classList.remove('hidden');
  setTimeout(() => b.classList.add('hidden'), 3500);
}

// ---------- deal animation: cards fly to each player with sounds ----------
function playDealAnimation(numPlayers, done) {
  const ov = $('dealOverlay'), dc = $('dealCards');
  ov.classList.remove('hidden');
  dc.innerHTML = '<div class="deal-pile">🂠</div>';
  AudioSys.shuffle();
  // targets: opponents across the top, me at the bottom
  const targets = [];
  for (let i = 0; i < numPlayers - 1; i++) targets.push({ x: -32 + i * 32, y: -38 }); // top spread
  targets.push({ x: 0, y: 38 }); // me at bottom
  let n = 0;
  const total = numPlayers * 5;
  const iv = setInterval(() => {
    if (n >= total) {
      clearInterval(iv);
      setTimeout(() => { ov.classList.add('hidden'); dc.innerHTML = ''; done && done(); }, 500);
      return;
    }
    const t = targets[n % numPlayers];
    const el = document.createElement('div');
    el.className = 'deal-card';
    dc.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = `translate(${t.x}vw, ${t.y}vh) rotate(${(Math.random() - .5) * 40}deg)`;
    });
    AudioSys.deal();
    setTimeout(() => el.style.opacity = '0', 900);
    setTimeout(() => el.remove(), 1300);
    n++;
  }, 130);
}

// ---------- voice announcements from game events ----------
function announceEvents() {
  if (!S) return;
  const me = S.players[myIdx];
  const myName = me ? me.name : '';
  // payment targeting ME: announce loudly
  if (S.pending && S.pending.kind === 'pay' && !announcedPay) {
    const fromName = S.players[S.pending.by] ? S.players[S.pending.by].name : 'Someone';
    if (S.pending.from === myIdx || S.pending.awaits === myIdx) {
      announcedPay = true;
      AudioSys.speak(`${fromName} charges you ${S.pending.amount} blades!`);
    }
  } else if (!S.pending || S.pending.kind !== 'pay') {
    announcedPay = false;
  }
  // new log entries -> speak action cards / wins
  const log = S.log || [];
  for (let i = lastLogLen; i < log.length; i++) {
    const line = log[i];
    // action card played: "X played <Name>..."
    const m = line.match(/played (.+?)(?: to | on |\.|$)/);
    if (m) {
      const nm = m[1].trim();
      if (/berrie|mushroom|fire|acrobatics|relic|reading|archives|time|outsmart|armor|wisdom/i.test(nm))
        AudioSys.speak(nm + '!');
    }
    if (/wins!/i.test(line)) {
      const w = line.match(/^(.+?) /);
      const winnerName = w ? w[1] : 'Someone';
      AudioSys.speak(winnerName + ' wins the game!');
      AudioSys.fanfare();
      showWinnerOverlay(winnerName);
    }
    if (/issues a Challenge/i.test(line)) {
      AudioSys.speak('Challenge!');
      // if it targets me, say so
      if (myName && line.includes(myName)) AudioSys.speak('Someone challenges you!');
    }
    // Dragonscale Armor block: banner + voice announcement
    if (/blocked by Dragonscale Armor/i.test(line)) {
      const msg = 'Dragonscale Armor blocked the move!';
      AudioSys.speak(msg);
      toast('🛡️ ' + msg);
    }
    // action card targeting me: "X played [card] on Y" or "X stole from Y"
    if (myName && line.includes(myName)) {
      const acted = line.match(/^(.+?) (played|stole|took|discarded|swapped)/i);
      if (acted && acted[1] !== myName) {
        AudioSys.speak(`${acted[1]} targets you!`);
      }
    }
  }
  lastLogLen = log.length;
  // my turn? announce on draw or play phase, including the very first turn
  if (S.turn === myIdx && (S.phase === 'play' || S.phase === 'draw') && !announcedTurn) {
    announcedTurn = true;
    AudioSys.speak("It's your turn!");
    // hint at active signet power
    const me = S.players[myIdx];
    if (me && me.signet && !me.signetBlocked && !S.pending && !S.winner) {
      const sid = me.signet.id;
      if (sid === 'mending' && S.phase === 'draw' && S.needDraw) {
        setTimeout(() => AudioSys.speak("Your Mending power is ready!"), 1200);
      } else if (sid === 'foresight' && S.phase === 'draw' && S.needDraw) {
        setTimeout(() => AudioSys.speak("Your Foresight power is ready!"), 1200);
      } else if (sid === 'lightning' && S.phase === 'play') {
        // only announce if the lightning wild isn't already on the table
        const lid = 'lightning-' + myIdx;
        const alreadyPlaced = (me.table || []).some(e => e.card === lid);
        if (!alreadyPlaced) setTimeout(() => AudioSys.speak("Your Lightning power is ready!"), 1200);
      }
    }
  }
  if (S.turn !== myIdx) announcedTurn = false;
  // I owe money?
  const pd = S.pending;
  if (pd && pd.kind === 'pay' && pd.from === myIdx && !announcedPay) {
    announcedPay = true;
    AudioSys.speak(`You owe ${pd.amount} blades to ${S.players[pd.to].name}.`);
    AudioSys.clink();
  }
  if (!pd || pd.kind !== 'pay') announcedPay = false;
  // Dragonscale prompt? play a sound + read it aloud (only if I have one)
  if (pd && pd.kind === 'wards' && pd.hasWards && announcedWards !== pd) {
    announcedWards = pd;
    AudioSys.tap();
    AudioSys.speak(`${pd.byName} plays ${pd.actionName} against you. Use Dragonscale Armor?`);
  }
  if (!pd || pd.kind !== 'wards') announcedWards = null;
}
// Physical-card style: dark card, set-color frame, gold value badges
function frameStyle(c) {
  if (c.kind === 'property') return `border-color:${setColor(c.set)}`;
  if (c.kind === 'wild') return `border-color:${setColor(c.asSet || c.sets[0])}`;
  if (c.kind === 'rent') return `border-color:${setColor(c.sets[0])}`;
  if (c.kind === 'money') return `border-color:#d4af37`;
  if (c.kind === 'action') return `border-color:${actionStyle(c).color}`;
  return `border-color:#5b2a86`;
}
function cardEl(c, mini, extra, simple) {
  const d = document.createElement('div');
  d.className = 'card fw' + (mini ? ' mini' : '') + (extra ? ' ' + extra : '') + (simple ? ' simple' : '');
  d.dataset.cid = c.id;
  d.style.cssText += frameStyle(c);
  const badge = `<div class="vbadge">${c.value}</div>`;
  let inner = '';
  if (simple) {
    // Business Deals style: just color + value, no names
    if (c.kind === 'property') {
      inner = `${badge}<div class="shead" style="background:${setColor(c.set)}"></div><div class="sbody"></div>`;
    } else if (c.kind === 'wild') {
      const lbl = c.signetCard ? '⚡️' : '';
      inner = `${badge}<div class="shead" style="background:${wildGrad(c.sets)}"><span class="swild">${lbl}</span></div><div class="sbody"></div>`;
    } else if (c.kind === 'money') {
      inner = `${badge}<div class="shead" style="background:#b8860b"></div><div class="sbody"></div>`;
    } else {
      inner = `${badge}<div class="shead" style="background:#ddd"></div><div class="sbody"></div>`;
    }
  } else if (c.kind === 'property') {
    const s = SETMAP[c.set];
    inner = `${badge}<div class="phead" style="background:${setColor(c.set)}">${esc(c.name)}</div>` +
      `<div class="pbody"><div class="pset">${esc(s.name)}</div><div class="ptiers">${s.rent.join(' · ')}</div></div>`;
  } else if (c.kind === 'wild') {
    const active = c.asSet || c.sets[0];
    // Active color banner at TOP when flipped (prominent)
    const topBanner = c.asSet ? `<div class="wtop" style="background:${setColor(active)}">${esc(SETMAP[active].name).toUpperCase()}</div>` : '';
    // lightning signet wild: big ⚡️ to tell it apart
    const wildLabel = c.signetCard ? '⚡️' : 'WILD';
    inner = `${badge}${topBanner}<div class="wface" style="background:${wildGrad(c.sets)}"><div class="wwild">${wildLabel}</div></div>` +
      `<div class="pbody"><div class="pset">${c.signetCard ? '⚡️ Lightning Wild' : esc(c.sets.map(s => SETMAP[s].name).join(' / '))}</div></div>`;
  } else if (c.kind === 'rent') {
    inner = `${badge}<div class="whead" style="background:${splitGrad(c.sets)}">CHALLENGE</div>` +
      `<div class="pbody rent-body"><div class="rent-circle">⚔️</div><div class="pset">${esc(c.sets.map(s => SETMAP[s].name).join(' / '))}</div></div>`;
  } else if (c.kind === 'money') {
    inner = `${badge}<div class="mnum">${c.value}</div><div class="mlabel">BLADES</div>`;
  } else {
    // action: clean cream card like the sample — emoji center, no bright colors
    const st = actionStyle(c);
    d.classList.add('action-clean');
    inner = `${badge}<div class="ahead-clean"><span class="aicon-big">${st.icon}</span></div>` +
      `<div class="pbody"><div class="aname-clean">${esc(c.name)}</div></div>`;
  }
  d.innerHTML = inner;
  return d;
}

// big center focus card — matches the physical Fourth Wing cards
function focusCardEl(c) {
  const d = document.createElement('div');
  d.className = 'focus-card fw';
  d.style.cssText += frameStyle(c);
  const badge = `<div class="fvbadge">${c.value}</div>`;
  if (c.kind === 'property') {
    const s = SETMAP[c.set];
    const tiers = s.rent.map((v, i) =>
      `<div class="fc-tier"><div class="tnum">${i + 1}</div><div class="tdots"></div><div class="tval">${v}⚔️</div></div>`).join('');
    d.innerHTML = `${badge}
      <div class="fc-phead" style="background:${setColor(c.set)}">${esc(c.name.toUpperCase())}</div>
      <div class="fc-pbody">
        <div class="fc-set">${esc(s.name)} SET</div>
        <div class="fc-rent"><div class="fc-rent-title">⚔️ CHALLENGE</div>${tiers}</div>
      </div>`;
  } else if (c.kind === 'wild') {
    const names = c.signetCard ? '⚡️ Lightning Wild — any color' : c.sets.map(s => SETMAP[s].name).join(' / ');
    const active = c.asSet || c.sets[0];
    const wildBig = c.signetCard ? '⚡️' : 'WILD';
    d.innerHTML = `${badge}
      <div class="fc-wface" style="background:${wildGrad(c.sets)}"><div class="fc-wwild">${wildBig}</div></div>
      <div class="fc-pbody">
        <div class="fc-set">${esc(names)}</div>
        ${c.asSet ? `<div class="fc-curnote">Currently counts as <b style="color:${setColor(active)}">${esc(SETMAP[active].name).toUpperCase()}</b> — tap 🔄 Flip to switch sides.</div>` : ''}
        <div class="fc-desc">Play on any matching set.<br>Use the Flip button to switch which color it counts as.</div>
      </div>`;
  } else if (c.kind === 'rent') {
    const names = c.sets.map(s => SETMAP[s].name).join(' / ');
    // show which complete sets you have (or need) for this Challenge
    const me = S.players[myIdx];
    const reqLines = c.sets.map(s => {
      const have = (me.sets[s] || []).length;
      const ok = have > 0;
      return `<div style="color:${ok ? '#7CFC00' : '#ff9a9a'};font-weight:700">${ok ? '✓' : '✗'} ${esc(SETMAP[s].name)}: ${have} owned</div>`;
    }).join('');
    d.innerHTML = `${badge}
      <div class="fc-phead" style="background:${splitGrad(c.sets)}">CHALLENGE</div>
      <div class="fc-pbody" style="align-items:center">
        <div class="fc-rent-circle">⚔️</div>
        <div class="fc-name">${esc(c.name.toUpperCase())}</div>
        <div class="fc-set">${esc(names)}</div>
        <div class="fc-desc" style="text-align:center">${esc(c.text || '')}</div>
        <div class="fc-req" style="margin-top:8px;font-size:13px;text-align:center">Charge rent on properties you own:<br>${reqLines}</div>
      </div>`;
  } else if (c.kind === 'money') {
    d.innerHTML = `${badge}
      <div class="fc-phead" style="background:linear-gradient(100deg,#8a6d1c,#d4af37)">BLADES</div>
      <div class="fc-pbody">
        <div class="fc-mnum">${c.value}</div>
        <div class="fc-desc">Worth ${c.value}⚔️ in your armory.</div>
      </div>`;
  } else {
    // action focus: clean cream card like the sample — big emoji circle center
    const st = actionStyle(c);
    d.innerHTML = `${badge}
      <div class="fc-acream">
        <div class="fc-atop"><span class="fc-aval">${c.value}</span> ACTION CARD</div>
        <div class="fc-acircle"><span class="fc-aemoji">${st.icon}</span></div>
        <div class="fc-aname-big">${esc(c.name.toUpperCase())}</div>
        <div class="fc-adesc">${esc(c.text || '')}</div>
      </div>`;
  }
  return d;
}

function setGroupEl(p, setId, entries, forFlow) {
  // Split oversized sets: a 3-card set with max 2 shows as [2][1], not [3]
  const maxSize = (typeof SETMAP !== 'undefined' && SETMAP[setId]) ? SETMAP[setId].size : 99;
  if (entries.length > maxSize) {
    // Render as multiple groups
    const frag = document.createDocumentFragment();
    for (let i = 0; i < entries.length; i += maxSize) {
      const chunk = entries.slice(i, i + maxSize);
      frag.appendChild(setGroupEl(p, setId, chunk, forFlow));
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'setgroup-split';
    wrapper.appendChild(frag);
    return wrapper;
  }
  const g = document.createElement('div');
  const complete = entries.length >= maxSize;
  g.className = 'setgroup bd' + (complete ? ' complete' : '');
  // highlight valid move destinations during moveWild flow
  if (flow && flow.kind === 'moveWild' && p.idx === myIdx && flow.sets.includes(setId)) {
    g.classList.add('move-target');
  }
  // Business Deals style: NO set name label, just stacked cards
  let inner = `<div class="cards stacked">`;
  entries.forEach(e => {
    const full = (S.cardMap && S.cardMap[e.card]) || e;
    const el = cardEl(full, true, '', true);
    el.dataset.set = setId;
    if (forFlow) el.classList.add('targetable');
    const wrap = document.createElement('span');
    wrap.className = 'card-wrap';
    wrap.appendChild(el);
    inner += wrap.outerHTML;
  });
  inner += '</div>';
  const b = p.boosts[setId] || {};
  if (b.house || b.hotel) inner += `<div class="boost">${b.house ? '🏠' : ''}${b.hotel ? '🏨' : ''}</div>`;
  // complete indicator: small checkmark badge, not text
  if (complete) inner += `<div class="complete-badge">✓</div>`;
  g.innerHTML = inner;
  // re-attach handlers (innerHTML kills them)
  g.querySelectorAll('.card').forEach((el, i) => {
    const e = entries[i];
    el.dataset.set = setId;
    if (forFlow) el.classList.add('targetable');
    if (flow && flow.kind === 'payProps' && selSet.includes(e.card)) el.classList.add('selected');
    el.onclick = () => tableCardClick(e, setId);
  });
  return g;
}

const AVATARS = ['🐉', '🔥', '⚡', '🌿'];
let renderQueued = false;
function render() {
  // debounce: batch rapid state updates into one render
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    try { _render(); } catch (e) {
      console.error('render failed:', e);
      // Fail-safe: if it's my turn, force buttons visible
      try {
        if (S && myIdx != null && S.turn === myIdx && !S.winner) {
          if (S.phase === 'draw') $('drawBtn').classList.remove('hidden');
          if (S.phase === 'play') $('endBtn').classList.remove('hidden');
        }
      } catch {}
    }
  });
}
// Independent watchdog: every 2s, ensure buttons match turn state (bypasses render path)
setInterval(() => {
  try {
    if (!S || myIdx == null || S.winner) return;
    const mine = S.turn === myIdx;
    if (mine && S.phase === 'draw') $('drawBtn').classList.remove('hidden');
    if (mine && S.phase === 'play') $('endBtn').classList.remove('hidden');
    if (!mine) { $('drawBtn').classList.add('hidden'); $('endBtn').classList.add('hidden'); }
  } catch {}
}, 2000);
function _render() {
  const me = S.players[myIdx];
  const myTurn = S.turn === myIdx && !S.winner;

  // hide flow banner if no active flow (render() handles showing it via #flowBar)

  // opponents as full-width colored banners (Business Deals style)
  const opp = $('opponents'); opp.innerHTML = '';
  let oi = 0;
  const bannerColors = ['#16a34a', '#2563eb', '#dc2626', '#9333ea']; // green, blue, red, purple
  S.players.forEach((p, i) => {
    if (i === myIdx) return;
    const d = document.createElement('div');
    d.className = 'oppcol' + (S.turn === i ? ' active-turn' : '');
    const av = AVATARS[oi % AVATARS.length];
    const bg = bannerColors[oi % bannerColors.length]; oi++;
    d.innerHTML = `<div class="opp-banner" style="background:${bg}">
        <div class="opp-avatar">${av}</div>
        <div class="opp-name">${esc(p.name.replace(' \u{1F916}', ''))}</div>
        <div class="opp-bank"><span class="mcoin">M</span>${p.bankTotal}M</div>
      </div><div class="opp-area"><div class="opp-handcount">🂠 ×${p.handCount}</div></div>`;
    const area = d.querySelector('.opp-area');
    const pickRider = flow && (flow.kind === 'targetPlayer' || flow.kind === 'mendingTarget');
    for (const [setId, entries] of Object.entries(p.sets)) {
      const inFlow = flow && flow.kind === 'theirCard' && flow.target === i &&
        (p.sets[setId] || []).length < SETMAP[setId].size;
      const g = setGroupEl(p, setId, entries, inFlow);
      if (pickRider) g.querySelectorAll('.card').forEach(el => el.classList.add('flow-target'));
      area.appendChild(g);
    }
    if (flow && (flow.kind === 'targetPlayer' || flow.kind === 'mendingTarget')) {
      d.style.cursor = 'pointer'; d.onclick = () => flowTarget(i);
      d.classList.add('flow-target');
    }
    opp.appendChild(d);
  });

  // sticky turn/activity banner — always visible, no scrolling needed
  // tap it to jump to the active player's cards
  const tb = $('turnBar');
  const tp = S.players[S.turn];
  const tav = AVATARS[S.turn % AVATARS.length];
  tb.classList.remove('hidden');
  tb.classList.toggle('mine', S.turn === myIdx);
  $('turnAvatar').textContent = tav;
  const lastAction = (S.log || []).filter(l => !/drew|discarded|Welcome|It's .*'s turn/.test(l)).slice(-1)[0] || '';
  let miniCard = '';
  if (lastPlayInfo && lastPlayInfo.playerIdx !== myIdx) {
    const lc = S.cardMap[lastPlayInfo.cardId];
    if (lc) {
      const bg = lc.kind === 'property' ? setColor(lc.set) : lc.kind === 'rent' ? '#444' : '#2a3560';
      miniCard = `<span class="turn-mini" style="border-color:${lc.kind === 'property' ? setColor(lc.set) : '#d4af37'};background:${bg}">${esc(lc.name.slice(0, 14))}</span>`;
    }
  }
  $('turnText').innerHTML = S.turn === myIdx
    ? `<b>Your turn</b>${lastAction ? ` <span class="turn-action">· ${esc(lastAction.slice(0, 50))}</span>` : ''}`
    : `<b>${esc(tp.name)}'s turn</b>${miniCard}${lastAction ? ` <span class="turn-action">· ${esc(lastAction.slice(0, 50))}</span>` : ''}`;
  tb.onclick = () => {
    if (S.turn === myIdx) return;
    const oppEls = document.querySelectorAll('#opponents .oppcol');
    const el = oppEls[S.turn < myIdx ? S.turn : S.turn - 1];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // persistent flow instruction bar (pay flow has its own banner via renderPayModal)
  const fb = $('flowBar');
  if (flow && flow.kind === 'payProps') { renderPayModal(); }
  else if (flow && flow.label) {
    fb.classList.remove('hidden');
    fb.innerHTML = `<span id="flowText"></span><button id="flowCancel" class="btn">✖ Cancel</button>`;
    $('flowText').textContent = '👉 ' + flow.label;
    $('flowCancel').onclick = () => cancelFlow();
  } else fb.classList.add('hidden');

  // piles + log
  $('deckCount').textContent = S.deckCount;
  const drawP = $('drawPile');
  drawP.classList.toggle('has-cards', S.deckCount > 0);
  drawP.classList.toggle('empty', S.deckCount === 0);
  const dp = $('discardPile');
  dp.innerHTML = S.discardPile && S.discardPile.length ? '🂡' : '';
  $('log').innerHTML = S.log.map(l => `<div>${esc(l)}</div>`).join('');
  $('log').scrollTop = 1e6;

  // my table
  $('myName').textContent = me.name;
  const mt = $('myTable'); mt.classList.toggle('turn', myTurn);
  $('playerRow').classList.toggle('turn', myTurn);
  // my avatar glows on my turn (Business Deals style)
  const myAva = document.querySelector('#myAvatar .ava');
  if (myAva) myAva.classList.toggle('my-turn', myTurn);
  const ms = $('mySets'); ms.innerHTML = '';
  for (const [setId, entries] of Object.entries(me.sets)) {
    const inFlow = flow && (flow.kind === 'theirCard' || flow.kind === 'myCard' || flow.kind === 'payProps');
    const g = setGroupEl(me, setId, entries, inFlow);
    if (flow && flow.kind === 'myCard') g.querySelectorAll('.card').forEach(el => el.classList.add('flow-target'));
    ms.appendChild(g);
  }
  const mb = $('myBank'); mb.innerHTML = '';
  // Business Deals style: just show total, not individual cards
  // (individual cards clutter the UI - total is what matters)
  $('bankTotal').textContent = me.bankTotal + 'M';
  $('bankTotal2').textContent = me.bankTotal + 'M';
  $('handCount').textContent = me.hand.length;
  const mhc = $('myHandCount'); if (mhc) mhc.textContent = me.hand.length;

  // hand
  const h = $('hand'); h.innerHTML = '';
  me.hand.forEach(c => {
    const el = cardEl(c, false);
    if (selCard === c.id) el.classList.add('selected');
    el.onclick = () => selectCard(c);
    h.appendChild(el);
  });
  // hand fan: overlap cards like Business Deals, keep headers readable
  requestAnimationFrame(() => {
    const n = me.hand.length;
    if (!n) return;
    const cards = h.querySelectorAll('.card');
    const cardW = 72;
    const avail = (h.parentElement ? h.parentElement.clientWidth : window.innerWidth) || window.innerWidth;
    // calculate overlap so cards fit, but never smaller than 28px visible per card
    const maxOverlap = cardW - 28;
    const needed = n * cardW;
    let overlap = 0;
    if (needed > avail) {
      overlap = Math.min(maxOverlap, (needed - avail) / Math.max(1, n - 1));
    }
    cards.forEach((el, i) => {
      el.style.marginLeft = i === 0 ? '' : `-${overlap}px`;
      el.style.zIndex = i;
    });
    h.style.transform = '';
  });
  let turnText;
  if (S.winner) {
    turnText = `🏆 ${esc(S.winner.name)} wins!`;
    // Show the epic winner overlay (direct check, not log parsing)
    if (!$('winnerOverlay') || $('winnerOverlay').classList.contains('hidden')) {
      AudioSys.speak(S.winner.name + ' wins the game!');
      AudioSys.fanfare();
      showWinnerOverlay(S.winner.name);
    }
  }
  else if (S.pending && S.pending.awaits !== myIdx && S.pending.from !== myIdx) {
    const waiter = S.players[S.pending.awaits] ? S.players[S.pending.awaits].name : 'opponent';
    turnText = `⏳ Waiting for ${esc(waiter)}…`;
  }
  else turnText = myTurn ? `Your turn (${S.playsLeft} left)` : `${esc(S.players[S.turn].name)}'s turn`;
  $('turnInfo').textContent = turnText;

  // controls
  $('drawBtn').classList.toggle('hidden', !(myTurn && S.needDraw));
  $('drawBtn').classList.toggle('end-ready', myTurn && S.needDraw);
  // Defensive: if it's my draw phase, Draw MUST be visible (needDraw flag is redundant)
  if (myTurn && S.phase === 'draw' && !S.winner) $('drawBtn').classList.remove('hidden');
  // clarify normal draw vs signet power
  const me2 = S.players[myIdx];
  if (myTurn && S.needDraw && me2.signet && (me2.signet.id === 'mending' || me2.signet.id === 'foresight') && !me2.signetBlocked) {
    $('drawBtn').textContent = 'Draw 2 (skip power)';
  } else {
    $('drawBtn').textContent = 'Draw';
  }
  const needD = S.needDiscard > 0 && myTurn;
  // Enter must-discard mode: End Turn was tapped (or plays exhausted) with >7 cards
  if (needD && !mustDiscard && (S.playsLeft === 0 || endTurnTapped)) {
    mustDiscard = true; discardMode = true; selSet = [];
  }
  if (!needD) { discardMode = false; mustDiscard = false; selSet = []; announcedDiscard = false; endTurnTapped = false; }
  // Big red discard UI + voice when forced to discard at end of turn
  if (mustDiscard && !announcedDiscard) {
    announcedDiscard = true;
    AudioSys.speak(`Discard ${S.needDiscard} card${S.needDiscard === 1 ? '' : 's'}!`);
    AudioSys.tap();
  }
  $('endBtn').classList.toggle('hidden', !myTurn || S.phase !== 'play' || mustDiscard);
  // Defensive: if it's my play phase and not discarding, End Turn MUST be visible
  if (myTurn && S.phase === 'play' && !mustDiscard && !S.winner) $('endBtn').classList.remove('hidden');
  $('endBtn').textContent = S.playsLeft === 3 && me.hand.length <= 7 ? 'End Turn' : `End Turn (${S.playsLeft} left)`;
  // pop bright when all plays are used — hard to miss
  $('endBtn').classList.toggle('end-ready', myTurn && S.phase === 'play' && !mustDiscard && S.playsLeft === 0);
  $('discardBtn').classList.toggle('hidden', !mustDiscard);
  $('discardBtn').textContent = discardMode
    ? `Confirm Discard (${selSet.length}/${S.needDiscard})`
    : `Discard ${S.needDiscard}`;
  $('discardBtn').classList.toggle('end-ready', mustDiscard && discardMode && selSet.length >= S.needDiscard);
  $('discardBtn').classList.toggle('big-red', mustDiscard);

  renderFocus();
  renderPending();
  renderSignets();
}

// focus card + circular action buttons (Business-Deals style)
function renderFocus() {
  const fc = $('focusCard'), fa = $('focusActions'), fe = $('focusEmpty'), fw = $('focusWrap');
  const me = S.players[myIdx];
  const c = selCard && me.hand.find(x => x.id === selCard);
  const canAct = S && S.turn === myIdx && S.phase === 'play' && !S.winner && !S.pending && S.playsLeft > 0;
  // table wild flip mode: show popup for free flipping
  // (selTableWild popup removed — tapping a wild goes straight to move mode)
  // overlay mode: card pops up large when selected, closes when deselected
  fw.classList.toggle('overlay', !!c);
  fw.classList.toggle('hidden', !c);
  if (!c) {
    fc.classList.add('hidden'); fa.classList.add('hidden'); fe.classList.remove('hidden');
    fc.innerHTML = ''; fa.innerHTML = '';
    return;
  }
  fe.classList.add('hidden'); fc.classList.remove('hidden'); fa.classList.remove('hidden');
  fc.innerHTML = ''; fc.appendChild(focusCardEl(c));
  fa.innerHTML = '';
  const mkBtn = (cls, icon, label, fn, enabled) => {
    const b = document.createElement('div');
    b.className = 'act-btn ' + cls + (enabled === false ? ' disabled' : '');
    b.innerHTML = `<div class="circle">${icon}</div><div class="lbl">${label}</div>`;
    if (enabled !== false) b.onclick = fn;
    fa.appendChild(b);
  };
  // Flip — wilds: cycle through colors (top/bottom like physical card)
  if (c.kind === 'wild') mkBtn('flip', '🔄', 'Flip', () => {
    const idx = c.sets.indexOf(c.asSet || c.sets[0]);
    c.asSet = c.sets[(idx + 1) % c.sets.length];
    AudioSys.tap();
    render(); // re-render to show the flipped color
  }, canAct);
  // Bank — money, action, and challenge cards can go to the armory (not properties/wilds)
  if (c.kind === 'money' || c.kind === 'action' || c.kind === 'rent')
    mkBtn('bank', '⚔️', 'Bank', () => { send({ t: 'play', card: c.id, opts: { asMoney: true } }); selCard = null; }, canAct);
  // Play — contextual (money cards are bank-only, no Play)
  // Challenge cards need a complete matching set; disable Play with explanation if none
  let playEnabled = canAct;
  let playLabel = 'Play';
  if (c.kind === 'rent' && canAct) {
    // Challenge: playable if you own 1+ properties in any of its colors
    const okSets = c.sets.filter(s => (me.sets[s] || []).length > 0);
    if (!okSets.length) {
      playEnabled = false;
      playLabel = 'No Props';
    }
  }
  if (c.kind !== 'money') mkBtn('play', '▶', playLabel, () => playSelected(c), playEnabled);
  // Pass — deselect
  mkBtn('pass', '⏭', 'Pass', () => { selCard = null; render(); }, true);
  // plays-left dots
  const dots = document.createElement('div');
  dots.id = 'playsLeft';
  const maxPlays = me.signet && me.signet.id === 'distance' ? 4 : 3;
  for (let i = 0; i < maxPlays; i++) {
    const d = document.createElement('div');
    d.className = 'dot' + (i < S.playsLeft ? ' on' : '');
    dots.appendChild(d);
  }
  fa.appendChild(dots);
}

// (showFlipModal removed — tap wild, tap destination set)

function playSelected(c) {
  AudioSys.whoosh();
  if (c.kind === 'property') { send({ t: 'play', card: c.id, opts: {} }); selCard = null; }
  else if (c.kind === 'wild') {
    // play directly on the flipped color — no extra modal needed
    send({ t: 'play', card: c.id, opts: { set: c.asSet || c.sets[0] } });
    selCard = null;
  }
  else if (c.kind === 'rent') startRentFlow(c);
  else if (c.kind === 'money') { send({ t: 'play', card: c.id, opts: { asMoney: true } }); selCard = null; }
  else if (c.kind === 'action') playActionCard(c);
}

function playActionCard(c) {
  const a = c.action;
  // close the overlay directly (don't use debounced render - it races with modals/flows)
  const closeOverlay = () => { selCard = null; const fw = $('focusWrap'); if (fw) fw.classList.add('hidden'); };
  if (a === 'tairn_wisdom') { send({ t: 'play', card: c.id, opts: {} }); selCard = null; }
  else if (a === 'house' || a === 'hotel') { closeOverlay(); startBoostFlow(c); }
  else if (a === 'memory_reading') { closeOverlay(); startFlow({ kind: 'targetPlayer', card: c.id, action: a, label: 'Step 1/1: tap a rider to collect 5 blades from' }); }
  else if (a === 'outsmart') { closeOverlay(); startFlow({ kind: 'targetPlayer', card: c.id, action: a, label: 'Step 1/2: tap a rider to steal a full set from' }); }
  else if (a === 'dragons_fire') { closeOverlay(); startFlow({ kind: 'targetPlayer', card: c.id, action: a, label: "Step 1/2: tap a rider (or one of their cards) to discard one of their properties" }); }
  else if (a === 'leighorrel') { closeOverlay(); startFlow({ kind: 'targetPlayer', card: c.id, action: a, label: 'Step 1/2: tap a rider (or one of their cards) to swap a property with' }); }
  else if (a === 'dagger_acro') { closeOverlay(); startFlow({ kind: 'targetPlayer', card: c.id, action: a, label: 'Step 1/2: tap a rider (or one of their cards) to steal a property from' }); }
  else if (a === 'double_relics') { closeOverlay(); showRelicModal(c); }
  else if (a === 'search_arch') { closeOverlay(); showSearchModal(c); }
  else if (a === 'time_stopping') { closeOverlay(); startFlow({ kind: 'targetPlayer', card: c.id, action: a, label: 'Time Stopping: choose a rider' }); }
  else if (a === 'fonilee') { if (confirm('Collect 2 Blades from EVERY other rider?')) send({ t: 'play', card: c.id, opts: {} }); selCard = null; }
  else if (a === 'dragonscale') { selCard = null; render(); toast('Dragonscale Armor is played when someone targets you.'); }
}

// ---------- multi-step flows ----------
function startFlow(f) {
  flow = f; selCard = null; render();
  // render() shows the persistent banner via #flowBar; just speak the instruction
  if (f.label) AudioSys.speak(f.label);
}
function cancelFlow() {
  flow = null;
  render();
}
$('flowCancel').onclick = () => cancelFlow();

function startRentFlow(c) {
  const me = S.players[myIdx];
  const okSets = (c.sets || []).filter(s => (me.sets[s] || []).length > 0 && SETMAP[s]);
  if (!okSets.length) return toast('You own no properties in those colors.');
  selCard = null;
  // hide focus overlay directly (don't use debounced render - it races with modal)
  const fw = $('focusWrap'); if (fw) fw.classList.add('hidden');
  showModal(`<h3>⚔️ Issue Challenge</h3><div class="pickgrid">${
    okSets.map(s => `<button class="btn" data-s="${s}" style="border-color:${setColor(s)}">${esc(SETMAP[s].name)}</button>`).join('')
  }</div><div><button class="btn" id="mCancel">Cancel</button></div>`);
  const box = $('modalBox'); if (!box) return;
  box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    hideModal();
    send({ t: 'play', card: c.id, opts: { set: b.dataset.s } });
    selCard = null;
  });
  const cancel = $('mCancel'); if (cancel) cancel.onclick = hideModal;
}

function startBoostFlow(c) {
  const me = S.players[myIdx];
  const okSets = Object.keys(me.sets).filter(s => {
    const n = (me.sets[s] || []).length >= SETMAP[s].size;
    const b = me.boosts[s] || {};
    return n && (c.action === 'house' ? !b.house : (b.house && !b.hotel));
  });
  if (!okSets.length) return toast(c.action === 'house' ? 'Need a complete set without a House.' : 'Need a complete set with a House.');
  selCard = null; render(); // close overlay before showing modal
  showModal(`<h3>🏗️ ${esc(c.name)}</h3><div class="pickgrid">${
    okSets.map(s => `<button class="btn" data-s="${s}" style="border-color:${setColor(s)}">${esc(SETMAP[s].name)}</button>`).join('')
  }</div><div><button class="btn" id="mCancel">Cancel</button></div>`);
  $('modalBox').querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    hideModal(); send({ t: 'play', card: c.id, opts: { set: b.dataset.s } }); selCard = null;
  });
  $('mCancel').onclick = hideModal;
}

function flowTarget(playerIdx) {
  if (flow && flow.kind === 'mendingTarget') {
    if (playerIdx === myIdx) return toast('Choose another rider.');
    send({ t: 'mendingDraw', card: flow.card, target: playerIdx });
    flow = null; return;
  }
  if (!flow || flow.kind !== 'targetPlayer') return;
  const a = flow.action;
  if (a === 'memory_reading' || a === 'time_stopping') {
    send({ t: 'play', card: flow.card, opts: { target: playerIdx } });
    flow = null; selCard = null; return;
  }
  if (a === 'outsmart') {
    const p = S.players[playerIdx];
    const cs = Object.keys(p.sets || {}).filter(s => SETMAP[s] && (p.sets[s] || []).length >= SETMAP[s].size);
    if (!cs.length) return toast(p.name + ' has no complete set.');
    showModal(`<h3>🐉 Outsmart — steal a set from ${esc(p.name)}</h3><div class="pickgrid">${
      cs.map(s => `<button class="btn" data-s="${s}" style="border-color:${setColor(s)}">${esc(SETMAP[s].name)}</button>`).join('')
    }</div><div><button class="btn" id="mCancel">Cancel</button></div>`);
    const box = $('modalBox'); if (!box) return;
    box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      hideModal(); send({ t: 'play', card: flow.card, opts: { target: playerIdx, set: b.dataset.s } });
      flow = null; selCard = null;
    });
    const cancel = $('mCancel'); if (cancel) cancel.onclick = () => { hideModal(); cancelFlow(); };
    return;
  }
  // dragons_fire / leighorrel / dagger_acro need card picks
  // Business Deals style: show target's properties as full-size cards in a clean panel
  showStealPanel(playerIdx, a);
  return;
}

// Business Deals panel for picking MY card (mushroom swap step 2)
function showMyCardPanel(playerIdx, theirCardId) {
  const me = S.players[myIdx];
  const cards = [];
  for (const [setId, entries] of Object.entries(me.sets || {})) {
    const complete = (me.sets[setId] || []).length >= SETMAP[setId].size;
    if (complete) continue; // can't swap from complete set
    for (const e of entries) {
      const entry = typeof e === 'object' ? e : { card: e };
      const cardId = entry.card || entry.id;
      const cdef = typeof e === 'object' && e.name ? e : null;
      cards.push({ id: cardId, setId, name: cdef?.name || cardId, color: setId, value: cdef?.value || 0 });
    }
  }
  // Filter out cards that are part of a complete set (monopoly) - can't swap those
  const availCards = cards.filter(c => {
    const setId = c.setId;
    const setEntries = me.sets[setId] || [];
    const maxSize = SETMAP[setId]?.size || 99;
    return setEntries.length < maxSize;
  });
  const cardBtns = (availCards.length ? availCards : cards).map(c => {
    const full = (S.cardMap && S.cardMap[c.id]) || c;
    const el = cardEl(full, false, '', false);
    el.classList.add('stealcard');
    el.dataset.id = c.id;
    el.dataset.set = c.setId;
    el.style.cursor = 'pointer';
    return el.outerHTML;
  }).join('');
  showModal(`<div style="background:#7c3aed;border-radius:12px;padding:10px;margin:-8px -8px 12px">
      <h3 style="font-size:18px;margin:0;color:#fff">Now select YOUR property to swap.</h3>
    </div>
    <div class="paygrid">${cardBtns || '<p>No swappable properties!</p>'}</div>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
      <button class="btn" id="myCardCancel" style="font-size:16px;padding:12px 24px;background:#475569">Cancel</button>
      <button class="btn" id="myCardGo" style="font-size:18px;padding:12px 32px;background:#ea580c" disabled>Swap</button>
    </div>`, true);
  let selected = null;
  const goBtn = $('myCardGo');
  $('modalBox').querySelectorAll('.stealcard').forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    $('modalBox').querySelectorAll('.stealcard').forEach(x => { x.style.boxShadow = ''; x.style.transform = ''; });
    b.style.boxShadow = '0 0 16px #ffd75f'; b.style.transform = 'translateY(-4px)';
    selected = { id: b.dataset.id, set: b.dataset.set };
    goBtn.disabled = false;
    AudioSys.pop();
  });
  if (goBtn) goBtn.onclick = () => {
    if (!selected) return;
    hideModal(); AudioSys.whoosh();
    send({ t: 'play', card: flow.card, opts: { target: playerIdx, theirCard: theirCardId, myCard: selected.id } });
    flow = null; selCard = null; render();
  };
  const cancelBtn = $('myCardCancel');
  if (cancelBtn) cancelBtn.onclick = () => { hideModal(); cancelFlow(); };
}

// Wild move: show YOUR sets as LARGE cards to pick destination (not tiny panel)
function showWildMovePanel(cardId, validSets) {
  const me = S.players[myIdx];
  const mySets = me.sets || {};
  // Build large set cards for each valid destination
  const setBtns = validSets.map(setId => {
    const entries = mySets[setId] || [];
    const sname = SETMAP[setId] ? SETMAP[setId].name : setId;
    const scolor = setColor(setId);
    // Show a representative card from the set, or a placeholder
    let preview = '';
    if (entries.length) {
      const e = entries[0];
      const cid = typeof e === 'object' ? (e.card || e.id) : e;
      const full = (S.cardMap && S.cardMap[cid]) || {};
      preview = `<div style="font-size:11px;color:#fff;background:${scolor};border-radius:6px;padding:4px 8px;margin-top:6px">${esc(sname)} (${entries.length})</div>`;
    } else {
      preview = `<div style="font-size:11px;color:#fff;background:${scolor};border-radius:6px;padding:4px 8px;margin-top:6px">New ${esc(sname)} set</div>`;
    }
    return `<div class="wildset-card" data-set="${setId}" style="cursor:pointer;background:#1e293b;border:3px solid ${scolor};border-radius:12px;padding:16px 12px;text-align:center;min-width:110px">
      <div style="font-size:32px">${scolor === '#000' ? '⬛' : '🃏'}</div>
      <div style="font-size:14px;font-weight:800;color:#fff;margin-top:4px">${esc(sname).toUpperCase()}</div>
      ${preview}
    </div>`;
  }).join('');
  showModal(`<div style="background:#7c3aed;border-radius:12px;padding:10px;margin:-8px -8px 12px">
      <h3 style="font-size:18px;margin:0;color:#fff">👉 Move wild to which set?</h3>
      <p style="font-size:13px;margin:4px 0 0;color:#e9d5ff">Tap a set below — all your sets are shown large.</p>
    </div>
    <div class="paygrid" style="max-height:50vh;overflow-y:auto">${setBtns || '<p>No valid sets!</p>'}</div>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
      <button class="btn" id="wildMoveCancel" style="font-size:16px;padding:12px 24px;background:#475569">✖ Cancel</button>
    </div>`, true);
  $('modalBox').querySelectorAll('.wildset-card').forEach(el => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      const setId = el.dataset.set;
      hideModal();
      AudioSys.tap();
      send({ t: 'recolor', card: cardId, set: setId });
      render();
    };
  });
  $('wildMoveCancel').onclick = () => { hideModal(); };
}

// Business Deals steal panel: target's properties as full-size tappable cards
function showStealPanel(playerIdx, actionId) {
  const target = S.players[playerIdx];
  const actionName = actionId === 'dragons_fire' ? 'DRAGONS FIRE' : actionId === 'dagger_acro' ? 'DAGGER ACROBATICS' : 'MUSHROOM SWAP';
  const actionDesc = actionId === 'dragons_fire' ? 'Discard a property from the player of your choice.'
    : actionId === 'dagger_acro' ? 'Steal a property from the player of your choice.'
    : 'Swap one of your properties with an opponent\'s.';
  const btnLabel = actionId === 'dragons_fire' ? 'Discard' : actionId === 'dagger_acro' ? 'Steal' : 'Swap';
  // collect all target's property cards
  const cards = [];
  for (const [setId, entries] of Object.entries(target.sets || {})) {
    for (const e of entries) {
      const entry = typeof e === 'object' ? e : { card: e };
      const cardId = entry.card || entry.id;
      const cdef = typeof e === 'object' && e.name ? e : null;
      cards.push({ id: cardId, setId, name: cdef?.name || cardId, color: setId, value: cdef?.value || 0 });
    }
  }
  // Filter out cards that are part of a complete set (monopoly) - can't steal those
  const availCards = cards.filter(c => {
    const setId = c.setId;
    const setEntries = target.sets[setId] || [];
    const maxSize = SETMAP[setId]?.size || 99;
    return setEntries.length < maxSize;
  });
  const cardBtns = (availCards.length ? availCards : cards).map(c => {
    const full = (S.cardMap && S.cardMap[c.id]) || c;
    const el = cardEl(full, false, '', false);
    el.classList.add('stealcard');
    el.dataset.id = c.id;
    el.dataset.set = c.setId;
    el.style.cursor = 'pointer';
    return el.outerHTML;
  }).join('');
  showModal(`<div style="background:#7c3aed;border-radius:12px;padding:10px;margin:-8px -8px 12px">
      <h3 style="font-size:18px;margin:0;color:#fff">Now select the Property.</h3>
    </div>
    <div class="paygrid">${cardBtns || '<p>No properties to target!</p>'}</div>
    <div style="background:#dc2626;border-radius:12px;padding:12px;margin:12px -8px">
      <h3 style="font-size:22px;margin:0;color:#fff">${actionName}</h3>
      <p style="font-size:14px;margin:4px 0 0;color:#fecaca">${actionDesc}</p>
    </div>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:8px">
      <button class="btn" id="stealCancel" style="font-size:16px;padding:12px 24px;background:#475569">Cancel</button>
      <button class="btn" id="stealGo" style="font-size:18px;padding:12px 32px;background:#ea580c" disabled>${btnLabel}</button>
    </div>`, true);
  let selected = null;
  const goBtn = $('stealGo');
  $('modalBox').querySelectorAll('.stealcard').forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    $('modalBox').querySelectorAll('.stealcard').forEach(x => { x.style.boxShadow = ''; x.style.transform = ''; });
    b.style.boxShadow = '0 0 16px #ffd75f'; b.style.transform = 'translateY(-4px)';
    selected = { id: b.dataset.id, set: b.dataset.set };
    goBtn.disabled = false;
    AudioSys.pop();
  });
  if (goBtn) goBtn.onclick = () => {
    if (!selected) return;
    hideModal(); AudioSys.whoosh();
    if (actionId === 'dagger_acro') {
      send({ t: 'play', card: flow.card, opts: { target: playerIdx, card: selected.id, theirCard: selected.id } });
    } else if (actionId === 'dragons_fire') {
      send({ t: 'play', card: flow.card, opts: { target: playerIdx, card: selected.id, theirCard: selected.id } });
    } else {
      // mushroom swap: now pick MY card with the same clean panel
      hideModal();
      flow.kind = 'myCard'; flow.target = playerIdx; flow.theirCard = selected.id;
      showMyCardPanel(playerIdx, selected.id);
      return;
    }
    flow = null; selCard = null; render();
  };
  const cancelBtn = $('stealCancel');
  if (cancelBtn) cancelBtn.onclick = () => { hideModal(); cancelFlow(); };
}

function tableCardClick(entry, setId) {
  if (!flow) {
    // no flow: tapping my own table wild starts move mode
    const me = S.players[myIdx];
    const isMine = S.turn === myIdx && !S.winner;
    // entry from me.sets is {card: id, set: setId} — look up the card
    const cardId = entry.card || entry.id;
    const card = (S.cardMap && S.cardMap[cardId]) || entry;
    if (isMine && card.kind === 'wild') {
      // only my table wilds: tap wild → show LARGE set selection modal
      const myTable = me.table || [];
      // me.table has spread cards with .id
      if (myTable.some(e => (e.id === cardId) || (e.card === cardId))) {
        const sets = card.sets || (card.signetCard ? Object.keys(SETMAP) : []) || [];
        showWildMovePanel(cardId, sets);
        selCard = null;
        return;
      }
    }
    return;
  }
  const me = S.players[myIdx];
  // (moveWild now uses showWildMovePanel modal, not flow)
  // tapping an opponent's card directly during "choose a rider" skips straight to that rider
  if (flow.kind === 'targetPlayer') {
    for (let pi = 0; pi < S.players.length; pi++) {
      if (pi === myIdx) continue;
      if (S.players[pi].sets && S.players[pi].sets[setId]) {
        flowTarget(pi);
        if (flow && flow.kind === 'theirCard' && flow.target === pi) return tableCardClick(entry, setId);
        return;
      }
    }
    return;
  }
  if (flow.kind === 'theirCard' && flow.target !== myIdx) {
    const complete = (S.players[flow.target].sets[setId] || []).length >= SETMAP[setId].size;
    if (complete) return toast('Cannot take from a complete set.');
    const theirCardId = entry.card || entry.id;
    if (flow.action === 'dragons_fire') {
      send({ t: 'play', card: flow.card, opts: { target: flow.target, card: theirCardId } });
      flow = null; selCard = null;
    } else if (flow.action === 'dagger_acro') {
      // steal: take their card immediately
      send({ t: 'play', card: flow.card, opts: { target: flow.target, card: theirCardId } });
      flow = null; selCard = null;
    } else { // leighorrel: now pick mine
      flow.theirCard = theirCardId; flow.kind = 'myCard';
      flow.label = 'Step 2/2: now tap one of YOUR glowing properties to swap it with';
      render(); toast(flow.label);
    }
  } else if (flow.kind === 'myCard' && flow.target !== myIdx) {
    // clicked own table
    const complete = (me.sets[setId] || []).length >= SETMAP[setId].size;
    if (complete) return toast('Cannot swap from a complete set.');
    const myCardId = entry.card || entry.id;
    send({ t: 'play', card: flow.card, opts: { target: flow.target, theirCard: flow.theirCard, myCard: myCardId } });
    flow = null; selCard = null;
  } else if (flow.kind === 'payProps') {
    const cid = entry.card;
    const i = selSet.indexOf(cid);
    if (i >= 0) selSet.splice(i, 1); else selSet.push(cid);
    renderPayModal();
  }
}

function selectCard(c) {
  AudioSys.pop();
  if (flow && flow.kind === 'mendingPick') {
    startFlow({ kind: 'mendingTarget', card: c.id, label: 'Mending: now click a rider to give this card to' });
    render(); return;
  }
  if (flow && flow.kind === 'unblockPick') {
    const i = selSet.indexOf(c.id);
    if (i >= 0) selSet.splice(i, 1); else selSet.push(c.id);
    updateUnblockBar(); return;
  }
  if (S.turn !== myIdx) { toast('Not your turn'); return; }
  if (S.winner) return;
  if (S.pending) { toast('Waiting for ' + (S.players[S.pending.awaits]?.name || 'opponent') + '…'); return; }
  if (S.phase === 'draw') { toast('Tap DRAW first to draw 2 cards!'); AudioSys.tap(); return; }
  if (S.phase !== 'play') { toast('Phase: ' + S.phase); return; }
  if (discardMode) { toast('Discard mode: tap cards to discard'); return; }
  if (flow) cancelFlow();
  selCard = selCard === c.id ? null : c.id;
  render();
}

// ---------- pending prompts ----------
let lastWaitingOn = null;
let lastAutoWards = null;
function renderPending() {
  const pd = S.pending;
  if (!pd) {
    lastWaitingOn = null;
    lastAutoWards = null;
    if (!$('modal').classList.contains('hidden') && !modalPinned) hideModal();
    return;
  }
  if (pd.waiting) {
    if (lastWaitingOn !== pd.on + pd.kind) { toast(`Waiting on ${pd.on}…`); lastWaitingOn = pd.on + pd.kind; }
    return;
  }
  lastWaitingOn = null;
  if (pd.kind === 'wards') {
    if (!pd.hasWards) {
      // Don't even ask — auto-decline once per prompt
      if (lastAutoWards !== pd) { lastAutoWards = pd; send({ t: 'answer', resp: { use: false } }); }
      return;
    }
    showModal(`<h3>🛡️ Dragonscale Armor?</h3><p>${esc(pd.byName)} plays <b>${esc(pd.actionName)}</b> against you.</p>
      <button class="btn gold" id="wYes">Play Dragonscale Armor</button><button class="btn" id="wNo">Take it</button>`,
      true);
    $('wNo').onclick = () => { send({ t: 'answer', resp: { use: false } }); hideModal(); };
    const y = $('wYes'); if (y) y.onclick = () => { send({ t: 'answer', resp: { use: true } }); hideModal(); };
  } else if (pd.kind === 'pay') {
    // Only reset selection if this is a new payment (not a re-render of the same one)
    const payKey = pd.by + ':' + pd.amount + ':' + pd.from;
    if (flow?.kind !== 'payProps' || flow.payKey !== payKey) {
      flow = { kind: 'payProps', need: pd.need, label: 'pay', payKey };
      selSet = [];
    }
    renderPayModal();
  } else if (pd.kind === 'foresight') {
    showModal(`<h3>🔮 Battle Foresight</h3><p>Choose <b>1 card to return</b> to the top of the deck — you keep the other 2.</p>
      <div class="pickgrid" id="foresightGrid"></div>`, true);
    const grid = $('foresightGrid');
    pd.cards.forEach(c => {
      const d = cardEl(c, false);
      d.onclick = () => { send({ t: 'answer', resp: { returnCard: c.id } }); hideModal(); };
      grid.appendChild(d);
    });
  }
}

let modalPinned = false;
// Pay UI is a non-blocking banner (not a modal) so table cards stay tappable
function renderPayModal() {
  const pd = S.pending;
  if (!pd || pd.kind !== 'pay') { flow = null; selSet = []; hideModal(); return; }
  const me = S.players[myIdx];
  const fromName = S.players[pd.by] ? S.players[pd.by].name : 'Someone';
  // Sum from both bank and table selections
  const cardValue = (id) => {
    const b = (pd.bankCards || []).find(x => x.card === id);
    if (b) return b.value;
    const t = me.table.find(e => (e.id || e.card) === id);
    return t ? (t.value || 0) : 0;
  };
  const sum = selSet.reduce((t, id) => t + cardValue(id), 0);
  const totalBank = (pd.bankCards || []).reduce((t, x) => t + x.value, 0);
  const totalTable = me.table.reduce((t, e) => t + (e.value || 0), 0);
  const canPay = sum >= pd.need || (sum > 0 && sum >= totalBank + totalTable);
  const bankSelected = selSet.filter(id => (pd.bankCards || []).some(x => x.card === id));
  const bankSum = bankSelected.reduce((t, id) => t + cardValue(id), 0);
  // Show bank cards first (large), then properties if bank isn't enough
  const showProps = bankSum < pd.need;
  showModal(`<div style="background:#dc2626;border-radius:12px;padding:12px;margin:-8px -8px 12px">
      <h3 style="font-size:20px;margin:0;color:#fff">⚔️ ${esc(fromName)} is demanding ${pd.amount} blades!</h3>
      <p style="font-size:14px;margin:4px 0 0;color:#fecaca">Tap your money cards to pay. ${showProps ? 'Not enough — select properties too.' : ''}</p>
    </div>
    <p style="font-size:20px;font-weight:800;margin:8px 0">Selected: <span style="color:#ffd75f">${sum}⚔️</span> / ${pd.need}⚔️ ${canPay ? '✅' : ''}</p>
    <h4 style="color:#ffd75f;margin:8px 0 4px">💰 Your Blades (${totalBank}M)</h4>
    <div class="paygrid" id="payBankGrid" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:12px"></div>
    ${showProps ? `<h4 style="color:#fbbf24;margin:8px 0 4px">🏠 Properties (if needed)</h4><div class="paygrid" id="payPropGrid" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center"></div>` : ''}
    <div style="display:flex;gap:12px;justify-content:center;margin-top:16px">
      <button class="btn" id="payClear" style="font-size:16px;padding:12px 24px;background:#475569">Clear</button>
      <button class="btn" id="payOk" style="font-size:18px;padding:12px 32px;background:#16a34a" ${canPay ? '' : 'disabled'}>💰 PAY ${sum}⚔️</button>
    </div>`, true);
  // Bank cards: LARGE
  const bankGrid = $('payBankGrid');
  (pd.bankCards || []).forEach(bc => {
    const full = (S.cardMap && S.cardMap[bc.card]) || bc;
    const card = cardEl(full, false, '', false); // large, not mini
    card.style.cursor = 'pointer';
    card.style.width = '90px'; card.style.height = '126px';
    const isSel = selSet.includes(bc.card);
    card.style.border = isSel ? '4px solid #4ade80' : '3px solid transparent';
    if (isSel) card.style.boxShadow = '0 0 16px #4ade80';
    card.onclick = (ev) => {
      ev.stopPropagation();
      const i = selSet.indexOf(bc.card);
      if (i >= 0) selSet.splice(i, 1); else selSet.push(bc.card);
      AudioSys.tap();
      renderPayModal();
    };
    bankGrid.appendChild(card);
  });
  // Properties: only if bank isn't enough
  if (showProps) {
    const propGrid = $('payPropGrid');
    me.table.forEach(e => {
      const cardId = e.id || e.card;
      const full = (S.cardMap && S.cardMap[cardId]) || e.card || e;
      const card = cardEl(full, true, '', true);
      card.style.cursor = 'pointer';
      const isSel = selSet.includes(cardId);
      card.style.border = isSel ? '3px solid #4ade80' : '3px solid transparent';
      if (isSel) card.style.boxShadow = '0 0 12px #4ade80';
      card.onclick = (ev) => {
        ev.stopPropagation();
        const i = selSet.indexOf(cardId);
        if (i >= 0) selSet.splice(i, 1); else selSet.push(cardId);
        AudioSys.tap();
        renderPayModal();
      };
      propGrid.appendChild(card);
    });
  }
  const okBtn = $('payOk');
  if (okBtn) okBtn.onclick = () => { hideModal(); send({ t: 'answer', resp: { cards: selSet } }); flow = null; selSet = []; render(); };
  const clearBtn = $('payClear');
  if (clearBtn) clearBtn.onclick = () => { selSet = []; renderPayModal(); };
}

function handleNak(m) {
  // server needs more info for a play (choose set etc.)
  if (m.need === 'chooseSet' && selCard) {
    const me = S.players[myIdx];
    const c = me.hand.find(x => x.id === selCard);
    const sets = m.sets || (c ? c.sets : []);
    showModal(`<h3>Choose a set</h3><div class="pickgrid">${
      sets.map(s => `<button class="btn" data-s="${s}" style="border-color:${setColor(s)}">${esc(SETMAP[s].name)}</button>`).join('')
    }</div>`);
    $('modalBox').querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      hideModal(); send({ t: 'play', card: selCard, opts: { set: b.dataset.s } });
    });
  } else {
    toast(m.err || 'That play needs more info.');
  }
}

function showModal(html, pin) {
  $('modalBox').innerHTML = html;
  $('modal').classList.remove('hidden');
  modalPinned = !!pin;
}
function hideModal() { $('modal').classList.add('hidden'); modalPinned = false; }

// ---------- lobby wiring ----------
window.onload = () => {
  fetch('/deck.js').then(r => r.text()).then(t => {
    // deck.js sets globals when loaded as script; also parse SETS here
  });
  connect();
  // Warn if lobby doesn't connect within 10 seconds (only when the socket
  // itself isn't open — an idle-but-connected lobby is not a connection issue)
  setTimeout(() => {
    if (!S && !roomCode && (!ws || ws.readyState !== 1)) {
      const lobby = $('lobby');
      if (lobby && !$('connWarn')) {
        const w = document.createElement('div');
        w.id = 'connWarn';
        w.innerHTML = '‼️ <b>Connection issue</b> - trying to reach the game server...<br><span style="font-size:13px">Check your internet, then refresh the page.</span>';
        w.style.cssText = 'background:#dc2626;color:#fff;padding:12px;border-radius:12px;margin:12px;text-align:center;font-size:15px;';
        lobby.prepend(w);
      }
    }
  }, 10000);
  // SETMAP filled from deck.js script tag (loaded before client.js)
  if (typeof SETS !== 'undefined') SETS.forEach(s => SETMAP[s.id] = s);
  // sound + voice toggles
  $('sndBtn').onclick = () => { soundOn = !soundOn; $('sndBtn').classList.toggle('off', !soundOn); $('sndBtn').textContent = soundOn ? '🔊' : '🔇'; if (soundOn) AudioSys.tap(); };
  $('voiceBtn').onclick = () => { voiceOn = !voiceOn; $('voiceBtn').classList.toggle('off', !voiceOn); if (voiceOn) AudioSys.speak('Voice on'); else speechSynthesis.cancel(); };
  // back button: leave game to lobby
  const bb = $('backBtn');
  if (bb) bb.onclick = () => { if (confirm('Leave this game?')) { try { sessionStorage.removeItem('fw_room'); sessionStorage.removeItem('fw_name'); } catch {} location.reload(); } };
  // unlock audio on first touch (mobile browsers require a gesture)
  const unlock = () => { AudioSys.ensure(); document.removeEventListener('touchstart', unlock); };
  document.addEventListener('touchstart', unlock);
  $('createBtn').onclick = () => {
    const name = $('nameInput').value.trim() || 'Rider';
    try { sessionStorage.setItem('fw_name', name); } catch {}
    send({ t: 'create', name });
  };
  $('joinBtn').onclick = () => {
    const name = $('nameInput').value.trim() || 'Rider';
    const code = $('codeInput').value.trim();
    if (!code) return $('lobbyErr').textContent = 'Enter a room code.';
    rememberRoom(code.toUpperCase(), name);
    send({ t: 'join', code, name });
  };
  let signetMode = 'random';
  const setMode = m => { signetMode = m;
    $('modeRandom').className = 'btn' + (m === 'random' ? ' gold' : '');
    $('modeDraft').className = 'btn' + (m === 'draft' ? ' gold' : ''); };
  $('modeRandom').onclick = () => setMode('random');
  $('modeDraft').onclick = () => setMode('draft');
  $('startBtn').onclick = () => send({ t: 'start', opts: { signetMode } });
  $('addBotBtn').onclick = () => send({ t: 'addBot' });
  const drawPick = (e) => { e.preventDefault(); AudioSys.deal(); send({ t: 'draw' }); };
  $('drawBtn').onclick = drawPick;
  $('drawBtn').ontouchend = drawPick;
  $('endBtn').onclick = () => { AudioSys.tap(); endTurnTapped = true; send({ t: 'end' }); };
  $('drawPile').onclick = () => { if (myIdx != null && S && S.turn === myIdx && S.phase === 'draw') { AudioSys.deal(); send({ t: 'draw' }); } };
  $('focusOverlayClose').onclick = () => { selCard = null; selTableWild = null; render(); };
  $('focusWrap').onclick = (e) => { if (e.target.id === 'focusWrap') { selCard = null; selTableWild = null; render(); } };
  $('discardBtn').onclick = () => {
    if (!S || S.needDiscard <= 0) return;
    if (!discardMode) {
      // arm discard mode: play your cards first if you still have plays
      discardMode = true; selSet = []; selCard = null; flow = null;
      render();
      toast(S.playsLeft > 0
        ? `Tap ${S.needDiscard} cards to discard (you still have ${S.playsLeft} plays).`
        : `Tap ${S.needDiscard} cards to discard.`);
      return;
    }
    if (selSet.length !== S.needDiscard) return toast(`Select ${S.needDiscard} cards.`);
    send({ t: 'discard', cards: selSet });
    selSet = []; discardMode = false;
  };
  // hand card selection for discard: click toggles only while discard mode is armed
  const handEl = $('hand');
  handEl.addEventListener('click', e => {
    if (!(S && discardMode)) return;
    const ce = e.target.closest('.card');
    if (!ce) return;
    const id = ce.dataset.cid;
    const i = selSet.indexOf(id);
    if (i >= 0) selSet.splice(i, 1); else selSet.push(id);
    document.querySelectorAll('#hand .card').forEach(el =>
      el.classList.toggle('selected', selSet.includes(el.dataset.cid)));
    $('discardBtn').textContent = `Confirm Discard (${selSet.length}/${S.needDiscard})`;
  }, true);
};

// ---------- signets ----------
function renderSignets() {
  const draft = $('signetDraft');
  if (!S || !draft) return;
  if (S.signetPhase) {
    draft.classList.remove('hidden');
    const myTurnToPick = S.signetDraftTurn === myIdx;
    $('signetWait').classList.toggle('hidden', myTurnToPick);
    const grid = $('signetGrid');
    grid.innerHTML = '';
    (S.signetsAvailable || []).forEach(s => {
      const d = document.createElement('div');
      d.className = 'signet-card' + (myTurnToPick ? ' pickable' : '');
      d.innerHTML = `<h4>⚡ ${esc(s.name)}</h4><p class="sdesc">${esc(s.desc)}</p><p>${esc(s.text)}</p>${myTurnToPick ? '<div class="pick-hint">👆 TAP TO CHOOSE</div>' : ''}`;
      if (myTurnToPick) {
        const pick = (e) => { e.preventDefault(); AudioSys.tap(); send({ t: 'signet', signet: s.id }); };
        d.onclick = pick;
        d.ontouchend = pick;
        d.style.cursor = 'pointer';
      } else { d.style.opacity = '.55'; d.style.cursor = 'default'; }
      grid.appendChild(d);
    });
  } else {
    draft.classList.add('hidden');
  }
  const bar = $('signetBar');
  if (!bar) return;
  bar.innerHTML = '';
  const me = S.players[myIdx];
  if (me.signet) {
    const d = document.createElement('div');
    d.className = 'my-signet';
    d.innerHTML = `⚡ <b>${esc(me.signet.name)}</b>${me.signetBlocked ? ' <span class="blocked">⏸️ FROZEN</span>' : ''} <span class="signet-desc" style="color:var(--dim);font-size:12px">${esc(me.signet.text)}</span>`;
    d.style.cursor = 'pointer'; d.title = 'Tap to expand';
    d.onclick = () => bar.classList.toggle('expanded');
    bar.appendChild(d);
    const myTurn = S.turn === myIdx && !S.pending && !S.winner;
    const inDraw = myTurn && S.phase === 'draw' && S.needDraw;
    const inPlay = myTurn && S.phase === 'play';
    // Big obvious USE POWER button for active signets
    if (inDraw && !me.signetBlocked) {
      if (me.signet.id === 'mending') {
        const b = document.createElement('button'); b.className = 'btn signet-power';
        b.innerHTML = '🌿 <b>USE MENDING POWER</b><br><span style="font-size:12px;font-weight:400">Give 1 card to another rider → draw 4</span>';
        b.onclick = () => startFlow({ kind: 'mendingPick', label: 'Mending: tap one of YOUR hand cards to give away' });
        bar.appendChild(b);
      }
      if (me.signet.id === 'foresight') {
        const b = document.createElement('button'); b.className = 'btn signet-power';
        b.innerHTML = '🔮 <b>USE FORESIGHT POWER</b><br><span style="font-size:12px;font-weight:400">Draw 3, keep 2, return 1 to deck</span>';
        b.onclick = () => send({ t: 'foresightDraw' });
        bar.appendChild(b);
      }
    }
    if (inPlay && !me.signetBlocked && me.signet.id === 'lightning') {
      // hide once the lightning wild is already on the table — it's in use
      // table entries are spread card objects (have signetCard directly)
      const alreadyPlaced = (me.table || []).some(e => e.signetCard);
      if (!alreadyPlaced) {
        const b = document.createElement('button'); b.className = 'btn signet-power';
        b.innerHTML = '⚡ Use Lightning';
        b.onclick = () => showLightningModal();
        bar.appendChild(b);
      }
    }
    if (me.signetBlocked && myTurn) {
      const b = document.createElement('button'); b.className = 'btn gold'; b.textContent = '⏳ Unfreeze signet (discard 10⚔️)';
      b.onclick = () => { selSet = []; startFlow({ kind: 'unblockPick', label: 'Click hand cards worth 10+ Blades, then confirm below' }); updateUnblockBar(); };
      bar.appendChild(b);
    }
  }
  S.players.forEach((p, i) => {
    if (i === myIdx || !p.signet) return;
    // Business Deals: don't clutter with opponent signet names - hide them
  });
}

function updateUnblockBar() {
  const fa = $('focusActions');
  fa.classList.remove('hidden');
  const me = S.players[myIdx];
  const sum = selSet.reduce((t, id) => t + (me.hand.find(x => x.id === id)?.value || 0), 0);
  fa.innerHTML = '';
  const info = document.createElement('div');
  info.className = 'act-btn';
  info.innerHTML = `<div class="lbl">Selected: ${sum}⚔️ / 10⚔️ — tap hand cards</div>`;
  fa.appendChild(info);
  const ok = document.createElement('div');
  ok.className = 'act-btn play' + (sum < 10 ? ' disabled' : '');
  ok.innerHTML = `<div class="circle">✓</div><div class="lbl">Unfreeze</div>`;
  if (sum >= 10) ok.onclick = () => { send({ t: 'unblock', cards: selSet }); flow = null; selSet = []; };
  fa.appendChild(ok);
  const cx = document.createElement('div');
  cx.className = 'act-btn pass';
  cx.innerHTML = `<div class="circle">✕</div><div class="lbl">Cancel</div>`;
  cx.onclick = () => { flow = null; selSet = []; render(); };
  fa.appendChild(cx);
}

// (double-tap wild recolor removed — single tap goes straight to move mode)

// (showRecolorModal removed — tap wild, tap destination set)

function showLightningModal() {
  const colors = [['darkblue','Dark Blue'],['darkgreen','Dark Green'],['red','Red'],['yellow','Yellow'],['orange','Orange'],['pink','Pink'],['lightblue','Light Blue'],['brown','Brown'],['black','Black'],['lightgreen','Light Green']];
  showModal(`<h3>⚡ Lightning Wielding</h3><p style="color:var(--dim);font-size:13px">Place your signet as an every-color wild. Free — doesn't use a play.</p><div class="pickgrid">${
    colors.map(([c, n]) => `<button class="btn" data-s="${c}">${n}</button>`).join('')
  }</div><div><button class="btn" id="mCancel">Cancel</button></div>`);
  $('modalBox').querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    hideModal(); send({ t: 'placeLightning', set: b.dataset.s });
  });
  $('mCancel').onclick = hideModal;
}

function showRelicModal(c) {
  const me = S.players[myIdx];
  const sets = Object.keys(me.sets || {}).filter(s => (me.sets[s] || []).length > 0 && SETMAP[s]);
  if (!sets.length) return toast('You need properties to use Double Relics.');
  showModal(`<h3>🐉 Double Relics</h3><p style="color:var(--dim);font-size:13px">Choose a color — collect 1 Blade per property from each rider.</p><div class="pickgrid">${
    sets.map(s => `<button class="btn" data-s="${s}" style="border-color:${setColor(s)}">${esc(SETMAP[s].name)} (${(me.sets[s]||[]).length})</button>`).join('')
  }</div><div><button class="btn" id="mCancel">Cancel</button></div>`);
  const box = $('modalBox');
  if (!box) return;
  box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    hideModal(); send({ t: 'play', card: c.id, opts: { set: b.dataset.s } }); selCard = null;
  });
  const cancel = $('mCancel');
  if (cancel) cancel.onclick = hideModal;
}

function showSearchModal(c) {
  const pile = S.discardPile || [];
  if (!pile.length) return toast('Discard pile is empty.');
  showModal(`<h3>📚 Search the Archives</h3><p style="color:var(--dim);font-size:13px">Take a card from the discard pile — it goes to your hand.</p><div class="pickgrid" id="searchGrid"></div><div><button class="btn" id="mCancel">Cancel</button></div>`);
  const grid = $('searchGrid');
  pile.forEach(cardId => {
    const cd = S.cardMap[cardId]; if (!cd) return;
    const d = document.createElement('button');
    d.className = 'btn'; d.textContent = `${cd.name} (${cd.value}⚔️)`;
    d.onclick = () => { hideModal(); send({ t: 'play', card: c.id, opts: { card: cardId } }); selCard = null; };
    grid.appendChild(d);
  });
  const cancel = $('mCancel'); if (cancel) cancel.onclick = hideModal;
}

// big winner overlay with confetti
function showWinnerOverlay(name) {
  let ov = $('winnerOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'winnerOverlay';
    ov.innerHTML = `
      <div class="winner-confetti"></div>
      <div class="winner-box">
        <div class="winner-trophy">🏆</div>
        <div class="winner-medal">🥇</div>
        <div class="winner-name"></div>
        <div class="winner-sub">🎉 Three complete sets! 🎉</div>
        <button class="btn gold" id="winnerAgain">🔄 Play Again</button>
      </div>`;
    document.body.appendChild(ov);
    const conf = ov.querySelector('.winner-confetti');
    const colors = ['#ffd75f','#ff6b6b','#4ecdc4','#45b7d1','#f9ca24','#6c5ce7'];
    for (let i = 0; i < 120; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % 6];
      p.style.animationDelay = (Math.random() * 2) + 's';
      p.style.animationDuration = (2 + Math.random() * 2) + 's';
      conf.appendChild(p);
    }
  }
  ov.querySelector('.winner-name').textContent = name + ' WINS!';
  ov.classList.remove('hidden');
  ov.classList.remove('compact');
  // Reset celebration elements (in case of re-show)
  ov.querySelector('.winner-confetti').style.display = '';
  ov.querySelector('.winner-trophy').style.display = '';
  ov.querySelector('.winner-medal').style.display = '';
  ov.querySelector('.winner-sub').style.display = '';
  // After 5 seconds, hide celebration but show Play Again / Quit buttons
  clearTimeout(ov._hideT);
  ov._hideT = setTimeout(() => {
    ov.classList.add('compact');
    ov.querySelector('.winner-confetti').style.display = 'none';
    ov.querySelector('.winner-trophy').style.display = 'none';
    ov.querySelector('.winner-medal').style.display = 'none';
    ov.querySelector('.winner-sub').style.display = 'none';
    // Replace Play Again with Play Again + Quit buttons
    const box = ov.querySelector('.winner-box');
    if (!box.querySelector('#winnerQuit')) {
      const quitBtn = document.createElement('button');
      quitBtn.className = 'btn';
      quitBtn.id = 'winnerQuit';
      quitBtn.textContent = '🏠 Quit';
      quitBtn.style.marginLeft = '12px';
      quitBtn.onclick = () => {
        try { sessionStorage.removeItem('fw_room'); sessionStorage.removeItem('fw_name'); } catch {}
        location.reload();
      };
      box.appendChild(quitBtn);
    }
  }, 5000);
  $('winnerAgain').onclick = () => { try { sessionStorage.removeItem('fw_room'); sessionStorage.removeItem('fw_name'); } catch {} location.reload(); };
}
