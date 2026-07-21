# footplayer

Futebol **3D top-down** (Three.js) com boilerplate Vite e **live update (HMR)**.

▶ **Jogar / instalar:** https://cacaivilela.github.io/footplayer/

1 contra 1 com **52 jogadores** para escolher (cada um com cor, tamanho e atributos próprios), **modo boss** contra o Haaland e gramado que se curva quando você e a bola passam. Dá pra instalar como app (PWA) e jogar offline.

## Como rodar

```bash
npm install
npm run dev
```

Abra a URL que o Vite mostrar (normalmente `http://localhost:5173`).

## Controles

- **W A S D** ou **Setas** — mover o jogador (azul)
- **Espaco** — chutar quando estiver perto da bola
- **R** — reiniciar a partida

Marque mais gols que a CPU (vermelho) antes do tempo acabar.

## Estrutura

```
index.html        markup + HUD (placar/relogio)
src/main.js       loop do jogo + integracao HMR
src/game.js       fisica, IA, colisoes, gols e render
src/input.js      captura de teclado
src/config.js     parametros ajustaveis (velocidade, tempo, cores...)
src/style.css     estilo do HUD e do canvas
```

## Ajustando o jogo (com live update)

Abra `src/config.js` e mude valores como `player.maxSpeed`, `ball.kickPower`
ou `match.durationSeconds`. Ao salvar, o Vite aplica a mudanca sem recarregar
o servidor.

## Build de producao

```bash
npm run build     # gera dist/
npm run preview   # serve o build localmente
```
