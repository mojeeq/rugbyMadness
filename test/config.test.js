import test from "node:test";
import assert from "node:assert/strict";
import { GAME_MODES, attackDirection, scoringValue } from "../shared/config.js";

test("the three requested rugby codes have distinct rule configurations", () => {
  assert.equal(GAME_MODES.sevens.playersPerTeam, 7);
  assert.equal(GAME_MODES.league.playersPerTeam, 13);
  assert.equal(GAME_MODES.union.playersPerTeam, 15);
  assert.equal(GAME_MODES.league.tackleLimit, 6);
  assert.equal(GAME_MODES.sevens.breakdown, "ruck");
  assert.equal(GAME_MODES.union.breakdown, "ruck");
  assert.equal(scoringValue("league"), 6);
  assert.equal(scoringValue("union"), 7);
});

test("teams change ends in the second half", () => {
  assert.equal(attackDirection("home", 1), 1);
  assert.equal(attackDirection("away", 1), -1);
  assert.equal(attackDirection("home", 2), -1);
  assert.equal(attackDirection("away", 2), 1);
});
