// src/levels/index.js



import { level1 } from "./level1.js"; 
import { level2 } from "./level2.js";
import { level3 } from "./level3.js"; 
import { level4 } from "./level4.js";
import { level5 } from "./level5.js";
import { level6 } from "./level6.js"; 
import { level7 } from "./level7.js";
import { level8 } from "./level8.js"; 
import { level9 } from "./level9.js";
import { level10 } from "./level10.js";
import { level11 } from "./level11.js";
import { level12 } from "./level12.js";
import { level13 } from "./level13.js"; 
import { level14 } from "./level14.js";
import { level15 } from "./level15.js";
import { level16 } from "./level16.js"; 
import { level17 } from "./level17.js";
import { level18 } from "./level18.js"; 
import { level19 } from "./level19.js";
import { level20 } from "./level20.js";
import { level21 } from "./level21.js";
import { level22 } from "./level22.js";
import { level23 } from "./level23.js";
import { level24 } from "./level24.js";
import { level25 } from "./level25.js";


export const levels = [
 level1,
 level2,
 level3,
 level4, 
 level5,
 level6, 
 level7,
 level8,
 level9,
 level10,
 level11,
 level12,
 level13,
 level14, 
 level15,
 level16, 
 level17,
 level18,
 level19,
 level20,
 level21,
 level22,
 level23,
 level24,
 level25,
];

export function getLevel(index) {
  return levels[index] || null;
}

