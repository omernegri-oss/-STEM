# Supermarket stats

A small private dashboard for the game's developer: players online now, today, this week, this month and all
time, and the errors players ran into.

- `api/t.js`: one Vercel function. The game posts a heartbeat every 45 seconds and JavaScript errors
  (`client/js/telemetry.js`); the dashboard reads the numbers with the secret key.
- `index.html`: the dashboard (Hebrew). Open it as `https://<project>.vercel.app/#key=<ADMIN_KEY>`.
- Storage: one JSON document in a Vercel Blob store. Players are random ids made in the browser; no names, no IP
  addresses. Players can switch the reporting off in the game's Settings.

## Hosting (Vercel)

1. Import this repository as a Vercel project with **Root Directory** `stats`.
2. Add the environment variable `ADMIN_KEY` (any long random text; it is the dashboard's password).
3. Storage > Create > Blob, connect it to the project (this adds `BLOB_READ_WRITE_TOKEN`), then redeploy.
4. Put the site's address in `STATS_URL` in `client/js/telemetry.js` (`https://<project>.vercel.app/api/t`).

Vercel's free plan allows about 2,000 storage writes a month. The function writes once per new player per day
(at most every two minutes), so that covers roughly 60 different players a day.
