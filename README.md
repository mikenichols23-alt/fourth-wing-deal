# Fourth Wing Deal

A complete online card game for **2–4 players**: Monopoly Deal reskinned as the
official **Monopoly Deal: Fourth Wing Edition** — 116 cards, Blades instead of
money, and five signet cards drafted at the start of each game.

First rider to protect **3 complete sets of different colors** wins.

## Run it

```bash
cd monopoly-deal
npm install        # once
node server.js     # defaults to port 3000; or: node server.js 8080
```

Then open **http://localhost:3000** in your browser. The client is
mobile-responsive, so phones on the same network can play too.

## Play with friends

**Create a room** → share the 4-letter code → friends **Join Room** with it.
The host clicks **Start Game** (needs 2+ players, max 4).

Your friends need to reach your server. Pick one:

1. **Same Wi-Fi (easiest).** Find your computer's local IP
   (Mac: System Settings → Wi-Fi → Details; Windows: `ipconfig`),
   friends visit `http://YOUR-IP:3000` — e.g. `http://192.168.1.42:3000`.

2. **Tailscale (private, works anywhere).** You and your friends install
   Tailscale and join the same tailnet. Friends visit
   `http://YOUR-TAILSCALE-IP:3000`. No router config, no public exposure.

3. **Public tunnel.** `npx ngrok http 3000` (or Cloudflare Tunnel) gives you
   a public `https://…` link anyone can open. Don't leave it running unattended.

## Rules (Fourth Wing Edition)

- Draft a **signet** at game start (Shadow Wielding, Mending, Storm/Ice/Fire
  Wielding…) — each grants a repeatable special ability.
- Each turn: **draw 2** (or 5 if your hand is empty), then **play up to 3 cards**.
- **Bank Blades** (or action cards as Blades) to pay Challenges.
- **Play properties** to build location sets (Aretia, Riorson House, Basgiath,
  the Parapet, the Gauntlet, Healer/Scribe/Riders Quadrants, outposts…).
- **Actions**: Dragon's Fire, Dragonscale Armor (cancels an action against you),
  Tairn's Wisdom (draw 2), Poison, Sparring Match, Summon (steal a full set),
  Swap, Double Challenge, Outpost (+3), Stronghold (+4), Andarna's Time Stopping
  (blocks a signet until 10 Blades are discarded).
- Win with **3 complete sets of different colors**.

## Playing with bots

If your friends aren't around, the host can tap **🤖 Add Bot Player** in the
lobby to fill empty seats (up to 4 players total). Bots are named after the
dragons (Tairn, Andarna, Sgaeyl, Feirge) and play automatically — they build
sets, charge rent, steal properties, and block actions with Dragonscale Armor.
Remove a bot before starting with the ✖ next to its name.

## Files

- `deck.js` — the Fourth Wing Edition deck (10 location sets, wilds,
  Challenges, actions, 5 signets)
- `engine.js` — game rules engine
- `bot.js` — AI bot players
- `server.js` — WebSocket server + rooms
- `public/` — web client (lobby + game board, mobile-responsive)
- `test-multiplayer.js` — automated 3-player WebSocket integration test
  (`node test-multiplayer.js`)

## Note on card accuracy

The deck was verified against photos of the physical Hasbro Fourth Wing
Edition cards (106 playable + 5 signets + 5 reference = 116 total). All
property names, blade values, wild pairings, action names, and card counts
match the real game.
