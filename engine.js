// Monopoly Deal: Fourth Wing Edition — game engine. Pure logic, no I/O.
// Server drives it: play() / answer() / endTurn() / discard(), then broadcasts publicFor().

const { SETS, SET_BY_ID, SIGNETS, ACTIONS, buildDeck } = require('./deck');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Game {
  constructor(names, opts = {}) {
    this.cards = {};
    const deck = buildDeck();
    deck.forEach(c => (this.cards[c.id] = c));
    this.deck = shuffle(deck.map(c => c.id));
    this.discardPile = [];
    this.players = names.map((name, i) => ({
      idx: i, name, hand: [], bank: [], table: [], boosts: {},
    }));
    for (let r = 0; r < 5; r++) for (const p of this.players) p.hand.push(this._draw());
    this.turn = 0; this.plays = 0;
    this.signets = {};        // idx -> signet id
    this.signetBlocked = {};  // idx -> true (Time Stopping)
    this.signetMode = opts.signetMode === 'draft' ? 'draft' : 'random';
    this.pending = null; this.winner = null; this.log = [];
    if (this.signetMode === 'random') {
      const pool = shuffle(SIGNETS.map(s => s.id));
      this.players.forEach((p, i) => { this.signets[i] = pool[i]; });
      this.phase = 'draw';
      this.logMsg(`Welcome to the Rider's Quadrant! Signets manifested: ` +
        this.players.map((p, i) => `${p.name} (${SIGNETS.find(s => s.id === this.signets[i]).name})`).join(', ') +
        `. ${this.me(0).name} goes first — draw to begin!`);
    } else {
      this.phase = 'signet';
      this.signetDraftIdx = 0;
      this.logMsg(`Welcome to the Rider's Quadrant! Each rider, choose your signet.`);
    }
  }

  maxPlays(i) {
    return (this.signetActive(i) && this.signetOf(i) === 'distance') ? 4 : 3;
  }

  // ---------- signets ----------
  chooseSignet(i, sid) {
    if (this.phase !== 'signet') return { ok: false };
    if (this.signetDraftIdx >= this.players.length) return { ok: false };
    // draft in turn order starting from player 0
    const expected = this.signetDraftIdx % this.players.length;
    if (i !== expected) return { ok: false, err: 'Not your pick yet.' };
    const s = SIGNETS.find(s => s.id === sid);
    if (!s) return { ok: false };
    if (Object.values(this.signets).includes(sid)) return { ok: false, err: 'Already manifested.' };
    this.signets[i] = sid;
    this.logMsg(`${this.me(i).name} manifested ${s.name}!`);
    this.signetDraftIdx++;
    if (this.signetDraftIdx >= this.players.length) {
      this.phase = 'draw';
      this.logMsg(`All signets manifested. ${this.me(0).name} goes first — draw to begin!`);
    }
    return { ok: true };
  }
  signetOf(i) { return this.signets[i] || null; }
  signetActive(i) { return !!this.signets[i] && !this.signetBlocked[i]; }

  // MENDING: give another rider one of your cards, then draw 4 instead of 2.
  // Replaces your normal draw; use during your draw phase.
  mendingDraw(i, cardId, target) {
    const p = this.me(i);
    if (this.phase !== 'draw' || this.turn !== i || this.winner != null) return { ok: false };
    if (!this.signetActive(i) || this.signetOf(i) !== 'mending') return { ok: false };
    if (!p.hand.includes(cardId)) return { ok: false, err: 'Card not in hand.' };
    if (target == null || target === i || !this.players[target]) return { ok: false, err: 'Choose another rider.' };
    this.removeFromHand(p, cardId);
    this.me(target).hand.push(cardId);
    for (let k = 0; k < 4; k++) { const d = this._draw(); if (d) p.hand.push(d); }
    this.phase = 'play'; this.plays = 0;
    this.logMsg(`${p.name} used Mending: gave ${this.card(cardId).name} to ${this.me(target).name}, drew 4.`);
    return { ok: true };
  }

  // BATTLE FORESIGHT: draw 3, choose 2 to keep, return 1 to the top of the deck.
  foresightDraw(i) {
    const p = this.me(i);
    if (this.phase !== 'draw' || this.turn !== i || this.winner != null) return { ok: false };
    if (!this.signetActive(i) || this.signetOf(i) !== 'foresight') return { ok: false };
    const drawn = [];
    for (let k = 0; k < 3; k++) { const d = this._draw(); if (d) drawn.push(d); }
    if (!drawn.length) return { ok: false, err: 'Nothing left to draw.' };
    this.pending = { type: 'foresight', by: i, cards: drawn };
    return { ok: true, prompt: { kind: 'foresight', cards: drawn.map(id => this.cards[id]) } };
  }
  answerForesight(i, returnId) {
    const pd = this.pending;
    if (!pd || pd.type !== 'foresight' || pd.by !== i) return { ok: false };
    if (!pd.cards.includes(returnId)) return { ok: false, err: 'Pick one of the drawn cards.' };
    const p = this.me(i);
    for (const id of pd.cards) {
      if (id === returnId) this.deck.push(id); // top of deck
      else p.hand.push(id);
    }
    this.pending = null;
    this.phase = 'play'; this.plays = 0;
    this.logMsg(`${p.name} used Battle Foresight: kept 2, returned 1 to the deck.`);
    return { ok: true };
  }

  // LIGHTNING WIELDING: place your signet as an every-color wild property.
  // Free — doesn't count as one of your plays. You keep it if the set is stolen.
  placeLightning(i, setId) {
    const p = this.me(i);
    if (this.turn !== i || this.phase !== 'play' || this.pending || this.winner != null) return { ok: false };
    if (!this.signetActive(i) || this.signetOf(i) !== 'lightning') return { ok: false };
    if (!SET_BY_ID[setId]) return { ok: false };
    const lid = 'lightning-' + i;
    if (!this.cards[lid]) {
      this.cards[lid] = { id: lid, kind: 'wild', sets: SETS.map(s => s.id),
        name: 'Lightning Wielding (signet)', value: 0, everyColor: true, signetCard: true };
    }
    const entry = p.table.find(e => e.card === lid);
    if (entry) entry.set = setId;
    else p.table.push({ card: lid, set: setId });
    this.logMsg(`${p.name} placed Lightning Wielding as a wild on ${SET_BY_ID[setId].name} (free).`);
    this.checkWin(p);
    return { ok: true };
  }

  unblockSignet(i, cardIds) {
    if (!this.signetBlocked[i]) return { ok: false };
    if (this.turn !== i || this.phase !== 'play' || this.winner != null) return { ok: false };
    const p = this.me(i);
    let sum = 0;
    for (const id of cardIds) {
      if (!p.hand.includes(id)) return { ok: false, err: 'Card not in hand.' };
      sum += this.card(id).value;
    }
    if (sum < 10) return { ok: false, err: 'Need at least 10 Blades worth.' };
    for (const id of cardIds) { this.removeFromHand(p, id); this.discardPile.push(id); }
    delete this.signetBlocked[i];
    this.logMsg(`${p.name} reversed Andarna's Time Stopping!`);
    return { ok: true };
  }
  recolorWild(i, cardId, newSet) {
    const p = this.me(i);
    if (this.turn !== i || this.phase !== 'play' || this.pending || this.winner != null) return { ok: false };
    const e = p.table.find(e => e.card === cardId);
    if (!e) return { ok: false };
    const c = this.card(cardId);
    if (c.kind !== 'wild' || !c.sets.includes(newSet)) return { ok: false };
    e.set = newSet;
    this.logMsg(`${p.name} shifted a wild to ${SET_BY_ID[newSet].name} (free).`);
    this.checkWin(p);
    return { ok: true };
  }

  // ---------- helpers ----------
  _draw() {
    if (!this.deck.length) {
      if (!this.discardPile.length) return null; // every card is in someone's hand/bank/table
      this.deck = shuffle(this.discardPile.splice(0));
      this.logMsg('Draw pile reshuffled from discards.');
    }
    return this.deck.pop();
  }
  card(id) { return this.cards[id]; }
  me(i) { return this.players[i]; }
  logMsg(m) { this.log.push(m); if (this.log.length > 40) this.log.shift(); }

  tableSets(p) {
    const groups = {};
    for (const t of p.table) {
      (groups[t.set] = groups[t.set] || []).push(t);
    }
    return groups;
  }
  isComplete(p, setId) {
    const g = this.tableSets(p)[setId] || [];
    if (g.length < SET_BY_ID[setId].size) return false;
    // every-color wilds cannot complete a set on their own
    if (g.every(e => this.card(e.card).everyColor)) return false;
    return true;
  }
  completeSets(p) {
    return Object.keys(this.tableSets(p)).filter(s => this.isComplete(p, s));
  }
  rentFor(p, setId) {
    const s = SET_BY_ID[setId];
    const n = (this.tableSets(p)[setId] || []).length;
    let r = s.rent[Math.min(n, s.rent.length) - 1] || 0;
    const b = p.boosts[setId] || {};
    if (b.house) r += 3;
    if (b.hotel) r += 4;
    return r;
  }
  bankTotal(p) { return p.bank.reduce((t, id) => t + this.card(id).value, 0); }
  removeFromHand(p, id) {
    const i = p.hand.indexOf(id);
    if (i >= 0) p.hand.splice(i, 1);
  }
  checkWin(p) {
    // official: three complete sets, each a DIFFERENT color
    const colors = new Set(this.completeSets(p));
    if (colors.size >= 3 && this.winner == null) {
      this.winner = p.idx; this.phase = 'over';
      this.logMsg(`${p.name} protected 3 different complete sets and wins! A standout dragon rider!`);
    }
  }

  // ---------- turn flow ----------
  drawPhase(i) {
    if (this.phase !== 'draw' || this.turn !== i || this.winner != null) return { ok: false };
    const p = this.me(i);
    let n = p.hand.length === 0 ? 5 : 2;
    if (n === 2 && this.signetActive(i) && this.signetOf(i) === 'shadow') n = 3; // Shadow Wielding
    let drew = 0;
    for (let k = 0; k < n; k++) { const c = this._draw(); if (c) { p.hand.push(c); drew++; } }
    this.phase = 'play'; this.plays = 0;
    this.logMsg(`${p.name} drew ${drew} card${drew === 1 ? '' : 's'}.${drew < n ? ' (draw pile exhausted)' : ''}`);
    return { ok: true };
  }

  endTurn(i) {
    if (this.turn !== i || this.winner != null) return { ok: false };
    if (this.pending) return { ok: false, err: 'Resolve the pending action first.' };
    const p = this.me(i);
    if (p.hand.length > 7) return { ok: true, needDiscard: p.hand.length - 7 };
    this._nextTurn();
    return { ok: true };
  }
  _nextTurn() {
    this.turn = (this.turn + 1) % this.players.length;
    this.phase = 'draw'; this.plays = 0;
    this.logMsg(`It's ${this.me(this.turn).name}'s turn.`);
  }
  discard(i, ids) {
    const p = this.me(i);
    if (this.turn !== i || p.hand.length <= 7) return { ok: false };
    for (const id of ids) {
      if (!p.hand.includes(id)) return { ok: false, err: 'Card not in hand.' };
    }
    for (const id of ids) { this.removeFromHand(p, id); this.discardPile.push(id); }
    this.logMsg(`${p.name} discarded ${ids.length}.`);
    // NOTE: discarding no longer ends the turn. Play your cards first, then
    // discard down to 7, then end the turn (endTurn still requires <= 7).
    return { ok: true, needDiscard: Math.max(0, p.hand.length - 7) };
  }

  // ---------- playing cards ----------
  play(i, cardId, opts = {}) {
    const p = this.me(i);
    if (this.winner != null) return { ok: false };
    if (this.pending) return { ok: false, err: 'Resolve the pending action first.' };
    if (this.turn !== i || this.phase !== 'play') return { ok: false, err: 'Not your play phase.' };
    if (this.plays >= this.maxPlays(i)) return { ok: false, err: 'No plays left — end your turn.' };
    if (!p.hand.includes(cardId)) return { ok: false, err: 'Card not in hand.' };
    const c = this.card(cardId);

    if (opts.asMoney) {
      if (c.kind !== 'action' && c.kind !== 'money' && c.kind !== 'rent') return { ok: false };
      this.removeFromHand(p, cardId); p.bank.push(cardId); this.plays++;
      this.logMsg(`${p.name} banked ${c.name}.`);
      return { ok: true };
    }

    if (c.kind === 'money') {
      this.removeFromHand(p, cardId); p.bank.push(cardId); this.plays++;
      this.logMsg(`${p.name} banked ${c.name}.`);
      return { ok: true };
    }
    if (c.kind === 'property' || c.kind === 'wild') {
      let set = c.kind === 'property' ? c.set : opts.set;
      if (c.kind === 'wild') {
        if (!set || !c.sets.includes(set)) return { ok: false, need: 'chooseSet', sets: c.sets };
      }
      this.removeFromHand(p, cardId);
      p.table.push({ card: cardId, set });
      this.plays++;
      this.logMsg(`${p.name} played ${c.name} to ${SET_BY_ID[set].name}.`);
      this.checkWin(p);
      return { ok: true };
    }
    if (c.kind === 'rent') {
      const set = opts.set;
      if (!set || !c.sets.includes(set) || !this.isComplete(p, set))
        return { ok: false, need: 'chooseRentSet', sets: c.sets.filter(s => this.isComplete(p, s)) };
      this.removeFromHand(p, cardId); this.discardPile.push(cardId); this.plays++;
      const amount = this.rentFor(p, set);
      this.logMsg(`${p.name} issues a Challenge on ${SET_BY_ID[set].name}: ${amount} Blades.`);
      return this._startCharge(i, null, amount, `Challenge on ${SET_BY_ID[set].name}`, 'Challenge');
    }
    if (c.kind === 'action') {
      return this._playAction(i, c, opts);
    }
    return { ok: false };
  }

  // ---------- actions ----------
  _playAction(i, c, opts) {
    const p = this.me(i);
    const A = c.action;
    if (A === 'tairn_wisdom') {
      this.removeFromHand(p, c.id); this.discardPile.push(c.id); this.plays++;
      let drew = 0;
      for (const dc of [this._draw(), this._draw()]) if (dc) { p.hand.push(dc); drew++; }
      this.logMsg(`${p.name} draws ${drew} card${drew === 1 ? '' : 's'} with Tairn's Wisdom.`);
      return { ok: true };
    }
    if (A === 'house' || A === 'hotel') {
      const set = opts.set;
      const okSets = this.completeSets(p).filter(s => {
        const b = p.boosts[s] || {};
        return A === 'house' ? !b.house : (b.house && !b.hotel);
      });
      if (!set || !okSets.includes(set)) return { ok: false, need: 'chooseBoostSet', sets: okSets, for: A };
      this.removeFromHand(p, c.id); this.plays++;
      p.boosts[set] = p.boosts[set] || {};
      p.boosts[set][A === 'house' ? 'house' : 'hotel'] = true;
      this.logMsg(`${p.name} built a ${c.name} on ${SET_BY_ID[set].name}.`);
      return { ok: true };
    }
    if (A === 'dragonscale') {
      return { ok: false, err: 'Wards Up is played in response to an action, not on its own.' };
    }
    if (A === 'search_arch') {
      const cid = opts.card;
      if (!cid || !this.discardPile.includes(cid))
        return { ok: false, need: 'chooseDiscardCard' };
      const card = this.card(cid);
      this.removeFromHand(p, c.id); this.discardPile.push(c.id); this.plays++;
      this.discardPile.splice(this.discardPile.indexOf(cid), 1);
      // recovered card goes to hand — play it whenever you want
      p.hand.push(cid);
      this.logMsg(`${p.name} searched the archives and recovered ${card.name} to hand.`);
      return { ok: true };
    }
    // targeted actions go through the wards pipeline
    this.removeFromHand(p, c.id); this.plays++;
    const targets = this._actionTargets(i, A, opts);
    if (targets.err) { // refund
      p.hand.push(c.id); this.plays--;
      return { ok: false, ...targets };
    }
    this.pending = { type: 'wards', action: A, cardId: c.id, by: i, label: c.name,
      targets, ti: 0, awaits: targets[0], lastWardsBy: null, data: opts };
    this.logMsg(`${p.name} plays ${c.name}!`);
    return { ok: true, prompt: this._promptFor(this.pending.awaits) };
  }

  _actionTargets(i, A, opts) {
    const others = this.players.filter(p => p.idx !== i);
    if (A === 'memory_reading' || A === 'outsmart' || A === 'dragons_fire' || A === 'leighorrel' || A === 'dagger_acro' || A === 'time_stopping') {
      const t = opts.target;
      if (t == null || !others.some(p => p.idx === t)) return { err: 'Choose a target rider.', need: 'chooseTarget' };
      if (A === 'outsmart') {
        const set = opts.set;
        const cs = this.completeSets(this.me(t));
        if (!set || !cs.includes(set)) return { err: 'Choose one of their complete sets.', need: 'chooseSet', sets: cs, forTarget: t };
      }
      if (A === 'dragons_fire' || A === 'dagger_acro') {
        const cid = opts.card;
        const entry = this.me(t).table.find(e => e.card === cid);
        if (!entry || this.isComplete(this.me(t), entry.set) || this.card(cid).signetCard)
          return { err: 'Choose one of their properties (not from a complete set).', need: 'chooseTheirCard', forTarget: t };
      }
      if (A === 'leighorrel') {
        const my = this.me(i).table.find(e => e.card === opts.myCard);
        const th = this.me(t).table.find(e => e.card === opts.theirCard);
        if (!my || this.isComplete(this.me(i), my.set) || !th || this.isComplete(this.me(t), th.set) ||
            this.card(opts.myCard).signetCard || this.card(opts.theirCard).signetCard)
          return { err: 'Pick leighorrelpable properties (neither in a complete set).', need: 'chooseLeighorrel Mushrooms' };
      }
      return [t];
    }
    if (A === 'fonilee') return others.map(p => p.idx);
    if (A === 'double_relics') {
      const set = opts.set;
      const mine = this.me(i).table.filter(e => e.set === set);
      if (!set || mine.length === 0) return { err: 'Choose a color you have properties in.', need: 'chooseRelicSet' };
      return others.map(p => p.idx);
    }

    return { err: 'Unknown action.' };
  }

  // Wards pipeline + resolution. Called via answer().
  _promptFor(idx) {
    const pd = this.pending;
    if (!pd) return null;
    if (pd.type === 'wards') {
      const has = this.me(idx).hand.some(id => { const c = this.card(id); return c && c.kind === 'action' && c.action === 'dragonscale'; });
      return { kind: 'wards', actionName: pd.label || this.card(pd.cardId).name, byName: this.me(pd.by).name, hasWards: has };
    }
    if (pd.type === 'pay') {
      const p = this.me(idx);
      return { kind: 'pay', to: pd.to, amount: pd.amount, need: pd.need,
        bankTaken: pd.bankTaken, properties: p.table.map(e => ({ card: e.card, name: this.card(e.card).name, set: e.set, value: this.card(e.card).value })) };
    }
    return null;
  }

  answer(i, resp) {
    const pd = this.pending;
    if (pd && pd.type === 'foresight') return this.answerForesight(i, resp.returnCard);
    if (!pd || pd.type === 'wards') {
      if (!pd || pd.awaits !== i) return { ok: false };
      return this._answerWards(i, resp);
    }
    if (pd.type === 'pay') {
      if (pd.from !== i) return { ok: false };
      return this._answerPay(i, resp);
    }
    return { ok: false };
  }

  _answerWards(i, resp) {
    const pd = this.pending;
    const p = this.me(i);
    if (resp.use) {
      const wi = p.hand.find(id => { const c = this.card(id); return c && c.kind === 'action' && c.action === 'dragonscale'; });
      if (!wi) return { ok: false, err: 'No Wards Up in hand.' };
      this.removeFromHand(p, wi); this.discardPile.push(wi);
      this.logMsg(`${p.name} raises Dragonscale Armor!`);
      pd.lastWardsBy = i;
      // other party may counter
      pd.awaits = (i === pd.by) ? pd.targets[pd.ti] : pd.by;
      return { ok: true, prompt: this._promptFor(pd.awaits) };
    }
    // declined
    if (pd.lastWardsBy === null) {
      return this._resolveAction(); // no wards used -> proceed
    }
    // Wards chain: if the last wards was played by the action owner (a counter),
    // it negates the block -> action resolves. Otherwise the block stands.
    if (pd.lastWardsBy === pd.by) {
      this.logMsg(`${this.me(pd.by).name}'s counter-wards negates the block!`);
      return this._afterWardsContinue();
    }
    // wards stands -> action cancelled
    this.discardPile.push(pd.cardId);
    this.logMsg(`${this.card(pd.cardId).name} was blocked by Dragonscale Armor.`);
    this.pending = null;
    return { ok: true };
  }

  _resolveAction() {
    const pd = this.pending;
    const A = pd.action, by = pd.by, me = this.me(by);
    const finish = (msg) => {
      this.discardPile.push(pd.cardId);
      if (msg) this.logMsg(msg);
      this.pending = null;
      this.checkWin(me);
      return { ok: true };
    };
    if (A === 'memory_reading') {
      const t = pd.targets[0];
      return this._startCharge(by, t, 5, 'Memory Reading');
    }
    if (A === 'fonilee') {
      pd.ti = 0;
      return this._chargeNextThreshing();
    }
    if (A === 'outsmart') {
      const t = pd.targets[0], set = pd.data.set;
      const tp = this.me(t);
      // lightning signet stays with its owner
      const moving = tp.table.filter(e => e.set === set && !this.card(e.card).signetCard);
      tp.table = tp.table.filter(e => !(e.set === set && !this.card(e.card).signetCard));
      me.table.push(...moving);
      if (tp.boosts[set]) { me.boosts[set] = tp.boosts[set]; delete tp.boosts[set]; }
      return finish(`${me.name} outsmarted ${SET_BY_ID[set].name} from ${tp.name}!`);
    }
    if (A === 'dragons_fire') {
      const t = pd.targets[0], tp = this.me(t);
      const ei = tp.table.findIndex(e => e.card === pd.data.card);
      const [entry] = tp.table.splice(ei, 1);
      this.discardPile.push(entry.card);
      return finish(`${me.name}'s Dragon's Fire destroyed ${this.card(entry.card).name}!`);
    }
    if (A === 'dagger_acro') {
      const t = pd.targets[0], tp = this.me(t);
      const ei = tp.table.findIndex(e => e.card === pd.data.card);
      const [entry] = tp.table.splice(ei, 1);
      me.table.push({ card: entry.card, set: entry.set });
      return finish(`${me.name}'s Dagger Acrobatics stole ${this.card(entry.card).name} from ${tp.name}!`);
    }
    if (A === 'time_stopping') {
      const t = pd.targets[0];
      this.signetBlocked[t] = true;
      return finish(`${me.name} froze time on ${this.me(t).name}'s signet!`);
    }
    if (A === 'double_relics') {
      const set = pd.data.set;
      const n = me.table.filter(e => e.set === set).length;
      this.logMsg(`${me.name} plays Double Relics on ${SET_BY_ID[set].name}: ${n} Blades from each rider.`);
      return this._startCharge(by, null, n, `Double Relics on ${SET_BY_ID[set].name}`, 'Double Relics');
    }
    if (A === 'leighorrel') {
      const t = pd.targets[0], tp = this.me(t);
      const mi = me.table.findIndex(e => e.card === pd.data.myCard);
      const ti = tp.table.findIndex(e => e.card === pd.data.theirCard);
      const [mine] = me.table.splice(mi, 1);
      const [theirs] = tp.table.splice(ti, 1);
      const mc = this.card(mine.card), tc = this.card(theirs.card);
      me.table.push({ card: theirs.card, set: theirs.set });
      tp.table.push({ card: mine.card, set: mine.set });
      return finish(`${me.name} forced a bond leighorrel with ${tp.name}: ${tc.name} ⇄ ${mc.name}.`);
    }
    return finish();
  }

  _chargeNextThreshing() {
    const pd = this.pending;
    if (pd.ti >= pd.targets.length) {
      this.discardPile.push(pd.cardId);
      this.pending = null;
      this.checkWin(this.me(pd.by));
      return { ok: true };
    }
    const t = pd.targets[pd.ti];
    // wards for this target
    pd.awaits = t; pd.lastWardsBy = null; pd.type = 'wards';
    // stash that after wards we continue fonilee
    pd.afterWards = 'fonilee';
    return { ok: true, prompt: this._promptFor(t) };
  }

  // payment: charge `to` (or all) amount from `from`
  _startCharge(by, target, amount, reason, label) {
    // target null => all others (rent)
    const targets = target == null ? this.players.filter(p => p.idx !== by).map(p => p.idx) : [target];
    this.pending = { type: 'charge', by, cardId: this.pending?.cardId, label: label || (this.pending && this.pending.cardId ? this.card(this.pending.cardId).name : 'Charge'),
      targets, ti: 0, amount, reason, awaits: null, lastWardsBy: null };
    return this._chargeStep();
  }

  _chargeStep() {
    const pd = this.pending;
    if (pd.ti >= pd.targets.length) {
      if (pd.cardId) this.discardPile.push(pd.cardId);
      const by = this.me(pd.by);
      this.pending = null;
      this.checkWin(by);
      return { ok: true };
    }
    const t = pd.targets[pd.ti];
    pd.type = 'wards'; pd.awaits = t; pd.lastWardsBy = null; pd.afterWards = 'chargeCollect';
    return { ok: true, prompt: this._promptFor(t) };
  }

  _collectFrom(byIdx, fromIdx, amount) {
    const from = this.me(fromIdx), to = this.me(byIdx);
    // auto-take from bank, largest first
    const bank = [...from.bank].sort((a, b) => this.card(b).value - this.card(a).value);
    let taken = 0; const takenIds = [];
    for (const id of bank) {
      if (taken >= amount) break;
      taken += this.card(id).value; takenIds.push(id);
    }
    for (const id of takenIds) {
      from.bank.splice(from.bank.indexOf(id), 1);
      to.bank.push(id);
    }
    const need = amount - taken;
    if (need <= 0) {
      this.logMsg(`${from.name} paid ${amount} Blades to ${to.name}.`);
      return null; // no prompt needed
    }
    const payable = from.table.filter(e => !this.card(e.card).everyColor);
    if (!payable.length) {
      this.logMsg(`${from.name} couldn't cover the full ${amount} Blades to ${to.name} — paid ${taken}.`);
      return null;
    }
    this.pending = { type: 'pay', by: byIdx, from: fromIdx, to: byIdx, amount, need, bankTaken: taken };
    return this._promptFor(fromIdx);
  }

  _answerPay(i, resp) {
    const pd = this.pending;
    const from = this.me(pd.from), to = this.me(pd.to);
    const ids = resp.cards || [];
    let sum = 0;
    for (const id of ids) {
      const e = from.table.find(e => e.card === id);
      if (!e) return { ok: false, err: 'Invalid property.' };
      if (this.card(id).everyColor) return { ok: false, err: 'Every-color wilds cannot be used to pay.' };
      sum += this.card(id).value;
    }
    const allValue = from.table
      .filter(e => !this.card(e.card).everyColor)
      .reduce((t, e) => t + this.card(e.card).value, 0);
    if (sum < pd.need && sum < allValue)
      return { ok: false, err: `Need ${pd.need} Blades in properties (or everything you can pay).` };
    for (const id of ids) {
      const ei = from.table.findIndex(e => e.card === id);
      const [entry] = from.table.splice(ei, 1);
      to.table.push(entry);
    }
    if (sum < pd.need)
      this.logMsg(`${from.name} paid ${pd.bankTaken}M + all properties to ${to.name} (couldn't cover ${pd.amount}M).`);
    else
      this.logMsg(`${from.name} paid ${pd.bankTaken}M + properties (${ids.map(id => this.card(id).name).join(', ')}) to ${to.name}.`);
    // continue charge chain
    const ch = pd; // save
    if (ch.action === 'fonilee' || this._pendingWasThreshing()) {
      // shouldn't happen; pay only occurs in charge flow
    }
    this.pending = ch.chargePd || null;
    // resume: we stored the charge pending inside? Simplify: rebuild via stored ref
    return this._resumeAfterPay(ch);
  }

  _pendingWasThreshing() { return false; }
  _resumeAfterPay(ch) {
    // ch holds {chargePd} — the charge pending to resume
    this.pending = ch.chargePd;
    if (!this.pending) return { ok: true };
    this.pending.ti++;
    // if it was fonilee wards flow, continue appropriately
    if (this.pending.afterWards === 'threshingCharge') {
      return this._chargeNextThreshing();
    }
    return this._chargeStep();
  }

  // called when wards declined and afterWards set
  _afterWardsContinue() {
    const pd = this.pending;
    if (pd.afterWards === 'fonilee') {
      pd.type = 'action';
      const t = pd.targets[pd.ti];
      const prompt = this._collectFrom(pd.by, t, 2);
      if (prompt) {
        // _collectFrom set pending to pay; stash charge continuation
        const payPd = this.pending;
        payPd.chargePd = { ...pd, type: 'action', afterWards: 'threshingCharge' };
        return { ok: true, prompt };
      }
      pd.ti++;
      return this._chargeNextThreshing();
    }
    if (pd.afterWards === 'chargeCollect') {
      pd.type = 'charge';
      const t = pd.targets[pd.ti];
      const prompt = this._collectFrom(pd.by, t, pd.amount);
      if (prompt) {
        const payPd = this.pending;
        payPd.chargePd = { ...pd, type: 'charge' };
        return { ok: true, prompt };
      }
      pd.ti++;
      return this._chargeStep();
    }
    // plain action (non-charge): resolve
    pd.type = 'action';
    return this._resolveAction();
  }

  // ---------- public state ----------
  publicFor(idx) {
    const p = this.me(idx);
    return {
      you: idx, turn: this.turn, phase: this.phase,
      playsLeft: this.maxPlays(idx) - this.plays,
      maxPlays: this.maxPlays(idx),
      deckCount: this.deck.length,
      discardTop: this.discardPile.length ? this.cards[this.discardPile[this.discardPile.length - 1]] : null,
      discardPile: this.discardPile.slice(),
      cardMap: this.cards,
      needDraw: this.phase === 'draw' && this.turn === idx,
      needDiscard: this.turn === idx && this.phase === 'play' && !this.pending && p.hand.length > 7
        ? p.hand.length - 7 : 0,
      signetPhase: this.phase === 'signet',
      signetDraftTurn: this.phase === 'signet' ? this.signetDraftIdx % this.players.length : null,
      signetsAvailable: this.phase === 'signet'
        ? SIGNETS.filter(s => !Object.values(this.signets).includes(s.id)) : [],
      players: this.players.map((q, qi) => ({
        name: q.name, isTurn: qi === this.turn,
        handCount: q.hand.length,
        hand: qi === idx ? q.hand.map(id => this.cards[id]) : [],
        bank: q.bank.map(id => this.cards[id]),
        bankTotal: this.bankTotal(q),
        table: q.table.map(e => ({ ...this.cards[e.card], asSet: e.set })),
        boosts: q.boosts,
        setsComplete: new Set(this.completeSets(q)).size,
        sets: this.tableSets(q),
        signet: this.signets[qi] ? SIGNETS.find(s => s.id === this.signets[qi]) : null,
        signetBlocked: !!this.signetBlocked[qi],
        signetMode: this.signetMode,
      })),
      pending: this._publicPending(idx),
      winner: this.winner != null ? { idx: this.winner, name: this.me(this.winner).name } : null,
      log: this.log.slice(-14),
    };
  }

  _publicPending(idx) {
    const pd = this.pending;
    if (!pd) return null;
    if (pd.type === 'wards' && pd.awaits === idx) return this._promptFor(idx);
    if (pd.type === 'pay' && pd.from === idx) return this._promptFor(idx);
    if (pd.type === 'foresight' && pd.by === idx)
      return { kind: 'foresight', cards: pd.cards.map(id => this.cards[id]) };
    // someone else is deciding
    const who = this.me(pd.awaits != null ? pd.awaits : pd.from);
    return { waiting: true, on: who ? who.name : '?', kind: pd.type };
  }
}

// hook _answerWards decline path into _afterWardsContinue
const _origAnswerWards = Game.prototype._answerWards;
Game.prototype._answerWards = function (i, resp) {
  const pd = this.pending;
  if (!pd || pd.type !== 'wards' || pd.awaits !== i) return { ok: false };
  const p = this.me(i);
  if (resp.use) return _origAnswerWards.call(this, i, resp);
  if (pd.lastWardsBy === null) return this._afterWardsContinue();
  // Counter-wards: if the last wards was the action owner's counter, it negates
  // the block -> action resolves. Otherwise the block stands -> cancelled.
  if (pd.lastWardsBy === pd.by) {
    this.logMsg(`${this.me(pd.by).name}'s counter-wards negates the block!`);
    return this._afterWardsContinue();
  }
  if (pd.cardId) this.discardPile.push(pd.cardId);
  this.logMsg(`${pd.label || this.card(pd.cardId).name} was blocked by Dragonscale Armor.`);
  this.pending = null;
  return { ok: true };
};

if (typeof module !== 'undefined') module.exports = { Game };
