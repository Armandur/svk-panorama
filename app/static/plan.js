/*
 * Planeringsvy: placera scener på kartan och länka dem. Fristående modul,
 * ingen byggprocess - lånar idéer från js/graph-editor.js men är skriven
 * på nytt för serverbackad app (map.json sparas via POST).
 *
 * Koordinater lagras i kartbildens naturliga pixelrum (samma rum som
 * js/geo.js förväntar sig), så SVG-overlayen ritas med en viewBox som
 * matchar bildens naturliga bredd/höjd - då krävs ingen skalning vid
 * ändrad fönsterstorlek.
 */
(function () {
	"use strict";

	const stage = document.getElementById("map-stage");
	if (!stage) return; // ingen kartbild uppladdad än

	const slug = document.body.dataset.slug;
	const img = document.getElementById("map-image");
	const svg = document.getElementById("edges-layer");
	const markersLayer = document.getElementById("markers-layer");
	const unplacedList = document.getElementById("unplaced-list");
	const statusBox = document.getElementById("status-box");
	const linkToggle = document.getElementById("link-mode-toggle");
	const saveBtn = document.getElementById("save-map-btn");

	const tour = JSON.parse(document.getElementById("tour-data").textContent);
	const mapData = JSON.parse(document.getElementById("map-data").textContent);
	if (!Array.isArray(mapData.scenes)) mapData.scenes = [];
	if (!Array.isArray(mapData.edges)) mapData.edges = [];

	const state = {
		armedId: null,
		linkMode: false,
		dragId: null,
		dragEl: null,
		dragPointerId: null,
		linkFromId: null,
		linkPointerId: null,
		rubberEl: null,
	};

	const SVG_NS = "http://www.w3.org/2000/svg";

	// --- Data-hjälpare -------------------------------------------------

	function sceneIds() {
		return Object.keys(tour.scenes || {}).sort(function (a, b) {
			return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
		});
	}

	function findPlaced(id) {
		return mapData.scenes.find(function (s) { return s.id === id; });
	}

	function unplacedIds() {
		return sceneIds().filter(function (id) { return !findPlaced(id); });
	}

	function edgeIndex(a, b) {
		return mapData.edges.findIndex(function (e) {
			return (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a);
		});
	}

	function toggleEdge(a, b) {
		const i = edgeIndex(a, b);
		if (i >= 0) mapData.edges.splice(i, 1);
		else mapData.edges.push([a, b]);
	}

	// --- Koordinatkonvertering ------------------------------------------

	function clientToImageCoords(clientX, clientY) {
		const rect = img.getBoundingClientRect();
		const scaleX = img.naturalWidth / rect.width;
		const scaleY = img.naturalHeight / rect.height;
		let x = (clientX - rect.left) * scaleX;
		let y = (clientY - rect.top) * scaleY;
		x = Math.max(0, Math.min(img.naturalWidth, x));
		y = Math.max(0, Math.min(img.naturalHeight, y));
		return { x: Math.round(x), y: Math.round(y) };
	}

	// --- Rendering -------------------------------------------------------

	function render() {
		renderUnplacedList();
		renderMarkers();
		renderEdges();
		renderStatus();
	}

	function renderUnplacedList() {
		const ids = unplacedIds();
		unplacedList.innerHTML = "";
		if (!ids.length) {
			const li = document.createElement("li");
			li.textContent = "Alla scener är placerade.";
			unplacedList.appendChild(li);
			return;
		}
		if (state.armedId && ids.indexOf(state.armedId) === -1) state.armedId = null;
		if (!state.armedId) state.armedId = ids[0];
		ids.forEach(function (id) {
			const li = document.createElement("li");
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "secondary";
			btn.textContent = "Scen " + id;
			btn.setAttribute("aria-pressed", id === state.armedId ? "true" : "false");
			btn.addEventListener("click", function () {
				state.armedId = id;
				renderUnplacedList();
			});
			if (window.ScenePreview) window.ScenePreview.attach(btn, slug, id);
			li.appendChild(btn);
			unplacedList.appendChild(li);
		});
	}

	function renderMarkers() {
		markersLayer.innerHTML = "";
		mapData.scenes.forEach(function (scene) {
			const marker = document.createElement("div");
			marker.className = "scene-marker";
			marker.dataset.id = scene.id;
			marker.textContent = scene.id;
			marker.style.left = pctOf(scene.position.x, img.naturalWidth) + "%";
			marker.style.top = pctOf(scene.position.y, img.naturalHeight) + "%";
			marker.title = "Scen " + scene.id;
			marker.addEventListener("pointerdown", function (e) { onMarkerPointerDown(e, scene.id); });
			if (window.ScenePreview) window.ScenePreview.attach(marker, slug, scene.id);
			markersLayer.appendChild(marker);
		});
	}

	function pctOf(value, total) {
		if (!total) return 0;
		return (value / total) * 100;
	}

	function renderEdges() {
		while (svg.firstChild) svg.removeChild(svg.firstChild);
		mapData.edges.forEach(function (e) {
			const a = findPlaced(e[0]);
			const b = findPlaced(e[1]);
			if (!a || !b) return;
			const line = document.createElementNS(SVG_NS, "line");
			line.setAttribute("x1", a.position.x);
			line.setAttribute("y1", a.position.y);
			line.setAttribute("x2", b.position.x);
			line.setAttribute("y2", b.position.y);
			line.setAttribute("class", "graph-edge");
			svg.appendChild(line);
		});
	}

	function renderStatus() {
		const placed = mapData.scenes.length;
		const total = sceneIds().length;
		statusBox.textContent =
			"Placerade: " + placed + "/" + total +
			" - Länkar: " + mapData.edges.length +
			(state.linkMode ? " - Länkläge aktivt" : "");
	}

	// --- Placering (klick på kartan) --------------------------------------

	function onStagePointerDown(e) {
		if (e.target.closest(".scene-marker")) return; // hanteras separat
		if (state.linkMode) return;
		if (!state.armedId) return;
		const pos = clientToImageCoords(e.clientX, e.clientY);
		placeScene(state.armedId, pos);
	}

	function placeScene(id, pos) {
		const existing = findPlaced(id);
		if (existing) existing.position = pos;
		else mapData.scenes.push({ id: id, position: pos });
		render();
	}

	// --- Flytta befintlig markör -----------------------------------------

	function onMarkerPointerDown(e, id) {
		e.stopPropagation();
		if (state.linkMode) {
			startLink(e, id);
			return;
		}
		e.preventDefault();
		var el = e.currentTarget;
		state.dragId = id;
		state.dragPointerId = e.pointerId;
		state.dragEl = el;
		el.setPointerCapture(e.pointerId);
		el.addEventListener("pointermove", onMarkerPointerMove);
		el.addEventListener("pointerup", onMarkerPointerUp);
		el.addEventListener("pointercancel", onMarkerPointerUp);
	}

	function onMarkerPointerMove(e) {
		if (state.dragId === null || e.pointerId !== state.dragPointerId) return;
		const pos = clientToImageCoords(e.clientX, e.clientY);
		const scene = findPlaced(state.dragId);
		if (scene) {
			scene.position = pos;
			// Flytta bara det dragna elementet. renderMarkers() här skulle förstöra
			// elementet som håller pointer-capture och avbryta dragningen.
			if (state.dragEl) {
				state.dragEl.style.left = pctOf(pos.x, img.naturalWidth) + "%";
				state.dragEl.style.top = pctOf(pos.y, img.naturalHeight) + "%";
			}
			renderEdges();
		}
	}

	function onMarkerPointerUp(e) {
		if (e.pointerId !== state.dragPointerId) return;
		var el = state.dragEl;
		if (el) {
			el.removeEventListener("pointermove", onMarkerPointerMove);
			el.removeEventListener("pointerup", onMarkerPointerUp);
			el.removeEventListener("pointercancel", onMarkerPointerUp);
		}
		state.dragId = null;
		state.dragPointerId = null;
		state.dragEl = null;
		render();
	}

	// --- Länkläge ----------------------------------------------------------

	function setLinkMode(on) {
		state.linkMode = on;
		linkToggle.setAttribute("aria-pressed", on ? "true" : "false");
		renderStatus();
	}

	function startLink(e, id) {
		e.preventDefault();
		state.linkFromId = id;
		state.linkPointerId = e.pointerId;
		e.target.classList.add("linking-from");
		e.target.setPointerCapture(e.pointerId);

		const from = findPlaced(id);
		const rubber = document.createElementNS(SVG_NS, "line");
		rubber.setAttribute("x1", from.position.x);
		rubber.setAttribute("y1", from.position.y);
		rubber.setAttribute("x2", from.position.x);
		rubber.setAttribute("y2", from.position.y);
		rubber.setAttribute("class", "graph-rubber");
		svg.appendChild(rubber);
		state.rubberEl = rubber;

		e.target.addEventListener("pointermove", onLinkPointerMove);
		e.target.addEventListener("pointerup", onLinkPointerUp);
		e.target.addEventListener("pointercancel", onLinkPointerCancel);
	}

	function onLinkPointerMove(e) {
		if (e.pointerId !== state.linkPointerId || !state.rubberEl) return;
		const pos = clientToImageCoords(e.clientX, e.clientY);
		state.rubberEl.setAttribute("x2", pos.x);
		state.rubberEl.setAttribute("y2", pos.y);
	}

	function onLinkPointerUp(e) {
		if (e.pointerId !== state.linkPointerId) return;
		const pos = clientToImageCoords(e.clientX, e.clientY);
		const target = nearestMarker(pos);
		if (target && target !== state.linkFromId) toggleEdge(state.linkFromId, target);
		finishLink(e);
	}

	function onLinkPointerCancel(e) {
		if (e.pointerId !== state.linkPointerId) return;
		finishLink(e);
	}

	function finishLink(e) {
		e.target.classList.remove("linking-from");
		e.target.removeEventListener("pointermove", onLinkPointerMove);
		e.target.removeEventListener("pointerup", onLinkPointerUp);
		e.target.removeEventListener("pointercancel", onLinkPointerCancel);
		state.linkFromId = null;
		state.linkPointerId = null;
		state.rubberEl = null;
		render();
	}

	function nearestMarker(pos) {
		const threshold = Math.max(img.naturalWidth, img.naturalHeight) * 0.04;
		let best = null;
		let bestDist = threshold;
		mapData.scenes.forEach(function (scene) {
			const dx = scene.position.x - pos.x;
			const dy = scene.position.y - pos.y;
			const d = Math.sqrt(dx * dx + dy * dy);
			if (d < bestDist) { bestDist = d; best = scene.id; }
		});
		return best;
	}

	// --- Spara ---------------------------------------------------------

	async function saveMap() {
		saveBtn.setAttribute("aria-busy", "true");
		try {
			await apiFetch("/projects/" + encodeURIComponent(slug) + "/map", {
				method: "POST",
				body: { scenes: mapData.scenes, edges: mapData.edges },
			});
			showToast("Kartan sparad", "ok");
		} catch (err) {
			showToast("Kunde inte spara: " + err.message, "error");
		} finally {
			saveBtn.removeAttribute("aria-busy");
		}
	}

	// --- Init ------------------------------------------------------------

	function init() {
		// viewBox i bildens naturliga pixelrum så länklinjer (som ritas i
		// samma rum) hamnar rätt även när kartan skalas för att passa skärmen.
		svg.setAttribute("viewBox", "0 0 " + img.naturalWidth + " " + img.naturalHeight);
		stage.addEventListener("pointerdown", onStagePointerDown);
		linkToggle.addEventListener("click", function () { setLinkMode(!state.linkMode); });
		saveBtn.addEventListener("click", saveMap);
		render();
	}

	if (img.complete && img.naturalWidth) init();
	else img.addEventListener("load", init);
})();
