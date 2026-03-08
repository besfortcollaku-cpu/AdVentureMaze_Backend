// src/game/state.js

function key(x, y) {
  return `${x},${y}`;
}

export function createGameState(level) {
  const grid = level.grid;
  const rows = grid.length;
  const cols = grid[0].length;

  const start = level.start || { x: 1, y: 1 };

  const state = {
    level,
    grid,
    rows,
    cols,

    player: { x: start.x, y: start.y },

    // painted tiles (walkable visited)
    painted: new Set(),

    // total walkable tiles count
    totalWalkable: 0,

    // helpers
    isWalkable(x, y) {
      if (!grid[y] || typeof grid[y][x] === "undefined") return false;

      // ✅ walkable tiles: 0 and 2
      const v = grid[y][x];
      return v === 0 || v === 2;
    },

    paint(x, y) {
  const k = key(x, y);
  const before = state.painted.size;
  state.painted.add(k);
  return state.painted.size !== before;
},

    isPainted(x, y) {
      return state.painted.has(key(x, y));
    },

    isComplete() {
      return state.totalWalkable > 0 && state.painted.size >= state.totalWalkable;
    },
  };

  // ✅ compute total walkable tiles (0 + 2)
  let count = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = grid[y][x];
      if (v === 0 || v === 2) count++;
    }
  }
  state.totalWalkable = count;

  // paint start tile immediately
  if (state.isWalkable(state.player.x, state.player.y)) {
    state.paint(state.player.x, state.player.y);
  }

  return state;
}