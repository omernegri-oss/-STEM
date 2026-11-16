# Stats dashboard

Private player counts and bug reports for the game.

- `api/t.js` (repository root): the Vercel function. The game POSTs heartbeats and error reports; the dashboard GETs the numbers with the key (sent in the `x-key` header, never in the address). `GET /api/t?health` is a public health check (no numbers).
- `stats/index.html`: the dashboard, served at the root of the Vercel site (`vercel.json`). Open it as `https://<site>/#key=<key>`.
- The Vercel project builds this repository on every push to `main` (no build step, `npm ci --ignore-scripts`).
- Storage: a Vercel Blob store connected to the project (`BLOB_READ_WRITE_TOKEN`). Without it, live numbers work but history resets when the function restarts.
- The key: the `ADMIN_KEY` environment variable of the Vercel project (a long random text). Without it the dashboard stays closed. The address `#key=<key>` is only a way to hand the key to the page: the page stores it in the browser and removes it from the address bar at once.
- Limits: requests per address per minute, new players per hour and the size of a request are capped, so the counters cannot be flooded with made-up players.
