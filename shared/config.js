export const TEAM_HOME = "home";
export const TEAM_AWAY = "away";

export const GAME_MODES = Object.freeze({
  sevens: Object.freeze({
    id: "sevens",
    label: "Rugby Sevens",
    shortLabel: "SEVENS",
    playersPerTeam: 7,
    halfSeconds: 180,
    tryPoints: 5,
    conversionPoints: 2,
    breakdown: "ruck",
    tackleLimit: null,
    accent: "#43f5b5",
  }),
  league: Object.freeze({
    id: "league",
    label: "Rugby League",
    shortLabel: "LEAGUE",
    playersPerTeam: 13,
    halfSeconds: 240,
    tryPoints: 4,
    conversionPoints: 2,
    breakdown: "play-the-ball",
    tackleLimit: 6,
    accent: "#ffcc45",
  }),
  union: Object.freeze({
    id: "union",
    label: "Rugby Union",
    shortLabel: "15s UNION",
    playersPerTeam: 15,
    halfSeconds: 240,
    tryPoints: 5,
    conversionPoints: 2,
    breakdown: "ruck",
    tackleLimit: null,
    accent: "#ff5b67",
  }),
});

export const FIELD = Object.freeze({
  width: 68,
  touchX: 34,
  goalLineZ: 50,
  deadBallZ: 58,
});

export function getMode(modeId) {
  return GAME_MODES[modeId] ?? GAME_MODES.sevens;
}

export function oppositeTeam(team) {
  return team === TEAM_HOME ? TEAM_AWAY : TEAM_HOME;
}

export function attackDirection(team, half = 1) {
  const firstHalfDirection = team === TEAM_HOME ? 1 : -1;
  return half === 1 ? firstHalfDirection : -firstHalfDirection;
}

export function scoringValue(modeId) {
  const mode = getMode(modeId);
  return mode.tryPoints + mode.conversionPoints;
}
