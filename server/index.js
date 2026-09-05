import crypto from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { GAME_MODES } from "../shared/config.js";
import { createMatch } from "./game.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(path.dirname(currentFile));
const production = process.env.NODE_ENV === "production";

function commandLineOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const commandLinePort = Number(commandLineOption("port"));
const port = Number(process.env.PORT) || (Number.isFinite(commandLinePort) ? commandLinePort : 3000);
const host = commandLineOption("host") || "0.0.0.0";
const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const app = express();
app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.json({ ok: true, game: "Rugby Madness", rooms: matches.size });
});

const httpServer = createServer(app);
const allowedOrigins = process.env.PUBLIC_ORIGIN
  ? process.env.PUBLIC_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : true;
const io = new SocketServer(httpServer, {
  cors: { origin: allowedOrigins },
  maxHttpBufferSize: 20_000,
  pingInterval: 15_000,
  pingTimeout: 10_000,
});

const matches = new Map();
const sessions = new Map();

function randomRoomCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let index = 0; index < 5; index += 1) {
      code += roomAlphabet[crypto.randomInt(roomAlphabet.length)];
    }
    if (!matches.has(code)) return code;
  }
  throw new Error("Could not allocate a room code");
}

function resolveMode(modeId) {
  return GAME_MODES[modeId] ? modeId : "sevens";
}

function acknowledge(callback, payload) {
  if (typeof callback === "function") callback(payload);
}

function leaveCurrentMatch(socket) {
  const session = sessions.get(socket.id);
  if (!session) return;
  const match = matches.get(session.roomCode);
  match?.removeHuman(socket.id);
  socket.leave(session.roomCode);
  sessions.delete(socket.id);
  if (match?.solo && match.hasNoHumans()) matches.delete(session.roomCode);
}

function assignSocket(socket, match, team) {
  sessions.set(socket.id, { roomCode: match.roomCode, team });
  socket.join(match.roomCode);
  socket.emit("room-assigned", {
    roomCode: match.roomCode,
    team,
    modeId: match.modeId,
    solo: match.solo,
  });
}

io.on("connection", (socket) => {
  socket.emit("server-ready", { version: "0.1.0" });

  socket.on("practice", (payload = {}, callback) => {
    leaveCurrentMatch(socket);
    const roomCode = `P-${crypto.randomUUID().slice(0, 8)}`;
    const match = createMatch({
      id: crypto.randomUUID(),
      roomCode,
      modeId: resolveMode(payload.modeId),
      solo: true,
    });
    matches.set(roomCode, match);
    const team = match.addHuman(socket.id, payload.name);
    assignSocket(socket, match, team);
    acknowledge(callback, { ok: true, roomCode, team });
  });

  socket.on("create-room", (payload = {}, callback) => {
    leaveCurrentMatch(socket);
    try {
      const roomCode = randomRoomCode();
      const match = createMatch({
        id: crypto.randomUUID(),
        roomCode,
        modeId: resolveMode(payload.modeId),
        solo: false,
      });
      matches.set(roomCode, match);
      const team = match.addHuman(socket.id, payload.name);
      assignSocket(socket, match, team);
      acknowledge(callback, { ok: true, roomCode, team });
    } catch {
      acknowledge(callback, { ok: false, message: "Could not create a match. Please try again." });
    }
  });

  socket.on("join-room", (payload = {}, callback) => {
    const roomCode = String(payload.roomCode ?? "").trim().toUpperCase().slice(0, 5);
    const match = matches.get(roomCode);
    if (!match || match.solo) {
      acknowledge(callback, { ok: false, message: "That match code was not found." });
      return;
    }
    if (match.status !== "waiting" || match.humans.away) {
      acknowledge(callback, { ok: false, message: "That match is already full or underway." });
      return;
    }

    leaveCurrentMatch(socket);
    const team = match.addHuman(socket.id, payload.name);
    if (!team) {
      acknowledge(callback, { ok: false, message: "That match is full." });
      return;
    }
    assignSocket(socket, match, team);
    acknowledge(callback, { ok: true, roomCode, team, modeId: match.modeId });
  });

  socket.on("input", (input = {}) => {
    const session = sessions.get(socket.id);
    const match = session && matches.get(session.roomCode);
    match?.setInput(session.team, input);
  });

  socket.on("action", (action) => {
    if (!["pass-left", "pass-right", "kick", "tackle"].includes(action)) return;
    const session = sessions.get(socket.id);
    const match = session && matches.get(session.roomCode);
    match?.performAction(session.team, action);
  });

  socket.on("restart-match", () => {
    const session = sessions.get(socket.id);
    const match = session && matches.get(session.roomCode);
    if (match?.status === "finished") match.restart();
  });

  socket.on("leave-match", () => leaveCurrentMatch(socket));
  socket.on("disconnect", () => leaveCurrentMatch(socket));
});

let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const delta = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  for (const [roomCode, match] of matches) {
    match.update(delta);
    io.to(roomCode).emit("snapshot", match.snapshot());
    const abandonedFor = Date.now() - match.lastHumanAt;
    if (match.hasNoHumans() && abandonedFor > 60_000) matches.delete(roomCode);
  }
}, 50).unref();

if (production) {
  const distDirectory = path.join(projectRoot, "dist");
  app.use(express.static(distDirectory, { maxAge: "1h", etag: true }));
  app.use((request, response, next) => {
    if (request.method === "GET" && request.accepts("html")) {
      response.sendFile(path.join(distDirectory, "index.html"));
      return;
    }
    next();
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: path.join(projectRoot, "client"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ ok: false, message: "Unexpected server error" });
});

httpServer.listen(port, host, () => {
  console.log(`Rugby Madness is running on port ${port}`);
});
