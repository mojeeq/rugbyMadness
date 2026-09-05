import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { io } from "socket.io-client";

const port = 3217;
const serverUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 8_000);
    const handleOutput = (chunk) => {
      const text = chunk.toString();
      if (text.includes("Rugby Madness is running")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    server.stdout.on("data", handleOutput);
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited during startup with code ${code}`));
    });
  });
}

function connectClient() {
  const socket = io(serverUrl, { forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Client connection timed out")), 5_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(4_000).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function nextSnapshot(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Snapshot timed out")), 5_000);
    socket.once("snapshot", (snapshot) => {
      clearTimeout(timeout);
      resolve(snapshot);
    });
  });
}

let host;
let guest;
try {
  await waitForServer();
  const health = await fetch(`${serverUrl}/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  [host, guest] = await Promise.all([connectClient(), connectClient()]);
  const created = await emitWithAck(host, "create-room", { modeId: "union", name: "Host" });
  assert.equal(created.ok, true);
  const joined = await emitWithAck(guest, "join-room", { roomCode: created.roomCode, name: "Guest" });
  assert.equal(joined.ok, true);
  const snapshot = await nextSnapshot(host);
  assert.equal(snapshot.status, "playing");
  assert.equal(snapshot.modeId, "union");
  assert.equal(snapshot.players.length, 30);
  assert.deepEqual(snapshot.humansConnected, { home: true, away: true });
  console.log("Health check and two-player room flow passed");
} finally {
  host?.disconnect();
  guest?.disconnect();
  server.kill("SIGTERM");
}
