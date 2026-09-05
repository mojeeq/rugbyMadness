# Rugby Madness — Game Design

## Product vision

Rugby Madness is an accessible, fast arcade rugby game that respects the identity and essential rules of Rugby Sevens, Rugby League and 15-a-side Rugby Union. It runs entirely in a modern browser and can be hosted on a modest Ubuntu server.

The experience should feel energetic within seconds: choose a code, enter the stadium and take control. Rule differences should be visible in play rather than hidden in menus.

## Chosen direction

| Design decision | Direction |
| --- | --- |
| Camera | Full 3D stadium with a trailing broadcast camera |
| Multiplayer | One human per team; AI controls every other athlete |
| Game feel | Fast arcade movement with recognisable rugby rules |
| Initial controls | Desktop keyboard |
| Matchmaking | Private rooms with short invite codes |
| Deployment | Docker on Ubuntu; one Node.js service |

## Core match loop

1. Select Sevens, League or Union.
2. Practise against AI or create/join an online room.
3. The server starts the match when both online players are present.
4. The human controls the ball carrier in possession and the nearest defender without possession.
5. AI teammates form support lines, cover space, chase kicks and pressure the ball.
6. Tries, conversions, half-time and full-time decide the result.

## Code-specific identity

| System | Sevens | League | Union |
| --- | --- | --- | --- |
| Players per team | 7 | 13 | 15 |
| Try | 5 points | 4 points | 5 points |
| Conversion | 2 points | 2 points | 2 points |
| After tackle | Quick ruck | Play-the-ball | Ruck |
| Possession pressure | Isolation can cause a jackal | Handover after tackle six | Isolation can cause a jackal |
| Arcade half length | 3 minutes | 4 minutes | 4 minutes |

## Design principles

- **Readable before realistic:** players, possession, legal support options and scoring zones must be easy to read from the 3D camera.
- **One shared engine:** movement, ball physics, rooms, rendering and AI stay common; rule modules define each code.
- **Server decides outcomes:** clients send inputs while the server owns positions, possession, clock and score.
- **Short recovery:** tackles and restarts pause only briefly so matches keep moving.
- **Progressive realism:** add deeper laws in layers without making the first playable build brittle.

## Visual direction

Night-match atmosphere with hard stadium lighting, deep green-black surfaces and high-visibility team colours. Home wears electric green; Away wears coral red. Interfaces borrow from televised score graphics rather than generic web dashboards. The selected athlete carries a gold ring and every player has an overhead squad number.

## Development roadmap

### Milestone 1 — Playable foundation (included)

- 3D stadium and broadcast camera
- Three selectable rugby codes
- Keyboard movement, sprinting, passing, kicking and tackling
- AI support and defensive movement
- Scoring, halves, match results and basic restarts
- Solo practice and two-player online rooms
- Ubuntu Docker deployment

### Milestone 2 — Rugby laws and feel

- Knock-ons and forward-pass calls
- Manual conversions, penalty kicks and drop goals
- Contested lineouts and scrums for Union/Sevens
- League play-the-ball animation, markers and ten-metre defensive line
- Advantage, penalties and sin-bin system
- Better ball catches, offloads and tackle outcomes

### Milestone 3 — Animation and presentation

- Rigged athlete models and animation blending
- Tackle, sidestep, fend, dive, ruck and celebration animations
- Stadium audio, referee calls and match commentary cues
- Team kits, flags, player attributes and formations
- Gamepad and mobile touch controls

### Milestone 4 — Online platform

- Public matchmaking and reconnect windows
- Accounts, team records, rankings and leaderboards
- Spectators and match replays
- Anti-cheat hardening and server metrics
- Redis-backed rooms and horizontal scaling

## Technical architecture

The browser renders the stadium with Three.js and sends compact control inputs through Socket.IO. A Node.js server owns each match, advances the simulation 20 times per second and broadcasts snapshots to the two players. Express serves the compiled browser client. The complete application runs in a single Docker container for the initial release.

For larger traffic, room state can later be distributed through Redis and multiple Node.js game processes without rewriting the browser renderer or rugby rule configurations.
