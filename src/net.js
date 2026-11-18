// Multiplayer transport. Everyone who types the same squadron password lands in the same room.
//
//  - Default: public WebTorrent trackers pass the WebRTC handshake (as in Forest Sniper); game traffic then flows peer-to-peer.
//  - Alternative: Trystero over public Nostr relays. The relays only pass the (password-encrypted)
//    WebRTC handshake; game traffic then flows peer-to-peer.
//  - Fallback: a plain WebSocket relay (server/relay.js) given as ?relay=wss://host. All game
//    traffic passes through it, AES-GCM encrypted with a key derived from the password.
//
// Both give the same interface: { id, peers, send(obj, to?), close() } and call
// handlers.onMessage(obj, from), onJoin(id), onLeave(id).

const APP_ID = 'wings-over-isonzo';
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function roomIdFor(password) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(APP_ID + ':room:' + password))).slice(0, 24);
}

export async function connect({ password, relay, turn, via = 'trackers' }, handlers) {
  const room = await roomIdFor(password);
  if (relay) return connectRelay(relay, room, password, handlers);
  return via === 'nostr' ? connectTrystero(room, password, turn, handlers) : connectTrackers(password, turn, handlers);
}

// ---------- public WebTorrent trackers + WebRTC (the default, as in Forest Sniper) ----------
// Everyone with the same password announces into the same tracker "torrent" (a hash of the password). The trackers pass WebRTC
// offers and answers between them and nothing else; each pair of players then has its own direct, encrypted data channel, so
// the battle is a full mesh. Offers keep going out every few seconds, so a player can join while a battle is under way.
const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev', 'wss://tracker.btorrent.xyz', 'wss://tracker.files.fm:7073/announce'];
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const randId = n => { const a = crypto.getRandomValues(new Uint8Array(n)), c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let t = ''; for (const b of a) t += c[b % 36]; return t; };
const gathered = (pc, ms) => new Promise(r => { if (pc.iceGatheringState === 'complete') return r(); const t = setTimeout(r, ms); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }); });
async function connectTrackers(password, turn, h) {
  if (!window.RTCPeerConnection) throw new Error('This browser cannot make peer-to-peer connections');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(APP_ID + ':torrent:' + password)));
  const infoHash = String.fromCharCode(...digest), me = randId(20), rtc = { iceServers: [...STUN, ...(turn || [])] };
  const peers = new Set(), conns = new Map(), connecting = new Map(), offers = new Map(), sockets = [];
  let dead = false, timer = 0;
  const busy = peer => peers.has(peer) || (connecting.get(peer) || 0) > Date.now() - 15000;
  const drop = (peer, dc) => { const c = conns.get(peer); if (!c || c.dc !== dc) return; conns.delete(peer); peers.delete(peer); try { c.pc.close(); } catch { /* gone */ } h.onLeave?.(peer); };
  function attach(pc, dc, peer, offerer) {
    dc.onopen = () => {
      if (dead) return; connecting.delete(peer);
      const ex = conns.get(peer);
      if (ex && ex.dc !== dc) {                                        // both sides offered at once: keep the link the lower id offered, on both ends
        if (offerer > ex.offerer) { try { pc.close(); } catch { /* */ } return; }
        try { ex.pc.close(); } catch { /* */ }
      }
      conns.set(peer, { pc, dc, offerer });
      if (!peers.has(peer)) { peers.add(peer); h.onJoin?.(peer); }
    };
    dc.onmessage = e => { if (conns.get(peer)?.dc !== dc) return; let m; try { m = JSON.parse(e.data); } catch { return; } h.onMessage(m, peer); };
    dc.onclose = () => drop(peer, dc);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(peer, dc); };
  }
  const send = (w, o) => { try { if (w.readyState === 1) w.send(JSON.stringify(o)); } catch { /* closed */ } };
  async function onTracker(w, ev) {
    if (dead) return; let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (!m || m.info_hash !== infoHash || !m.peer_id || m.peer_id === me) return;
    const peer = m.peer_id;
    if (m.offer && m.offer_id) {                                       // somebody else's offer: answer it, unless we are already linked
      if (busy(peer)) return; connecting.set(peer, Date.now());
      const pc = new RTCPeerConnection(rtc); pc.ondatachannel = e => attach(pc, e.channel, peer, peer);
      try { await pc.setRemoteDescription(m.offer); await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc, 3000); } catch { connecting.delete(peer); try { pc.close(); } catch { /* */ } return; }
      if (dead) return pc.close();
      send(w, { action: 'announce', info_hash: infoHash, peer_id: me, to_peer_id: peer, offer_id: m.offer_id, answer: { type: 'answer', sdp: pc.localDescription.sdp } });
    } else if (m.answer && m.offer_id) {                               // an answer to one of our offers
      const o = offers.get(m.offer_id); if (!o || o.used) return; o.used = true; offers.delete(m.offer_id);
      if (busy(peer)) { try { o.pc.close(); } catch { /* */ } return; }
      connecting.set(peer, Date.now()); attach(o.pc, o.dc, peer, me);
      o.pc.setRemoteDescription(m.answer).catch(() => { connecting.delete(peer); try { o.pc.close(); } catch { /* */ } });
    }
  }
  async function freshOffer() {
    const pc = new RTCPeerConnection(rtc), dc = pc.createDataChannel('g', { ordered: true }), id = randId(20);
    await pc.setLocalDescription(await pc.createOffer()); await gathered(pc, 2500);
    if (dead) { pc.close(); return null; }
    const o = { id, pc, dc, at: Date.now(), used: false }; offers.set(id, o); return o;
  }
  async function round() {
    if (dead) return;
    for (const [id, o] of offers) if (Date.now() - o.at > 45000) { offers.delete(id); try { o.pc.close(); } catch { /* */ } }   // unanswered offers go stale
    const want = peers.size >= 11 ? 0 : Math.min(4, 11 - peers.size);
    const made = (await Promise.all(Array.from({ length: want }, () => freshOffer().catch(() => null)))).filter(Boolean);
    for (const w of sockets) send(w, { action: 'announce', info_hash: infoHash, peer_id: me, numwant: made.length, uploaded: 0, downloaded: 0, left: 0, event: 'started',
      offers: made.map(o => ({ offer_id: o.id, offer: { type: 'offer', sdp: o.pc.localDescription.sdp } })) });
    timer = setTimeout(round, peers.size ? 9000 : 5000);
  }
  let reached = 0;
  await new Promise(resolve => {
    const done = setTimeout(resolve, 4000);
    (window.WOI_TRACKERS || TRACKERS).forEach(function open(url, i) {
      if (dead) return; let w; try { w = new WebSocket(url); } catch { return; }
      sockets[i] = w;
      w.onopen = () => { reached++; if (reached === 1) { clearTimeout(done); setTimeout(resolve, 300); } };
      w.onmessage = ev => onTracker(w, ev);
      w.onerror = () => {};
      w.onclose = () => { if (!dead) setTimeout(() => open(url, i), 5000); };
    });
  });
  if (!reached) h.onError?.('No matchmaking tracker answered yet; still trying');
  round();
  return {
    id: me, peers, kind: 'p2p', get trackers() { return sockets.filter(w => w && w.readyState === 1).length; },
    send(obj, to) {
      if (!peers.size) return; const data = JSON.stringify(obj);
      if (to) { const c = conns.get(to); if (c && c.dc.readyState === 'open') c.dc.send(data); return; }
      for (const c of conns.values()) if (c.dc.readyState === 'open') { try { c.dc.send(data); } catch { /* closing */ } }
    },
    close() { dead = true; clearTimeout(timer); for (const w of sockets) { if (!w) continue; w.onclose = null; try { w.close(); } catch { /* */ } } for (const c of conns.values()) try { c.pc.close(); } catch { /* */ } for (const o of offers.values()) try { o.pc.close(); } catch { /* */ } },
  };
}

