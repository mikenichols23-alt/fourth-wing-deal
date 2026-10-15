# Fourth Wing Deal — Simulation Bug Report

Date: 2026-10-15. All simulations run against the current working tree
(`~/workspace/monopoly-deal/`), which includes uncommitted changes to
`bot.js` (paced `step()` play) and `server.js` (paced `pumpBots` + watchdog).

## Simulation coverage

- **test-30games.js** (as requested): 23/30 winners; NO WINNER in games 11,
  12, 15, 16, 18, 20, 29 (90s timeouts); 0 hard errors; 2×
  `nak: {"t":"nak","need":"chooseRentSet","sets":[]}`; server stderr clean;
  avg 2639 actions/game. The 7 timeouts match the harness-artifact pattern
  in Bug 9 below.
- **Direct engine sim (v3)**: 150 games, 2–4 server-side bots (`bot.js`),
  mixed random/draft signet modes, exact replica of the new `pumpBots`
  logic. Result: **150/150 finished with a winner, 0 stuck, 0 exceptions,
  0 failsafe triggers.**
- **WS sim**: 20 quick games via real WebSocket server + `test-bot-lib`
  clients (3 players). Result: **14/20 winners, 6 timeouts** (see Bug 8).
- **Method coverage** (40 direct games): `mendingDraw` 215×,
  `foresightDraw`/`answerForesight` 233×, `placeLightning` 87×,
  `chooseSignet` 80×; all aggressive actions played
  (dragons_fire, dagger_acro, leighorrel, outsmart, memory_reading,
  fonilee, double_relics, time_stopping); wards used 40×.
