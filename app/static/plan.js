/*
 * Planeringsvy: placera scener på kartan, länka dem (enväg/tvåväg) och ta bort.
 * Fristående modul. Koordinater i kartbildens naturliga pixelrum (samma rum som
 * js/geo.js), SVG-overlayen använder viewBox så allt skalar med kartan.
 *
 * Verktygslägen (state.mode):
 *   place - klick på tom karta placerar vald scen, dra flyttar markörer, klick
 *           på en markör markerar scenen (fäster previewen med borttagningsknapp)
 *   two   - dra mellan markörer -> tvåvägslänk (ingen pil)
 *   one   - dra mellan markörer -> envägslänk from->to (pil nära målet)
 *
 * Hover över en scen visar bara dess egna länkar (state.edgeFocus).
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
	const saveBtn = document.getElementById("save-map-btn");
	const dirtyBadge = document.getElementById("dirty-badge");

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
		dragStart: null,
		dragMoved: false,
		linkFromId: null,
		linkEl: null,
		linkPointerId: null,
		rubberEl: null,
		edgeFocus: null, // scen-id vars länkar visas (hover), null = visa alla
		dirty: false,    // osparade ändringar
	};

	function setDirty(v) {
		state.dirty = v;
		if (dirtyBadge) dirtyBadge.hidden = !v;
		if (saveBtn) saveBtn.classList.toggle("has-changes", v);
	}

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
			// Markerad bara i placeringsläge - annars är det otydligt att man
			// inte kan placera.
			btn.setAttribute("aria-pressed", (state.mode === "place" && id === state.armedId) ? "true" : "false");
			btn.addEventListener("click", function () {
				state.armedId = id;
				setMode("place"); // välja en scen innebär att man vill placera
			});
			if (window.ScenePreview) window.ScenePreview.attach(btn, slug, id);

			const del = document.createElement("button");
			del.type = "button";
			del.className = "del-fully";
			del.textContent = "✕";
			del.setAttribute("aria-label", "Ta bort scen " + id + " helt");
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
			marker.addEventListener("mouseenter", function () { setEdgeFocus(scene.id); });
			marker.addEventListener("mouseleave", function () { setEdgeFocus(null); });
			if (window.ScenePreview) window.ScenePreview.attach(marker, slug, scene.id);
			markersLayer.appendChild(marker);
		});
	}

	// Distinkta färger så en scens många länkar går att skilja åt vid hover,
	// även när de ligger nästan parallellt.
	const EDGE_PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#00a0a0", "#f032e6", "#9a6324"];

	function renderEdges() {
		while (svg.firstChild) svg.removeChild(svg.firstChild);
		const focus = state.edgeFocus;
		let idx = 0;
		mapData.edges.forEach(function (e) {
			// När en scen hovras visas bara dess egna länkar.
			if (focus && e.from !== focus && e.to !== focus) return;
			const a = findPlaced(e.from);
			const b = findPlaced(e.to);
			if (!a || !b) return;
			const color = focus ? EDGE_PALETTE[idx++ % EDGE_PALETTE.length] : null;
			const line = document.createElementNS(SVG_NS, "line");
			line.setAttribute("x1", a.position.x);
			line.setAttribute("y1", a.position.y);
			line.setAttribute("x2", b.position.x);
			line.setAttribute("y2", b.position.y);
			line.setAttribute("class", "graph-edge");
			if (color) line.style.stroke = color;
			svg.appendChild(line);
			if (!e.twoway) drawArrowhead(a.position, b.position, color);
		});
	}

	// Liten pilspets vid målmarkörens kant (p2), pekande från p1 mot p2.
	// Storleken anges i skärm-pixlar (via user-units-per-pixel) så pilen blir
	// proportionell mot den 3px-tjocka linjen oavsett hur kartan skalas.
	function drawArrowhead(p1, p2, color) {
		const dx = p2.x - p1.x, dy = p2.y - p1.y;
		const len = Math.sqrt(dx * dx + dy * dy);
		if (len < 1) return;
		const ux = dx / len, uy = dy / len;   // riktning
		const px = -uy, py = ux;               // vinkelrät
		const rect = img.getBoundingClientRect();
		const upp = img.naturalWidth / (rect.width || img.naturalWidth); // user-units per skärm-px
		const markerR = 13 * upp;   // markörens radie (~13px)
		const aLen = 10 * upp;      // pillängd ~10px
		const aHalf = 4 * upp;      // halv bredd ~4px
		const stop = Math.min(markerR, len * 0.5);
		const tipx = p2.x - ux * stop, tipy = p2.y - uy * stop;
		const b1 = [tipx - ux * aLen + px * aHalf, tipy - uy * aLen + py * aHalf];
		const b2 = [tipx - ux * aLen - px * aHalf, tipy - uy * aLen - py * aHalf];
		const poly = document.createElementNS(SVG_NS, "polygon");
		poly.setAttribute("points", tipx + "," + tipy + " " + b1.join(",") + " " + b2.join(","));
		poly.setAttribute("class", "graph-arrow");
		if (color) poly.style.fill = color;
		svg.appendChild(poly);
	}

	const MODE_TEXT = { two: "Tvåvägslänk", one: "Envägslänk" };

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
		renderUnplacedList(); // uppdatera markering (bara synlig i placeringsläge)
		renderStatus();
	}

	function setEdgeFocus(id) {
		if (state.edgeFocus === id) return;
		state.edgeFocus = id;
		renderEdges();
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
		setDirty(true);
		render();
	}

	function unplaceScene(id) {
		const i = mapData.scenes.findIndex(function (s) { return s.id === id; });
		if (i >= 0) mapData.scenes.splice(i, 1);
		mapData.edges = mapData.edges.filter(function (e) { return e.from !== id && e.to !== id; });
		setDirty(true);
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
			setDirty(true);
			render();
			if (window.showToast) showToast("Scen " + id + " borttagen", "ok");
		}).catch(function (err) {
			if (window.showToast) showToast("Kunde inte ta bort: " + err.message, "error");
		});
	}

	// --- Flytta befintlig markör -----------------------------------------

	function onMarkerPointerDown(e, id) {
		e.stopPropagation();
		if (state.mode === "two" || state.mode === "one") { startLink(e, id); return; }
		e.preventDefault();
		const el = e.currentTarget;
		state.dragId = id;
		state.dragPointerId = e.pointerId;
		state.dragEl = el;
		state.dragStart = { x: e.clientX, y: e.clientY };
		state.dragMoved = false;
		el.setPointerCapture(e.pointerId);
		el.addEventListener("pointermove", onMarkerPointerMove);
		el.addEventListener("pointerup", onMarkerPointerUp);
		el.addEventListener("pointercancel", onMarkerPointerUp);
	}

	function onMarkerPointerMove(e) {
		if (state.dragId === null || e.pointerId !== state.dragPointerId) return;
		// Skilj klick från drag: rör sig pekaren tillräckligt blir det en drag.
		if (!state.dragMoved && state.dragStart) {
			const ddx = e.clientX - state.dragStart.x, ddy = e.clientY - state.dragStart.y;
			if (Math.sqrt(ddx * ddx + ddy * ddy) > 6) state.dragMoved = true;
		}
		if (!state.dragMoved) return;
		const pos = clientToImageCoords(e.clientX, e.clientY);
		const scene = findPlaced(state.dragId);
		if (scene) {
			scene.position = pos;
			setDirty(true);
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
		const id = state.dragId;
		const wasClick = !state.dragMoved;
		if (el) {
			el.removeEventListener("pointermove", onMarkerPointerMove);
			el.removeEventListener("pointerup", onMarkerPointerUp);
			el.removeEventListener("pointercancel", onMarkerPointerUp);
		}
		state.dragId = null;
		state.dragPointerId = null;
		state.dragEl = null;
		state.dragStart = null;
		state.dragMoved = false;
		if (wasClick && el && id !== null) selectMarker(id, el);
		else render();
	}

	// Klick på en placerad markör: fäst previewen med en knapp för att ta bort
	// scenen från kartan (åter till oplacerade).
	function selectMarker(id, el) {
		if (!window.ScenePreview || !window.ScenePreview.pin) return;
		const r = el.getBoundingClientRect();
		window.ScenePreview.pin(slug, id, r.right, r.top, [{
			label: "Ta bort från karta",
			kind: "danger",
			onClick: function () { unplaceScene(id); window.ScenePreview.unpin(); },
		}]);
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
		if (target && target !== state.linkFromId) {
			applyEdge(state.linkFromId, target, state.mode === "two");
			setDirty(true);
		}
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
			setDirty(false);
			showToast("Kartan sparad", "ok");
			return true;
		} catch (err) {
			showToast("Kunde inte spara: " + err.message, "error");
			return false;
		} finally {
			saveBtn.removeAttribute("aria-busy");
		}
	}

	// --- Skydd mot att lämna med osparade ändringar ------------------------

	function showLeaveDialog() {
		return new Promise(function (resolve) {
			const ov = document.createElement("div");
			ov.className = "leave-overlay";
			const art = document.createElement("article");
			const h = document.createElement("h3");
			h.textContent = "Osparade ändringar";
			const p = document.createElement("p");
			p.textContent = "Du har ändringar på kartan som inte är sparade. Vad vill du göra?";
			const row = document.createElement("div");
			row.className = "leave-actions";
			function mk(label, val, cls) {
				const b = document.createElement("button");
				b.type = "button";
				b.textContent = label;
				if (cls) b.className = cls;
				b.addEventListener("click", function () {
					if (ov.parentNode) document.body.removeChild(ov);
					resolve(val);
				});
				return b;
			}
			row.appendChild(mk("Spara och lämna", "save"));
			row.appendChild(mk("Lämna utan att spara", "discard", "secondary"));
			row.appendChild(mk("Avbryt", "cancel", "secondary outline"));
			art.appendChild(h);
			art.appendChild(p);
			art.appendChild(row);
			ov.appendChild(art);
			document.body.appendChild(ov);
		});
	}

	function guardLink(a) {
		a.addEventListener("click", function (e) {
			if (!state.dirty) return;
			if (a.getAttribute("aria-disabled") === "true") return;
			e.preventDefault();
			const href = a.href;
			showLeaveDialog().then(function (choice) {
				if (choice === "cancel") return;
				if (choice === "discard") { setDirty(false); window.location.href = href; return; }
				if (choice === "save") saveMap().then(function (ok) { if (ok) window.location.href = href; });
			});
		});
	}

	// --- Init ------------------------------------------------------------

	function init() {
		// viewBox i bildens naturliga pixelrum så länkar/pilar hamnar rätt när
		// kartan skalas för att passa skärmen.
		svg.setAttribute("viewBox", "0 0 " + img.naturalWidth + " " + img.naturalHeight);
		stage.addEventListener("pointerdown", onStagePointerDown);
		if (toolTwo) toolTwo.addEventListener("click", function () { setMode("two"); });
		if (toolOne) toolOne.addEventListener("click", function () { setMode("one"); });
		saveBtn.addEventListener("click", saveMap);

		// Fråga vid navigering bort med osparade ändringar.
		document.querySelectorAll(".planner-side a[href]").forEach(guardLink);
		window.addEventListener("beforeunload", function (e) {
			if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
		});

		render();
	}

	if (img.complete && img.naturalWidth) init();
	else img.addEventListener("load", init);
})();
