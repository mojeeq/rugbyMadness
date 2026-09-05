import { io } from "socket.io-client";
import { RugbyRenderer } from "./game-renderer.js";
import "./styles.css";

const elements = {
  viewport: document.querySelector("#viewport"),
  startScreen: document.querySelector("#start-screen"),
  waitingScreen: document.querySelector("#waiting-screen"),
  resultScreen: document.querySelector("#result-screen"),
  matchHud: document.querySelector("#match-hud"),
  matchMeta: document.querySelector("#match-meta"),
  controls: document.querySelector("#controls"),
  exitMatch: document.querySelector("#exit-match"),
  modeButtons: [...document.querySelectorAll(".mode-card")],
  playerName: document.querySelector("#player-name"),
  practiceButton: document.querySelector("#practice-button"),
  createButton: document.querySelector("#create-button"),
  joinForm: document.querySelector("#join-form"),
  roomCodeInput: document.querySelector("#room-code"),
  menuError: document.querySelector("#menu-error"),
  copyCode: document.querySelector("#copy-code"),
  cancelWaiting: document.querySelector("#cancel-waiting"),
  homeName: document.querySelector("#home-name"),
  awayName: document.querySelector("#away-name"),
  homeScore: document.querySelector("#home-score"),
  awayScore: document.querySelector("#away-score"),
  modeLabel: document.querySelector("#mode-label"),
  clock: document.querySelector("#clock"),
  halfLabel: document.querySelector("#half-label"),
  eventBanner: document.querySelector("#event-banner"),
  connectionState: document.querySelector("#connection-state"),
  possessionLabel: document.querySelector("#possession-label"),
  tackleLabel: document.querySelector("#tackle-label"),
  radar: document.querySelector("#radar"),
  resultTitle: document.querySelector("#result-title"),
  resultHome: document.querySelector("#result-home"),
  resultAway: document.querySelector("#result-away"),
  rematchButton: document.querySelector("#rematch-button"),
  returnMenu: document.querySelector("#return-menu"),
};

const renderer = new RugbyRenderer(elements.viewport);
const socket = io({ reconnectionDelayMax: 4_000 });
const keys = new Set();
const radarContext = elements.radar.getContext("2d");

let selectedMode = "sevens";
let localTeam = "home";
let latestSnapshot = null;
let activeRoomCode = null;
let inMatch = false;
let eventSequence = -1;
let eventTimeout = null;

const savedName = window.localStorage.getItem("rugby-madness-player-name");
if (savedName) elements.playerName.value = savedName;

function playerName() {
  const name = elements.playerName.value.trim().slice(0, 18) || "Player One";
  elements.playerName.value = name;
  window.localStorage.setItem("rugby-madness-player-name", name);
  return name;
}

function setMenuBusy(busy) {
  elements.practiceButton.disabled = busy;
  elements.createButton.disabled = busy;
  elements.roomCodeInput.disabled = busy;
  elements.joinForm.querySelector("button").disabled = busy;
}

function showMenuError(message = "") {
  elements.menuError.textContent = message;
}

function hide(element) {
  element.classList.add("hidden");
}

function show(element) {
  element.classList.remove("hidden");
}

function showStartScreen() {
  inMatch = false;
  latestSnapshot = null;
  activeRoomCode = null;
  keys.clear();
  renderer.showLobbyView();
  show(elements.startScreen);
  hide(elements.waitingScreen);
  hide(elements.resultScreen);
  hideGameInterface();
  showMenuError();
}

function showWaiting(code) {
  activeRoomCode = code;
  elements.copyCode.textContent = code;
  hide(elements.startScreen);
  show(elements.waitingScreen);
  hide(elements.resultScreen);
  hideGameInterface();
}

function showMatch() {
  inMatch = true;
  hide(elements.startScreen);
  hide(elements.waitingScreen);
  hide(elements.resultScreen);
  show(elements.matchHud);
  show(elements.matchMeta);
  show(elements.controls);
  show(elements.exitMatch);
  show(elements.radar);
}

function showResult(snapshot) {
  inMatch = false;
  hide(elements.controls);
  elements.resultHome.textContent = snapshot.score.home;
  elements.resultAway.textContent = snapshot.score.away;
  if (snapshot.score.home === snapshot.score.away) elements.resultTitle.textContent = "DRAW";
  else elements.resultTitle.textContent = `${snapshot.score.home > snapshot.score.away ? "HOME" : "AWAY"} WIN`;
  show(elements.resultScreen);
}

