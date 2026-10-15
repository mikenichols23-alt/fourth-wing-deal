// Simple AI bot for Fourth Wing Deal. Plays a reasonable game:
// builds sets, charges rent, steals when valuable, banks excess, and
// handles pending decisions (wards, payments, foresight, discards).

const BOT_NAMES = ['Tairn 🤖', 'Andarna 🤖', 'Sgaeyl 🤖', 'Feirge 🤖'];

let SIGNETS = [];
try { SIGNETS = require('./deck').SIGNETS || []; } catch (e) { /* browser */ }
if (!SIGNETS.length && typeof window !== 'undefined' && window.SIGNETS) SIGNETS = window.SIGNETS;

class Bot {
  constructor(game, idx) {
    this.g = game;
    this.i = idx;
  }

  get me() { return this.g.me(this.i); }
  card(id) { return this.g.card(id); }

  // Card value for decision-making (lower = more expendable)
  cardScore(id) {
    const c = this.card(id);
    if (!c) return 99;
    // Properties in incomplete sets are valuable; complete sets even more
    if (c.kind === 'property' || c.kind === 'wild') return 50 - c.value;
    if (c.kind === 'rent') return 20;
    if (c.kind === 'action') {
      // Keep versatile actions, discard weak ones first
      const keep = { dragonscale: 5, outsmart: 5, time_stopping: 8, tairn_wisdom: 15 };
      return keep[c.action] ?? 25;
    }
    return 30 - c.value; // money: keep high values
  }

  lowestCards(ids, n) {
    return [...ids].sort((a, b) => this.cardScore(a) - this.cardScore(b)).slice(0, n);
  }

  // ---------- turn flow ----------
  takeTurn() {
    const g = this.g, i = this.i;

    // Signet draft (if bot is drafting) — before turn guard, draft isn't a "turn"
    if (g.phase === 'signet') {
      const taken = Object.values(g.signets || {});
      const avail = SIGNETS.filter(s => !taken.includes(s.id));
      if (avail.length && g.signetDraftIdx % g.players.length === i) {
        // Prefer: distance > shadow > foresight > mending > lightning
        const pref = ['distance', 'shadow', 'foresight', 'mending', 'lightning'];
        for (const p of pref) {
          const s = avail.find(s => s.id === p);
          if (s) { g.chooseSignet(i, s.id); break; }
        }
      }
      return;
    }

    if (g.winner || g.turn !== i) return;

    // Draw phase
    if (g.phase === 'draw' && g.turn === i) {
      this.doDraw();
    }

    // Play phase
    let guard = 0;
    while (g.phase === 'play' && g.turn === i && !g.winner && guard++ < 20) {
      if (g.pending) {
        if (!this.decidePending()) break;
        continue;
      }
      if (!this.doPlay()) break;
    }

    // Discard down to 7
    while (this.me.hand.length > 7 && !g.winner) {
      const n = this.me.hand.length - 7;
      const ids = this.lowestCards(this.me.hand, n);
      g.discard(i, ids);
    }

    // End turn
    if (!g.pending && !g.winner && g.turn === i) {
      const r = g.endTurn(i);
      if (r.needDiscard) {
        const ids = this.lowestCards(this.me.hand, r.needDiscard);
        g.discard(i, ids);
        g.endTurn(i);
      }
    }
  }

  doDraw() {
    const g = this.g, i = this.i;
    const signet = g.signetOf(i);
    if (g.signetActive(i) && signet === 'mending' && this.me.hand.length > 0) {
      // Give lowest card to a random opponent, draw 4
      const others = g.players.filter(p => p.idx !== i);
      const target = others[Math.floor(Math.random() * others.length)].idx;
      const give = this.lowestCards(this.me.hand, 1)[0];
      const r = g.mendingDraw(i, give, target);
      if (r.ok) return;
    }
    if (g.signetActive(i) && signet === 'foresight') {
      const r = g.foresightDraw(i);
      if (r.ok && g.pending?.kind === 'foresight') {
        // Return lowest-value of the 3
        const cards = g.pending.cards;
        const ret = [...cards].sort((a, b) => a.value - b.value)[0];
        g.answerForesight(i, ret.id);
        return;
      }
    }
    g.drawPhase(i);
    // Place lightning wild for free after draw (doesn't use a play)
    if (g.signetOf(i) === 'lightning' && g.signetActive(i)) {
      const sets = this.me.table.map(e => e.set);
      // Place on the set with most properties (or first)
      const counts = {};
      this.me.table.forEach(e => counts[e.set] = (counts[e.set] || 0) + 1);
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (best) g.placeLightning(i, best[0]);
    }
  }

