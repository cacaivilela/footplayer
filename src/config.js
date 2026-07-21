// Parametros centrais do jogo (unidades de mundo 3D).
// Ajuste e veja o resultado ao vivo (HMR).

// gera hex a partir de HSL (cor unica por personagem)
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// pseudo-aleatorio deterministico (mesmo numero -> sempre os mesmos atributos)
function charRand(num, k) {
  const x = Math.sin(num * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// tons de pele
const CHARACTER_SKINS = [
  "#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3a21",
];

// elenco selecionavel: [nome, numero da camisa] - Leo Serpa e o camisa 67
const CHARACTER_ROSTER = [
  ["Léo Serpa", 67], ["Rique", 11], ["Tuca", 9], ["Bidu", 7],
  ["Neymar", 10], ["Gabi", 99], ["Rô", 8], ["Digão", 4],
  ["Cacá", 3], ["Piu", 77], ["Vitão", 5], ["Fael", 21],
  ["Duda", 20], ["Théo", 17], ["Kaká", 22], ["Serginho", 6],
  ["Marcão", 13], ["Biel", 30], ["Juninho", 88], ["Dedé", 33],
  ["Nando", 14], ["Gugu", 24], ["Pipoca", 27], ["Xandão", 44],
  ["Betinho", 12], ["Cebola", 19], ["Toddynho", 76], ["Zé", 1],
  ["Lucão", 23], ["Robson", 18], ["Tato", 25], ["Vava", 28],
  ["Nino", 16], ["Cauã", 31], ["Peu", 39], ["Ronaldinho Gaúcho", 42],
  ["Léo Preto", 55], ["Duds", 66], ["Maranhão", 70], ["Tiziu", 80],
  ["Careca", 90],
  // +11 personagens
  ["Alan", 2], ["Bruninho", 26], ["Cebolinha", 29], ["Danilo", 32],
  ["Edu", 34], ["Fabinho", 36], ["Gil", 37], ["Iran", 38],
  ["Juca", 40], ["Kléber", 45], ["Moacir", 50],
];

export const CONFIG = {
  field: {
    width: 450, // eixo X (de gol a gol) - 3x maior
    depth: 288, // eixo Z (lateral a lateral) - 3x maior
    goalWidth: 60, // abertura do gol (eixo Z)
    goalHeight: 18, // altura do gol (eixo Y)
    postRadius: 0.9,
    lineColor: "#ffffff",
    grassDark: "#1f7a34",
    grassLight: "#2a9d45",
    grassBlades: 600000, // quantidade de fios de grama (5x - bem densa)
    grassHeight: 1.4, // altura base de cada fio (um pouco mais baixa)
  },
  team: {
    count: 1, // jogadores por time (1v1, sem goleiro)
  },
  // jogador controlado (controle estilo "conducao": frente/re + giro)
  player: {
    radius: 2.6,
    maxSpeed: 1.35,
    forwardAccel: 0.1,
    reverseAccel: 0.06,
    turnRate: 0.055,
    friction: 0.9,
    kickChargeTime: 0.8, // segundos para carregar o chute no maximo
    kickChargeMax: 2.4, // multiplicador da forca com carga cheia
  },
  // jogadores controlados pela IA (companheiros e adversarios)
  ai: {
    maxSpeed: 0.9, // rival melhorado -> mais rapido e participativo
    steer: 0.11, // corrige melhor a rota
    kickCooldown: 34, // chuta com mais frequencia
  },
  colors: {
    home: "#2d6cdf", // azul (seu time)
    homeKeeper: "#15357a",
    away: "#e23b3b", // vermelho (CPU)
    awayKeeper: "#7a1515",
    active: "#ffe14d", // realce do jogador que voce controla
  },
  ball: {
    radius: 1.6,
    friction: 0.985,
    maxSpeed: 6.5, // teto maior para os chutes carregados valerem a pena
    kickPower: 2.7,
    push: 0.9,
  },
  match: {
    durationSeconds: 120,
  },
  // personagens selecionaveis (jogador que voce controla)
  // cada um com cor, pele, tamanho e atributos proprios
  characters: CHARACTER_ROSTER.map(([name, number], i) => {
    // Leo Serpa (i === 0) vem com tudo no maximo
    const stats =
      i === 0
        ? { speed: 1.25, accel: 1.4, turn: 1.5, kick: 1.4, size: 1.25 }
        : {
            speed: 0.85 + charRand(number, 1) * 0.4, // 0.85 .. 1.25
            accel: 0.8 + charRand(number, 2) * 0.6, // 0.80 .. 1.40
            turn: 0.8 + charRand(number, 3) * 0.7, // 0.80 .. 1.50
            kick: 0.85 + charRand(number, 4) * 0.55, // 0.85 .. 1.40
            size: 0.9 + charRand(number, 5) * 0.35, // 0.90 .. 1.25
          };
    // Neymar e o mais rapido do elenco
    if (name === "Neymar") stats.speed = 1.3;
    return {
      name,
      number,
      // Leo Serpa mantem o azul; os demais recebem cores unicas (angulo aureo)
      color: i === 0 ? "#2d6cdf" : hslToHex((i * 137.508) % 360, 64, 52),
      // Leo Serpa tem a pele bem clara; os demais sorteiam
      skin: i === 0 ? "#ffe6cc" : CHARACTER_SKINS[Math.floor(charRand(number, 6) * CHARACTER_SKINS.length)],
      stats,
    };
  }),
  // adversario (CPU)
  opponent: { name: "Rival", number: 4, color: "#e23b3b" },
  // chefe do modo boss: enfrenta o Haaland (grande, rapido e agressivo)
  boss: {
    name: "Haaland",
    number: 9,
    color: "#6cabdd",
    skin: "#ffdbac",
    size: 1.4,
    ai: { maxSpeed: 1.0, steer: 0.12, kickCooldown: 26 }, // boss piorado (menos brutal)
  },
  // camera de terceira pessoa que segue o jogador controlado
  camera: {
    fov: 55,
    distance: 34,
    height: 18,
    lookAhead: 22,
    lookHeight: 3,
    smooth: 0.12,
  },
};
