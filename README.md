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
- **Start:** on the runway (the default), or in the air over your airfield. On the runway, open the throttle, let the tail come up, and ease the stick back at flying speed. Bots take off too when the host starts on the runway.
- **Balloons:** the observation balloons, their baskets and cables are solid; flying into one destroys the aircraft.
- **Bots:** Rookie (the default), Regular or Ace, or no bots at all, chosen in the lobby. In multiplayer the host's choice applies.
- **Collisions:** two aircraft that touch are both destroyed, so don't ram.
- **Sides:** Italy flies the SPAD VII (faster), Austria-Hungary the Albatros D.III (turns tighter).
- **Round:** every aircraft lost gives the other side a point. First to 30 wins and the round restarts.

| Control | Keys |
|---|---|
| Pitch | `W` / `S` or `↑` / `↓` (`S` pulls the nose up) |
| Roll | `A` / `D` or `←` / `→` |
| Rudder | `Q` / `E` |
| Throttle | `Shift` up, `Ctrl` or `C` down |
| Fire | `Space` or mouse button |
| Sound on / off | `M` |
| Time of day, back / forward one hour | `[` / `]` |
| Camera smoothing, less / more | `,` / `.` |

### Damage

Based on Home Skies 1917, with hits located on the airframe: where a round strikes decides what it damages. Shots from astern tend to find the tail, head-on shots the engine, and shots from the side the wings.

| Zone | Effect |
|---|---|
| Engine | Less power and an oil leak (oil trail, spatter on your view); badly hit it misfires; destroyed means no power; it may catch fire |
| Left / right wing | Sluggish roll, higher stall speed, and the aircraft keeps rolling toward the damaged side; a destroyed wing breaks away, a badly damaged one folds in a fast dive |
| Tail controls | Weak elevator and rudder; destroyed means the tail is shot away |
| Fuel tank | Leaks; with no fuel the engine stops |

Each change in handling is announced in the feed. A burning aircraft loses airframe strength until the fire is blown out in a dive faster than top speed. An aircraft that loses a wing, its tail or all its strength goes down: it noses over, spins and falls fast. The loss is scored at that moment. The panel at the bottom left shows every zone. When it is your own aircraft going down, the view cuts to a cinematic shot: a fixed camera ahead of the fall, a tighter lens and letterbox bars, held on the wreck until you are back in the air.

### Day and night

The sun rises in the east at 06:00 and sets in the west at 18:00; the moon is up through the night. Both light the scene and cast shadows. Pick the starting hour and how fast the clock runs in the lobby, and nudge the time in flight with `[` and `]`. In multiplayer the host's clock applies to everyone.

### Game modes

Pick the mode on the Game tab. In multiplayer the host's mode applies to everyone.

**Zeppelin Front** (the default). Each side starts with 150 tickets and loses when it reaches 0.

- **Airships:** each side has one, patrolling a racetrack about a third of the way from its airfield toward the front. Each has 6 gas cells. Shoot a cell until it bursts into flame; fire then spreads slowly to its neighbours. With 3 cells alight the airship goes down: it noses over, falls burning and explodes on the ground. Losing it costs **50 tickets**. Its gunners defend it from the upper and lower gun positions, and flying into it is fatal.
- **Gradisca:** the ground point in the middle, between the two airfields. Fly low over it (inside the ring, below the top of the faint wall) to capture it; more of your aircraft than the enemy's makes it go faster, and equal numbers hold it contested. The side holding it drains **1 enemy ticket every 4 seconds**.
- **Aircraft:** every aircraft lost costs its side **1 ticket**.
- **Bots:** they take roles in turn: capture Gradisca, attack the enemy airship, hunt fighters, escort their own airship.
- **HUD:** the bar under the score shows each airship's gas cells and who holds Gradisca. Markers and edge arrows point to both airships and Gradisca, and the minimap shows them too.

**Dogfight.** No objectives; the first side to 30 kills wins the round.

### Controllers

Gamepads, joysticks, throttles and rudder pedals work alongside the keyboard. The start screen is the first tab of **Options** (Game, Controls, Flight, Graphics, Audio); press `Esc` in flight to reopen the others; controller settings are on the Controls tab.

The Game tab stays available in flight: press `Esc`, open the Game tab, change the mode, bots, pilots per side, start time, clock or start position, and press **Apply changes**. A new mode or number of pilots starts a fresh round; the rest take effect at once. Callsign, password, side and relay are fixed for the session. In a shared battle only the host can change the battle itself; everyone can change where they start from.