  doPlay() {
    const g = this.g, i = this.i, me = this.me;
    const maxPlays = g.maxPlays(i);
    if (g.plays >= maxPlays) return false;

    // 1. Play wilds to complete sets (highest priority)
    for (const id of [...me.hand]) {
      const c = this.card(id);
      if ((c.kind === 'wild') && !g.isComplete(me, c.sets[0])) {
        // Find the set closest to completion among our options
        let best = null, bestNeed = 99;
        const setsToTry = c.everyColor ? Object.keys(this.setCounts()) : c.sets;
        for (const s of setsToTry) {
          if (g.isComplete(me, s)) continue;
          const have = (this.setCounts()[s] || 0);
          const need = (require('./deck.js').SET_BY_ID[s].size - have);
          if (need < bestNeed && need > 0) { bestNeed = need; best = s; }
        }
        if (best) {
          const r = g.play(i, id, { set: best });
          if (r.ok) return true;
        }
      }
    }
    // 2. Play properties to sets we're building (avoid starting too many new sets)
    const mySets = Object.keys(this.setCounts());
    for (const id of [...me.hand]) {
      const c = this.card(id);
      if (c.kind === 'property') {
        const alreadyBuilding = mySets.includes(c.set);
        // Only start a new set if we have fewer than 2 incomplete sets
        const incomplete = mySets.filter(s => !g.isComplete(me, s)).length;
        if (alreadyBuilding || incomplete < 2) {
          const r = g.play(i, id, { set: c.set });
          if (r.ok) return true;
        }
      } else if (c.kind === 'wild' && !c.everyColor) {
        // Play to the set where we have most cards
        const counts = {};
        me.table.forEach(e => counts[e.set] = (counts[e.set] || 0) + 1);
        let best = c.sets[0], bestN = -1;
        for (const s of c.sets) {
          const n = counts[s] || 0;
          if (n > bestN) { bestN = n; best = s; }
        }
        const r = g.play(i, id, { set: best });
        if (r.ok) return true;
      } else if (c.kind === 'wild' && c.everyColor) {
        // Play to largest incomplete set
        const counts = {};
        me.table.forEach(e => { if (!g.isComplete(me, e.set)) counts[e.set] = (counts[e.set] || 0) + 1; });
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (best) {
          const r = g.play(i, id, { set: best[0] });
          if (r.ok) return true;
        }
      }
    }

    // 2. Play rent/Challenge if we have a complete set
    const complete = g.completeSets(me);
    for (const id of [...me.hand]) {
      const c = this.card(id);
      if (c.kind === 'rent' && complete.some(s => c.sets.includes(s))) {
        const set = complete.find(s => c.sets.includes(s));
        const r = g.play(i, id, { set });
        if (r.ok) return true;
      }
      if (c.kind === 'action' && c.action === 'double_relics' && me.table.length > 0) {
        const counts = {};
        me.table.forEach(e => counts[e.set] = (counts[e.set] || 0) + 1);
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        const r = g.play(i, id, { set: best });
        if (r.ok) return true;
      }
    }

    // 3. Aggressive actions (steal/destroy/charge)
    for (const id of [...me.hand]) {
      const c = this.card(id);
      if (c.kind !== 'action') continue;
      const A = c.action;
      // Find best target (opponent with most valuable stuff)
      const others = g.players.filter(p => p.idx !== i);
      const target = others.sort((a, b) => this.threatOf(b.idx) - this.threatOf(a.idx))[0];
      if (!target) continue;

      if (A === 'memory_reading') {
        const r = g.play(i, id, { target: target.idx });
        if (r.ok) return true;
      } else if (A === 'dragons_fire' || A === 'dagger_acro') {
        const tp = g.me(target.idx);
        const stealable = tp.table.filter(e => !g.isComplete(tp, e.set) && !this.card(e.card).signetCard);
        if (stealable.length) {
          // Prefer cards that complete our sets
          const myCounts = this.setCounts();
          const SET_BY_ID = require('./deck.js').SET_BY_ID;
          stealable.sort((a, b) => {
            const aCompletes = (myCounts[a.set] || 0) + 1 >= SET_BY_ID[a.set].size ? 100 : 0;
            const bCompletes = (myCounts[b.set] || 0) + 1 >= SET_BY_ID[b.set].size ? 100 : 0;
            return (bCompletes + this.card(b.card).value) - (aCompletes + this.card(a.card).value);
          });
          const best = stealable[0];
          // Only steal if it's valuable or completes a set
          const completes = (myCounts[best.set] || 0) + 1 >= SET_BY_ID[best.set].size;
          if (completes || this.card(best.card).value >= 3) {
            const r = g.play(i, id, { target: target.idx, card: best.card });
            if (r.ok) return true;
          }
        }
      } else if (A === 'leighorrel') {
        const tp = g.me(target.idx);
        const mine = me.table.filter(e => !g.isComplete(me, e.set));
        const theirs = tp.table.filter(e => !g.isComplete(tp, e.set) && !this.card(e.card).signetCard);
        if (mine.length && theirs.length) {
          const myWorst = mine.sort((a, b) => this.card(a.card).value - this.card(b.card).value)[0];
          const theirBest = theirs.sort((a, b) => this.card(b.card).value - this.card(a.card).value)[0];
          if (this.card(theirBest.card).value > this.card(myWorst.card).value) {
            const r = g.play(i, id, { target: target.idx, myCard: myWorst.card, theirCard: theirBest.card });
            if (r.ok) return true;
          }
        }
      } else if (A === 'outsmart') {
        const tp = g.me(target.idx);
        const cs = g.completeSets(tp);
        if (cs.length) {
          const r = g.play(i, id, { target: target.idx, set: cs[0] });
          if (r.ok) return true;
        }
      } else if (A === 'tairn_wisdom') {
        const r = g.play(i, id, {});
        if (r.ok) return true;
      } else if (A === 'fonilee') {
        const r = g.play(i, id, {});
        if (r.ok) return true;
      }
    }

    // 4. Bank high-value cards (don't waste plays on low-value)
    const bankable = me.hand.filter(id => {
      const c = this.card(id);
      return (c.kind === 'money' || c.kind === 'action') && c.value >= 3;
    }).sort((a, b) => this.card(b).value - this.card(a).value);
    if (bankable.length) {
      const r = g.play(i, bankable[0], { toBank: true });
      if (r.ok) return true;
    }

    return false; // nothing useful to play
  }