// ---------- Trystero (Nostr relays + WebRTC) ----------
async function connectTrystero(roomId, password, turn, h) {
  const { joinRoom, selfId } = await import('../vendor/trystero-nostr.min.js');
  const cfg = { appId: APP_ID, password };
  if (turn && turn.length) cfg.turnConfig = turn;
  const room = joinRoom(cfg, roomId, { onJoinError: e => h.onError?.(e.error) });
  const peers = new Set();
  const action = room.makeAction('g');
  action.onMessage = (data, ctx) => h.onMessage(data, ctx.peerId);
  room.onPeerJoin = id => { peers.add(id); h.onJoin?.(id); };
  room.onPeerLeave = id => { peers.delete(id); h.onLeave?.(id); };
  return {
    id: selfId, peers, kind: 'p2p',
    send(obj, to) { if (peers.size) action.send(obj, to ? { target: to } : undefined).catch(() => {}); },
    close() { room.leave(); },
  };
}

// ---------- WebSocket relay ----------
async function connectRelay(url, roomId, password, h) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode(APP_ID + roomId), iterations: 50000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const ws = new WebSocket(url.replace(/\/$/, '') + '/?room=' + roomId);
  ws.binaryType = 'arraybuffer';
  const peers = new Set();
  const net = {
    id: null, peers, kind: 'relay',
    async send(obj, to) {
      if (ws.readyState !== 1 || !peers.size) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
      // frame: [target id length][target id][iv][ciphertext]; empty target = everyone
      const t = enc.encode(to || ''), out = new Uint8Array(1 + t.length + 12 + ct.length);
      out[0] = t.length; out.set(t, 1); out.set(iv, 1 + t.length); out.set(ct, 13 + t.length);
      if (ws.readyState === 1) ws.send(out);
    },
    close() { ws.close(); },
  };
  await new Promise((res, rej) => {
    ws.onerror = () => rej(new Error('Could not reach relay ' + url));
    ws.onclose = () => { h.onError?.('Relay connection closed'); rej(new Error('Relay closed')); };
    ws.onmessage = async ev => {
      if (typeof ev.data === 'string') {           // control messages from the relay itself
        const m = JSON.parse(ev.data);
        if (m.t === 'welcome') { net.id = m.id; m.peers.forEach(p => peers.add(p)); res(); m.peers.forEach(p => h.onJoin?.(p)); }
        else if (m.t === 'join') { peers.add(m.id); h.onJoin?.(m.id); }
        else if (m.t === 'leave') { peers.delete(m.id); h.onLeave?.(m.id); }
        else if (m.t === 'full') rej(new Error('Room is full'));
        return;
      }
      const b = new Uint8Array(ev.data), n = b[0], from = dec.decode(b.subarray(1, 1 + n));
      try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(1 + n, 13 + n) }, key, b.subarray(13 + n));
        h.onMessage(JSON.parse(dec.decode(pt)), from);
      } catch { /* wrong password or corrupt frame: ignore */ }
    };
  });
  return net;
}
