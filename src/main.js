import "./style.css";
import { Game } from "./game.js";
import { createInput } from "./input.js";
import { CONFIG } from "./config.js";

const canvas = document.getElementById("game");
const scoreHome = document.getElementById("score-home");
const scoreAway = document.getElementById("score-away");
const clock = document.getElementById("clock");
const banner = document.getElementById("banner");
const endscreen = document.getElementById("endscreen");
const endTitle = document.getElementById("end-title");
const endScore = document.getElementById("end-score");
const charselect = document.getElementById("charselect");
const charGrid = document.getElementById("char-grid");
const btnChange = document.getElementById("btn-change");
const bossToggle = document.getElementById("boss-toggle");
const awayName = document.getElementById("away-name");
const fpsEl = document.getElementById("fps");
const powerbar = document.getElementById("powerbar");
const powerFill = powerbar.querySelector("i");

const input = createInput();
const game = new Game(canvas, input.state);

// ---------- tela de selecao de personagens ----------
function showSelect() {
  game.running = false;
  game.over = false;
  charselect.classList.remove("hidden");
}

let bossMode = false;

function refreshBossToggle() {
  bossToggle.textContent = bossMode
    ? "🔥 Modo Boss: ON (vs Haaland)"
    : "Modo Boss: OFF";
  bossToggle.classList.toggle("boss-toggle--on", bossMode);
}

bossToggle.addEventListener("click", () => {
  bossMode = !bossMode;
  refreshBossToggle();
});
refreshBossToggle();

function chooseCharacter(char) {
  game.bossMode = bossMode;
  awayName.textContent = bossMode ? "HAALAND" : "CPU";
  game.setHomeCharacter(char);
  game.start();
  charselect.classList.add("hidden");
}

const statBar = (label, v, min, span) => {
  const pct = Math.round(15 + Math.max(0, Math.min(1, (v - min) / span)) * 85);
  return `<div class="stat"><span>${label}</span><em><i style="width:${pct}%"></i></em></div>`;
};

charGrid.innerHTML = ""; // evita cards duplicados em recargas (HMR)
CONFIG.characters.forEach((char) => {
  const s = char.stats || { speed: 1, kick: 1, turn: 1 };
  const bars =
    statBar("VEL", s.speed, 0.85, 0.4) +
    statBar("CHU", s.kick, 0.85, 0.55) +
    statBar("DRI", s.turn, 0.8, 0.7);
  const card = document.createElement("div");
  card.className = "charcard";
  card.innerHTML = `
    <div class="charcard__num" style="background:${char.color}">${char.number}</div>
    <div class="charcard__name">${char.name}</div>
    <div class="charcard__stats">${bars}</div>`;
  card.addEventListener("click", () => chooseCharacter(char));
  charGrid.appendChild(card);
});

btnChange.addEventListener("click", showSelect);

// jogo comeca sempre na tela de selecao (inclusive apos recargas do HMR)
showSelect();

game.onScore = (home, away, clockText) => {
  scoreHome.textContent = home;
  scoreAway.textContent = away;
  clock.textContent = clockText;
};

const onResize = () => game.resize();
window.addEventListener("resize", onResize);

let raf = 0;
let last = performance.now();

// Passo de tempo fixo: a fisica avanca sempre em fatias de 1/60s,
// independente do refresh do monitor. Assim o jogo tem a mesma velocidade
// em 60Hz, 144Hz ou com quedas de FPS (antes rodava por quadro = rapido demais
// em telas de alta taxa de atualizacao).
const STEP = 1 / 60;
let acc = 0;

// contador de FPS (media a cada 250ms)
let fpsFrames = 0;
let fpsLast = last;

function loop(now) {
  let frame = (now - last) / 1000;
  last = now;

  fpsFrames++;
  if (now - fpsLast >= 250) {
    fpsEl.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsLast))} FPS`;
    fpsLast = now;
    fpsFrames = 0;
  }
  // limita o acumulo para evitar "espiral da morte" apos travadas/tab em segundo plano
  if (frame > 0.25) frame = 0.25;
  acc += frame;
  while (acc >= STEP) {
    game.update(STEP);
    acc -= STEP;
  }

  game.render();

  clock.textContent = game.clockText();
  banner.classList.toggle("hidden", game.flash <= 0);

  // barra de forca do chute
  if (game.charge > 0.001) {
    powerbar.classList.add("on");
    powerFill.style.width = `${game.charge * 100}%`;
  } else {
    powerbar.classList.remove("on");
  }

  if (game.over) {
    endTitle.textContent = game.resultText();
    endScore.textContent = `${game.score.home} x ${game.score.away}`;
    endscreen.classList.remove("hidden");
  } else {
    endscreen.classList.add("hidden");
  }

  raf = requestAnimationFrame(loop);
}
raf = requestAnimationFrame(loop);

// ---------- live update (HMR) ----------
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    input.dispose();
    game.dispose();
  });
  import.meta.hot.accept();
}
