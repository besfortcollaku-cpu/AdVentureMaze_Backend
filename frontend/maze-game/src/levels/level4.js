// src/levels/level4.js



export const level4 = {

  name: "LEVEL 4",

  zoom: 0.92, // slightly zoomed-out (bigger maze feel)

  start: { x: 1, y: 1 },



  // ✅ 0 = walkable, 1 = wall

  grid: [

[1,1,1,1,1,1,1,1,1],
[1,0,0,0,1,0,0,0,1],
[1,0,1,0,1,0,1,0,1],
[1,0,1,0,0,0,1,0,1],
[1,0,1,1,1,0,1,0,1],
[1,0,0,0,0,0,0,0,1],
[1,0,1,1,1,1,1,0,1],
[1,0,0,0,0,0,0,0,1],
[1,1,1,1,1,1,1,1,1]

  ],

};