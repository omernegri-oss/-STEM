# Putting Supermarket on Steam

The game ships on Steam as a desktop app for **Windows, macOS and Linux / Steam Deck**. It is the same game as
the web version, wrapped in Electron, with Steam features added:

- **Play with friends through Steam.** The host presses **👥 Invite** in the lobby or in the game. Friends accept
  the invite, or click **Join Game** on the host in their friends list. Up to 4 players. The host's computer runs
  the store, and friends connect to it over Steam's peer-to-peer network. No server and no port forwarding needed.
- **Achievements.** All 24 store achievements unlock on Steam too.
- **Saves.** Stores are saved in the app data folder, and Steam Cloud can sync them (see step 5).
- **Offline.** If Steam isn't running, the game still starts and plays solo.

Until you have your own App ID, the game uses **480**. That is Valve's public test app ("Spacewar"), which
every Steam account can use for development. Invites and achievements can be tested with it. Steam shows the
game as "Spacewar" while you test.

---

## 1. Create the game in Steamworks (only you can do this)

1. Sign up at <https://partner.steamgames.com> and pay the **Steam Direct fee ($100 per game)**. Steam needs
   tax and bank details before it gives you an App ID.
2. Create the app. You get an **App ID** (for example `2345670`).
3. Put your App ID in `desktop/steam-config.json`:
   ```json
   { "appId": 2345670 }
   ```
4. In **SteamPipe → Depots**, add three depots, one per operating system. By default their IDs are your App ID
   +1, +2 and +3. Set each depot's operating system: Windows, macOS, Linux + SteamOS.
5. In `steam/app_build.vdf` and the three `steam/depot_*.vdf` files, replace `480`, `481`, `482` and `483` with
   your App ID and depot IDs.

## 2. Launch options (Steamworks → Installation → General)

| OS | Executable | Arguments |
| --- | --- | --- |
| Windows | `Supermarket.exe` | |
| macOS | `Supermarket.app` | |
| Linux + SteamOS | `supermarket` | `--no-sandbox` |

The game already turns off Chromium's sandbox when it runs under Steam on Linux. The argument covers launches
where Steam's environment variables are missing.

## 3. Achievements (Stats & Achievements → Achievements)

`steam/achievements.csv` lists all 24: API name, display name and description. The API names must be typed
exactly (`ACH_FIRST_SALE`, `ACH_CUSTOMERS50`, …). Steam needs a 64×64 icon per achievement, locked and
unlocked. After saving, press **Publish** on the Steamworks page.

Run `npm run steam:achievements` again if you add achievements to `shared/data.js`.

## 4. Store page images

`steam/assets/` has everything the store page asks for:

| File | Where it goes |
| --- | --- |
| `header-capsule-920x430.png` | Header capsule |
| `small-capsule-462x174.png` | Small capsule |
| `main-capsule-1232x706.png` | Main capsule |
| `vertical-capsule-748x896.png` | Vertical capsule |
| `library-capsule-600x900.png` | Library capsule |
| `library-hero-3840x1240.png` | Library hero |
| `library-logo-1280x720.png` | Library logo (transparent) |
| `screenshot-1…5.png` (1920×1080) | Screenshots (Steam wants at least 5) |
| `community-icon-184.png`, `icon-256.png` | Community icon / client icon |

Run `npm run steam:assets` to remake them from the current game. It takes a few minutes. Run
`node tools/steam-assets.mjs --capsules` to redraw only the capsules.

## 5. Steam Cloud (Steam Cloud → Auto-Cloud)

Byte quota 50 MB, number of files 200, then add these root paths. All use the pattern `*.json`:

| Root | Subdirectory | OS |
| --- | --- | --- |
| `WinAppDataRoaming` | `Supermarket/saves` | Windows |
| `MacHome` | `Library/Application Support/Supermarket/saves` | macOS |
| `LinuxHome` | `.config/Supermarket/saves` | Linux |

## 6. Build

**On GitHub (recommended).** Go to **Actions → "Desktop builds (Steam)" → Run workflow**. The workflow:

1. Runs the tests.
2. Builds all three versions. The Mac app is built on Linux as an Intel app, which also runs on Apple Silicon
   Macs through Rosetta (GitHub often has no macOS machine free for private repositories). For a *universal*
   app, run `npm run dist:mac` on a Mac.
3. Starts the Linux build to check it.

Each run's page has **Supermarket-windows / -mac / -linux** to download.

**On your own computer:**
```bash
npm install
npm run desktop          # play the desktop version (uses Steam if it is running)
npm run dist:win         # → release/win-unpacked/
npm run dist:mac         # → release/mac-universal/   (must run on a Mac)
npm run dist:mac-intel   # → release/mac/             (Intel app, works on any OS)
npm run dist:linux       # → release/linux-unpacked/
```

## 7. Upload to Steam

**From GitHub.** Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `STEAM_APP_ID` | your App ID |
| `STEAM_USERNAME` | a Steam account with build-upload rights. Make a separate "builder" account with only that permission |
| `STEAM_CONFIG_VDF` | the base64 of `config/config.vdf` after logging that account into `steamcmd` once with Steam Guard. See <https://github.com/game-ci/steam-deploy#configvdf> |

Then run the workflow with **Upload this build to Steam** ticked. Optionally give a branch name (for example
`beta`) to set the build live there. The default branch has to be set live by hand in Steamworks.

**By hand.** Install [steamcmd](https://developer.valvesoftware.com/wiki/SteamCMD), put the three build folders
in `release/`, then:
```bash
cd steam
steamcmd +login <builder account> +run_app_build "$(pwd)/app_build.vdf" +quit
```

## 8. Before release

- Mac: Steam doesn't mark downloaded files as "from the internet", so the unsigned app opens normally. To sign
  and notarize anyway, build on a Mac with an Apple Developer ID (`CSC_LINK` / `APPLE_ID` env variables for
  electron-builder).
- Steam Deck: the game runs in Desktop Mode style with the touchpads as mouse. Choose the **Keyboard (WASD) and
  Mouse** controller template in Steamworks → Steam Input so the Deck controls work out of the box.
- Steam reviews the store page and a build before release. Plan for a few days.
