/*
 * Regressionstest för js/geo.js mot riktig handtrimmad turdata (hkg).
 *
 * Metod: för varje scen används dess FÖRSTA scen-hotspot som kalibrering
 * (härleder nordoffset), sedan regenereras alla hotspots ur kartbäringar och
 * jämförs mot de handsatta yaw-värdena. Låg avvikelse = modellen håller.
 *
 * Kör: node tools/geo.test.js
 */
const fs = require("fs");
const path = require("path");
const Geo = require("../js/geo.js");

const root = path.join(__dirname, "..");
const map = JSON.parse(fs.readFileSync(path.join(root, "images/dk/hkg/map.json")));
const tour = JSON.parse(fs.readFileSync(path.join(root, "images/dk/hkg/hkg.json")));

const pos = {};
map.scenes.forEach(s => { pos[s.id] = { x: s.position.x, y: s.position.y }; });

function angErr(a, b) { return Math.abs(Geo.normalizeDeg(a - b)); }

// Kalibrera varje scen från dess första scen-hotspot som har en granne med position.
const offsets = {};
for (const [sid, scene] of Object.entries(tour.scenes)) {
  if (!pos[sid]) continue;
  for (const hs of scene.hotSpots || []) {
    if (hs.type === "scene" && hs.sceneId && pos[hs.sceneId]) {
      offsets[sid] = Geo.deriveOffset(pos[sid], pos[hs.sceneId], hs.yaw);
      break;
    }
  }
}

// Jämför predikterad yaw mot handsatt yaw för varje scen-hotspot.
let n = 0, sum = 0, worst = 0, worstWhere = "";
const perScene = {};
for (const [sid, scene] of Object.entries(tour.scenes)) {
  if (!pos[sid] || offsets[sid] === undefined) continue;
  for (const hs of scene.hotSpots || []) {
    if (hs.type !== "scene" || !hs.sceneId || !pos[hs.sceneId]) continue;
    const pred = Geo.hotspotYaw(pos[sid], pos[hs.sceneId], offsets[sid]);
    const err = angErr(pred, hs.yaw);
    n++; sum += err;
    (perScene[sid] = perScene[sid] || []).push(err);
    if (err > worst) { worst = err; worstWhere = `scen ${sid} -> ${hs.sceneId}`; }
  }
}

console.log(`Jämförde ${n} hotspots i ${Object.keys(perScene).length} scener`);
console.log(`Medelfel:  ${(sum / n).toFixed(1)}°`);
console.log(`Största fel: ${worst.toFixed(1)}° (${worstWhere})`);

// Andel hotspots inom rimlig tolerans (kalibrerings-hotspoten själv ger 0).
const flat = Object.values(perScene).flat();
const within5 = flat.filter(e => e <= 5).length / flat.length * 100;
const within10 = flat.filter(e => e <= 10).length / flat.length * 100;
console.log(`Inom 5°:  ${within5.toFixed(0)}%`);
console.log(`Inom 10°: ${within10.toFixed(0)}%`);

// Lista scener med dålig passning (median > 15°) - dessa har trolig felkälla
// (slarvig handplacering eller fel kartposition) och bör flaggas i UI:t.
const bad = [];
for (const [sid, errs] of Object.entries(perScene)) {
  const sorted = [...errs].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  if (med > 15) bad.push(`${sid} (median ${med.toFixed(0)}°)`);
}
console.log(bad.length ? `Dålig passning: ${bad.join(", ")}` : "Alla scener passar väl");

// Enkelt godkänt-kriterium: minst 80% inom 10°.
if (within10 >= 80) {
  console.log("\nOK: modellen håller (>=80% inom 10°)");
  process.exit(0);
} else {
  console.log("\nFEL: för stor avvikelse");
  process.exit(1);
}
