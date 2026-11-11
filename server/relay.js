// Optional WebSocket relay for Wings over Isonzo (fallback when peer-to-peer WebRTC is blocked).
// It never sees the password or any game data: rooms are named by a hash and frames are
// AES-GCM ciphertext. It only forwards frames between the sockets in one room.
//
//   npm install && npm run relay            (listens on PORT or 8787)
//   then open the game with  ?relay=ws://localhost:8787
import { WebSocketServer } from 'ws';

const PORT = +(process.env.PORT || 8787);
const MAX_PER_ROOM = 12;            // 6 v 6
const MAX_FRAME = 16 * 1024;
const rooms = new Map();            // room id -> Map(peer id -> socket)
const enc = new TextEncoder(), dec = new TextDecoder();

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_FRAME });
wss.on('connection', (ws, req) => {
  const roomId = new URL(req.url, 'http://x').searchParams.get('room') || '';
  if (!/^[0-9a-f]{8,64}$/.test(roomId)) return ws.close(1008, 'bad room');
  let room = rooms.get(roomId);
  if (!room) rooms.set(roomId, room = new Map());
  if (room.size >= MAX_PER_ROOM) { ws.send(JSON.stringify({ t: 'full' })); return ws.close(1013, 'room full'); }

  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const idBytes = enc.encode(id);
  ws.send(JSON.stringify({ t: 'welcome', id, peers: [...room.keys()] }));
  for (const peer of room.values()) peer.send(JSON.stringify({ t: 'join', id }));
  room.set(id, ws);

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const b = new Uint8Array(data), n = b[0];
    if (b.length < 1 + n + 12) return;
    const to = dec.decode(b.subarray(1, 1 + n));
    // rewrite the header so receivers learn the sender instead of the target
    const out = new Uint8Array(1 + idBytes.length + b.length - 1 - n);
    out[0] = idBytes.length; out.set(idBytes, 1); out.set(b.subarray(1 + n), 1 + idBytes.length);
    if (to) room.get(to)?.send(out);
    else for (const [pid, peer] of room) if (pid !== id && peer.readyState === 1) peer.send(out);
  });
  ws.on('close', () => {
    room.delete(id);
    if (!room.size) rooms.delete(roomId);
    else for (const peer of room.values()) peer.send(JSON.stringify({ t: 'leave', id }));
  });
});
console.log(`Wings over Isonzo relay listening on :${PORT}`);
