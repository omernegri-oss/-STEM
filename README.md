# 🛒 Supermarket

A cooperative **1–4 player** multiplayer supermarket building and management game that runs in the browser.
You and your friends start in an **empty building** with $5,000. You agree on a store name, then build, stock,
staff and grow the biggest supermarket in town together.

![stylized 3D, Three.js, Node.js WebSocket multiplayer](https://img.shields.io/badge/3D-Three.js-orange) ![multiplayer](https://img.shields.io/badge/co--op-1--4%20players-blue)

## Quick start

```bash
npm install
npm start            # → http://localhost:3000
```

Open the URL, click **Build a New Store**, and share the 5-letter store code. Friends type it and press
**Join with code**, from anywhere (see [Playing together online](#playing-together-online)). Everyone shares the
same money, inventory and store.

Requires Node.js 18+. No build step: the client is plain ES modules plus Three.js served by the game server.

## How to play

| Action | Key |
| --- | --- |
| Move / sprint | `WASD` / `Shift` |
| Look around (first person) · switch camera | mouse · `V` |
| Interact · drop (first person) | left click · right click |
| Rotate camera / zoom | drag mouse, `Z`/`C` · mouse wheel |
| Interact (hold to repeat) | `E` or `Space` |
| Drop what you carry | `Q` |
| Baton out / away · swing it (friends are knocked down; customers leave without buying and your reputation drops) | `1` · left click |
| Punch (friends get dizzy, customers walk out) | `F` |
| Arrange furniture (move / rotate / pack / sell) | `B` (`M` / `R` / `P` / `X`) |
| Stock overview · money · progress | `I` · `M` · `K` |
| Chat · gestures (wave, point, thumbs up, shrug, clap, nod) · mark a spot | `Enter` · `2`–`7` · `G` |
| Help | `?` |

**How it works**

- You start in an empty building with **$400**, a **store computer** and one checkout counter. That's enough
  for a shelf and a few boxes of flour, oil or sugar, the only products you're licensed to sell at first.
- **Everything is bought on the computer.** Walk to it and press `E`. From there you can:
  - order stock from suppliers;
  - buy a **license** for each new product ($50–$200 each);
  - buy furniture and plants;
  - set prices (each product has a minimum and maximum price). Prices can also be changed at the shelf: look at a
    price label and press `E` to open the price calculator (cost, selling price, profit per item, margin);
  - hire staff (from store level 3; each hire costs a one-time fee of one day's wage), buy upgrades and expansions;
  - pay your **bills**;
  - read **messages**.
- Deliveries arrive as boxes at the loading area. Furniture comes in a box too: carry it inside, press `E`
  and place it wherever you like. Nobody tells you how to lay out your store.
- **Household & toiletries** (toilet tissue, bleach, dish soap, shampoo, soap, washing powder, detergent) share the
  gondola shelves with groceries; order them from CleanCo Supply (from level 2).
- **Fridges and freezers have doors**: open them before stocking.
- **At the register**, shoppers unload their basket onto the belt (side by side, stacked, some lying down). Click each
  product to pass it over the scanner, then take the payment:
  - **cash**: the customer hands you notes; count the change from the cash drawer. Too little and they complain
    (try again); too much and the extra is lost;
  - **card**: type the total on the card terminal and press OK. A wrong amount is refused.
  Staff cashiers and self-checkouts take payments on their own.
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
  online.js      online play by store code (WebRTC through PeerJS)
desktop/       main.mjs (Electron app: runs the game server inside the app) · preload.cjs
media/         promo images and screenshots (tools/media-assets.mjs)
tests/         sim · multiplayer · soak (unit) · browser-* · browser-online · desktop-smoke (Playwright)
```

The server owns all game state. Clients send intents (`place`, `order`, `pickup`, `stock`, `work`…) and their
own position (client-predicted movement with shared collision code). They receive world/meta updates when
something changes, plus 10 Hz snapshots of moving actors, which they interpolate.

## Playing together online

The player who builds the store is its host: the store runs on their computer. The lobby shows the 5-letter
store code (also in the top bar during the game). Friends type it in the main menu and press **Join with code**.
This works on the website and in the downloaded game, in any mix, over the internet. No accounts are needed.

There are two routes, tried in order:

1. **Direct**: the free public PeerJS service (0.peerjs.com) introduces the two computers, and the game runs over
   a direct WebRTC connection (STUN/TURN help with routers).
2. **Relay**: when two home networks can't connect directly (strict routers, carrier-grade NAT), messages go
   through free public MQTT brokers over a secure WebSocket (EMQX, HiveMQ, Mosquitto test servers). The host
   listens on all of them; the friend uses the first one that reaches the store.

The friend's loading screen shows each step. The host must keep the game open; friends see a message and return
to the menu when the host leaves. Self-hosting: `window.ST_PEER = { host, port, path, secure }` and
`window.ST_RELAYS = ['wss://…']` before the game loads.

Keys work by their place on the keyboard, so WASD and all shortcuts work with any keyboard layout (for example
Hebrew).

## Desktop version

`npm run desktop` starts the desktop app (Electron). It runs the game server inside the app and keeps saves in
the app data folder. It starts fullscreen (F11 toggles). If a copy is stuck in the background it offers to
close it and start again; after a graphics-driver crash it restarts with software graphics. Each start writes
`startup-log.txt` (and errors `error-log.txt`) in the app data folder (`%APPDATA%\\Supermarket` on Windows). Builds for Windows, macOS and Linux come from `npm run dist:win|dist:mac|dist:linux` or from
the **Desktop builds** GitHub Actions workflow, which publishes them on the Releases page.

## Web version (no server)

`npm run build:static` creates `dist/`, a static build. The same game server code runs inside the browser and
stores are saved in the browser; friends join online with the store code. All paths are relative, so you can host `dist/` on any static web host
or in a subfolder. `dist/artifact.html` is the same page without the document wrapper, for hosts that add their own.

## Download

The newest build is on the Releases page: Windows, Mac and Linux. The browser version is published
at https://omernegri-oss.github.io/-STEM/ by the "Website (GitHub Pages)" workflow once the repository is public and
Pages is set to "GitHub Actions" (Settings > Pages).

## Tests

```bash
npm test                    # simulation, multiplayer, 8-day soak
npm run test:desktop        # starts the Electron app and plays the opening (Linux: xvfb-run -a npm run test:desktop)
npm run test:browser        # 2-player browser playthrough (needs Playwright + Chromium)
npm run test:online         # online play by code: website and game-server hosts and friends (local PeerServer)
node tests/browser-ui.mjs   # UI flows: butcher counter, build card, panels, events, report
npm run showcase            # builds a level-10 store and saves screenshots (SHOTS=dir)
```

Saves are written to `saves/` (override with `SAVES_DIR`). Port via `PORT` (default 3000).
