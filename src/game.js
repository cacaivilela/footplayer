import * as THREE from "three";
import { CONFIG } from "./config.js";

// ---------- utilidades ----------
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const len = (x, z) => Math.hypot(x, z);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// substitui o <project_vertex> do fio de grama: curva a ponta para longe da
// bola e dos personagens (uInf) e adiciona um vento suave. So a ponta (bendH)
// se move; a base fica fixa no chao.
const GRASS_PROJECT = `
  vec4 gInstancePos = instanceMatrix * vec4(transformed, 1.0);
  vec4 worldPos = modelMatrix * gInstancePos;
  vec3 gBase = (modelMatrix * (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0))).xyz;
  float bendH = clamp(position.y / uBladeH, 0.0, 1.0);
  vec2 gOff = vec2(0.0);
  for (int i = 0; i < 12; i++) {
    if (i >= uInfN) break;
    vec2 gd = gBase.xz - uInf[i].xy;
    float gdist = length(gd);
    float grad = uInf[i].z;
    if (gdist < grad) {
      float gf = 1.0 - gdist / grad;
      gOff += normalize(gd + vec2(0.0001)) * gf * gf * grad * 0.45;
    }
  }
  gOff += vec2(sin(uTime * 1.6 + gBase.x * 0.2), sin(uTime * 1.3 + gBase.z * 0.2)) * 0.3;
  worldPos.xz += gOff * bendH;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
`;

function limitSpeed(e, max) {
  const s = len(e.vx, e.vz);
  if (s > max) {
    e.vx = (e.vx / s) * max;
    e.vz = (e.vz / s) * max;
  }
}

export class Game {
  constructor(canvas, input) {
    this.canvas = canvas;
    this.input = input;

    const f = CONFIG.field;
    this.f = f;
    this.halfW = f.width / 2;
    this.halfD = f.depth / 2;
    this.halfGoal = f.goalWidth / 2;
    this.count = CONFIG.team.count;

    // postes dos dois gols (colisao no plano do chao)
    this.posts = [
      { x: -this.halfW, z: -this.halfGoal },
      { x: -this.halfW, z: this.halfGoal },
      { x: this.halfW, z: -this.halfGoal },
      { x: this.halfW, z: this.halfGoal },
    ];

    this.onScore = null;

    // so simula depois que um personagem for escolhido na tela de selecao
    this.running = false;
    this.homeCharacter = CONFIG.characters[0];

    // modo boss (vs Haaland)
    this.bossMode = false;
    this.aiCfg = CONFIG.ai; // config de IA ativa (normal ou do boss)
    this.opponentSize = 1;

    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();

    this.initThree();
    this.buildWorld();
    this.reset();
    this.snapCamera();
  }

