/*
 * Planeringsvy: placera scener på kartan, länka dem (enväg/tvåväg) och ta bort.
 * Fristående modul. Koordinater i kartbildens naturliga pixelrum (samma rum som
 * js/geo.js), SVG-overlayen använder viewBox så allt skalar med kartan.
 *
 * Verktygslägen (state.mode):
 *   place   - klick placerar vald scen, dra flyttar markörer (default)
 *   two     - dra mellan markörer -> tvåvägslänk (ingen pil)
 *   one     - dra mellan markörer -> envägslänk from->to (pil)
 *   unplace - klick på markör tar bort scenen från kartan (åter till oplacerade)
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
	const toolTwo = document.getElementById("tool-two");
	const toolOne = document.getElementById("tool-one");
	const toolUnplace = document.getElementById("tool-unplace");
	const saveBtn = document.getElementById("save-map-btn");

	const tour = JSON.parse(document.getElementById("tour-data").textContent);
	const mapData = JSON.parse(document.getElementById("map-data").textContent);
	if (!Array.isArray(mapData.scenes)) mapData.scenes = [];
	// Normalisera länkar: äldre format [a, b] -> {from, to, twoway:true}.
	mapData.edges = (Array.isArray(mapData.edges) ? mapData.edges : []).map(function (e) {
		if (Array.isArray(e)) return { from: e[0], to: e[1], twoway: true };
		return { from: e.from, to: e.to, twoway: e.twoway !== false };
	});

	const state = {
		mode: "place",
		armedId: null,
		dragId: null,
		dragEl: null,
		dragPointerId: null,
		linkFromId: null,
		linkEl: null,
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

	function findEdge(a, b) {
		return mapData.edges.findIndex(function (e) {
			return (e.from === a && e.to === b) || (e.from === b && e.to === a);
		});
	}

	// Sätt/toggla en länk. a = källa (dragstart), b = mål. twoway avgör typ.
	// Samma länk igen tar bort den; annars ersätts/skapas den med nya riktningen.
	function applyEdge(a, b, twoway) {
		const i = findEdge(a, b);
		if (i >= 0) {
			const e = mapData.edges[i];
			const same = twoway ? e.twoway === true : (e.twoway === false && e.from === a && e.to === b);
			mapData.edges.splice(i, 1);
			if (same) return; // toggla av
		}
		mapData.edges.push({ from: a, to: b, twoway: twoway });
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

	function pctOf(value, total) {
		if (!total) return 0;
		return (value / total) * 100;
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
			li.className = "unplaced-item";

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "secondary arm-btn";
			btn.textContent = "Scen " + id;
			btn.setAttribute("aria-pressed", id === state.armedId ? "true" : "false");
			btn.addEventListener("click", function () {
				state.armedId = id;
				renderUnplacedList();
			});
			if (window.ScenePreview) window.ScenePreview.attach(btn, slug, id);

			const del = document.createElement("button");
			del.type = "button";
			del.className = "secondary outline del-fully";
			del.textContent = "×";
			del.title = "Ta bort scenen helt (bilden raderas, kräver ny uppladdning)";
			del.addEventListener("click", function () { deleteSceneFully(id); });

			li.appendChild(btn);
			li.appendChild(del);
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

	function renderEdges() {
		while (svg.firstChild) svg.removeChild(svg.firstChild);
		mapData.edges.forEach(function (e) {
			const a = findPlaced(e.from);
			const b = findPlaced(e.to);
			if (!a || !b) return;
			const line = document.createElementNS(SVG_NS, "line");
			line.setAttribute("x1", a.position.x);
			line.setAttribute("y1", a.position.y);
			line.setAttribute("x2", b.position.x);
			line.setAttribute("y2", b.position.y);
			line.setAttribute("class", "graph-edge");
			svg.appendChild(line);
			if (!e.twoway) drawArrowhead(a.position, b.position);
		});
	}

	// Rita en pilspets vid mittpunkten, pekande från p1 mot p2 (envägslänk).
	function drawArrowhead(p1, p2) {
		const dx = p2.x - p1.x, dy = p2.y - p1.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len < 1) return;
		const ux = dx / len, uy = dy / len;   // riktning
		const px = -uy, py = ux;               // vinkelrät
		const s = Math.max(img.naturalWidth, img.naturalHeight) * 0.02;
		const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
		const tip = [mx + ux * s, my + uy * s];
		const b1 = [mx - ux * s * 0.3 + px * s * 0.7, my - uy * s * 0.3 + py * s * 0.7];
		const b2 = [mx - ux * s * 0.3 - px * s * 0.7, my - uy * s * 0.3 - py * s * 0.7];
		const poly = document.createElementNS(SVG_NS, "polygon");
		poly.setAttribute("points", tip.join(",") + " " + b1.join(",") + " " + b2.join(","));
		poly.setAttribute("class", "graph-arrow");
		svg.appendChild(poly);
	}

	const MODE_TEXT = { two: "Tvåvägslänk", one: "Envägslänk", unplace: "Ta bort från karta" };

	function renderStatus() {
		const placed = mapData.scenes.length;
		const total = sceneIds().length;
		let text = "Placerade: " + placed + "/" + total + " - Länkar: " + mapData.edges.length;
		if (MODE_TEXT[state.mode]) text += " - " + MODE_TEXT[state.mode] + " aktivt";
		statusBox.textContent = text;
	}

	// --- Verktygslägen ----------------------------------------------------

	function setMode(mode) {
		state.mode = (state.mode === mode) ? "place" : mode;
		toolTwo.setAttribute("aria-pressed", state.mode === "two" ? "true" : "false");
		toolOne.setAttribute("aria-pressed", state.mode === "one" ? "true" : "false");
		toolUnplace.setAttribute("aria-pressed", state.mode === "unplace" ? "true" : "false");
		renderStatus();
	}

	// --- Placering (klick på kartan) --------------------------------------

	function onStagePointerDown(e) {
		if (e.target.closest(".scene-marker")) return; // hanteras separat
		if (state.mode !== "place") return;
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

	function unplaceScene(id) {
		const i = mapData.scenes.findIndex(function (s) { return s.id === id; });
		if (i >= 0) mapData.scenes.splice(i, 1);
		mapData.edges = mapData.edges.filter(function (e) { return e.from !== id && e.to !== id; });
		render();
	}

	function deleteSceneFully(id) {
		if (!confirm("Ta bort scen " + id + " helt? Bilden raderas och måste laddas upp igen.")) return;
		const fd = new FormData();
		fd.append("csrf_token", window.getCsrfToken ? window.getCsrfToken() : "");
		fetch("/projects/" + encodeURIComponent(slug) + "/images/" + encodeURIComponent(id) + "/delete", {
			method: "POST",
			body: fd,
		}).then(function (r) {
			if (!r.ok) throw new Error("HTTP " + r.status);
			delete tour.scenes[id];
			const i = mapData.scenes.findIndex(function (s) { return s.id === id; });
			if (i >= 0) mapData.scenes.splice(i, 1);
			mapData.edges = mapData.edges.filter(function (e) { return e.from !== id && e.to !== id; });
			render();
			if (window.showToast) showToast("Scen " + id + " borttagen", "ok");
		}).catch(function (err) {
			if (window.showToast) showToast("Kunde inte ta bort: " + err.message, "error");
		});
	}

	// --- Flytta befintlig markör -----------------------------------------

	function onMarkerPointerDown(e, id) {
		e.stopPropagation();
		if (state.mode === "unplace") { e.preventDefault(); unplaceScene(id); return; }
		if (state.mode === "two" || state.mode === "one") { startLink(e, id); return; }
		e.preventDefault();
		const el = e.currentTarget;
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
		const el = state.dragEl;
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

	// --- Länkning ----------------------------------------------------------

	function startLink(e, id) {
		e.preventDefault();
		const el = e.currentTarget;
		state.linkFromId = id;
		state.linkEl = el;
		state.linkPointerId = e.pointerId;
		el.classList.add("linking-from");
		el.setPointerCapture(e.pointerId);

		const from = findPlaced(id);
		const rubber = document.createElementNS(SVG_NS, "line");
		rubber.setAttribute("x1", from.position.x);
		rubber.setAttribute("y1", from.position.y);
		rubber.setAttribute("x2", from.position.x);
		rubber.setAttribute("y2", from.position.y);
		rubber.setAttribute("class", "graph-rubber");
		svg.appendChild(rubber);
		state.rubberEl = rubber;

		el.addEventListener("pointermove", onLinkPointerMove);
		el.addEventListener("pointerup", onLinkPointerUp);
		el.addEventListener("pointercancel", onLinkPointerCancel);
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
		if (target && target !== state.linkFromId) applyEdge(state.linkFromId, target, state.mode === "two");
		finishLink();
	}

	function onLinkPointerCancel(e) {
		if (e.pointerId !== state.linkPointerId) return;
		finishLink();
	}

	function finishLink() {
		const el = state.linkEl;
		if (el) {
			el.classList.remove("linking-from");
			el.removeEventListener("pointermove", onLinkPointerMove);
			el.removeEventListener("pointerup", onLinkPointerUp);
			el.removeEventListener("pointercancel", onLinkPointerCancel);
		}
		state.linkFromId = null;
		state.linkEl = null;
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
		// viewBox i bildens naturliga pixelrum så länkar/pilar hamnar rätt när
		// kartan skalas för att passa skärmen.
		svg.setAttribute("viewBox", "0 0 " + img.naturalWidth + " " + img.naturalHeight);
		stage.addEventListener("pointerdown", onStagePointerDown);
		if (toolTwo) toolTwo.addEventListener("click", function () { setMode("two"); });
		if (toolOne) toolOne.addEventListener("click", function () { setMode("one"); });
		if (toolUnplace) toolUnplace.addEventListener("click", function () { setMode("unplace"); });
		saveBtn.addEventListener("click", saveMap);
		render();
	}

	if (img.complete && img.naturalWidth) init();
	else img.addEventListener("load", init);
})();
