# 🃏 Santase 66

A multiplayer web version of the popular Balkan card game **Santase** (Сантасе / Sixty-Six).
Host a room, share a 4-letter code, and a friend joins instantly — real-time play over
WebSockets, a live rendered game board, a spectator mode, chat, and an admin dashboard.

```
 ┌── Home ──┐     ┌── Lobby ──┐     ┌──── Game ────┐
 │ Host  ►──┼────►│ code ABCD │────►│  live board  │
 │ Join ◄───┼─────┤ 2 players │     │  + chat/log  │
 └──────────┘     └───────────┘     └──────────────┘
                                    /dashboard = live stats
```

## Features

- **Rooms & lobbies** — one player hosts and gets a shareable code; others join by typing it.
- **Real-time** — Socket.IO keeps both players (and spectators) in sync; each player only
  ever sees their own hand.
- **Full rule engine** — trumps, marriages (20/40), trump-9 exchange, closing the stock,
  two-phase follow-suit rules, schneider/schwarz scoring, matches to 7/11/21 game points.
- **Rendered board** — CSS-drawn cards, trump/stock display, trick animation, turn banners.
- **Reconnect** — refresh or drop and rejoin the same seat (state kept in `localStorage`).
- **Live dashboard** — `/dashboard` shows online players, active rooms, and match scores.
- **Dockerized** + a `render.yaml` blueprint for one-click deploy.

## Quick start (local)

```bash
npm install
npm start
# open http://localhost:3000
# dashboard at http://localhost:3000/dashboard
```

Open two browser tabs (or two devices): create a room in one, join with the code in the other.

Run the engine self-test (500 simulated matches):

```bash
npm test
```

## Run with Docker

```bash
docker compose up --build
# → http://localhost:3000
```

or plain Docker:

```bash
docker build -t santase-66 .
docker run -p 3000:3000 santase-66
```

## Deploy to Render

1. Push this repo to GitHub.
2. On [Render](https://render.com): **New → Blueprint**, select the repo.
   It reads `render.yaml` and deploys the Docker service automatically.
3. Render sets `PORT`; the app already reads `process.env.PORT`. Health check: `/healthz`.

(The free plan sleeps when idle — the first request after a nap takes a few seconds to wake.)

## How to play Santase 66

Two players, a 24-card deck (A, 10, K, Q, J, 9 in each suit).

| Card | A  | 10 | K | Q | J | 9 |
|------|----|----|---|---|---|---|
| Pts  | 11 | 10 | 4 | 3 | 2 | 0 |

- Each player gets 6 cards; one card is turned up to set the **trump** suit. The rest form the stock.
- **Phase 1 (stock open):** win a trick, then draw (winner first). You may play *any* card.
- On your lead you can:
  - **Announce a marriage** — play a King or Queen while holding its partner of the same
    suit: **+20** points (**+40** if it's the trump suit). Points count once you've won a trick.
  - **Exchange** the trump **9** for the face-up trump card.
  - **Close** the stock to switch to Phase 2 early (risky — you must then reach 66).
- **Phase 2 (stock empty or closed):** you *must* follow suit, beat the led card if you can,
  and trump when void.
- **Win the hand** by being first to **66+** points (cards + marriages). Game points:
  opponent had no tricks → **3**, under 33 → **2**, otherwise → **1**. Close and fail → opponent scores.
- First to the target (default **11**) game points wins the **match**.

## Project layout

```
server/
  santase.js       # pure game engine (rules, scoring, serialization)
  santase.test.js  # deterministic self-test
  rooms.js         # room/lobby manager, codes, stats
  index.js         # Express + Socket.IO server
public/
  index.html       # home / lobby / game (single page)
  app.js           # client: sockets, board rendering, actions
  cards.js         # card render helpers
  styles.css       # felt table + card styling
  dashboard.html   # live admin dashboard
Dockerfile · docker-compose.yml · render.yaml
```

## Tech

Node.js · Express · Socket.IO · vanilla JS/CSS (no build step, no database — rooms live in memory).

MIT licensed.
