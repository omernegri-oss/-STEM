// Steamworks integration for the desktop app: friends-only lobbies, invites, joining through Steam,
// P2P networking between the host and friends, and achievements.
import { createRequire } from 'node:module';
import { HostBridge, ClientRelay } from './p2p.mjs';
const require = createRequire(import.meta.url);

const LobbyType = { FriendsOnly: 1 };
const SendType = { Reliable: 2 };
const CB = { LobbyChatUpdate: 5, P2PSessionRequest: 6, P2PSessionConnectFail: 7, GameLobbyJoinRequested: 8 };
const MEMBER_LEFT = new Set([1, 2, 3, 4]); // left, disconnected, kicked, banned

export const achievementApiName = (id) => 'ACH_' + String(id).toUpperCase();

export class SteamService {
  // sw: the object returned by steamworks.init(); null when Steam isn't running (the game still works solo)
  constructor(sw, { attachSocket, onJoin, log = console.log } = {}) {
    this.sw = sw; this.attachSocket = attachSocket; this.onJoin = onJoin || (() => {}); this.log = log;
    this.lobby = null; this.role = null; this.bridge = null; this.relay = null; this.listeners = [];
    this.pendingSessions = new Set();
    if (!sw) return;
    this.me = String(sw.localplayer.getSteamId().steamId64);
    this.transport = {
      send: (peer, buf) => sw.networking.sendP2PPacket(BigInt(peer), SendType.Reliable, buf),
      onPacket: (fn) => this.listeners.push(fn),
    };
    // read incoming packets often; the game itself ticks at 20 Hz
    this.poll = setInterval(() => {
      try {
        for (let n = sw.networking.isP2PPacketAvailable(), guard = 0; n > 0 && guard < 500; n = sw.networking.isP2PPacketAvailable(), guard++) {
          const pk = sw.networking.readP2PPacket(n);
          const from = String(pk.steamId.steamId64);
          for (const fn of this.listeners) fn(from, pk.data);
        }
        if (this.bridge) this.bridge.tick();
      } catch (e) { this.log('steam poll error', e); }
    }, 8);
    sw.callback.register(CB.P2PSessionRequest, ({ remote }) => this.onSessionRequest(String(remote)));
    sw.callback.register(CB.P2PSessionConnectFail, ({ remote }) => { if (this.bridge) this.bridge.drop(String(remote), false); });
    sw.callback.register(CB.LobbyChatUpdate, (e) => this.onLobbyChange(e));
    sw.callback.register(CB.GameLobbyJoinRequested, ({ lobby_steam_id }) => this.join(lobby_steam_id).catch(e => this.log('join failed', e)));
  }

  get available() { return !!this.sw; }
  info() {
    if (!this.sw) return { available: false };
    let deck = false; try { deck = this.sw.utils.isSteamRunningOnSteamDeck(); } catch {}
    return { available: true, name: this.sw.localplayer.getName(), appId: this.sw.utils.getAppId(), deck };
  }
  isMember(peer) { try { return !!this.lobby && this.lobby.getMembers().some(m => String(m.steamId64) === peer); } catch { return false; } }
  // only people in our Steam lobby may open a connection to us
  onSessionRequest(peer) {
    if (this.isMember(peer)) this.sw.networking.acceptP2PSession(BigInt(peer));
    else this.pendingSessions.add(peer);
  }
  onLobbyChange({ lobby, user_changed, member_state_change }) {
    if (!this.lobby || String(lobby) !== String(this.lobby.id)) return;
    const who = String(user_changed);
    if (member_state_change === 0 && this.pendingSessions.has(who)) { this.pendingSessions.delete(who); this.sw.networking.acceptP2PSession(BigInt(who)); }
    if (MEMBER_LEFT.has(member_state_change)) {
      if (this.role === 'host' && this.bridge) this.bridge.drop(who, false);
      if (this.role === 'client' && this.relay && who === this.relay.host) this.relay.close();
    }
  }

  // the host opened a store: make a friends-only lobby that points at it
  async host(code, storeName = '') {
    if (!this.sw) return null;
    if (this.role === 'host' && this.lobby && this.lobby.getData('code') === code) return String(this.lobby.id);
    this.leave();
    this.lobby = await this.sw.matchmaking.createLobby(LobbyType.FriendsOnly, 4);
    this.role = 'host';
    this.lobby.mergeFullData({ code, store: storeName, host: this.sw.localplayer.getName() });
    this.lobby.setJoinable(true);
    this.sw.localplayer.setRichPresence('connect', `+connect_lobby ${this.lobby.id}`);
    this.sw.localplayer.setRichPresence('status', storeName ? `Running ${storeName}` : 'Opening a supermarket');
    if (!this.bridge) this.bridge = new HostBridge(this.transport, this.attachSocket);
    this.log('steam lobby', String(this.lobby.id), 'for store', code);
    return String(this.lobby.id);
  }
  setStoreName(name) { try { if (this.role === 'host' && this.lobby) { this.lobby.setData('store', name); this.sw.localplayer.setRichPresence('status', `Running ${name}`); } } catch {} }

  // a friend invited us (or we clicked "Join game" in the friends list)
  async join(lobbyId) {
    if (!this.sw) return null;
    this.leave();
    const lobby = await this.sw.matchmaking.joinLobby(BigInt(lobbyId));
    const owner = String(lobby.getOwner().steamId64);
    if (owner === this.me) { this.lobby = lobby; this.role = 'host'; return null; }
    const code = lobby.getData('code');
    if (!code) { lobby.leave(); throw new Error('That lobby has no store'); }
    this.lobby = lobby; this.role = 'client';
    this.relay = new ClientRelay(this.transport, owner);
    this.sw.networking.acceptP2PSession(BigInt(owner));
    const d = { code, hostName: lobby.getData('host') || 'your friend', store: lobby.getData('store') || '' };
    this.onJoin(d);
    return d;
  }
  // the page opened its '/steam-relay' WebSocket: pipe it to the host
  pipe(ws) { if (this.relay) this.relay.pipe(ws); else ws.close(); }

  invite() { if (this.lobby) { this.lobby.openInviteDialog(); return true; } return false; }
  leave() {
    if (this.relay) { this.relay.close(); this.relay = null; }
    if (this.bridge) { this.bridge.close(); this.bridge = null; }
    if (this.lobby) { try { this.lobby.leave(); } catch {} this.lobby = null; }
    this.role = null; this.pendingSessions.clear(); this.listeners = []; // old bridge/relay stop hearing packets
    try { this.sw && this.sw.localplayer.setRichPresence('connect', null); } catch {}
  }
  achievement(id) {
    if (!this.sw) return false;
    try { const name = achievementApiName(id); return this.sw.achievement.isActivated(name) || this.sw.achievement.activate(name); } catch { return false; }
  }
}
