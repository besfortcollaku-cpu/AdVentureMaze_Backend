// src/levels/level3.js



export const level3 = {

  name: "LEVEL 3",

  zoom: 0.92, // slightly zoomed-out (bigger maze feel)

  start: { x: 1, y: 1 },



  // ✅ 0 = walkable, 1 = wall

  grid: [

[1,1,1,1,1,1,1,1,1],
[1,0,0,0,0,0,0,0,1],
[1,0,1,1,1,0,1,0,1],
[1,0,1,0,0,0,1,0,1],
[1,0,1,0,1,0,1,0,1],
[1,0,1,0,1,0,1,0,1],
[1,0,1,0,1,0,1,0,1],
[1,0,0,0,1,0,0,0,1],
[1,1,1,1,1,1,1,1,1]
    
  ],

};