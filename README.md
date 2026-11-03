# 🛒 Supermarket Tycoons

A cooperative **1–4 player** multiplayer supermarket building and management game that runs in the browser.
You and your friends start in an **empty building** with $5,000. You agree on a store name, then build, stock,
staff and grow the biggest supermarket in town together.

![stylized 3D, Three.js, Node.js WebSocket multiplayer](https://img.shields.io/badge/3D-Three.js-orange) ![multiplayer](https://img.shields.io/badge/co--op-1--4%20players-blue)

## Quick start

```bash
npm install
npm start            # → http://localhost:3000
```

Open the URL, click **Build a New Store**, and share the 5-letter invite code. Friends on the same network
open `http://<your-ip>:3000` and **Join with code**. Everyone shares the same money, inventory and store.

Requires Node.js 18+. No build step: the client is plain ES modules plus Three.js served by the game server.

## How to play

| Action | Key |
| --- | --- |
| Move / sprint | `WASD` / `Shift` |
| Rotate camera / zoom | drag mouse, `Z`/`C` · mouse wheel |
| Interact (hold to repeat) | `E` or `Space` |
| Drop what you carry | `Q` |
| Punch (friends get dizzy, customers walk out) | `F` |
| Arrange furniture (move / rotate / pack / sell) | `B` (`M` / `R` / `P` / `X`) |
| Stock overview · money · progress | `I` · `M` · `K` |
| Chat · emotes · ping a spot | `Enter` · `1`–`6` · `G` |
| Help | `?` |

**How it works**

- You start in an empty building with **$400**, a **store computer** and one checkout counter. That's enough
  for a shelf and a few boxes of flour, oil or sugar, the only products you're licensed to sell at first.
- **Everything is bought on the computer.** Walk to it and press `E`. From there you can:
  - order stock from suppliers;
  - buy a **license** for each new product ($50–$200 each);
  - buy furniture and plants;
  - set prices (each product has a minimum and maximum price);
  - hire staff, buy upgrades and expansions;
  - pay your **bills**;
  - read **messages**.
- Deliveries arrive as boxes at the loading area. Furniture comes in a box too: carry it inside, press `E`
  and place it wherever you like. Nobody tells you how to lay out your store.
- **Fridges and freezers have doors**: open them before stocking.
- **At the register**, click each product on the belt to pass it over the scanner, then take the payment.
- **Butcher and deli departments** have a big fridge and a prep station (cleaver block or cheese slicer) behind
  the counter. To serve an order, take it from the fridge, cut and wrap it at the station, then hand it over at the counter.
- Customers don't show their wishes above their heads. If they can't find a product, they tell you in the
  computer's messages.
- At most **15 shoppers** are in the store at once.
- Every evening a bill for rent, electricity and maintenance arrives. Pay it within 2 days or late fees stack
  up, and after 3 days you're evicted. Salaries are paid automatically.
- The chat only shows your team's messages, level-ups and deliveries.
- There are **10 store levels**. The last expansion adds a **second floor** with stairs, which customers and players walk up.

## Architecture

```
server/        Node.js authoritative simulation (20 Hz) + WebSocket rooms
  index.js       HTTP static hosting, lobby/room management, tick loop, autosave
  room.js        players, message handling, snapshots (10 Hz), world/meta deltas
  game.js        store state, actions, economy, orders, day cycle, events, goals
  customers.js   customer AI      staff.js   employee AI     persistence.js   JSON saves
shared/        data.js (all game content & balance) · grid.js (placement rules, A*, collision)
client/        Three.js renderer, procedural models, actors, build mode, UI panels, WebAudio
tests/         sim.test.js · multiplayer.test.js · browser-e2e.mjs · browser-ui.mjs · browser-showcase.mjs
```

The server owns all game state. Clients send intents (`place`, `order`, `pickup`, `stock`, `work`…) and their
own position (client-predicted movement with shared collision code). They receive world/meta updates when
something changes, plus 10 Hz snapshots of moving actors, which they interpolate.

## Tests

```bash
npm test                    # headless simulation + 4-client multiplayer protocol test
npm run test:browser        # 2-player browser playthrough (needs Playwright + Chromium)
node tests/browser-ui.mjs   # UI flows: butcher counter, build card, panels, events, report
npm run showcase            # builds a level-10 store and saves screenshots (SHOTS=dir)
```

Saves are written to `saves/` (override with `SAVES_DIR`). Port via `PORT` (default 3000).
