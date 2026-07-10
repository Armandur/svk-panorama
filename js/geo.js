/*
 * Geometri för auto-generering av hotspots ur kartan.
 *
 * Modell: varje scen har en okänd vridning (nordoffset) eftersom panoramats
 * yaw=0 pekar åt ett godtyckligt håll. Med kartpositioner och EN kalibrerad
 * riktning per scen kan alla hotspot-yaws härledas ur kartbäringar.
 *
 * Konventioner:
 *  - Kartkoordinater (x, y) i pixlar, y ökar nedåt (skärm).
 *  - "heading" 0 = uppåt på kartan, medurs positiv.
 *  - Pannellum-yaw relateras via: yaw = heading(scen, granne) - offset[scen].
 *    Vilket teckenval Pannellum än har absorberas av kalibreringen.
 *
 * Rena funktioner, inga sidoeffekter. Fungerar i browser (global `Geo`)
 * och i node (module.exports) för test.
 */
(function (root) {
  "use strict";

  function normalizeDeg(a) {
    while (a > 180) a -= 360;
    while (a <= -180) a += 360;
    return a;
  }

  // Bäring från a till b på kartan. 0 = uppåt, medurs positiv.
  function mapHeading(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    return normalizeDeg(radToDeg(Math.atan2(dx, -dy)));
  }

  function radToDeg(r) { return r * 180 / Math.PI; }

  // Härled scenens nordoffset från en kalibrerad hotspot: användaren siktade
  // mot grannen `refNeighborId` och släppte markören på yaw `refYaw`.
  //   offset = heading(scen -> granne) - refYaw
  function deriveOffset(scenePos, refNeighborPos, refYaw) {
    return normalizeDeg(mapHeading(scenePos, refNeighborPos) - refYaw);
  }

  // Vilken yaw en hotspot mot `neighbor` ska ha i scenen, givet scenens offset.
  function hotspotYaw(scenePos, neighborPos, offset) {
    return normalizeDeg(mapHeading(scenePos, neighborPos) - offset);
  }

  // targetYaw: när man går from -> to ska blicken i `to` peka framåt in i
  // scenen, dvs bort från den scen man kom ifrån. Riktningen tillbaka mot
  // `from` i to:s panorama är hotspotYaw(to, from, offset[to]); framåt = +180.
  function targetYaw(fromPos, toPos, toOffset) {
    return normalizeDeg(hotspotYaw(toPos, fromPos, toOffset) + 180);
  }

  /*
   * Auto-generera hotspots för hela grafen.
   *
   *  positions: { sceneId: {x, y} }
   *  offsets:   { sceneId: gradtal }  (nordoffset per scen)
   *  edges:     [ [a, b], ... ]       (dubbelriktade länkar; ordning spelar roll ej)
   *
   * Returnerar { sceneId: [ {yaw, pitch, type:'scene', sceneId, targetPitch, targetYaw}, ... ] }
   * Endast scener som har både position och offset får genererade hotspots mot
   * grannar som också har position + offset. Saknade rapporteras i `.skipped`.
   */
  function generateHotspots(edges, positions, offsets, pitch) {
    pitch = (pitch === undefined) ? 0 : pitch;
    var out = {};
    var skipped = [];

    function ready(id) {
      return positions[id] && offsets[id] !== undefined && offsets[id] !== null;
    }
    function push(from, to) {
      if (!ready(from) || !ready(to)) {
        skipped.push([from, to]);
        return;
      }
      if (!out[from]) out[from] = [];
      out[from].push({
        pitch: pitch,
        yaw: round2(hotspotYaw(positions[from], positions[to], offsets[from])),
        type: "scene",
        sceneId: to,
        targetPitch: 0,
        targetYaw: round2(targetYaw(positions[from], positions[to], offsets[to]))
      });
    }

    edges.forEach(function (e) {
      push(e[0], e[1]);
      push(e[1], e[0]);
    });
    return { hotSpots: out, skipped: skipped };
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  var Geo = {
    normalizeDeg: normalizeDeg,
    mapHeading: mapHeading,
    deriveOffset: deriveOffset,
    hotspotYaw: hotspotYaw,
    targetYaw: targetYaw,
    generateHotspots: generateHotspots
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Geo;
  } else {
    root.Geo = Geo;
  }
})(typeof self !== "undefined" ? self : this);