  // ---------- setup 3D ----------
  initThree() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0a1f12");
    this.scene.fog = new THREE.Fog("#0a1f12", 220, 520);

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1.6, 0.1, 2000);
    this.resize();

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(-80, 200, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = Math.max(this.halfW, this.halfD) + 40;
    Object.assign(sun.shadow.camera, {
      left: -s,
      right: s,
      top: s,
      bottom: -s,
      near: 1,
      far: 700,
    });
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun);
  }

  resize() {
    const w = this.canvas.clientWidth || 960;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildWorld() {
    const groundTex = this.makeFieldTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.f.width + 40, this.f.depth + 40),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.buildGrass();

    this.buildGoal(-this.halfW, 1);
    this.buildGoal(this.halfW, -1);

    // malhas dos jogadores
    this.homeMeshes = [];
    this.awayMeshes = [];
    for (let i = 0; i < this.count; i++) {
      const keeper = this.count > 1 && i === 0;
      const hc = keeper ? CONFIG.colors.homeKeeper : CONFIG.colors.home;
      const ac = keeper ? CONFIG.colors.awayKeeper : CONFIG.colors.away;
      const hm = this.buildPlayer(hc, CONFIG.player.radius);
      const am = this.buildPlayer(ac, CONFIG.player.radius);
      hm.userData.setAppearance(CONFIG.characters[i % CONFIG.characters.length]);
      am.userData.setAppearance(CONFIG.opponent);
      this.scene.add(hm, am);
      this.homeMeshes.push(hm);
      this.awayMeshes.push(am);
    }

    // anel de realce do jogador controlado
    this.activeRing = new THREE.Mesh(
      new THREE.RingGeometry(CONFIG.player.radius * 1.3, CONFIG.player.radius * 1.7, 28),
      new THREE.MeshBasicMaterial({
        color: CONFIG.colors.active,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    this.activeRing.rotation.x = -Math.PI / 2;
    this.activeRing.position.y = 0.2;
    this.scene.add(this.activeRing);

    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(CONFIG.ball.radius, 24, 18),
      new THREE.MeshStandardMaterial({ map: this.makeBallTexture(), roughness: 0.5 })
    );
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);
  }

  // milhares de fios de grama que se curvam com a bola e os personagens
  buildGrass() {
    const f = this.f;
    const count = f.grassBlades ?? 40000;
    const bladeH = f.grassHeight ?? 1.6;
    const bladeW = 0.45;

    // geometria de um fio: triangulo com o pivo na base
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-bladeW / 2, 0, 0, bladeW / 2, 0, 0, 0, bladeH, 0]),
        3
      )
    );
    geo.computeVertexNormals();

    // uniforms: altura, tempo (vento) e influenciadores (bola + personagens)
    this.grassUniforms = {
      uBladeH: { value: bladeH },
      uTime: { value: 0 },
      uInfN: { value: 0 },
      uInf: { value: Array.from({ length: 12 }, () => new THREE.Vector3()) },
    };

    const mat = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      roughness: 1,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.grassUniforms);
      shader.vertexShader =
        "uniform float uBladeH;\nuniform float uTime;\nuniform int uInfN;\nuniform vec3 uInf[12];\n" +
        shader.vertexShader.replace("#include <project_vertex>", GRASS_PROJECT);
    };

    const grass = new THREE.InstancedMesh(geo, mat, count);
    grass.castShadow = false;
    grass.receiveShadow = false;
    grass.frustumCulled = false; // fios se curvam pra fora; evita sumico nas bordas

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    // cobre o gramado todo (com margem)
    const rx = this.halfW + 20;
    const rz = this.halfD + 20;

    for (let i = 0; i < count; i++) {
      dummy.position.set(
        (Math.random() * 2 - 1) * rx,
        0,
        (Math.random() * 2 - 1) * rz
      );
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.25,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.25
      );
      dummy.scale.set(1, 0.6 + Math.random() * 0.8, 1);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);

      // cor "pintada" pela cor do gramado logo abaixo do fio
      this.sampleGround(dummy.position.x, dummy.position.z, color);
      color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
      grass.setColorAt(i, color);
    }
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;

    this.grass = grass;
    this.scene.add(grass);
  }

  // atualiza vento + posicoes que curvam a grama (bola e personagens)
  updateGrass() {
    const u = this.grassUniforms;
    u.uTime.value += 1 / 60;
    const arr = u.uInf.value;
    let n = 0;
    if (this.ball && n < arr.length) arr[n++].set(this.ball.x, this.ball.z, 10);
    for (const p of this.home) if (n < arr.length) arr[n++].set(p.x, p.z, p.r * 3.4);
    for (const p of this.away) if (n < arr.length) arr[n++].set(p.x, p.z, p.r * 3.4);
    u.uInfN.value = n;
  }

  makeFieldTexture() {
    const scale = 4;
    const f = this.f;
    const W = Math.round((f.width + 40) * scale);
    const D = Math.round((f.depth + 40) * scale);
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = D;
    const ctx = cv.getContext("2d");

    const stripes = 16;
    const sw = W / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? f.grassDark : f.grassLight;
      ctx.fillRect(i * sw, 0, sw + 1, D);
    }

    const px = (x) => (x + f.width / 2 + 20) * scale;
    const pz = (z) => (z + f.depth / 2 + 20) * scale;

    ctx.strokeStyle = f.lineColor;
    ctx.lineWidth = 2 * scale;

    ctx.strokeRect(px(-f.width / 2), pz(-f.depth / 2), f.width * scale, f.depth * scale);

    ctx.beginPath();
    ctx.moveTo(px(0), pz(-f.depth / 2));
    ctx.lineTo(px(0), pz(f.depth / 2));
    ctx.stroke();

    const circle = f.depth * 0.13;
    ctx.beginPath();
    ctx.arc(px(0), pz(0), circle * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px(0), pz(0), 1.6 * scale, 0, Math.PI * 2);
    ctx.fillStyle = f.lineColor;
    ctx.fill();

    const areaDepth = f.depth * 0.45;
    const areaWidth = f.width * 0.11;
    ctx.strokeRect(px(-f.width / 2), pz(-areaDepth / 2), areaWidth * scale, areaDepth * scale);
    ctx.strokeRect(px(f.width / 2 - areaWidth), pz(-areaDepth / 2), areaWidth * scale, areaDepth * scale);

    // guarda os pixels para "pintar" a grama com a cor do gramado abaixo dela
    this._fieldImg = ctx.getImageData(0, 0, W, D);
    this._fieldW = W;
    this._fieldD = D;
    this._fieldScale = scale;

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // le a cor do gramado (textura) na posicao de mundo (x, z)
  sampleGround(x, z, out) {
    const f = this.f;
    const s = this._fieldScale;
    const cx = clamp(Math.floor((x + f.width / 2 + 20) * s), 0, this._fieldW - 1);
    const cz = clamp(Math.floor((z + f.depth / 2 + 20) * s), 0, this._fieldD - 1);
    const i = (cz * this._fieldW + cx) * 4;
    const d = this._fieldImg.data;
    out.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace);
    return out;
  }

  makeBallTexture() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#222";
    const spots = [
      [64, 30, 12],
      [30, 70, 12],
      [98, 70, 12],
      [64, 104, 10],
      [10, 20, 8],
    ];
    for (const [x, y, r] of spots) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildGoal(x, dir) {
    const f = this.f;
    const group = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const post = (px, pz) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(f.postRadius, f.postRadius, f.goalHeight, 12),
        white
      );
      m.position.set(px, f.goalHeight / 2, pz);
      m.castShadow = true;
      group.add(m);
    };
    post(x, -this.halfGoal);
    post(x, this.halfGoal);

    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(f.postRadius, f.postRadius, f.goalWidth, 12),
      white
    );
    bar.rotation.x = Math.PI / 2;
    bar.position.set(x, f.goalHeight, 0);
    bar.castShadow = true;
    group.add(bar);

    const netDepth = 12;
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(f.goalWidth, f.goalHeight),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
      })
    );
    net.position.set(x - dir * netDepth, f.goalHeight / 2, 0);
    net.rotation.y = Math.PI / 2;
    group.add(net);

    this.scene.add(group);
  }

  buildPlayer(color, r) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const bodyH = r * 2.2;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.55, r * 0.75, bodyH, 16),
      bodyMat
    );
    body.position.y = bodyH / 2;
    body.castShadow = true;
    group.add(body);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.7 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 16, 12), headMat);
    head.position.y = bodyH + r * 0.45;
    head.castShadow = true;
    group.add(head);

    // marcador de frente (local +X = frente)
    const nose = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.26, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
    );
    nose.position.set(r * 0.72, bodyH * 0.6, 0);
    group.add(nose);

    // etiqueta flutuante: numero + nome (sprite sempre virado pra camera)
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 72;
    const ctx = cv.getContext("2d");
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true })
    );
    label.position.set(0, bodyH + r * 1.7, 0);
    label.scale.set(r * 5, r * 5 * (72 / 256), 1);
    group.add(label);

    // funcao para (re)aplicar a aparencia de um personagem
    group.userData.setAppearance = (char) => {
      bodyMat.color.set(char.color);
      if (char.skin) headMat.color.set(char.skin);
      ctx.clearRect(0, 0, 256, 72);
      // pilula de fundo
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      roundRect(ctx, 2, 6, 252, 60, 30);
      ctx.fill();
      // circulo com o numero (cor da camisa)
      ctx.fillStyle = char.color;
      ctx.beginPath();
      ctx.arc(38, 36, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 34px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(char.number), 38, 38);
      // nome
      ctx.textAlign = "left";
      ctx.font = "bold 30px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(char.name, 78, 38);
      tex.needsUpdate = true;
    };

    return group;
  }

  // ---------- estado ----------
  reset() {
    this.score = { home: 0, away: 0 };
    this.timeLeft = CONFIG.match.durationSeconds;
    this.over = false;
    this.flash = 0;
    this.prevReset = false;
    this.kickCooldown = 0;
    this.charge = 0; // carga do chute (0..1)
    this.prevKick = false;
    this.kickoff();
    this.emitScore();
  }

  // aplica o personagem escolhido ao jogador controlado (aparencia + atributos)
  setHomeCharacter(char) {
    this.homeCharacter = char;
    const mesh = this.homeMeshes[this.activeHome] || this.homeMeshes[0];
    mesh.userData.setAppearance(char);

    const st = char.stats || {};
    const size = st.size || 1;
    mesh.scale.setScalar(size);

    const p = CONFIG.player;
    const b = CONFIG.ball;
    this.homeStats = {
      maxSpeed: p.maxSpeed * (st.speed || 1),
      forwardAccel: p.forwardAccel * (st.accel || 1),
      reverseAccel: p.reverseAccel * (st.accel || 1),
      turnRate: p.turnRate * (st.turn || 1),
      friction: p.friction,
      kickPower: b.kickPower * (st.kick || 1),
      radius: p.radius * size,
    };
    if (this.controlled) this.controlled.r = this.homeStats.radius;
  }

  // inicia (ou reinicia) a partida a partir da tela de selecao
  start() {
    // define a forca do adversario ANTES do kickoff (que usa o raio)
    this.aiCfg = this.bossMode ? CONFIG.boss.ai : CONFIG.ai;
    this.opponentSize =
      (this.bossMode ? CONFIG.boss.size : CONFIG.opponent.size) || 1;
    this.reset();
    this.setHomeCharacter(this.homeCharacter);
    this.setOpponent();
    this.running = true;
  }

  // aplica a aparencia do adversario (Rival ou Haaland no modo boss)
  setOpponent() {
    const opp = this.bossMode ? CONFIG.boss : CONFIG.opponent;
    const mesh = this.awayMeshes[0];
    if (mesh) {
      mesh.userData.setAppearance(opp);
      mesh.scale.setScalar(opp.size || 1);
    }
  }

  makePlayer(x, z, r, role, lane, headingToRight) {
    const h = headingToRight ? 0 : Math.PI;
    return {
      x,
      z,
      vx: 0,
      vz: 0,
      heading: h,
      speed: 0,
      dirX: Math.cos(h),
      dirZ: Math.sin(h),
      r,
      role, // "keeper" | "field"
      lane, // z-alvo relativo (-1..1) para formacao
      kickCd: 0,
    };
  }

  kickoff() {
    const r = CONFIG.player.radius;
    this.home = [];
    this.away = [];

    // goleiro apenas quando ha mais de 1 jogador por time
    const hasKeeper = this.count > 1;
    if (hasKeeper) {
      this.home.push(this.makePlayer(-this.halfW + 10, 0, r, "keeper", 0, true));
      this.away.push(this.makePlayer(this.halfW - 10, 0, r, "keeper", 0, false));
    }

    // jogadores de linha distribuidos em faixas (lanes)
    const fieldCount = hasKeeper ? this.count - 1 : this.count;
    for (let idx = 0; idx < fieldCount; idx++) {
      const ln = fieldCount === 1 ? 0 : -0.34 + (idx / (fieldCount - 1)) * 0.68;
      const z = ln * this.f.depth;
      const forward = idx % 2 === 0 ? 0.5 : 0.28; // um pouco escalonado
      this.home.push(this.makePlayer(-this.halfW * forward, z, r, "field", ln, true));
      this.away.push(this.makePlayer(this.halfW * forward, z, r, "field", ln, false));
    }

    this.ball = { x: 0, z: 0, vx: 0, vz: 0, r: CONFIG.ball.radius };

    // controle fixo: sempre o mesmo jogador (nao troca durante a partida)
    this.activeHome = this.nearestFieldIndex(this.home);
    this.controlled = this.home[this.activeHome];
    if (this.homeStats) this.controlled.r = this.homeStats.radius;
    if (this.opponentSize && this.opponentSize !== 1) {
      for (const a of this.away) {
        if (a.role !== "keeper") a.r = CONFIG.player.radius * this.opponentSize;
      }
    }
  }

  nearestFieldIndex(team) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < team.length; i++) {
      if (team[i].role === "keeper") continue; // goleiro nao e controlavel/perseguidor
      const d = len(team[i].x - this.ball.x, team[i].z - this.ball.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best === -1 ? 0 : best;
  }

  emitScore() {
    if (this.onScore) this.onScore(this.score.home, this.score.away, this.clockText());
  }

  clockText() {
    const t = Math.max(0, Math.ceil(this.timeLeft));
    const m = String(Math.floor(t / 60)).padStart(2, "0");
    const s = String(t % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  resultText() {
    if (this.score.home > this.score.away) return "VOCE VENCEU";
    if (this.score.away > this.score.home) return "CPU VENCEU";
    return "EMPATE";
  }

  // ---------- atualizacao ----------
  update(dt) {
    if (!this.running) return; // aguardando selecao de personagem

    if (this.input.reset && !this.prevReset) this.reset();
    this.prevReset = this.input.reset;

    if (this.over) return;

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.over = true;
    }

    if (this.flash > 0) this.flash--;
    if (this.kickCooldown > 0) this.kickCooldown--;
    for (const p of this.home) if (p.kickCd > 0) p.kickCd--;
    for (const p of this.away) if (p.kickCd > 0) p.kickCd--;

    this.pickControlled();
    this.updateTeam(this.home, true);
    this.updateTeam(this.away, false);
    this.collidePlayers();
    this.collidePlayersWithPosts();
    this.updateBall();
    this.handleKicks(dt);
    this.checkGoal();
  }

  // controle fixo: mantem sempre o mesmo jogador (nao troca de personagem)
  pickControlled() {
    this.controlled = this.home[this.activeHome];
  }

  updateTeam(team, isHome) {
    // o "perseguidor" e o jogador de linha mais proximo da bola
    const chaser = this.nearestFieldIndex(team);
    for (let i = 0; i < team.length; i++) {
      const p = team[i];
      if (isHome && i === this.activeHome) {
        this.humanControl(p);
      } else if (p.role === "keeper") {
        this.keeperAI(p, isHome);
      } else {
        this.fieldAI(p, isHome, i === chaser);
      }
      this.moveEntity(p);
    }
  }

  humanControl(p) {
    const c = this.homeStats || CONFIG.player;
    const i = this.input;
    if (i.left) p.heading -= c.turnRate;
    if (i.right) p.heading += c.turnRate;
    if (i.forward) p.speed += c.forwardAccel;
    if (i.back) p.speed -= c.reverseAccel;
    p.speed *= c.friction;
    p.speed = clamp(p.speed, -c.maxSpeed * 0.5, c.maxSpeed);
    p.dirX = Math.cos(p.heading);
    p.dirZ = Math.sin(p.heading);
    p.vx = p.dirX * p.speed;
    p.vz = p.dirZ * p.speed;
  }

  steer(p, tx, tz, maxSpeed) {
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = len(dx, dz);
    if (d > 2) {
      p.vx += (dx / d) * maxSpeed * this.aiCfg.steer;
      p.vz += (dz / d) * maxSpeed * this.aiCfg.steer;
    } else {
      p.vx *= 0.75;
      p.vz *= 0.75;
    }
    p.vx *= 0.9;
    p.vz *= 0.9;
    limitSpeed(p, maxSpeed);
    if (len(p.vx, p.vz) > 0.05) p.heading = Math.atan2(p.vz, p.vx);
    p.dirX = Math.cos(p.heading);
    p.dirZ = Math.sin(p.heading);
  }

  fieldAI(p, isHome, isChaser) {
    const b = this.ball;
    let tx, tz;
    if (isChaser) {
      tx = b.x;
      tz = b.z;
    } else {
      // formacao: segue a bola no eixo X (limitado ao seu campo de acao)
      // e mantem sua faixa no eixo Z, puxando um pouco para a bola.
      tx = clamp(b.x, -this.halfW + 20, this.halfW - 20);
      tz = clamp(p.lane * this.f.depth + (b.z - p.lane * this.f.depth) * 0.3, -this.halfD + p.r, this.halfD - p.r);
    }
    this.steer(p, tx, tz, this.aiCfg.maxSpeed);
  }

  keeperAI(p, isHome) {
    const b = this.ball;
    const goalX = isHome ? -this.halfW : this.halfW;
    const tx = goalX + (isHome ? 9 : -9);
    const tz = clamp(b.z, -this.halfGoal + p.r, this.halfGoal - p.r);
    this.steer(p, tx, tz, this.aiCfg.maxSpeed * 0.95);
  }

  moveEntity(e) {
    e.x = clamp(e.x + e.vx, -this.halfW + e.r, this.halfW - e.r);
    e.z = clamp(e.z + e.vz, -this.halfD + e.r, this.halfD - e.r);
  }

  // separa jogadores que se sobrepoem (colisao corpo a corpo)
  collidePlayers() {
    const all = this.home.concat(this.away);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        let dist = len(dx, dz);
        const minDist = a.r + b.r;
        if (dist >= minDist) continue;
        let nx, nz;
        if (dist > 0) {
          nx = dx / dist;
          nz = dz / dist;
        } else {
          nx = 1; // sobreposicao exata: empurra num eixo qualquer
          nz = 0;
          dist = 0.0001;
        }
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;
        // mantem ambos dentro do campo
        a.x = clamp(a.x, -this.halfW + a.r, this.halfW - a.r);
        a.z = clamp(a.z, -this.halfD + a.r, this.halfD - a.r);
        b.x = clamp(b.x, -this.halfW + b.r, this.halfW - b.r);
        b.z = clamp(b.z, -this.halfD + b.r, this.halfD - b.r);
      }
    }
  }

  // jogadores nao atravessam os postes do gol
  collidePlayersWithPosts() {
    const pr = this.f.postRadius;
    const all = this.home.concat(this.away);
    for (const e of all) {
      for (const post of this.posts) {
        const dx = e.x - post.x;
        const dz = e.z - post.z;
        const dist = len(dx, dz);
        const minDist = e.r + pr;
        if (dist >= minDist) continue;
        const nx = dist > 0 ? dx / dist : 1;
        const nz = dist > 0 ? dz / dist : 0;
        e.x = clamp(post.x + nx * minDist, -this.halfW + e.r, this.halfW - e.r);
        e.z = clamp(post.z + nz * minDist, -this.halfD + e.r, this.halfD - e.r);
      }
    }
  }

  updateBall() {
    const b = this.ball;
    const cfg = CONFIG.ball;
    b.vx *= cfg.friction;
    b.vz *= cfg.friction;
    limitSpeed(b, cfg.maxSpeed);
    b.x += b.vx;
    b.z += b.vz;

    const inMouth = b.z > -this.halfGoal && b.z < this.halfGoal;
    if (b.z < -this.halfD + b.r) {
      b.z = -this.halfD + b.r;
      b.vz *= -0.75;
    }
    if (b.z > this.halfD - b.r) {
      b.z = this.halfD - b.r;
      b.vz *= -0.75;
    }
    if (!inMouth) {
      if (b.x < -this.halfW + b.r) {
        b.x = -this.halfW + b.r;
        b.vx *= -0.75;
      }
      if (b.x > this.halfW - b.r) {
        b.x = this.halfW - b.r;
        b.vx *= -0.75;
      }
    }

    this.collideBallWithPosts();

    for (const p of this.home) this.collideWithBall(p);
    for (const p of this.away) this.collideWithBall(p);
  }

  // a bola quica nos postes do gol
  collideBallWithPosts() {
    const b = this.ball;
    const pr = this.f.postRadius;
    for (const post of this.posts) {
      const dx = b.x - post.x;
      const dz = b.z - post.z;
      const dist = len(dx, dz);
      const minDist = b.r + pr;
      if (dist >= minDist || dist === 0) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      b.x = post.x + nx * minDist;
      b.z = post.z + nz * minDist;
      const dot = b.vx * nx + b.vz * nz;
      if (dot < 0) {
        const e = 0.75; // restituicao (quique)
        b.vx -= (1 + e) * dot * nx;
        b.vz -= (1 + e) * dot * nz;
      }
    }
  }

  collideWithBall(e) {
    const b = this.ball;
    const dx = b.x - e.x;
    const dz = b.z - e.z;
    const dist = len(dx, dz);
    const minDist = e.r + b.r;
    if (dist < minDist && dist > 0) {
      const nx = dx / dist;
      const nz = dz / dist;
      b.x = e.x + nx * minDist;
      b.z = e.z + nz * minDist;
      const push = CONFIG.ball.push;
      b.vx += nx * push + e.vx * 0.6;
      b.vz += nz * push + e.vz * 0.6;
    }
  }

  kickBall(dirX, dirZ, power = CONFIG.ball.kickPower) {
    const b = this.ball;
    b.vx = dirX * power;
    b.vz = dirZ * power;
  }

  handleKicks(dt) {
    const b = this.ball;
    const p = this.controlled;
    const c = CONFIG.player;
    const near = len(b.x - p.x, b.z - p.z) < p.r + b.r + 3;

    if (this.input.kick) {
      // segurando Espaco: vai carregando a forca (fora do cooldown)
      if (this.kickCooldown <= 0) {
        this.charge = clamp(this.charge + dt / c.kickChargeTime, 0, 1);
      }
    } else {
      // soltou o Espaco: se estava carregando e esta perto da bola, chuta
      if (this.prevKick && this.charge > 0 && this.kickCooldown <= 0 && near) {
        const base = this.homeStats ? this.homeStats.kickPower : CONFIG.ball.kickPower;
        const mult = 1 + this.charge * (c.kickChargeMax - 1);
        this.kickBall(p.dirX, p.dirZ, base * mult);
        this.kickCooldown = 12;
      }
      this.charge = 0;
    }
    this.prevKick = this.input.kick;

    // chutes da IA: qualquer jogador da IA perto da bola chuta pro gol adversario
    this.aiKicks(this.home, true);
    this.aiKicks(this.away, false);
  }

  aiKicks(team, isHome) {
    const b = this.ball;
    const oppGoalX = isHome ? this.halfW : -this.halfW;
    for (let i = 0; i < team.length; i++) {
      if (isHome && i === this.activeHome) continue; // esse e o humano
      const p = team[i];
      if (p.kickCd > 0) continue;
      if (len(b.x - p.x, b.z - p.z) >= p.r + b.r + 3) continue;
      // mira a boca do gol adversario a partir da bola
      let dx = oppGoalX - b.x;
      let dz = clamp(b.z, -this.halfGoal * 0.6, this.halfGoal * 0.6) - b.z;
      const d = len(dx, dz) || 1;
      this.kickBall(dx / d, dz / d);
      p.kickCd = this.aiCfg.kickCooldown;
    }
  }

  checkGoal() {
    const b = this.ball;
    const inMouth = b.z > -this.halfGoal && b.z < this.halfGoal;
    if (!inMouth) return;
    if (b.x - b.r <= -this.halfW) {
      this.score.away++;
      this.afterGoal();
    } else if (b.x + b.r >= this.halfW) {
      this.score.home++;
      this.afterGoal();
    }
  }

  afterGoal() {
    this.flash = 90;
    this.kickoff();
    this.snapCamera();
    this.emitScore();
  }

  // ---------- camera ----------
  updateCamera() {
    const p = this.controlled;
    const c = CONFIG.camera;
    const tx = p.x - p.dirX * c.distance;
    const tz = p.z - p.dirZ * c.distance;
    this._camPos.x += (tx - this._camPos.x) * c.smooth;
    this._camPos.y += (c.height - this._camPos.y) * c.smooth;
    this._camPos.z += (tz - this._camPos.z) * c.smooth;
    this.camera.position.copy(this._camPos);

    const lx = p.x + p.dirX * c.lookAhead;
    const lz = p.z + p.dirZ * c.lookAhead;
    this._camLook.x += (lx - this._camLook.x) * c.smooth;
    this._camLook.y += (c.lookHeight - this._camLook.y) * c.smooth;
    this._camLook.z += (lz - this._camLook.z) * c.smooth;
    this.camera.lookAt(this._camLook);
  }

  snapCamera() {
    const p = this.controlled;
    const c = CONFIG.camera;
    this._camPos.set(p.x - p.dirX * c.distance, c.height, p.z - p.dirZ * c.distance);
    this._camLook.set(p.x + p.dirX * c.lookAhead, c.lookHeight, p.z + p.dirZ * c.lookAhead);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLook);
  }

  // ---------- render ----------
  render() {
    if (this.grassUniforms) this.updateGrass();

    for (let i = 0; i < this.count; i++) {
      const h = this.home[i];
      this.homeMeshes[i].position.set(h.x, 0, h.z);
      this.homeMeshes[i].rotation.y = -h.heading;
      const a = this.away[i];
      this.awayMeshes[i].position.set(a.x, 0, a.z);
      this.awayMeshes[i].rotation.y = -a.heading;
    }

    // anel sob o jogador controlado
    const p = this.controlled;
    this.activeRing.position.set(p.x, 0.2, p.z);

    const b = this.ball;
    this.ballMesh.position.set(b.x, b.r, b.z);
    const speed = len(b.vx, b.vz);
    if (speed > 0.001) {
      this.ballMesh.rotateOnWorldAxis(
        new THREE.Vector3(-b.vz / speed, 0, b.vx / speed),
        speed / b.r
      );
    }

    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.grass) {
      this.grass.geometry.dispose();
      this.grass.material.dispose();
    }
    this.renderer.dispose();
  }
}
