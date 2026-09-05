import assert from "node:assert/strict";
import { io } from "socket.io-client";

const serverUrl = process.argv[2] || "http://127.0.0.1:3000";
const host = io(serverUrl, { forceNew: true, reconnection: false });
const guest = io(serverUrl, { forceNew: true, reconnection: false });

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Could not connect to ${serverUrl}`)), 5_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
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
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for a match snapshot")), 5_000);
    socket.once("snapshot", (snapshot) => {
      clearTimeout(timeout);
      resolve(snapshot);
    });
  });
}

try {
  await Promise.all([
    waitForConnect(host),
    waitForConnect(guest),
  ]);
  const created = await emitWithAck(host, "create-room", { modeId: "sevens", name: "Host" });
  assert.equal(created.ok, true);
  assert.equal(created.roomCode.length, 5);
  const joined = await emitWithAck(guest, "join-room", { roomCode: created.roomCode, name: "Guest" });
  assert.equal(joined.ok, true);
  const snapshot = await nextSnapshot(host);
  assert.equal(snapshot.status, "playing");
  assert.equal(snapshot.players.length, 14);
  assert.equal(snapshot.humansConnected.home, true);
  assert.equal(snapshot.humansConnected.away, true);
  console.log(`Multiplayer smoke test passed for room ${created.roomCode}`);
} finally {
  host.disconnect();
  guest.disconnect();
}
