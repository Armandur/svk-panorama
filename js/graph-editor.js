/*
 * Graf-editor: rita länkar mellan scener på kartan, kalibrera en riktning per
 * scen och auto-generera alla hotspots ur kartgeometrin (js/geo.js).
 *
 * Fristående modul - kopplas inte in i app.js. Självinitierar på dev.html när
 * den globala `viewer` och `mapSpots` finns. Läser markörernas DOM-positioner
 * direkt så inga koordinatoffsets behöver dubbleras.
 *
 * Interaktion:
 *   G (håll) + dra mellan två scenmarkörer på kartan  -> lägg/ta bort länk
 *   N  i panoramavyn, siktad mot en granne             -> kalibrera nordoffset
 *   A                                                  -> auto-generera hotspots
 *
 * Persistens: länkar sparas i mapSpots.edges (följer med map_export.json via F),
 * nordoffset i scene.northOffset (följer med config_export.json via F).
 */
(function () {
  "use strict";

  if (!window.location.pathname.includes("dev.html")) return; // bara editorn

  var SVG_NS = "http://www.w3.org/2000/svg";
  var HALF = 7.5;      // halva markörstorleken (15px)
  var HIT = 22;        // träffradie i px vid dragning
  var state = {
    inited: false,
    graphMode: false,  // G hålls nere
    dragFrom: null,    // scen-id vi drar från
    overlay: null,
    rubber: null,
    status: null
  };

  function init() {
    if (state.inited) return;
    if (!window.viewer || typeof window.mapSpots === "undefined" || !window.mapSpots) return;
    if (!window.Geo) return;
    var container = document.getElementById("map-container");
    if (!container) return;

    if (!Array.isArray(window.mapSpots.edges)) window.mapSpots.edges = [];

    ensureOverlay(container);
    ensureStatus();
    attachListeners(container);
    render();
    state.inited = true;
    console.log("graph-editor initierad");
  }

  // --- DOM ---------------------------------------------------------------

  function ensureOverlay(container) {
    var svg = document.getElementById("graph-overlay");
    if (!svg) {
      svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("id", "graph-overlay");
      container.appendChild(svg);
    }
    state.overlay = svg;
  }

  function ensureStatus() {
    var el = document.getElementById("graph-status");
    if (!el) {
      el = document.createElement("div");
      el.id = "graph-status";
      document.body.appendChild(el);
    }
    state.status = el;
  }

  // Markörcentrum per scen-id, läst ur DOM (offset relativt #map-container).
  function markerCenters() {
    var out = {};
    document.querySelectorAll("#map-container .map-button").forEach(function (b) {
      out[b.dataset.id] = { x: b.offsetLeft + HALF, y: b.offsetTop + HALF };
    });
    return out;
  }

  // Scenpositioner ur mapSpots (för geometrin - samma koordinatrum som markörer).
  function positionsById() {
    var out = {};
    (window.mapSpots.scenes || []).forEach(function (s) {
      out[s.id] = { x: s.position.x, y: s.position.y };
    });
    return out;
  }

  function nearestMarker(x, y, centers) {
    var best = null, bestD = HIT;
    for (var id in centers) {
      var dx = centers[id].x - x, dy = centers[id].y - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  // --- Rendering ---------------------------------------------------------

  function render() {
    var svg = state.overlay;
    if (!svg) return;
    var container = document.getElementById("map-container");
    svg.setAttribute("width", container.clientWidth);
    svg.setAttribute("height", container.clientHeight);

    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var centers = markerCenters();
    (window.mapSpots.edges || []).forEach(function (e) {
      var a = centers[e[0]], b = centers[e[1]];
      if (!a || !b) return;
      var line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
      line.setAttribute("class", "graph-edge");
      svg.appendChild(line);
    });
    renderStatus();
  }

  function renderStatus() {
    if (!state.status) return;
    var positions = positionsById();
    var config = window.viewer.getConfig();
    var ids = Object.keys(config.scenes || {});
    var calibrated = ids.filter(function (id) {
      return config.scenes[id].northOffset !== undefined && config.scenes[id].northOffset !== null;
    });
    var edges = (window.mapSpots.edges || []).length;
    state.status.innerHTML =
      "<b>Graf-editor</b><br>" +
      "Länkar: " + edges + "<br>" +
      "Kalibrerat: " + calibrated.length + "/" + ids.length + " scener<br>" +
      "<span class='gk'>G</span>+dra = länka&nbsp; <span class='gk'>N</span> = kalibrera&nbsp; <span class='gk'>A</span> = generera" +
      (state.graphMode ? "<br><b class='gon'>GRAF-LÄGE PÅ</b>" : "");
  }

  // --- Interaktion: rita graf --------------------------------------------

  function setGraphMode(on) {
    state.graphMode = on;
    if (state.overlay) state.overlay.style.pointerEvents = on ? "auto" : "none";
    if (!on) clearRubber();
    renderStatus();
  }

  function localXY(e) {
    var r = document.getElementById("map-container").getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    if (!state.graphMode) return;
    var p = localXY(e);
    var from = nearestMarker(p.x, p.y, markerCenters());
    if (!from) return;
    e.preventDefault();
    state.dragFrom = from;
    startRubber(markerCenters()[from], p);
  }

  function onMove(e) {
    if (!state.dragFrom) return;
    updateRubber(localXY(e));
  }

  function onUp(e) {
    if (!state.dragFrom) return;
    var p = localXY(e);
    var to = nearestMarker(p.x, p.y, markerCenters());
    if (to && to !== state.dragFrom) toggleEdge(state.dragFrom, to);
    state.dragFrom = null;
    clearRubber();
    render();
  }

  function startRubber(a, p) {
    clearRubber();
    var line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
    line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
    line.setAttribute("class", "graph-rubber");
    state.overlay.appendChild(line);
    state.rubber = line;
  }
  function updateRubber(p) {
    if (!state.rubber) return;
    state.rubber.setAttribute("x2", p.x);
    state.rubber.setAttribute("y2", p.y);
  }
  function clearRubber() {
    if (state.rubber && state.rubber.parentNode) state.rubber.parentNode.removeChild(state.rubber);
    state.rubber = null;
  }

  function toggleEdge(a, b) {
    var edges = window.mapSpots.edges;
    var i = edges.findIndex(function (e) {
      return (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a);
    });
    if (i >= 0) edges.splice(i, 1);
    else edges.push([a, b]);
  }

  // --- Kalibrering -------------------------------------------------------

  function calibrateCurrent() {
    var current = window.viewer.getScene();
    var positions = positionsById();
    if (!positions[current]) {
      alert("Scen " + current + " saknar kartposition. Placera den på kartan först (klicka på kartan).");
      return;
    }
    var neighbor = prompt(
      "Kalibrera scen " + current + ".\n" +
      "Vrid vyn så en granne du ser är centrerad, skriv sedan grannens scen-id:");
    if (!neighbor) return;
    neighbor = neighbor.trim();
    if (!positions[neighbor]) {
      alert("Granne " + neighbor + " saknar kartposition.");
      return;
    }
    var yaw = window.viewer.getYaw();
    var offset = window.Geo.deriveOffset(positions[current], positions[neighbor], yaw);
    window.viewer.getConfig().scenes[current].northOffset = Math.round(offset * 100) / 100;
    console.log("Kalibrerade scen " + current + ": northOffset=" + offset.toFixed(2) + " (yaw " + yaw.toFixed(1) + " mot " + neighbor + ")");
    renderStatus();
  }

  // --- Auto-generering ---------------------------------------------------

  function generate() {
    var positions = positionsById();
    var config = window.viewer.getConfig();
    var offsets = {};
    Object.keys(config.scenes).forEach(function (id) {
      var o = config.scenes[id].northOffset;
      if (o !== undefined && o !== null) offsets[id] = o;
    });
    var edges = window.mapSpots.edges || [];
    if (!edges.length) { alert("Inga länkar ritade. Håll G och dra mellan scener på kartan först."); return; }

    var res = window.Geo.generateHotspots(edges, positions, offsets);

    var totalScenes = 0, totalHs = 0;
    Object.keys(res.hotSpots).forEach(function (sid) {
      var scene = config.scenes[sid];
      if (!scene) return;
      // Behåll info- och URL-hotspots, ersätt scen-länkar med genererade.
      var kept = (scene.hotSpots || []).filter(function (hs) {
        return hs.type !== "scene" || hs.URL;
      });
      var generated = res.hotSpots[sid];
      scene.hotSpots = kept.concat(generated);
      // Tilldela unika id per scen.
      scene.hotSpots.forEach(function (hs, i) { hs.id = i; });
      totalScenes += 1;
      totalHs += generated.length;
    });

    // Rapportera brister.
    var uncalibrated = [];
    var inGraph = {};
    edges.forEach(function (e) { inGraph[e[0]] = 1; inGraph[e[1]] = 1; });
    Object.keys(inGraph).forEach(function (id) {
      if (offsets[id] === undefined) uncalibrated.push(id);
    });

    // Ladda om aktuell scen så nya hotspots syns direkt.
    var current = window.viewer.getScene();
    window.viewer.loadScene(current);

    var msg = "Genererade " + totalHs + " hotspots i " + totalScenes + " scener.";
    if (res.skipped.length) msg += "\nHoppade över " + res.skipped.length + " länkar (saknad position/kalibrering).";
    if (uncalibrated.length) msg += "\nOkalibrerade scener i grafen: " + uncalibrated.join(", ");
    msg += "\n\nTryck F för att exportera turen + kartan.";
    alert(msg);
    renderStatus();
  }

  // --- Lyssnare ----------------------------------------------------------

  function attachListeners(container) {
    container.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    window.addEventListener("keydown", function (e) {
      if (e.repeat) return;
      var k = e.key.toLowerCase();
      if (k === "g") setGraphMode(true);
    });
    window.addEventListener("keyup", function (e) {
      var k = e.key.toLowerCase();
      if (k === "g") setGraphMode(false);
      else if (k === "n") calibrateCurrent();
      else if (k === "a") generate();
    });

    // Rita om när kartan öppnas (storlek blir känd först då) och vid scenbyte.
    var mapBtn = document.getElementById("show-map-btn");
    if (mapBtn) mapBtn.addEventListener("click", function () { setTimeout(render, 50); });
    if (window.viewer.on) window.viewer.on("scenechange", function () { setTimeout(render, 50); });
  }

  // Vänta in att viewer + mapSpots finns (laddas async efter tur-val).
  var poll = setInterval(function () {
    init();
    if (state.inited) clearInterval(poll);
  }, 400);
})();