- **Assign:** press Assign next to an action, then move that control (or press that button). Each binding remembers its device, so a stick, a throttle and pedals can be mixed.
- **Standard layout:** an Xbox / PlayStation style pad is set up automatically — left stick pitch and roll, right stick rudder and throttle, right trigger fires.
- **Lever:** tick "lever" on the throttle axis when it is a real throttle lever, so its position sets the throttle directly.
- **Calibrate:** two steps — release everything to record the centres, then move every control to its end stops.
- **Dead zone / response curve:** ignore small movements near centre, and soften the response around it.

Settings are saved in the browser.

### Finding other aircraft

Aircraft in view carry a marker with name and distance: a diamond for enemies, a ring for friends. Aircraft out of view are shown by arrows on a ring round the centre of the screen, pointing the way to turn; enemy arrows are red, larger when closer, and show the distance.

### Flags and wind

Each side flies its own flag, built from flat-coloured cells (no textures): Italy's tricolore with the crowned Savoy shield, and the Austro-Hungarian imperial war ensign, red-white-red with the Austrian and Hungarian arms under a crown (simplified to fit the grid). They are on the airfield flagpoles, and the capture point flies the flag of whoever holds it, or plain white if nobody does. The flags wave in a wind that drifts slowly and gusts, and the airfield windsocks stream downwind and droop when it is light. The wind is cosmetic and does not affect flight.

### Control surfaces

The aircraft have working control surfaces: ailerons on the upper wing, an elevator behind the tailplane and a hinged rudder. Yours follow your stick, so roll right drops the left aileron and raises the right, pulling back raises the elevator, and right rudder swings the rudder to the left. Other aircraft, bots included, move theirs according to how they are turning, so you can read what a pilot is doing. A wing or tail that is badly damaged loses its surfaces.

### Weather

Pick the weather on the Game tab (and change it in flight, as host): **Fair**, **Overcast**, **Rain**, **Thunderstorm**, or **Changeable**, which drifts between them every minute or two. The weather fades in over about 15 seconds.

- **Look:** cloud cover dims the sun, greys the sky and haze, and builds a dark cloud deck. Rain streaks lean the way you are flying through them, and rain and storms close the view in. The wind in the flags and windsocks strengthens.
- **Thunderstorm:** lightning bolts and sheet lightning flash the whole sky and light the ground where they strike. Thunder follows each strike, later the further away it is, with a sharp crack from near ones. Strikes are cosmetic and cannot hit you.
- **Turbulence:** rain and storms shake your aircraft. The Flight tab has a Turbulence slider (off to 200%).
- **Sound:** Rain, Thunder and Storm wind each have a slider and Test button on the Audio tab.
- **Shared battles:** the host's weather applies to everyone. Each player's own lightning and wind are random, so strikes differ between players.

### Nav lights and jingles

At night the airfield runways light up: orange lamps along both edges, green across the threshold where the take-off run starts and red at the far end, with a flashing beacon on a mast (Italy once every four seconds, Austria-Hungary twice). They come on through the dusk and flicker a little like flames.

In Zeppelin Front a short brass fanfare plays when your side takes Gradisca, and a slow, falling phrase when it is lost to the enemy. Both have a slider, and a Test button that plays both, on the Audio tab.

### Airship cannons

The airship guns are heavy cannons: slower to fire (one shell about every 0.85 seconds, alternating barrels), with a big kick-back and a large muzzle flash, and a deep blast with a rolling rumble. A shell bursts in a puff of flak at the end of its flight or when it hits, and a hit does much more damage than a machine gun's, so one or two can cripple a system. They have their own volume slider on the Audio tab.

### Lit windows

Every house has windows. By day they are dark glass; at night about three quarters of the houses have lit rooms, which come on one by one through the dusk (in warm yellows and oranges), and about half of the houses go dark again late in the evening, between about 22:30 and 04:30. All the windows are drawn as a single instanced mesh, so they cost almost nothing.

### Hit effects and FPS

Every round of yours that strikes an enemy aircraft or airship makes a small explosion: a quick fireball, sparks, a puff of smoke and a brief flash of light on the metal around it. A counter in the top right shows the frame rate, green at 50 and above, amber at 30 and above, red below that.

### Guns and muzzle flash

Every gun flashes when it fires, and the flash lights up the hull, wings and ground around it for a moment. Aircraft carry twin machine guns on the nose that fire alternately, so the flashes alternate left and right. Each airship has four gun mounts, two on top and two slung under the gondolas: twin guns in cooling jackets with an ammunition drum and shield, a gunner at each, and a pedestal and gun ring or blister. Gunners swing their guns to follow the target between bursts, and the guns recoil with each shot.

Lights are expensive in a flat-shaded scene, so all explosions and muzzle flashes share four lights: when several flash at once, the nearest and biggest win.

### Landing and repairs

