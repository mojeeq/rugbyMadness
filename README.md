# Rugby Madness

Rugby Madness is a fast, full-3D browser rugby game. One human controls each team while server-controlled teammates maintain attacking lines, chase, support, defend and contest possession.

This repository is the first playable foundation. It includes:

- Rugby Sevens with 7 players per team, rucks and converted five-point tries
- Rugby League with 13 players per team, six-tackle sets and converted four-point tries
- 15-a-side Rugby Union with rucks and converted five-point tries
- A 3D night stadium, moving players, goalposts, crowd, broadcast camera and tactical radar
- Solo practice against AI
- Online head-to-head rooms using five-character invite codes
- Server-authoritative movement, passing, kicking, tackling, scoring and match clock
- Docker deployment for Ubuntu

## Controls

| Action | Key |
| --- | --- |
| Move | `W`, `A`, `S`, `D` or arrow keys |
| Sprint | `Shift` |
| Pass left | `Q` |
| Pass right | `E` |
| Tackle | `Space` |
| Kick in play | `K` |

The active player switches automatically. In attack, you control the ball carrier. In defence, you control the defender nearest the ball.

## Run locally

Requires Node.js 22 or later.

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in a browser. Open a second browser or private window to test an online room on the same computer.

## Install on an Ubuntu server with Docker

Install Docker if it is not already available:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
```

Clone your GitHub repository and enter the project directory. Replace the
example address with the URL of the repository you create:

```bash
git clone https://github.com/YOUR_USERNAME/rugby-madness.git
cd rugby-madness
cp .env.example .env
```

Build and start Rugby Madness:

```bash
sudo docker compose up -d --build
sudo docker compose ps
```

The game will be available at:

```text
http://YOUR_SERVER_IP:3000
```

If UFW is enabled, allow the port:

```bash
sudo ufw allow 3000/tcp
```

To use another public port, edit `.env` and change `GAME_PORT`. For example,
`GAME_PORT=8080` publishes the game at `http://YOUR_SERVER_IP:8080` while the
container continues to use port 3000 internally.

To update after pulling new code:

```bash
git pull
sudo docker compose up -d --build
```

To view server output:

```bash
sudo docker compose logs -f rugby-madness
```

## Domain and HTTPS

For a public game, put a reverse proxy in front of port 3000. An Nginx example is included at `deploy/nginx-rugby-madness.conf`; replace `rugby.example.com` with your domain. The WebSocket upgrade headers in that file are required for live multiplayer.

After enabling the Nginx site, use Certbot to add HTTPS. Set `PUBLIC_ORIGIN` to the final HTTPS address if you want to restrict browser connections to that origin.

## Create the GitHub repository

1. Extract the ZIP on your computer.
2. Create an empty repository on GitHub named `rugby-madness`.
3. Upload the extracted files and folders, including the files whose names begin with a dot.
4. Commit them to the repository's default branch.

If you prefer the command line, run these commands from the extracted project
directory after creating the empty GitHub repository:

```bash
git init
git add .
git commit -m "Initial Rugby Madness release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/rugby-madness.git
git push -u origin main
```

## Production build without Docker

```bash
npm ci
npm run build
NODE_ENV=production PORT=3000 npm start
```

Use a process manager such as systemd or Docker so the server restarts after a reboot.

## Project structure

```text
client/          Browser interface and Three.js renderer
server/          Socket.IO rooms and authoritative match simulation
shared/          Rule configurations shared across the project
test/            Rule and game-engine checks
deploy/          Ubuntu reverse-proxy example
Dockerfile       Reproducible production container
docker-compose.yml
```

## Current gameplay boundary

This milestone proves the common game engine and multiplayer loop. Scrums, contested lineouts, manual place kicks, penalties, advantage, knock-ons, drop goals, substitutions, player attributes, animation assets and persistent accounts are planned layers rather than completed features. The current conversion is automatic after a try.

See `GAME_DESIGN.md` for the product direction and staged roadmap.

## Verify the project

```bash
npm test
npm run test:multiplayer
npm run build
```
