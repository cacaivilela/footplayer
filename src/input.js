// Captura o teclado (1 jogador, controle estilo conducao).
// W / seta cima  -> acelerar pra frente
// S / seta baixo -> re
// A / seta esq   -> girar para a esquerda
// D / seta dir   -> girar para a direita
// Espaco         -> chutar (pra frente)
// R              -> reiniciar
export function createInput() {
  const keys = new Set();

  const map = {
    ArrowUp: "forward",
    KeyW: "forward",
    ArrowDown: "back",
    KeyS: "back",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    Space: "kick",
    KeyR: "reset",
  };

  const blocked = new Set([
    "Space",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ]);

  const onDown = (e) => {
    const action = map[e.code];
    if (action) {
      keys.add(action);
      if (blocked.has(e.code)) e.preventDefault();
    }
  };
  const onUp = (e) => {
    const action = map[e.code];
    if (action) keys.delete(action);
  };

  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);

  return {
    state: {
      get forward() {
        return keys.has("forward");
      },
      get back() {
        return keys.has("back");
      },
      get left() {
        return keys.has("left");
      },
      get right() {
        return keys.has("right");
      },
      get kick() {
        return keys.has("kick");
      },
      get reset() {
        return keys.has("reset");
      },
    },
    dispose() {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    },
  };
}