- **Edge cases**: double_relics w/ empty table → clean refund;
  challenge w/ no complete set → clean `need: chooseRentSet, sets: []` nak;
  search_arch to table and to bank → OK; partial payment (can't cover) →
  accepted; wards counter-chain → terminates.

---

## Bug 1 (CRITICAL): game doesn't end when player 0 wins (falsy-0 `winner`)

`Game.winner` is a player **index**, so `0` is a legitimate winner — but the
code tests it for truthiness in many places. When player 0 (often the host /
first player) wins:

- `engine.js:207` (`checkWin`): `if (colors.size >= 3 && !this.winner)` —
  `!0 === true`, so a later player reaching 3 sets **overwrites the winner**.
  Verified empirically: winner flipped from `0` to `1`.
- `engine.js:227` (`endTurn`): `if (this.turn !== i || this.winner)` —
  passes when winner is 0, so `endTurn` calls `_nextTurn()` and
  **resurrects a finished game** (phase back to `'draw'`).
- `engine.js:74,89,116,134,149,215,255` (`mendingDraw`, `foresightDraw`,
  `placeLightning`, `unblockSignet`, `recolorWild`, `drawPhase`, `play`):
  `... || this.winner` guards don't fire for winner 0 → actions accepted
  after game over.
- `bot.js:44` (`step`): `if (g.winner) return false;` — bots keep stepping
  after player 0 wins.
- `server.js:190` (`pumpBots`): `while (guard++ < 300 && !g.winner)` — keeps
  pumping after player 0 wins.
- `server.js:225,240` (watchdog): arms and fires on finished games; calls
  `unstickBot`, whose own `if (!g || g.winner || ...)` guard also misses 0,
  so it force-advances the turn of a **finished** game, resurrecting it.

Full chain in production: player 0 wins → 8s later the watchdog fires →
`unstickBot` → `endTurn` → `_nextTurn()` → bots resume playing a "finished"
game → someone else hits 3 sets → `checkWin` overwrites the winner.
The user-visible symptom is a game that won't stay finished / behaves
erratically after the first player wins.

**Fix:** replace every truthiness test on `winner` with an explicit null
check (`!= null`). `publicFor` (line 706) already does this correctly —
follow that pattern everywhere. (Note: my sim harness initially had the
same bug — `while (!g.winner)` looped forever on player-0 wins — which is
how this was caught.)

---

## Bug 2 (MEDIUM): counter-wards resolution is inverted

`engine.js` — `_answerWards` and the hook override at the bottom of the file.
Scenario: A plays Dragon's Fire on B → B plays Dragonscale Armor →
A **counter-wards** → B declines.

Correct (physical Monopoly Deal "Just Say No" chaining): A's counter negates
B's block, so the Fire should **resolve**. Actual: the decline path sees
`pd.lastWardsBy (0, the owner) !== null` and treats it as "wards stands →
action cancelled". The action is cancelled when it should resolve, making
counter-wards useless (you spend a Dragonscale to still lose the action).

Verified empirically (see sim notes): after A's counter + B's decline,
`pending` cleared and the target property was **not** destroyed.

Reachable in production: bots never counter-wards as the action owner
(`decidePending` only wards when targeted), but a human can — the wards
prompt is shown to `pd.by` for the counter.

**Fix:** on wards decline, if `pd.lastWardsBy === pd.by` (the last wards was
the owner's counter) → resolve the action (`_afterWardsContinue()` /
`_resolveAction()`); otherwise → cancel. I.e. an odd-length wards chain
(last by target) cancels, an even-length chain (last by owner) resolves.

---

## Bug 3 (CRITICAL, client): pay prompt causes infinite recursion → stack overflow

`public/client.js`:
- `render()` ends with `renderPending()` (~line 575).
- `renderPending()`'s `pay` branch does `flow = {...}; selSet = []; render();
  renderPayModal();` (~line 808).

`render → renderPending → render → …` — unbounded recursion, `RangeError:
Maximum call stack size exceeded`. The pay banner never renders, the state
message is never fully processed (no `try/catch` around `ws.onmessage →
handle()`), and the human who owes blades is soft-locked: they can never
open the pay UI, so the game stalls on their payment.

**Fix:** delete the `render();` call in the pay branch — `renderPayModal()`
alone is sufficient, and `render()` already calls `renderPayModal()` when
`flow.kind === 'payProps'` (~line 502).

---

## Bug 4 (HIGH, client): pay running total always shows 0; partial payment impossible

`public/client.js` `renderPayModal` (~line 830):
```js
const sum = selSet.reduce((t, id) => t + (me.table.find(e => e.card === id)?.value || 0), 0);
```
`me.table` holds **public-format** entries (`{...card, asSet}`), which use
`.id`, not `.card` (verified empirically). The `find` never matches, so
`sum` is always 0, "Selected: 0⚔️" always shows, and the Pay button only
enables via the select-everything fallback
(`selSet.length === me.table.length`). A human can never make a partial
property payment through the UI.

**Fix:** `me.table.find(e => e.id === id)?.value`.

---

## Bug 5 (HIGH, client): steal / destroy / swap targeting sends `undefined` card id

`public/client.js` `tableCardClick` — `theirCard` and `myCard` branches
(~lines 746, 749, 757) use `entry.id`, but `entry` comes from `p.sets[setId]`,
which are **engine-format** entries `{card, set}` (verified empirically) —
they have `.card`, not `.id`. Result: `opts.card` / `opts.theirCard` /
`opts.myCard` are sent as `undefined`; the server rejects with
`need: chooseTheirCard` / `need: chooseLeighorrelMushrooms`, which
`handleNak` doesn't handle (generic toast). Dragon's Fire, Dagger Acrobatics,
and Leighorrel Mushrooms are unusable for human players — every attempt
fails with "Choose one of their properties".

**Fix:** use `entry.card` in all three spots (the `payProps` branch on
~line 760 already does this correctly).

---

## Bug 6 (HIGH, client): double-tap wild recolor never fires

`public/client.js` ~line 1030:
```js
const entry = me.table.find(x => x.card === ce.dataset.cid);
```
Same format mix-up as Bug 4: `me.table` entries use `.id`. The find always
misses, `if (!entry) return;` exits, so the Shift-Wild-Color modal never
opens for human players.

**Fix:** `me.table.find(x => x.id === ce.dataset.cid)`.

---

## Bug 7 (LOW): property blade values use `rent[0]` instead of official values

`deck.js` `buildDeck`: `value: s.rent[0]` for properties. Per the
verified-cards spec the correct per-set values are: Dark Blue 4 (has 3),
Dark Green 4 (has 2), Red 3 (has 2), Yellow 3 (has 2), Orange 2 (has 1),
Pink 2 (has 1), Black 2 (has 1), Light Green 2 (has 1); Light Blue and Brown
are correctly 1. This skews payment math, the pay-need calculation, and bot
card valuations. Doesn't stall games.

**Fix:** add an explicit `value` per set in `SETS` and use it.

---

## Bug 8 (LOW, robustness): `_startCharge` label ternary can throw

`engine.js:546`:
```js
label: label || (this.pending ? this.card(this.pending.cardId).name : 'Charge')
```
If `this.pending` is truthy but has no `cardId` (e.g. a `pay` pending),
`this.card(undefined).name` throws `TypeError`. Not reachable through
current internal callers (all pass `label`), confirmed by code inspection,
but one refactor away from a server crash inside the WS handler (which would
propagate out of `pumpBots`, uncaught).

**Fix:** `(this.pending && this.pending.cardId ? this.card(this.pending.cardId).name : 'Charge')`.

---

## Bug 9: WS test-harness games time out — harness limits, not engine bugs

Two WS probes (20 games @25s timeout; 6 games with action/freeze tracking)
show the timeouts clearly:

- Timed-out games all show `maxBotActions: 4001` with action counts freezing
  ~11–12s in (`frozenAt`). `test-bot-lib.js` has `MAX_ACTIONS = 4000`, after
  which `act()` silently returns forever — the bot whose turn it is never
  acts again, so the game genuinely stalls **because the test client gave
  up**, not because the engine is stuck (state keeps `phase: play/draw`,
  `pending: null`).
- The test bots also play a deliberately passive strategy: every action
  card except Tairn's Wisdom is banked as money, so bots never steal,
  destroy, swap, or charge aggressively. Games devolve into 3-way property
  accumulation races (observed `complete: 2/2/2` with 10–16 cards per table)
  that burn thousands of actions without converging.

The engine + real server bots converge: **150/150 direct-sim games finished
with a winner**. No engine change needed; the WS timeouts are an artifact
of the test harness (action cap + passive bots). If long-game robustness is
wanted, raise `MAX_ACTIONS` and/or make test bots play interaction cards.
