# ⚡ Don't Press It!

A chaotic reaction party game. One person hosts from a laptop/big screen (the **organizer**), everyone else joins from their phone (a **player**) and taps a big button — fast on green, never on red.

## What's inside
- `server.js` — Node/Express + Socket.io backend. Holds all game state in memory (no database needed).
- `public/index.html` — landing page (choose Host or Join).
- `public/organizer.html` + `organizer.js` — host console: create a room, tune settings, run rounds, see live scores.
- `public/player.html` + `player.js` — player controller: join with a room code + name, then press.

## Run it locally
Requires [Node.js](https://nodejs.org) 16+.

```bash
npm install
npm start
```

The server starts on **http://localhost:3000** (or `$PORT` if set).

- Open `http://localhost:3000/organizer.html` on the host's computer → **Host a game**.
- Everyone else opens `http://<your-computer's-LAN-IP>:3000/player.html` on their phone (same Wi-Fi) and enters the 4-letter room code shown on the host screen.

## Deploying so players can join over the internet
Any Node hosting works (Render, Railway, Fly.io, a VPS, etc.) since this needs a persistent process for Socket.io (not a static host):

1. Push this folder to your host of choice.
2. Set the start command to `npm start` (it reads `PORT` from the environment automatically).
3. Share the deployed URL + `/player.html` with players, and use `/organizer.html` yourself.

## How the game works
- The **organizer** sets: number of rounds, min/max wait before a signal appears, how long the signal stays live, the odds a round is "Don't Press", and points for 1st/2nd/3rd.
- Each round: screen shows **WAIT...**, then randomly flips to either:
  - 🟢 **PRESS NOW** — the fastest three players to tap score 5/3/1 points (configurable).
  - 🔴 **DON'T PRESS** — anyone who taps is **eliminated** for the rest of the game.
- Eliminated players stay connected and can watch the rest of the game, but can't score again until the organizer resets.
- The organizer can kick a player, reset the whole game (scores + eliminations clear), or end the game early.
- Refreshing the page won't lose your seat — both organizer and player sessions are remembered in the browser (`localStorage`) so a reload just reconnects you to the same room.

## Notes
- Room codes are 4 letters, generated automatically, and unique to running games.
- All state lives in server memory — restarting the server clears every room. For a real event, keep the process running for the duration of the game.
