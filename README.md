# Wings over Isonzo

WW1 arcade flight game over the Isonzo front, 1917. Flat-shaded low-poly, no textures, runs in the browser with no build step.

This is the minimal playable build: a team dogfight on the Isonzo Front map with one fighter per side, bots, and multiplayer for up to 6 v 6.

![Front overview](docs/concept/02_front_overview.png)

## Play

```bash
npm install
```

```bash
npm start
```

Open http://localhost:8080. Any static file server works; the game is plain ES modules.

- **Solo:** leave the squadron password empty. Bots fill both sides.
- **Multiplayer:** everyone enters the same squadron password. Up to 6 pilots per side; bots fill the remaining seats up to "Pilots per side".
- **Sides:** Italy flies the SPAD VII (faster), Austria-Hungary the Albatros D.III (turns tighter).
- **Round:** every aircraft lost gives the other side a point. First to 30 wins and the round restarts.

| Control | Keys |
|---|---|
| Pitch | `W` / `S` or `↑` / `↓` (`S` pulls the nose up) |
| Roll | `A` / `D` or `←` / `→` |
| Rudder | `Q` / `E` |
| Throttle | `Shift` up, `Ctrl` or `C` down |
| Fire | `Space` or mouse button |

### Controllers

Gamepads, joysticks, throttles and rudder pedals work alongside the keyboard. Open **Controller setup** from the lobby, or press `Esc` in flight.

- **Assign:** press Assign next to an action, then move that control (or press that button). Each binding remembers its device, so a stick, a throttle and pedals can be mixed.
- **Standard layout:** an Xbox / PlayStation style pad is set up automatically — left stick pitch and roll, right stick rudder and throttle, right trigger fires.
- **Lever:** tick "lever" on the throttle axis when it is a real throttle lever, so its position sets the throttle directly.
- **Calibrate:** two steps — release everything to record the centres, then move every control to its end stops.
- **Dead zone / response curve:** ignore small movements near centre, and soften the response around it.

Settings are saved in the browser.

### Handling

The flight model and chase camera come from Home Skies 1917:

- The aircraft turns by banking and holds the bank you set; there is no self-levelling.
- The flight path follows the nose only as fast as the wings can pull, so hauling back hard bleeds speed.
- Below stall speed the aircraft sinks and drops its nose; let it dive to recover.
- The camera sits behind and above and always keeps the horizon level.

Add `?shadows=0` to the URL on slow machines.

## Multiplayer

There is no game server. The password picks the room and encrypts the traffic.

- **Default — peer-to-peer.** [Trystero](https://github.com/dmotz/trystero) finds the other players through public Nostr relays, then game data flows directly between browsers over WebRTC. Some networks block this; if players cannot see each other, use the relay below. A TURN server can be supplied by setting `window.WOI_TURN` before the game loads.
- **Fallback — WebSocket relay.** Run `npm run relay` (port 8787, or `PORT`) on any host and have every player enter its address under "Connection options", or open the game with `?relay=wss://your-host`. The relay only forwards AES-GCM ciphertext and never sees the password.

How the game stays in sync:

- Each browser simulates its own aircraft and sends its state 15 times a second.
- The shooter decides hits; the owner of the target applies the damage and announces the kill.
- Bots and the score are run by one player (the lowest peer id). If that player leaves, the next one takes over.

Nothing here is cheat-proof; it is built for friends sharing a password.

URL parameters: `name`, `pw`, `team` (`it` / `ah`), `size` (1–6), `relay`, `autostart=1`, `shadows=0`.

## Layout

| Path | What |
|---|---|
| `index.html` | Lobby and HUD markup |
| `src/world.js` | Map definition: terrain height function, airfields, balloon sectors, ground targets |
| `src/terrain.js` | Terrain, river, sea, trees, sky |
| `src/objects.js` | Aircraft, balloons, airfields, towns, ground-target models |
| `src/plane.js` | Aircraft types, flight model, bot pilot |
| `src/gamepad.js` | Controller bindings, calibration and the setup panel |
| `src/net.js` | Password rooms over Trystero or the WebSocket relay |
| `src/main.js` | Game loop, guns, scoring, networking, HUD |
| `server/relay.js` | Optional WebSocket relay |
| `docs/concept/` | Map concept images |

To add an aircraft, add an entry to `TYPES` in `src/plane.js` with a model builder from `src/objects.js`.

## Not in yet

Balloon sectors and ground targets are on the map as scenery only; capture zones, bombing, take-off and landing, sound, and touch controls are still to come.

Third-party code in `vendor/` (three.js, Trystero) is MIT licensed; see the licence files there.