You can land: come in slowly with the wings level, the nose up a little and the throttle closed, and settle onto the wheels. A touchdown that is too hard, too fast, nose-down, on one wingtip or on a steep slope is a crash, and the message says which. Close to the ground (under about 6 m up) the wings ride a cushion of air that lowers the stall speed by up to 15%, which helps you settle onto the runway. A firm but survivable arrival is a "Hard landing" that strains the tail. You can land anywhere flat enough, but only your own airfield has ground crews:

- **Landed and rolled almost to a stop:** fast repairs and refuelling, and any fire is put out.
- **Still rolling, or a low pass under 20 m over the strip:** slower repairs, enough to patch up an aircraft on a pass or two.

Open the throttle again to take off; at speed under full power you lift off by yourself, so a touch-and-go works too.

### Handling

The flight model and chase camera come from Home Skies 1917:

- The aircraft turns by banking and holds the bank you set; there is no self-levelling.
- The flight path follows the nose only as fast as the wings can pull, so hauling back hard bleeds speed.
- Below stall speed the aircraft sinks and drops its nose; let it dive to recover.
- The camera sits behind and above and always keeps the horizon level. How lazily it follows is the "Camera smoothing" slider on the Controls tab of Options.

### Flight options

Options has a Flight tab that changes how your own aircraft handles: pitch, roll and rudder response, optional wing levelling, stall speed, top speed, how much speed hard turns cost, aircraft toughness, and inverted pitch. Presets give Forgiving, Standard and Demanding settings in one click. Bots always fly the standard model, so in a shared battle each pilot can choose their own.

### Audio options

Options has an Audio tab with a volume slider for each kind of sound: master, your engine, other aircraft (their engines and the Doppler pitch drop as they pass), wind, guns, hits and explosions. Each runs from silent to double the designed level, has a Test button, and is saved in the browser. A Mute checkbox does the same as `M`.

### Graphics options

Options has a Graphics tab: shadows on or off, shadow distance (how far from your aircraft shadows reach when you are high, up to 2000 m; further means softer shadows), and rendering scale (the resolution the 3D view is drawn at; lower is faster). Settings are saved in the browser. Adding `?shadows=0` to the URL also turns shadows off.

## Multiplayer

There is no game server. The password picks the room and encrypts the traffic.

