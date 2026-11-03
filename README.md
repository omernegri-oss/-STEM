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
| Drop a carried box | `Q` |
| Build mode (rotate / move / sell / upgrade) | `B` (`R` / `M` / `X` / `U`) |
| Order stock · Inventory · Prices · Staff | `O` · `I` · `P` · `H` |
| Finances · Team upgrades · Progress | `F` · `U` · `K` |
| Chat · emotes · ping a spot | `Enter` · `1`–`6` · `G` |
| Help | `?` |

**The core loop**

1. **Build** shelves, fridges and a checkout counter in the empty store. The build preview shows valid
   placement, the customer side in yellow and the staff side in blue.
2. **Order** from suppliers. Each has its own catalog, minimum order, delivery fee, delivery time and bulk discounts.
   Trucks drop **physical boxes** at the yellow loading area outside.
3. **Carry** boxes inside and **stock** the right fixture. Shelves visibly fill up and empty out, and milk won't go on a dry-goods shelf.
4. **Open the store.** Customers walk in, browse departments, fill baskets or carts and queue at checkouts.
   Stand on the blue **STAFF** mat behind a register and tap `E` to scan items and take payment.
5. **Hire employees**: cashiers, shelf stockers, cleaners, butchers and deli clerks, each with a name, salary, skill, speed,
   happiness and shift.
6. At closing time you get a **daily report** covering revenue, expenses, profit, satisfaction, best sellers and what customers wanted.
   Three days in debt and the store goes bankrupt.

## Features

- **Multiplayer co-op (1–4).** Authoritative server, real-time sync, shared money and permissions, public room
  list and invite codes, team naming vote (names are unique across stores), role badges, chat, emotes, pings,
  late joining and save/resume.
- **Building.** 24 fixtures and decorations, placement validation (no blocked aisles or entrances), move, rotate,
  sell (full refund if bought today before opening), per-fixture upgrades, 7 floor styles, 8 wall colours,
  5 lighting styles (up to a party disco) and 5 store expansions.
- **Departments.** Grocery, refrigerated, frozen, produce, an interactive **butcher counter** and a **deli counter**
  where customers request specific cuts and quantities that a player or a hired specialist prepares.
- **62 products** from **8 suppliers**, with expiry dates, spoilage and inventory tracking.
- **Customer AI.** Shopping lists, price sensitivity, patience, reactions (thought bubbles) to prices, cleanliness, empty
  shelves and expired food, litter, and angry walk-outs when lines are too long. Reputation drives foot traffic.
- **Employees** who visibly do their jobs: cashiers scan, stockers haul boxes from the loading area and racks, cleaners mop,
  and butchers chop. Happiness, raises, shifts, sick days and quitting are all modelled.
- **Economy.** Revenue, cost of goods, salaries, rent, electricity, maintenance, tips, profit history chart and margins.
- **Progression.** A fresh **daily challenge** every day, 15 store levels unlock products, suppliers, fixtures, roles, decor and expansions. There are 23 guided
  goals with cash rewards, 24 achievements and 9 team upgrades (hand trucks, pallet jacks, shopping carts, LED lighting…).
- **Random events.** Customer rushes, supplier delays, fridge breakdowns, product shortages, holidays, a VIP food
  blogger, staff absences, flash sales, health inspections, heatwaves, going viral, and a pigeon that gets inside.
- **Presentation.** Stylized low-poly 3D built entirely from code, with a day/night cycle, sliding doors, delivery
  trucks, flying-product stocking animation, checkout belts, confetti and synthesized sound effects and music.
  There is a low-graphics toggle for weaker machines.

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
