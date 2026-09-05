import * as THREE from "three";

const HOME_COLOUR = 0x43f5b5;
const AWAY_COLOUR = 0xff5b67;
const FIELD_GREEN = 0x176b43;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeCanvasLabel(text, colour) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, 128, 128);
  context.fillStyle = "rgba(3, 10, 8, 0.84)";
  context.beginPath();
  context.arc(64, 64, 44, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = colour;
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = "#f4fff9";
  context.font = "900 54px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(text), 64, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.75, 0.75, 0.75);
  sprite.position.set(0, 3.25, 0);
  return sprite;
}

export class RugbyRenderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07110f);
    this.scene.fog = new THREE.FogExp2(0x07110f, 0.0065);
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 350);
    this.camera.position.set(44, 38, -72);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.playerMeshes = new Map();
    this.latestSnapshot = null;
    this.localTeam = "home";
    this.idle = true;
    this.elapsed = 0;
    this.cameraPosition = new THREE.Vector3(44, 38, -72);
    this.cameraTarget = new THREE.Vector3(0, 0, 0);
    this.lookTarget = new THREE.Vector3(0, 0, 0);
    this.desiredCamera = new THREE.Vector3();
    this.desiredLook = new THREE.Vector3();
    this.tempVector = new THREE.Vector3();

    this.#createStadium();
    this.ballMesh = this.#createBall();
    this.scene.add(this.ballMesh);
	window.addEventListener("resize", () => this.#resize());
    this.renderer.setAnimationLoop((time) => this.#render(time));
  }

  showLobbyView() {
    this.idle = true;
    this.latestSnapshot = null;
    for (const mesh of this.playerMeshes.values()) mesh.group.visible = false;
    this.ballMesh.visible = false;
  }

  setMatch(snapshot, localTeam) {
    this.idle = false;
    this.localTeam = localTeam ?? this.localTeam;
    this.latestSnapshot = snapshot;
    this.ballMesh.visible = true;

    const activeIds = new Set(snapshot.players.map((player) => player.id));
    for (const [id, mesh] of this.playerMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh.group);
        this.playerMeshes.delete(id);
      }
    }

    for (const player of snapshot.players) {
      if (!this.playerMeshes.has(player.id)) {
        const mesh = this.#createPlayer(player);
        this.playerMeshes.set(player.id, mesh);
        this.scene.add(mesh.group);
      }
      this.playerMeshes.get(player.id).group.visible = true;
    }
  }

  #createStadium() {
    const worldGround = new THREE.Mesh(
      new THREE.CircleGeometry(145, 72),
      new THREE.MeshStandardMaterial({ color: 0x071d16, roughness: 1 }),
    );
    worldGround.rotation.x = -Math.PI / 2;
    worldGround.position.y = -0.13;
    worldGround.receiveShadow = true;
    this.scene.add(worldGround);

    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(68, 116),
      new THREE.MeshStandardMaterial({ color: FIELD_GREEN, roughness: 0.98, metalness: 0 }),
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = 0;
    pitch.receiveShadow = true;
    this.scene.add(pitch);

    for (let strip = 0; strip < 10; strip += 1) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(68, 11.6),
        new THREE.MeshBasicMaterial({ color: strip % 2 ? 0x1a7048 : 0x20794e, transparent: true, opacity: 0.38 }),
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(0, 0.012, -52.2 + strip * 11.6);
      this.scene.add(stripe);
    }

    const inGoalMaterial = new THREE.MeshBasicMaterial({ color: 0x115439, transparent: true, opacity: 0.72 });
    for (const z of [-54, 54]) {
      const inGoal = new THREE.Mesh(new THREE.PlaneGeometry(68, 8), inGoalMaterial);
      inGoal.rotation.x = -Math.PI / 2;
      inGoal.position.set(0, 0.025, z);
      this.scene.add(inGoal);
    }

    this.#createFieldLines();
    this.#createGoalPosts(-50);
    this.#createGoalPosts(50);
    this.#createCornerFlags();
    this.#createStands();
    this.#createCrowd();

    const hemisphere = new THREE.HemisphereLight(0xb9e6ff, 0x123224, 1.75);
    this.scene.add(hemisphere);
    const keyLight = new THREE.DirectionalLight(0xdfffee, 2.15);
    keyLight.position.set(-28, 58, -22);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -54;
    keyLight.shadow.camera.right = 54;
    keyLight.shadow.camera.top = 70;
    keyLight.shadow.camera.bottom = -70;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 130;
    keyLight.shadow.bias = -0.00025;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x46e4ff, 0.72);
    rimLight.position.set(40, 35, 45);
    this.scene.add(rimLight);
  }

  #createFieldLines() {
    const material = new THREE.LineBasicMaterial({ color: 0xe9fff5, transparent: true, opacity: 0.82 });
    const addLine = (points) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.05, z)));
      this.scene.add(new THREE.Line(geometry, material));
    };

    addLine([[-34, -58], [34, -58], [34, 58], [-34, 58], [-34, -58]]);
    for (const z of [-50, -22, -10, 0, 10, 22, 50]) addLine([[-34, z], [34, z]]);
    for (const x of [-15, 15]) addLine([[x, -50], [x, 50]]);

    const dashMaterial = new THREE.LineBasicMaterial({ color: 0xe9fff5, transparent: true, opacity: 0.55 });
    for (const z of [-40, -30, -20, -10, 10, 20, 30, 40]) {
      for (const x of [-25, -5, 5, 25]) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x - 0.8, 0.052, z),
          new THREE.Vector3(x + 0.8, 0.052, z),
        ]);
        this.scene.add(new THREE.Line(geometry, dashMaterial));
      }
    }
  }

  #createGoalPosts(z) {
    const group = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf4fff9, roughness: 0.7 });
    const postGeometry = new THREE.CylinderGeometry(0.09, 0.09, 8.5, 10);
    for (const x of [-2.8, 2.8]) {
      const post = new THREE.Mesh(postGeometry, white);
      post.position.set(x, 4.25, z);
      post.castShadow = true;
      group.add(post);
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 1.55, 12),
        new THREE.MeshStandardMaterial({ color: 0x43f5b5, roughness: 0.72 }),
      );
      pad.position.set(x, 0.78, z);
      pad.castShadow = true;
      group.add(pad);
    }
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.75, 10), white);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, 3, z);
    group.add(crossbar);
    this.scene.add(group);
  }

  #createCornerFlags() {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xf5fff9 });
    const flagMaterial = new THREE.MeshStandardMaterial({ color: 0xffcc45, side: THREE.DoubleSide });
    for (const x of [-34, 34]) {
      for (const z of [-50, 50]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.8, 6), poleMaterial);
        pole.position.set(x, 0.9, z);
        this.scene.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.38), flagMaterial);
        flag.position.set(x + (x < 0 ? 0.34 : -0.34), 1.55, z);
        this.scene.add(flag);
      }
    }
  }

  #createStands() {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x172b27, roughness: 0.88, metalness: 0.08 });
    const fascia = new THREE.MeshStandardMaterial({ color: 0x0d1c19, roughness: 0.72 });
    const sideGeometry = new THREE.BoxGeometry(18, 5, 125);
    const endGeometry = new THREE.BoxGeometry(78, 5, 15);

    for (const x of [-52, 52]) {
      for (let tier = 0; tier < 3; tier += 1) {
        const stand = new THREE.Mesh(sideGeometry, tier === 1 ? fascia : concrete);
        stand.position.set(x + Math.sign(x) * tier * 4.8, 2.35 + tier * 4.4, 0);
        stand.rotation.z = -Math.sign(x) * 0.12;
        stand.castShadow = true;
        stand.receiveShadow = true;
        this.scene.add(stand);
      }
    }

    for (const z of [-71, 71]) {
      for (let tier = 0; tier < 3; tier += 1) {
        const stand = new THREE.Mesh(endGeometry, tier === 1 ? fascia : concrete);
        stand.position.set(0, 2.35 + tier * 4.4, z + Math.sign(z) * tier * 4.3);
        stand.rotation.x = Math.sign(z) * 0.12;
        stand.castShadow = true;
        stand.receiveShadow = true;
        this.scene.add(stand);
      }
    }

    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x0b1513, roughness: 0.42, metalness: 0.62 });
    for (const x of [-66, 66]) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(19, 0.7, 132), roofMaterial);
      roof.position.set(x, 18.2, 0);
      roof.rotation.z = -Math.sign(x) * 0.08;
      this.scene.add(roof);
    }
  }

  #createCrowd() {
    const random = seededRandom(2026);
    const count = 3200;
    const positions = new Float32Array(count * 3);
    const colours = new Float32Array(count * 3);
    const palette = [new THREE.Color(0x43f5b5), new THREE.Color(0xff5b67), new THREE.Color(0xf1fff9), new THREE.Color(0xffcc45), new THREE.Color(0x3183a5)];

    for (let index = 0; index < count; index += 1) {
      const sideStand = random() > 0.35;
      let x;
      let z;
      if (sideStand) {
        x = (random() > 0.5 ? 1 : -1) * (43 + random() * 19);
        z = -62 + random() * 124;
      } else {
        x = -38 + random() * 76;
        z = (random() > 0.5 ? 1 : -1) * (65 + random() * 14);
      }
      const tierDistance = sideStand ? Math.abs(x) - 43 : Math.abs(z) - 65;
      const y = 3 + tierDistance * 0.58 + random() * 2.4;
      positions.set([x, y, z], index * 3);
      const colour = palette[Math.floor(random() * palette.length)];
      colours.set([colour.r, colour.g, colour.b], index * 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.34, vertexColors: true, transparent: true, opacity: 0.88 }),
    );
    this.scene.add(points);
  }

  #createPlayer(player) {
    const teamColour = player.team === "home" ? HOME_COLOUR : AWAY_COLOUR;
    const secondaryColour = player.team === "home" ? 0xeafff6 : 0x17201d;
    const skinTones = [0x6f3d25, 0x915c3c, 0xb77854, 0xd79a72, 0x5b321f];
    const skin = skinTones[player.number % skinTones.length];
    const group = new THREE.Group();
    group.position.set(player.x, 0, player.z);

    const jersey = new THREE.MeshStandardMaterial({ color: teamColour, roughness: 0.55 });
    const shorts = new THREE.MeshStandardMaterial({ color: secondaryColour, roughness: 0.72 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.82 });
    const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x07100d, roughness: 0.55 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 0.72, 4, 8), jersey);
    torso.position.y = 1.75;
    torso.scale.set(1.05, 1, 0.78);
    torso.castShadow = true;
    group.add(torso);

    const shortsMesh = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.45, 0.58), shorts);
    shortsMesh.position.y = 1.12;
    shortsMesh.castShadow = true;
    group.add(shortsMesh);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10), skinMaterial);
    head.position.y = 2.75;
    head.castShadow = true;
    group.add(head);

    const limbGeometry = new THREE.CapsuleGeometry(0.12, 0.67, 3, 6);
    const armGeometry = new THREE.CapsuleGeometry(0.1, 0.58, 3, 6);
    const limbs = [];
    for (const x of [-0.27, 0.27]) {
      const leg = new THREE.Mesh(limbGeometry, skinMaterial);
      leg.position.set(x, 0.55, 0);
      leg.castShadow = true;
      group.add(leg);
      limbs.push(leg);

      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.42), bootMaterial);
      boot.position.set(x, 0.13, 0.1);
      boot.castShadow = true;
      group.add(boot);
    }
    for (const x of [-0.58, 0.58]) {
      const arm = new THREE.Mesh(armGeometry, skinMaterial);
      arm.position.set(x, 1.78, 0);
      arm.rotation.z = x > 0 ? -0.17 : 0.17;
      arm.castShadow = true;
      group.add(arm);
      limbs.push(arm);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1.03, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe665, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    ring.visible = false;
    group.add(ring);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.23, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    group.add(makeCanvasLabel(player.number, player.team === "home" ? "#43f5b5" : "#ff5b67"));
    group.userData.targetPosition = new THREE.Vector3(player.x, 0, player.z);
    return { group, limbs, ring, player };
  }

  #createBall() {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xf4ede0, roughness: 0.62, metalness: 0.02 }),
    );
    ball.scale.set(0.72, 0.72, 1.42);
    ball.castShadow = true;
    ball.visible = false;
    return ball;
  }

  #render(timeMilliseconds) {
    const time = timeMilliseconds / 1000;
    const delta = Math.min(time - this.elapsed || 0.016, 0.05);
    this.elapsed = time;

    if (this.idle || !this.latestSnapshot) this.#updateLobbyCamera(time, delta);
    else this.#updateMatchScene(time, delta);

    this.renderer.render(this.scene, this.camera);
  }

  #updateLobbyCamera(time, delta) {
    const angle = time * 0.055 - 1.25;
    this.desiredCamera.set(Math.cos(angle) * 78, 42, Math.sin(angle) * 92);
    this.cameraPosition.lerp(this.desiredCamera, 1 - Math.exp(-delta * 1.2));
    this.lookTarget.lerp(this.tempVector.set(0, 0, 0), 1 - Math.exp(-delta * 1.8));
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.lookTarget);
  }

  #updateMatchScene(time, delta) {
    const snapshot = this.latestSnapshot;
    for (const player of snapshot.players) {
      const mesh = this.playerMeshes.get(player.id);
      if (!mesh) continue;
      mesh.group.userData.targetPosition.set(player.x, 0, player.z);
      mesh.group.position.lerp(mesh.group.userData.targetPosition, 1 - Math.exp(-delta * 14));
      const targetAngle = Math.atan2(player.facingX, player.facingZ);
      const angleDifference = Math.atan2(Math.sin(targetAngle - mesh.group.rotation.y), Math.cos(targetAngle - mesh.group.rotation.y));
      mesh.group.rotation.y += angleDifference * Math.min(1, delta * 11);
      mesh.ring.visible = snapshot.controlled[this.localTeam] === player.id;
      const runAmount = Math.min(player.speed / 8, 1);
      const stride = Math.sin(time * 12) * 0.58 * runAmount;
      mesh.limbs[0].rotation.x = stride;
      mesh.limbs[1].rotation.x = -stride;
      mesh.limbs[2].rotation.x = -stride * 0.72;
      mesh.limbs[3].rotation.x = stride * 0.72;
      mesh.ring.material.opacity = 0.72 + Math.sin(time * 5) * 0.2;
    }

    this.tempVector.set(snapshot.ball.x, snapshot.ball.y, snapshot.ball.z);
    this.ballMesh.position.lerp(this.tempVector, 1 - Math.exp(-delta * 18));
    this.ballMesh.rotation.x += delta * 8;
    this.ballMesh.rotation.z += delta * 3.5;

    const controlledId = snapshot.controlled[this.localTeam];
    const controlledMesh = this.playerMeshes.get(controlledId);
    const focus = controlledMesh?.group.position ?? this.ballMesh.position;
    const direction = snapshot.directions[this.localTeam] ?? 1;
    this.desiredCamera.set(
      focus.x + 8 * direction,
      15.5,
      focus.z - 23 * direction,
    );
    this.desiredCamera.x = THREE.MathUtils.clamp(this.desiredCamera.x, -29, 29);
    this.desiredCamera.z = THREE.MathUtils.clamp(this.desiredCamera.z, -64, 64);
    this.desiredLook.set(focus.x, 1.3, focus.z + 7.5 * direction);
    this.cameraPosition.lerp(this.desiredCamera, 1 - Math.exp(-delta * 3.9));
    this.lookTarget.lerp(this.desiredLook, 1 - Math.exp(-delta * 5.2));
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.lookTarget);
  }

  #resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
