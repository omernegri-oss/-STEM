# Stats dashboard

Private player counts and bug reports for the game.

- `api/t.js` (repository root): the Vercel function. The game POSTs heartbeats and error reports; the dashboard GETs the numbers with the key. `GET /api/t?health` is a public health check (no numbers).
- `stats/index.html`: the dashboard, served at the root of the Vercel site (`vercel.json`). Open it as `https://<site>/#key=<key>`.
- The Vercel project builds this repository on every push to `main` (no build step, `npm ci --ignore-scripts`).
- Storage: the public Vercel Blob store "supermarket-stats" connected to the project (`BLOB_READ_WRITE_TOKEN`; the file sits at a path derived from the key). Without it, live numbers work but history resets when the function restarts.
- The key: `ADMIN_KEY` environment variable if set, otherwise the built-in one (only its SHA-256 is in the code).
