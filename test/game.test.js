import test from "node:test";
import assert from "node:assert/strict";
import { createMatch } from "../server/game.js";

for (const [modeId, teamSize] of [["sevens", 7], ["league", 13], ["union", 15]]) {
  test(`${modeId} creates ${teamSize} players per team`, () => {
    const match = createMatch({ id: `test-${modeId}`, roomCode: "TEST1", modeId, solo: true });
    match.addHuman("socket-home", "Tester");
    const snapshot = match.snapshot();
    assert.equal(snapshot.players.length, teamSize * 2);
    assert.equal(snapshot.rules.playersPerTeam, teamSize);
    assert.equal(snapshot.status, "playing");
    assert.ok(snapshot.ball.carrierId?.startsWith("home-"));
  });
}

test("a human ball carrier can make a legal lateral or backward pass", () => {
  const match = createMatch({ id: "test-pass", roomCode: "TEST2", modeId: "sevens", solo: true });
  match.addHuman("socket-home", "Tester");
  const controlledId = match.snapshot().controlled.home;
  assert.equal(match.snapshot().ball.carrierId, controlledId);
  match.performAction("home", "pass-left");
  const afterPass = match.snapshot();
  assert.equal(afterPass.ball.carrierId, null);
  assert.ok(afterPass.ball.targetId?.startsWith("home-"));
});

test("crossing the goal line awards a converted try using the selected code", () => {
  const match = createMatch({ id: "test-score", roomCode: "TEST3", modeId: "league", solo: true });
  match.addHuman("socket-home", "Tester");
  const carrier = match.players.find((player) => player.id === match.ball.carrierId);
  carrier.z = 50.4;
  carrier.x = 0;
  match.tackleGrace = 5;
  match.update(0.01);
  assert.equal(match.snapshot().score.home, 6);
  assert.match(match.snapshot().phase, /TRY/);
});

test("league counts completed tackles", () => {
  const match = createMatch({ id: "test-tackle", roomCode: "TEST4", modeId: "league", solo: true });
  match.addHuman("socket-home", "Tester");
  const carrier = match.players.find((player) => player.id === match.ball.carrierId);
  const defender = match.players.find((player) => player.team === "away");
  defender.x = carrier.x;
  defender.z = carrier.z;
  match.tackleGrace = 0;
  match.update(0.001);
  assert.equal(match.snapshot().tackleCount, 1);
  assert.match(match.snapshot().phase, /TACKLE 1 OF 6/);
});
