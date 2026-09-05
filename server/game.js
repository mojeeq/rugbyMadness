import {
  FIELD,
  GAME_MODES,
  TEAM_AWAY,
  TEAM_HOME,
  attackDirection,
  getMode,
  oppositeTeam,
} from "../shared/config.js";

const BASE_SPEED = 8.4;
const SPRINT_SPEED = 11.4;
const AI_CARRIER_SPEED = 7.1;
const PLAYER_LIMIT_X = FIELD.touchX + 1.4;
const PLAYER_LIMIT_Z = FIELD.deadBallZ - 0.8;
const EMPTY_INPUT = Object.freeze({
  forward: false,
  backward: false,
  left: false,
  right: false,
  sprint: false,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function normalise(x, z) {
  const length = Math.hypot(x, z);
  return length > 0.0001 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function safeName(name, fallback) {
  const cleaned = String(name ?? "")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .trim()
    .slice(0, 18);
  return cleaned || fallback;
}

function rowLayout(index, count) {
  const rowSize = count <= 7 ? 3 : 5;
  const row = Math.floor(index / rowSize);
  const inRow = index % rowSize;
  const rows = Math.ceil(count / rowSize);
  const playersInThisRow = row === rows - 1 ? count - row * rowSize : rowSize;
  const lane = playersInThisRow === 1 ? 0 : inRow / (playersInThisRow - 1) - 0.5;
  return { row, x: lane * 49 };
}

function emptyBall() {
  return {
    x: 0,
    y: 1.25,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    carrierId: null,
    targetId: null,
    lastTeam: TEAM_HOME,
  };
}

export class Match {
  constructor({ id, roomCode, modeId = "sevens", solo = false }) {
    this.id = id;
    this.roomCode = roomCode;
    this.modeId = GAME_MODES[modeId] ? modeId : "sevens";
    this.mode = getMode(this.modeId);
    this.solo = solo;
    this.humans = { [TEAM_HOME]: null, [TEAM_AWAY]: null };
    this.humanNames = { [TEAM_HOME]: "Home", [TEAM_AWAY]: solo ? "CPU" : "Away" };
    this.inputs = { [TEAM_HOME]: { ...EMPTY_INPUT }, [TEAM_AWAY]: { ...EMPTY_INPUT } };
    this.controlled = { [TEAM_HOME]: null, [TEAM_AWAY]: null };
    this.players = [];
    this.ball = emptyBall();
    this.score = { [TEAM_HOME]: 0, [TEAM_AWAY]: 0 };
    this.half = 1;
    this.clock = this.mode.halfSeconds;
    this.status = solo ? "playing" : "waiting";
    this.phase = solo ? "KICK-OFF" : "WAITING FOR CHALLENGER";
    this.possession = TEAM_HOME;
    this.tackleCount = 0;
    this.pauseRemaining = 0;
    this.pendingRestart = null;
    this.tackleGrace = 1.2;
    this.passCooldown = 0;
    this.simulationTime = 0;
    this.eventSequence = 0;
    this.event = { text: this.phase, tone: "neutral", sequence: 0 };
    this.createdAt = Date.now();
    this.lastHumanAt = Date.now();
    this.#createSquads();
    this.#resetFormation(TEAM_HOME);
  }

  addHuman(socketId, name) {
    let team = null;
    if (!this.humans[TEAM_HOME]) team = TEAM_HOME;
    else if (!this.humans[TEAM_AWAY] && !this.solo) team = TEAM_AWAY;
    if (!team) return null;

    this.humans[team] = socketId;
    this.humanNames[team] = safeName(name, team === TEAM_HOME ? "Home" : "Away");
    this.lastHumanAt = Date.now();
    if (this.solo || (this.humans[TEAM_HOME] && this.humans[TEAM_AWAY])) this.start();
    return team;
  }

  removeHuman(socketId) {
    for (const team of [TEAM_HOME, TEAM_AWAY]) {
      if (this.humans[team] !== socketId) continue;
      this.humans[team] = null;
      this.inputs[team] = { ...EMPTY_INPUT };
      this.lastHumanAt = Date.now();
      if (this.status === "playing" && !this.solo) {
        this.#announce(`${this.humanNames[team]} disconnected — AI takes over`, "warning");
      }
      return team;
    }
    return null;
  }

  start() {
    if (this.status === "playing") return;
    this.status = "playing";
    this.phase = "KICK-OFF";
    this.#announce(`${this.mode.shortLabel} — KICK-OFF`, "accent");
    this.#resetFormation(TEAM_HOME);
  }

  restart() {
    this.score = { [TEAM_HOME]: 0, [TEAM_AWAY]: 0 };
    this.half = 1;
    this.clock = this.mode.halfSeconds;
    this.status = this.solo || (this.humans[TEAM_HOME] && this.humans[TEAM_AWAY]) ? "playing" : "waiting";
    this.phase = this.status === "playing" ? "KICK-OFF" : "WAITING FOR CHALLENGER";
    this.tackleCount = 0;
    this.pauseRemaining = 0;
    this.pendingRestart = null;
    this.tackleGrace = 1.2;
    this.#resetFormation(TEAM_HOME);
    this.#announce(this.phase, "accent");
  }

  setInput(team, input = {}) {
    if (!this.humans[team]) return;
    this.inputs[team] = {
      forward: input.forward === true,
      backward: input.backward === true,
      left: input.left === true,
      right: input.right === true,
      sprint: input.sprint === true,
    };
  }

  performAction(team, action) {
    if (this.status !== "playing" || this.pauseRemaining > 0 || !this.humans[team]) return;
    const controlled = this.#getPlayer(this.controlled[team]);
    if (!controlled) return;

    if (action === "pass-left" || action === "pass-right") {
      if (this.ball.carrierId === controlled.id && this.passCooldown <= 0) {
        this.#passBall(controlled, action === "pass-left" ? -1 : 1);
      }
      return;
    }

    if (action === "kick" && this.ball.carrierId === controlled.id && this.passCooldown <= 0) {
      this.#kickBall(controlled);
      return;
    }

    if (action === "tackle" && this.ball.carrierId) {
      const carrier = this.#getPlayer(this.ball.carrierId);
      if (carrier && carrier.team !== team && distanceSquared(controlled, carrier) <= 5.3) {
        this.#resolveTackle(controlled, carrier);
      }
    }
  }

  update(rawDelta) {
    const delta = clamp(rawDelta, 0, 0.1);
    this.simulationTime += delta;
    this.passCooldown = Math.max(0, this.passCooldown - delta);
    this.tackleGrace = Math.max(0, this.tackleGrace - delta);
    if (this.status !== "playing") return;

    if (this.pauseRemaining > 0) {
      this.pauseRemaining = Math.max(0, this.pauseRemaining - delta);
      if (this.pauseRemaining === 0 && this.pendingRestart) this.#applyPendingRestart();
      return;
    }

    this.clock = Math.max(0, this.clock - delta);
    if (this.clock === 0) {
      this.#endPeriod();
      return;
    }

    this.#updateControlledPlayers();
    this.#updatePlayers(delta);
    this.#updateBall(delta);
    this.#checkAutomaticTackle();
    this.#checkBoundariesAndScore();
  }

  snapshot() {
    return {
      id: this.id,
      roomCode: this.roomCode,
      modeId: this.modeId,
      modeLabel: this.mode.label,
      status: this.status,
      phase: this.phase,
      half: this.half,
      clock: this.clock,
      score: this.score,
      possession: this.possession,
      tackleCount: this.tackleCount,
      tackleLimit: this.mode.tackleLimit,
      controlled: this.controlled,
      directions: {
        [TEAM_HOME]: attackDirection(TEAM_HOME, this.half),
        [TEAM_AWAY]: attackDirection(TEAM_AWAY, this.half),
      },
      humansConnected: {
        [TEAM_HOME]: Boolean(this.humans[TEAM_HOME]),
        [TEAM_AWAY]: Boolean(this.humans[TEAM_AWAY]),
      },
      humanNames: this.humanNames,
      event: this.event,
      rules: {
        playersPerTeam: this.mode.playersPerTeam,
        tryPoints: this.mode.tryPoints,
        conversionPoints: this.mode.conversionPoints,
        breakdown: this.mode.breakdown,
      },
      players: this.players.map((player) => ({
        id: player.id,
        team: player.team,
        number: player.number,
        x: player.x,
        z: player.z,
        facingX: player.facingX,
        facingZ: player.facingZ,
        speed: Math.hypot(player.vx, player.vz),
      })),
      ball: { ...this.ball },
    };
  }

  hasNoHumans() {
    return !this.humans[TEAM_HOME] && !this.humans[TEAM_AWAY];
  }

  #createSquads() {
    this.players = [];
    for (const team of [TEAM_HOME, TEAM_AWAY]) {
      for (let index = 0; index < this.mode.playersPerTeam; index += 1) {
        this.players.push({
          id: `${team}-${index + 1}`,
          team,
          number: index + 1,
          slot: index,
          x: 0,
          z: 0,
          vx: 0,
          vz: 0,
          facingX: 0,
          facingZ: team === TEAM_HOME ? 1 : -1,
        });
      }
    }
  }

  #resetFormation(possessionTeam) {
    for (const player of this.players) {
      const direction = attackDirection(player.team, this.half);
      const layout = rowLayout(player.slot, this.mode.playersPerTeam);
      player.x = layout.x;
      player.z = -direction * (8 + layout.row * 6);
      player.vx = 0;
      player.vz = 0;
      player.facingX = 0;
      player.facingZ = direction;
    }

    const carrier = this.#playersForTeam(possessionTeam)
      .slice()
      .sort((a, b) => Math.abs(a.x) - Math.abs(b.x) || b.z * attackDirection(possessionTeam, this.half) - a.z * attackDirection(possessionTeam, this.half))[0];
    this.ball = { ...emptyBall(), x: carrier.x, z: carrier.z, carrierId: carrier.id, lastTeam: possessionTeam };
    this.possession = possessionTeam;
    this.tackleCount = 0;
    this.tackleGrace = 1.3;
    this.#updateControlledPlayers();
  }

  #updateControlledPlayers() {
    const ballPoint = this.#ballPoint();
    const carrier = this.#getPlayer(this.ball.carrierId);
    for (const team of [TEAM_HOME, TEAM_AWAY]) {
      if (carrier?.team === team) {
        this.controlled[team] = carrier.id;
      } else {
        this.controlled[team] = this.#nearestPlayer(team, ballPoint)?.id ?? null;
      }
    }
  }

  #updatePlayers(delta) {
    const carrier = this.#getPlayer(this.ball.carrierId);
    const ballPoint = this.#ballPoint();

    for (const player of this.players) {
      const isHumanControlled = this.humans[player.team] && this.controlled[player.team] === player.id;
      let desired = { x: 0, z: 0 };
      let speed = BASE_SPEED;

      if (isHumanControlled) {
        const input = this.inputs[player.team] ?? EMPTY_INPUT;
        const direction = attackDirection(player.team, this.half);
        const forward = Number(input.forward) - Number(input.backward);
        const sideways = Number(input.right) - Number(input.left);
        desired = normalise(sideways * direction, forward * direction);
        speed = input.sprint ? SPRINT_SPEED : BASE_SPEED;
      } else if (carrier?.id === player.id) {
        desired = this.#aiCarrierDirection(player);
        speed = AI_CARRIER_SPEED;
      } else if (carrier?.team === player.team) {
        desired = this.#seek(player, this.#supportTarget(player, carrier));
        speed = BASE_SPEED * 0.86;
      } else {
        desired = this.#seek(player, this.#defensiveTarget(player, ballPoint, carrier?.team ?? oppositeTeam(player.team)));
        speed = BASE_SPEED * (this.#nearestPlayer(player.team, ballPoint)?.id === player.id ? 1.02 : 0.84);
      }

      const blend = Math.min(1, delta * 10);
      player.vx += (desired.x * speed - player.vx) * blend;
      player.vz += (desired.z * speed - player.vz) * blend;
      player.x += player.vx * delta;
      player.z += player.vz * delta;
      player.x = clamp(player.x, -PLAYER_LIMIT_X, PLAYER_LIMIT_X);
      player.z = clamp(player.z, -PLAYER_LIMIT_Z, PLAYER_LIMIT_Z);

      const moving = Math.hypot(player.vx, player.vz);
      if (moving > 0.2) {
        player.facingX = player.vx / moving;
        player.facingZ = player.vz / moving;
      }
    }

    this.#separatePlayers();

    if (carrier && !this.humans[carrier.team] && this.passCooldown <= 0) {
      const nearestDefender = this.#nearestPlayer(oppositeTeam(carrier.team), carrier);
      if (nearestDefender && distanceSquared(nearestDefender, carrier) < 13) {
        const side = Math.sin(this.simulationTime * 1.7 + carrier.slot) >= 0 ? 1 : -1;
        this.#passBall(carrier, side);
      }
    }
  }

  #aiCarrierDirection(carrier) {
    const direction = attackDirection(carrier.team, this.half);
    const defenders = this.#playersForTeam(oppositeTeam(carrier.team));
    let evade = 0;
    for (const defender of defenders) {
      const dz = (defender.z - carrier.z) * direction;
      if (dz > -1 && dz < 8 && Math.abs(defender.x - carrier.x) < 5) {
        evade += carrier.x <= defender.x ? -1 : 1;
      }
    }
    return normalise(clamp(evade, -0.72, 0.72) * direction, direction);
  }

  #supportTarget(player, carrier) {
    const direction = attackDirection(player.team, this.half);
    const laneCount = this.mode.playersPerTeam <= 7 ? 5 : 7;
    const lane = (player.slot % laneCount) / Math.max(1, laneCount - 1) - 0.5;
    const row = Math.floor(player.slot / laneCount);
    return {
      x: clamp(carrier.x + lane * 42, -29, 29),
      z: clamp(carrier.z - direction * (4 + row * 4.5), -47, 47),
    };
  }

  #defensiveTarget(player, ballPoint, attackingTeam) {
    const attackerDirection = attackDirection(attackingTeam, this.half);
    const defenders = this.#playersForTeam(player.team)
      .slice()
      .sort((a, b) => distanceSquared(a, ballPoint) - distanceSquared(b, ballPoint));
    const chaseRank = defenders.findIndex((candidate) => candidate.id === player.id);
    if (chaseRank < (this.mode.playersPerTeam <= 7 ? 2 : 3)) {
      return {
        x: ballPoint.x + (chaseRank - 1) * 1.2,
        z: ballPoint.z + attackerDirection * 0.7,
      };
    }

    const laneCount = this.mode.playersPerTeam <= 7 ? 5 : 7;
    const lane = (player.slot % laneCount) / Math.max(1, laneCount - 1) - 0.5;
    const row = Math.floor(player.slot / laneCount);
    return {
      x: lane * 55,
      z: clamp(ballPoint.z + attackerDirection * (7 + row * 3), -48, 48),
    };
  }

  #seek(player, target) {
    return normalise(target.x - player.x, target.z - player.z);
  }

  #separatePlayers() {
    const minimum = 1.25;
    const minimumSquared = minimum * minimum;
    for (let aIndex = 0; aIndex < this.players.length; aIndex += 1) {
      const a = this.players[aIndex];
      for (let bIndex = aIndex + 1; bIndex < this.players.length; bIndex += 1) {
        const b = this.players[bIndex];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const squared = dx * dx + dz * dz;
        if (squared >= minimumSquared || squared < 0.0001) continue;
        const distance = Math.sqrt(squared);
        const push = (minimum - distance) * 0.22;
        const nx = dx / distance;
        const nz = dz / distance;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }
  }

  #updateBall(delta) {
    const carrier = this.#getPlayer(this.ball.carrierId);
    if (carrier) {
      this.ball.x = carrier.x + carrier.facingX * 0.42;
      this.ball.y = 1.25;
      this.ball.z = carrier.z + carrier.facingZ * 0.42;
      this.ball.lastTeam = carrier.team;
      return;
    }

    this.ball.x += this.ball.vx * delta;
    this.ball.z += this.ball.vz * delta;
    this.ball.y += this.ball.vy * delta;
    this.ball.vy -= 16 * delta;

    const target = this.#getPlayer(this.ball.targetId);
    if (target && this.ball.y < 2.1 && distanceSquared(this.ball, target) < 2.2) {
      this.#giveBallTo(target);
      return;
    }

    if (this.ball.y <= 0.3) {
      this.ball.y = 0.3;
      this.ball.vy = Math.abs(this.ball.vy) > 2 ? Math.abs(this.ball.vy) * 0.28 : 0;
      this.ball.vx *= 0.92;
      this.ball.vz *= 0.92;
      this.ball.targetId = null;
    }

    if (this.ball.y < 1.55) {
      const nearest = this.players
        .slice()
        .sort((a, b) => distanceSquared(a, this.ball) - distanceSquared(b, this.ball))[0];
      if (nearest && distanceSquared(nearest, this.ball) < 1.5) this.#giveBallTo(nearest);
    }
  }

  #passBall(carrier, side) {
    const direction = attackDirection(carrier.team, this.half);
    const candidates = this.#playersForTeam(carrier.team)
      .filter((player) => {
        if (player.id === carrier.id) return false;
        const forwardDifference = (player.z - carrier.z) * direction;
        const screenSide = (player.x - carrier.x) * direction;
        return forwardDifference <= 0.9 && Math.sign(screenSide || side) === side;
      })
      .sort((a, b) => {
        const aScore = distanceSquared(a, carrier) + Math.abs((a.z - carrier.z) * direction) * 2;
        const bScore = distanceSquared(b, carrier) + Math.abs((b.z - carrier.z) * direction) * 2;
        return aScore - bScore;
      });
    const target = candidates.find((player) => distanceSquared(player, carrier) < 340);
    if (!target) return false;

    const travelTime = clamp(Math.sqrt(distanceSquared(target, carrier)) / 15, 0.28, 0.72);
    this.ball.carrierId = null;
    this.ball.targetId = target.id;
    this.ball.x = carrier.x;
    this.ball.y = 1.4;
    this.ball.z = carrier.z;
    this.ball.vx = (target.x - carrier.x) / travelTime;
    this.ball.vz = (target.z - carrier.z) / travelTime;
    this.ball.vy = 5.3;
    this.ball.lastTeam = carrier.team;
    this.passCooldown = 0.55;
    this.phase = "PASS";
    return true;
  }

  #kickBall(carrier) {
    const direction = attackDirection(carrier.team, this.half);
    this.ball.carrierId = null;
    this.ball.targetId = null;
    this.ball.x = carrier.x;
    this.ball.y = 1.1;
    this.ball.z = carrier.z;
    this.ball.vx = carrier.facingX * 4;
    this.ball.vz = direction * 21;
    this.ball.vy = 12;
    this.ball.lastTeam = carrier.team;
    this.passCooldown = 0.8;
    this.phase = "KICK IN PLAY";
    this.#announce("KICK IN PLAY", "neutral");
  }

  #giveBallTo(player) {
    this.ball.carrierId = player.id;
    this.ball.targetId = null;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this.ball.lastTeam = player.team;
    if (this.possession !== player.team) {
      this.possession = player.team;
      this.tackleCount = 0;
      this.#announce("TURNOVER!", "warning");
    }
    this.#updateControlledPlayers();
  }

  #checkAutomaticTackle() {
    if (this.tackleGrace > 0 || !this.ball.carrierId) return;
    const carrier = this.#getPlayer(this.ball.carrierId);
    const defender = this.#nearestPlayer(oppositeTeam(carrier.team), carrier);
    if (defender && distanceSquared(defender, carrier) < 1.72) this.#resolveTackle(defender, carrier);
  }

  #resolveTackle(defender, carrier) {
    if (this.pauseRemaining > 0 || this.ball.carrierId !== carrier.id) return;
    const point = { x: carrier.x, z: carrier.z };
    let restartTeam = carrier.team;
    let message;
    let tone = "neutral";

    if (this.mode.breakdown === "play-the-ball") {
      this.tackleCount += 1;
      if (this.tackleCount >= this.mode.tackleLimit) {
        restartTeam = oppositeTeam(carrier.team);
        this.tackleCount = 0;
        message = "SIXTH TACKLE — HANDOVER";
        tone = "warning";
      } else {
        message = `TACKLE ${this.tackleCount} OF ${this.mode.tackleLimit}`;
      }
    } else {
      const support = this.#playersForTeam(carrier.team).filter(
        (player) => player.id !== carrier.id && distanceSquared(player, carrier) < 21,
      ).length;
      const defenders = this.#playersForTeam(defender.team).filter(
        (player) => distanceSquared(player, carrier) < 16,
      ).length;
      if (support === 0 && defenders >= 2) {
        restartTeam = defender.team;
        message = "JACKAL! TURNOVER BALL";
        tone = "warning";
      } else {
        message = "RUCK WON — QUICK BALL";
      }
      this.tackleCount = 0;
    }

    this.ball.carrierId = null;
    this.ball.targetId = null;
    this.ball.x = point.x;
    this.ball.y = 0.3;
    this.ball.z = point.z;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this.pauseRemaining = this.mode.breakdown === "play-the-ball" ? 0.55 : 0.72;
    this.pendingRestart = { team: restartTeam, point, fullReset: false, phase: message };
    this.phase = message;
    this.#announce(message, tone);
  }

  #checkBoundariesAndScore() {
    const carrier = this.#getPlayer(this.ball.carrierId);
    const point = carrier ?? this.ball;

    if (Math.abs(point.x) >= FIELD.touchX) {
      const restartTeam = oppositeTeam(this.ball.lastTeam);
      const message = this.mode.breakdown === "play-the-ball" ? "INTO TOUCH — HANDOVER" : `LINEOUT — ${restartTeam.toUpperCase()} BALL`;
      this.#scheduleRestart(restartTeam, { x: Math.sign(point.x) * 28, z: clamp(point.z, -43, 43) }, message, "warning");
      return;
    }

    if (!carrier) return;
    const direction = attackDirection(carrier.team, this.half);
    if (carrier.z * direction < FIELD.goalLineZ) return;

    const points = this.mode.tryPoints + this.mode.conversionPoints;
    this.score[carrier.team] += points;
    const label = `${carrier.team.toUpperCase()} TRY! +${this.mode.tryPoints} · CONVERSION +${this.mode.conversionPoints}`;
    this.ball.carrierId = null;
    this.pauseRemaining = 2.4;
    this.pendingRestart = { team: oppositeTeam(carrier.team), point: { x: 0, z: 0 }, fullReset: true, phase: "KICK-OFF" };
    this.phase = label;
    this.#announce(label, "score");
  }

  #scheduleRestart(team, point, message, tone) {
    if (this.pauseRemaining > 0) return;
    this.ball.carrierId = null;
    this.ball.targetId = null;
    this.ball.x = point.x;
    this.ball.y = 0.3;
    this.ball.z = point.z;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this.pauseRemaining = 1;
    this.pendingRestart = { team, point, fullReset: false, phase: message };
    this.phase = message;
    this.#announce(message, tone);
  }

  #applyPendingRestart() {
    const restart = this.pendingRestart;
    this.pendingRestart = null;
    if (!restart) return;
    if (restart.fullReset) {
      this.#resetFormation(restart.team);
    } else {
      this.#restartAt(restart.team, restart.point);
    }
    this.phase = restart.phase === "KICK-OFF" ? "KICK-OFF" : "PLAY ON";
    this.tackleGrace = 1.15;
  }

  #restartAt(team, point) {
    const direction = attackDirection(team, this.half);
    const candidates = this.#playersForTeam(team)
      .slice()
      .sort((a, b) => distanceSquared(a, point) - distanceSquared(b, point));
    const receiver = candidates[0];
    receiver.x = clamp(point.x, -30, 30);
    receiver.z = clamp(point.z - direction * 0.8, -47, 47);
    receiver.vx = 0;
    receiver.vz = 0;
    this.possession = team;
    if (this.mode.breakdown !== "play-the-ball" || this.ball.lastTeam !== team) this.tackleCount = 0;
    this.#giveBallTo(receiver);
  }

  #endPeriod() {
    if (this.half === 1) {
      this.half = 2;
      this.clock = this.mode.halfSeconds;
      this.pauseRemaining = 2.7;
      this.pendingRestart = { team: TEAM_AWAY, point: { x: 0, z: 0 }, fullReset: true, phase: "SECOND HALF" };
      this.phase = "HALF-TIME — TEAMS CHANGE ENDS";
      this.#announce(this.phase, "accent");
      return;
    }

    this.status = "finished";
    const homeScore = this.score[TEAM_HOME];
    const awayScore = this.score[TEAM_AWAY];
    const result = homeScore === awayScore ? "FULL-TIME — DRAW" : `FULL-TIME — ${homeScore > awayScore ? "HOME" : "AWAY"} WIN`;
    this.phase = result;
    this.#announce(result, "score");
  }

  #announce(text, tone) {
    this.eventSequence += 1;
    this.event = { text, tone, sequence: this.eventSequence };
  }

  #ballPoint() {
    return this.#getPlayer(this.ball.carrierId) ?? this.ball;
  }

  #getPlayer(id) {
    if (!id) return null;
    return this.players.find((player) => player.id === id) ?? null;
  }

  #playersForTeam(team) {
    return this.players.filter((player) => player.team === team);
  }

  #nearestPlayer(team, point) {
    return this.#playersForTeam(team)
      .slice()
      .sort((a, b) => distanceSquared(a, point) - distanceSquared(b, point))[0] ?? null;
  }
}

export function createMatch(options) {
  return new Match(options);
}
