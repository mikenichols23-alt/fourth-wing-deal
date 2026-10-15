const WebSocket = require('ws');
const { SET_BY_ID } = require('./deck');

const MAX_ACTIONS = 4000;

class Bot {
  constructor(port, name) {
    this.name = name;
    this.port = port;
    this.me = null;
    this.lastState = null;
    this.failedCards = new Set();
    this.errors = [];
    this.actions = 0;
    this.ws = new WebSocket(`ws://localhost:${this.port}`);
    this.ws.on('message', raw => this.onMsg(JSON.parse(raw.toString())));
    this.ws.on('error', () => {});
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise(res => this.ws.on('open', res));
  }
  onMsg(m) {
    if (m.t === 'lobby') {
      this.me = m.you;
      this.roomCode = m.code;
      return;
    }
    if (m.t === 'error') { this.errors.push(m.msg); return; }
    if (m.t === 'nak') { this.onNak(m); return; }
    if (m.t !== 'state') return;
    this.me = m.you;
    this.lastState = m;
    this.act(m);
  }
  onNak(m) {
    // resolve needs by retrying with a choice
    if (m.need === 'chooseSet' && m.sets && m.sets.length && this.lastPlay) {
      this.send({ t: 'play', card: this.lastPlay, opts: { set: m.sets[0] } });
      this.actions++;
      return;
    }
    if (m.need === 'chooseBoostSet' && m.sets && m.sets.length && this.lastPlay) {
      this.send({ t: 'play', card: this.lastPlay, opts: { set: m.sets[0] } });
      this.actions++;
      return;
    }
    // hard failure: don't retry this card again this game
    if (this.lastPlay) this.failedCards.add(this.lastPlay);
    this.errors.push('nak: ' + JSON.stringify(m));
  }
  act(st) {
    if (st.winner) return; // game over
    if (this.actions > MAX_ACTIONS) return;
    // signet draft
    if (st.signetPhase) {
      if (st.signetDraftTurn === this.me && st.signetsAvailable.length) {
        this.send({ t: 'signet', signet: st.signetsAvailable[0].id });
        this.actions++;
      }
      return;
    }
    // pending prompt aimed at me
    const pd = st.pending;
    if (pd && !pd.waiting) {
      if (pd.kind === 'pay') {
        const mine = st.players[this.me];
        const propIds = mine.table
          .filter(e => !e.everyColor)
          .sort((a, b) => a.value - b.value)
          .map(e => e.id);
        let sum = 0; const pick = [];
        for (const id of propIds) {
          const c = mine.table.find(e => e.id === id);
          pick.push(id); sum += c.value;
          if (sum >= (pd.need || 0)) break;
        }
        this.send({ t: 'answer', resp: { cards: pick } });
        this.actions++;
        return;
      }
      if (pd.kind === 'wards') {
        this.send({ t: 'answer', resp: { use: false } });
        this.actions++;
        return;
      }
      return; // unknown prompt kind: wait
    }
    if (pd && pd.waiting) return; // someone else decides
    if (st.turn !== this.me) return;
    const mine = st.players[this.me];
    if (st.phase === 'draw' && st.needDraw) {
      this.send({ t: 'draw' });
      this.actions++;
      return;
    }
    if (st.phase !== 'play') return;
    // play first, discard excess only when done (real Monopoly Deal order)
    if (st.playsLeft > 0) {
      const pick = this.pickPlay(st, mine);
      if (pick) {
        this.lastPlay = pick.card;
        this.send({ t: 'play', card: pick.card, opts: pick.opts });
        this.actions++;
        return;
      }
    }
    if (st.needDiscard > 0) {
      const ids = mine.hand.slice(0, st.needDiscard).map(c => c.id);
      this.send({ t: 'discard', cards: ids });
      this.actions++;
      return;
    }
    this.send({ t: 'end' });
    this.actions++;
  }
  completeSetsOf(mine) {
    const by = {};
    for (const e of mine.table) { (by[e.asSet] = by[e.asSet] || []).push(e); }
    return Object.entries(by)
      .filter(([set, arr]) => arr.length >= SET_BY_ID[set].size)
      .map(([set]) => set);
  }
  pickPlay(st, mine) {
    for (const c of mine.hand) {
      if (this.failedCards.has(c.id)) continue;
      if (c.kind === 'money') return { card: c.id, opts: {} };
      if (c.kind === 'property') return { card: c.id, opts: {} };
      if (c.kind === 'wild') return { card: c.id, opts: { set: c.sets[0] } };
      if (c.kind === 'action') {
        if (c.action === 'tairn_wisdom') return { card: c.id, opts: {} };
        // bank everything else as money (avoids target prompts)
        return { card: c.id, opts: { asMoney: true } };
      }
      if (c.kind === 'rent') {
        const done = this.completeSetsOf(mine);
        const usable = (c.sets || []).find(s => done.includes(s));
        if (usable) return { card: c.id, opts: { set: usable } };
        continue; // hold it; will discard if hand overflows
      }
    }
    return null;
  }
}

module.exports = Bot;