function hideGameInterface() {
  hide(elements.matchHud);
  hide(elements.matchMeta);
  hide(elements.controls);
  hide(elements.exitMatch);
  hide(elements.radar);
  hide(elements.eventBanner);
}

function leaveMatch() {
  socket.emit("leave-match");
  showStartScreen();
}

function beginRequest(event, payload, onSuccess) {
  if (!socket.connected) {
    showMenuError("The game server is not connected yet. Please try again in a moment.");
    return;
  }
  setMenuBusy(true);
  showMenuError();
  socket.timeout(7_000).emit(event, payload, (error, response) => {
    setMenuBusy(false);
    if (error) {
      showMenuError("The server did not respond. Please try again.");
      return;
    }
    if (!response?.ok) {
      showMenuError(response?.message || "Could not start the match.");
      return;
    }
    onSuccess(response);
  });
}

for (const button of elements.modeButtons) {
  button.addEventListener("click", () => {
    selectedMode = button.dataset.mode;
    for (const candidate of elements.modeButtons) {
      const selected = candidate === button;
      candidate.classList.toggle("selected", selected);
      candidate.setAttribute("aria-pressed", String(selected));
    }
  });
}

elements.practiceButton.addEventListener("click", () => {
  beginRequest("practice", { modeId: selectedMode, name: playerName() }, () => showMatch());
});

elements.createButton.addEventListener("click", () => {
  beginRequest("create-room", { modeId: selectedMode, name: playerName() }, (response) => {
    showWaiting(response.roomCode);
  });
});

elements.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const roomCode = elements.roomCodeInput.value.trim().toUpperCase();
  if (roomCode.length !== 5) {
    showMenuError("Enter the five-character match code.");
    return;
  }
  beginRequest("join-room", { roomCode, name: playerName() }, () => showMatch());
});

elements.roomCodeInput.addEventListener("input", () => {
  elements.roomCodeInput.value = elements.roomCodeInput.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 5);
});

elements.copyCode.addEventListener("click", async () => {
  if (!activeRoomCode) return;
  try {
    await navigator.clipboard.writeText(activeRoomCode);
    elements.copyCode.textContent = "COPIED";
    window.setTimeout(() => {
      elements.copyCode.textContent = activeRoomCode;
    }, 1_100);
  } catch {
    elements.copyCode.setSelectionRange?.(0, activeRoomCode.length);
  }
});

elements.cancelWaiting.addEventListener("click", leaveMatch);
elements.exitMatch.addEventListener("click", leaveMatch);
elements.returnMenu.addEventListener("click", leaveMatch);
elements.rematchButton.addEventListener("click", () => {
  hide(elements.resultScreen);
  socket.emit("restart-match");
});

socket.on("room-assigned", (assignment) => {
  localTeam = assignment.team;
  activeRoomCode = assignment.roomCode;
});

socket.on("snapshot", (snapshot) => {
  latestSnapshot = snapshot;
  renderer.setMatch(snapshot, localTeam);
  updateHud(snapshot);
  drawRadar(snapshot);

  if (snapshot.status === "waiting") {
    showWaiting(snapshot.roomCode);
  } else if (snapshot.status === "playing") {
    showMatch();
  } else if (snapshot.status === "finished") {
    showResult(snapshot);
  }
});

socket.on("connect", () => updateConnection(true));
socket.on("disconnect", () => updateConnection(false));
socket.on("connect_error", () => updateConnection(false));

function updateConnection(connected) {
  elements.connectionState.classList.toggle("offline", !connected);
  elements.connectionState.lastChild.textContent = connected ? " Connected" : " Reconnecting";
}

