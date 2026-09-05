import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as THREE from "three";
import { createMatch } from "../server/game.js";

// Execute the actual renderer class with real Three.js scene objects. Only the
// GPU and browser host APIs are test doubles; this is not a browser/GPU test.
const source = readFileSync(new URL("../client/game-renderer.js", import.meta.url), "utf8");
assert.ok(source.startsWith('import * as THREE from "three";'));
const script = new vm.Script(
  source.replace('import * as THREE from "three";', "")
    .replace("export class RugbyRenderer", "class RugbyRenderer") + "\nRugbyRenderer;",
  { filename: "client/game-renderer.js" },
);

class RendererDouble {
  domElement = {};
  shadowMap = {};
  renderCount = 0;
  setPixelRatio(value) { this.pixelRatio = value; }
  setSize(width, height) { this.size = [width, height]; }
  setAnimationLoop(callback) { this.frame = callback; }
  render() { this.renderCount += 1; }
}

function startRenderer() {
  const listeners = new Map();
  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: (event, callback) => listeners.set(event, callback),
  };
  const document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      return {
        getContext: () => ({
          clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, fillText() {},
        }),
      };
    },
  };
  const RugbyRenderer = script.runInNewContext({
    THREE: { ...THREE, WebGLRenderer: RendererDouble }, window, document,
  });
  const children = [];
  const game = new RugbyRenderer({ appendChild: (element) => children.push(element) });
  return { game, window, listeners, children };
}

test("renderer startup reaches its animation loop and resize callback is callable", () => {
  const { game, window, listeners, children } = startRenderer();
  assert.equal(children.length, 1);
  assert.equal(typeof game.renderer.frame, "function");
  game.renderer.frame(16);
  assert.equal(game.renderer.renderCount, 1);
  window.innerWidth = 900;
  window.innerHeight = 600;
  const resize = listeners.get("resize");
  assert.equal(typeof resize, "function");
  resize();
  assert.equal(game.camera.aspect, 1.5);
  assert.deepEqual(game.renderer.size, [900, 600]);
});

test("renderer accepts all three match modes and returns to the lobby", () => {
  const { game } = startRenderer();
  for (const [modeId, teamSize] of [["sevens", 7], ["league", 13], ["union", 15]]) {
    const match = createMatch({ id: `render-${modeId}`, roomCode: "TEST1", modeId, solo: true });
    match.addHuman("socket-home", "Tester");
    game.setMatch(match.snapshot(), "home");
    game.renderer.frame(32);
    assert.equal(game.playerMeshes.size, teamSize * 2);
    assert.ok(game.ballMesh.visible);
    assert.ok(game.camera.position.toArray().every(Number.isFinite));
  }
  game.showLobbyView();
  game.renderer.frame(48);
  assert.equal(game.ballMesh.visible, false);
  assert.ok([...game.playerMeshes.values()].every((mesh) => !mesh.group.visible));
});
