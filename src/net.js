// Multiplayer transport. Everyone who types the same squadron password lands in the same room.
//
//  - Default: Trystero over public Nostr relays. The relays only pass the (password-encrypted)
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

export async function connect({ password, relay, turn }, handlers) {
  const room = await roomIdFor(password);
  return relay ? connectRelay(relay, room, password, handlers) : connectTrystero(room, password, turn, handlers);
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