function updateHud(snapshot) {
  elements.homeName.textContent = snapshot.humanNames.home || "HOME";
  elements.awayName.textContent = snapshot.humanNames.away || "AWAY";
  elements.homeScore.textContent = snapshot.score.home;
  elements.awayScore.textContent = snapshot.score.away;
  elements.modeLabel.textContent = snapshot.modeLabel.toUpperCase();
  elements.clock.textContent = formatClock(snapshot.clock);
  elements.halfLabel.textContent = snapshot.half === 1 ? "1ST HALF" : "2ND HALF";
  elements.possessionLabel.textContent = `${snapshot.possession.toUpperCase()} BALL`;
  elements.tackleLabel.textContent = snapshot.tackleLimit
    ? `TACKLE ${snapshot.tackleCount} / ${snapshot.tackleLimit}`
    : snapshot.rules.breakdown === "ruck"
      ? "RUCK RULES"
      : "";

  if (snapshot.event.sequence !== eventSequence) {
    eventSequence = snapshot.event.sequence;
    showEvent(snapshot.event.text, snapshot.event.tone);
  }
}

function formatClock(seconds) {
  const rounded = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function showEvent(text, tone) {
  window.clearTimeout(eventTimeout);
  elements.eventBanner.textContent = text;
  elements.eventBanner.dataset.tone = tone;
  show(elements.eventBanner);
  eventTimeout = window.setTimeout(() => hide(elements.eventBanner), tone === "score" ? 2_400 : 1_650);
}

function drawRadar(snapshot) {
  const width = elements.radar.width;
  const height = elements.radar.height;
  const margin = 10;
  const pitchWidth = width - margin * 2;
  const pitchHeight = height - margin * 2;
  const direction = snapshot.directions[localTeam] ?? 1;
  radarContext.clearRect(0, 0, width, height);
  radarContext.fillStyle = "rgba(6, 31, 21, 0.96)";
  radarContext.fillRect(0, 0, width, height);
  radarContext.strokeStyle = "rgba(230, 255, 244, 0.58)";
  radarContext.lineWidth = 1;
  radarContext.strokeRect(margin, margin, pitchWidth, pitchHeight);
  radarContext.beginPath();
  radarContext.moveTo(margin, height / 2);
  radarContext.lineTo(width - margin, height / 2);
  radarContext.stroke();

  const mapPoint = (x, z) => {
    const viewX = x * direction;
    const viewZ = z * direction;
    return {
      x: margin + ((viewX + 34) / 68) * pitchWidth,
      y: margin + (1 - (viewZ + 58) / 116) * pitchHeight,
    };
  };

  for (const player of snapshot.players) {
    const point = mapPoint(player.x, player.z);
    const controlled = snapshot.controlled[localTeam] === player.id;
    if (controlled) {
      radarContext.beginPath();
      radarContext.arc(point.x, point.y, 5.1, 0, Math.PI * 2);
      radarContext.strokeStyle = "#ffe665";
      radarContext.lineWidth = 2;
      radarContext.stroke();
    }
    radarContext.beginPath();
    radarContext.arc(point.x, point.y, 2.8, 0, Math.PI * 2);
    radarContext.fillStyle = player.team === "home" ? "#43f5b5" : "#ff5b67";
    radarContext.fill();
  }

  const ball = mapPoint(snapshot.ball.x, snapshot.ball.z);
  radarContext.beginPath();
  radarContext.arc(ball.x, ball.y, 2.3, 0, Math.PI * 2);
  radarContext.fillStyle = "#ffffff";
  radarContext.fill();
}

const keyMap = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "backward",
  ArrowDown: "backward",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
};

const actionMap = {
  KeyQ: "pass-left",
  KeyE: "pass-right",
  KeyK: "kick",
  Space: "tackle",
};

window.addEventListener("keydown", (event) => {
  if (!inMatch || event.target instanceof HTMLInputElement) return;
  if (keyMap[event.code] || actionMap[event.code]) event.preventDefault();
  if (keyMap[event.code]) keys.add(keyMap[event.code]);
  if (actionMap[event.code] && !event.repeat) socket.emit("action", actionMap[event.code]);
});

window.addEventListener("keyup", (event) => {
  if (keyMap[event.code]) keys.delete(keyMap[event.code]);
});

window.addEventListener("blur", () => keys.clear());

window.setInterval(() => {
  if (!inMatch || !socket.connected || latestSnapshot?.status !== "playing") return;
  socket.emit("input", {
    forward: keys.has("forward"),
    backward: keys.has("backward"),
    left: keys.has("left"),
    right: keys.has("right"),
    sprint: keys.has("sprint"),
  });
}, 50);

renderer.showLobbyView();
updateConnection(socket.connected);