- **Default — peer-to-peer.** [Trystero](https://github.com/dmotz/trystero) finds the other players through public Nostr relays, then game data flows directly between browsers over WebRTC. Some networks block this; if players cannot see each other, use the relay below. A TURN server can be supplied by setting `window.WOI_TURN` before the game loads.
- **Fallback — WebSocket relay.** Run `npm run relay` (port 8787, or `PORT`) on any host and have every player enter its address under "Connection options", or open the game with `?relay=wss://your-host`. The relay only forwards AES-GCM ciphertext and never sees the password.

How the game stays in sync:

- Each browser simulates its own aircraft and sends its state 15 times a second.
- The shooter decides hits; the owner of the target applies the damage and announces the kill.
- Bots and the score are run by one player (the lowest peer id). If that player leaves, the next one takes over.

Nothing here is cheat-proof; it is built for friends sharing a password.

URL parameters: `name`, `pw`, `team` (`it` / `ah`), `size` (1–6), `time` (start hour), `clock` (speed), `bots` (-1 none, 0 rookie, 1 regular, 2 ace), `start` (`air` / `runway`), `mode` (`front` / `dogfight`), `relay`, `autostart=1`, `shadows=0`.

## Layout

| Path | What |
|---|---|
| `index.html` | Lobby and HUD markup |
| `src/world.js` | Map definition: terrain height function, coastlines, airfields, balloon sectors, ground targets |
| `src/terrain.js` | Terrain, trees, sky, and the water shader for the river and sea |
| `src/objects.js` | Aircraft, balloons, airfields, towns, ground-target models |
| `src/guns.js` | Machine-gun models for the airships and aircraft, and the muzzle flash |
| `src/weather.js` | Weather: cloud deck, rain, lightning, thunder timing, turbulence |
| `src/flags.js` | The national flags, the wind, and the windsocks' motion |
| `src/front.js` | Zeppelin Front mode: airships, the Gradisca capture point, tickets, bot objectives |
| `src/plane.js` | Aircraft types, flight model, bot pilot |
| `src/gamepad.js` | Controller bindings, calibration and the setup panel |
| `src/daynight.js` | Sun, moon, stars, sky colours and the clock |
| `src/sound.js` | Engine loop playback, and synthesised wind, gun and explosion sounds |
| `assets/engine.mp3` | Propeller engine recording used for the engine note |
| `src/net.js` | Password rooms over Trystero or the WebSocket relay |
| `src/main.js` | Game loop, guns, scoring, networking, HUD |
| `server/relay.js` | Optional WebSocket relay |
| `docs/concept/` | Map concept images |

To add an aircraft, add an entry to `TYPES` in `src/plane.js` with a model builder from `src/objects.js`.

## Not in yet

Balloon sectors and ground targets are on the map as scenery only; capture zones, bombing, landing, and touch controls are still to come.

Third-party code in `vendor/` (three.js, Trystero) is MIT licensed; see the licence files there.

## Rockets and the supply balloon
Press **R** (gamepad right bumper) to fire a Le Prieur rocket from the interplane struts (8 carried, 4 per side). They hit hard: 70 damage to aircraft, 100 to an airship gas cell. A single supply balloon of rockets appears at a random time and place, marked by a pulsing golden outline around the balloon; fly through it to reload.

## The railway
One line crosses the Salcano bridge. East of it the line springs across the valley on a stone viaduct, then follows the mountain wall on a ledge cut into the slope (a gentle gradient, embankments and cuttings) down to the Santa Lucia railhead; west of it the line runs across the plain beneath Sabotino. Each end runs into a stone tunnel portal driven into a real hillside (west: the hills to the south-west; east: the slope just south of the Santa Lucia railhead). A steam train comes through every 150 seconds, alternating direction: a passenger or goods train by day, and at night the sleeper service with every window lit and a lamp on the engine. The schedule uses the wall clock, so everyone sees the same train. The line is on the minimap, with the train shown as a small marker while it runs. Trees and houses keep clear of the track (`src/world.js` plans the route, `src/railway.js` builds it).

## God camera (developer)
Press **F9** to detach the camera. The mouse looks around (the pointer is captured), the arrow keys fly it (up/down forward and back, left/right sideways), **R / F** or **PageUp / PageDown** rise and fall, **Shift** is fast, **Ctrl** is slow, and the mouse wheel changes the speed. Your aircraft is held in place and cannot be hurt while it is on; everything else carries on. Press **F9** again to return.

## Vapour trails
An aircraft diving faster than 200 km/h trails coloured vapour from both wingtips (blue for Italy, red for Austria-Hungary), which tapers to a point and fades over a couple of seconds. It applies to every aircraft, bots and other players included.

## Shooting the train and the balloons
The train can be destroyed: any round that strikes it does damage (240 points; two rockets, about ten cannon shells or a long burst of machine-gun fire). When it goes it stops, blows up in a chain of explosions, goes dark and burns for about a minute, then the timetable brings a fresh train at its next departure. The damage and the explosion are shared with other players. The observation balloons now ride the wind, leaning and drifting downwind with their noses into it, with the cable following. Rounds that hit one burst on its surface and shove it; a rocket also sets it spinning, and it swings back afterwards.

## Airship guns and gondolas
Each airship's four gun mounts and two engine gondolas have hit boxes of their own, separate from the gas cells. A mount has 60 points (a rocket or three shells destroys it), a gondola 200. A destroyed mount stops firing and smoulders. Destroying a gondola also takes out the gun slung under it and slows the airship by 40% (it loses an engine). None of this brings the airship down on its own; that still takes burning three gas cells.

## Scoreboard
Hold **Tab** for the scoreboard: every pilot, bots included, ranked by kills, then fewest deaths, with kills, deaths and kill/death ratio, the team score or tickets at the top and your own line highlighted. It also appears on its own when a round is won. Kills and deaths are counted from the kill messages every player receives, so everyone sees the same table.

## Thunder
Thunder uses three recorded claps (`assets/thunder1.mp3` to `thunder3.mp3`). One is picked at random for each lightning strike (never the same one twice running), pitched a little differently each time, and made quieter and duller the further away the strike is. The clap follows the flash closely: almost at once for a near strike, within about a second for a distant one. The old synthesised thunder remains only as a fallback while the recordings load.

## Win conditions
The Game tab has **Kills to win** (Dogfight: anywhere from 3 to 20, default 10) and **Tickets per side** (Zeppelin Front: 50, 100, 150, 200, 300 or 500). The host chooses them and everyone follows. Losing an airship costs a third of the starting tickets, so it stays proportionate. Changing the kill target applies at once; changing the tickets restarts a Zeppelin Front round.

## Keyboard and mouse controls
The default scheme is Battlefield-style: click the game to capture the mouse, then the **mouse** pitches and rolls (it moves a virtual stick, shown as a dot in a ring, that drifts back to centre; the Controls tab has sensitivity and centring sliders, and centring 0 holds the stick wherever you leave it), **W / S** raise and lower the throttle, **A / D** are the rudder, **Q / E** roll, **left click** or **Space** fires the guns and **right click** or **R** fires a rocket. The arrow keys still pitch and roll. A **Classic** scheme (W S pitch, A D roll, Q E rudder, Shift / Ctrl throttle) is a menu choice on the Controls tab. Controller support is unchanged and works alongside either scheme.