  setCounts() {
    const counts = {};
    this.me.table.forEach(e => counts[e.set] = (counts[e.set] || 0) + 1);
    return counts;
  }

  threatOf(idx) {
    const p = this.g.me(idx);
    return p.table.length * 10 + this.g.bankTotal(p);
  }

  // ---------- pending decisions ----------
  // Returns true if it made progress, false if stuck
  decidePending() {
    const g = this.g, i = this.i;
    const pd = g.pending;
    if (!pd) return true;

    // Wards: block if the action hurts us
    if (pd.type === 'wards' && pd.awaits === i) {
      const hasWards = this.me.hand.some(id => {
        const c = this.card(id);
        return c.kind === 'action' && c.action === 'dragonscale';
      });
      // Block if it targets us directly and we have something to lose
      const targetsUs = (pd.targets || []).includes(i);
      if (hasWards && targetsUs && this.threatOf(i) > 0) {
        g.answer(i, { use: true });
      } else {
        g.answer(i, { use: false });
      }
      return true;
    }

    // Payment: pay lowest-value cards first
    if (pd.type === 'pay' && pd.from === i) {
      const need = pd.amount || 0;
      // Prefer hand cards (money/actions) over table properties
      const handPayable = this.me.hand.filter(id => {
        const c = this.card(id);
        return c.kind === 'money' || c.kind === 'action';
      });
      const sorted = [...handPayable].sort((a, b) => this.card(a).value - this.card(b).value);
      let total = 0;
      const pay = [];
      for (const id of sorted) {
        if (total >= need) break;
        pay.push(id);
        total += this.card(id).value;
      }
      // If not enough in hand, add table properties (lowest value first, avoid breaking complete sets)
      if (total < need) {
        const props = this.me.table
          .filter(e => !g.isComplete(this.me, e.set))
          .sort((a, b) => this.card(a.card).value - this.card(b.card).value);
        for (const e of props) {
          if (total >= need) break;
          pay.push(e.card);
          total += this.card(e.card).value;
        }
      }
      g.answer(i, { pay });
      return true;
    }

    // Foresight: return lowest value
    if (pd.type === 'foresight' && pd.by === i) {
      const cards = pd.cards || [];
      const ret = [...cards].sort((a, b) => a.value - b.value)[0];
      if (ret) g.answerForesight(i, ret.id);
      return true;
    }

    return false;
  }
}

if (typeof module !== 'undefined') module.exports = { Bot, BOT_NAMES };
