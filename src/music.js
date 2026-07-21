// ============================================================
//  Footplayer — Música de fundo (som procedural, Web Audio API)
//  Sem arquivos de áudio: funciona offline (PWA). Levada energética
//  de "estádio/arcade": baixo motor + melodia + bateria. Botão liga/desliga.
// ============================================================
const KEY = "footplayer_music_on";

// Frequências das notas (Hz)
const N = {
  D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99,
};

// 2 compassos (32 semicolcheias). Progressão Am – F – C – G (bem animada).
const BASS = [
  "A2", 0, 0, "A2", 0, 0, "A3", 0,   "F2", 0, 0, "F2", 0, 0, "F3", 0,
  "C3", 0, 0, "C3", 0, 0, "G3", 0,   "G2", 0, 0, "G2", 0, "D3", 0, "G2",
];
// Melodia (stabs por cima), pentatônica de Lá menor
const MELODY = [
  0, 0, "E5", 0, "D5", 0, "C5", 0,   0, "A4", 0, "C5", 0, 0, "A4", 0,
  0, 0, "E5", 0, "G5", 0, "E5", 0,   0, "D5", 0, "B4", 0, "D5", 0, "E5",
];

// Bateria (posição dentro do compasso de 16 semicolcheias)
const KICK = new Set([0, 4, 8, 12]);  // bumbo em todos os tempos (motor)
const SNARE = new Set([4, 12]);       // caixa no 2 e no 4

const TEMPO = 124;             // batidas por minuto (animado)
const STEP = 60 / TEMPO / 4;   // duração de uma semicolcheia (s)
const VOLUME = 0.26;           // volume geral (0..1)

let ctx = null, master = null, noiseBuf = null;
let playing = false;
let enabled = localStorage.getItem(KEY) !== "off"; // ligado por padrão
let timer = null, nextTime = 0, step = 0;

function ensureCtx() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  // Ruído branco curto, reusado para caixa e chimbal
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

// Nota melódica/baixo (oscilador com envelope)
function tone(note, time, dur, type, vol) {
  const freq = typeof note === "string" ? N[note] : note;
  if (!freq) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(master);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(vol, time + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.start(time);
  osc.stop(time + dur + 0.03);
}

// Bumbo (seno com queda de tom)
function kick(time) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(48, time + 0.1);
  g.gain.setValueAtTime(0.6, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);
  osc.connect(g);
  g.connect(master);
  osc.start(time);
  osc.stop(time + 0.15);
}

// Caixa / chimbal (ruído filtrado)
function noiseHit(time, dur, vol, kind) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  if (kind === "hat") {
    f.type = "highpass";
    f.frequency.value = 8000;
  } else {
    f.type = "bandpass";
    f.frequency.value = 1900;
    f.Q.value = 0.9;
  }
  const g = ctx.createGain();
  src.connect(f);
  f.connect(g);
  g.connect(master);
  g.gain.setValueAtTime(vol, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  src.start(time);
  src.stop(time + dur + 0.02);
}

// Agendador com antecipação (lookahead)
function scheduler() {
  while (nextTime < ctx.currentTime + 0.15) {
    const b = step % 16;
    const idx = step % BASS.length;
    tone(BASS[idx], nextTime, STEP * 1.7, "sawtooth", 0.16);
    tone(MELODY[idx], nextTime, STEP * 1.4, "square", 0.09);
    if (KICK.has(b)) kick(nextTime);
    if (SNARE.has(b)) noiseHit(nextTime, 0.16, 0.24, "snare");
    noiseHit(nextTime, 0.03, b % 2 === 0 ? 0.05 : 0.03, "hat");
    nextTime += STEP;
    step++;
  }
  timer = setTimeout(scheduler, 25);
}

function start() {
  ensureCtx();
  if (ctx.state === "suspended") ctx.resume();
  if (playing) return;
  playing = true;
  nextTime = ctx.currentTime + 0.06;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 0.6);
  scheduler();
}

function stop() {
  if (!playing) return;
  playing = false;
  clearTimeout(timer);
  if (master) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  }
}

function updateBtn() {
  const b = document.getElementById("music-toggle");
  if (b) {
    b.textContent = enabled ? "🔊" : "🔇";
    b.title = enabled ? "Música: ligada" : "Música: desligada";
  }
}

function setEnabled(on) {
  enabled = on;
  localStorage.setItem(KEY, on ? "on" : "off");
  if (on) start();
  else stop();
  updateBtn();
}

// Navegadores só deixam tocar som após uma interação do usuário
function firstGesture(e) {
  if (e && e.target && e.target.closest && e.target.closest("#music-toggle")) return;
  if (enabled) start();
  window.removeEventListener("pointerdown", firstGesture);
  window.removeEventListener("keydown", firstGesture);
}
window.addEventListener("pointerdown", firstGesture);
window.addEventListener("keydown", firstGesture);

function wireBtn() {
  const b = document.getElementById("music-toggle");
  if (!b) return;
  updateBtn();
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    setEnabled(!enabled);
  });
}
if (document.readyState !== "loading") wireBtn();
else document.addEventListener("DOMContentLoaded", wireBtn);

window.FootMusic = { start, stop, setEnabled, isEnabled: () => enabled };
