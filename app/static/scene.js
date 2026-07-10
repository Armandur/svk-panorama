/*
 * Scenvy: kalibrera nordoffset per scen och auto-generera hotspots.
 *
 * Panoramat visas med den nedskalade previewen (snabbt; yaw är oberoende av
 * upplösning). Kalibrering: vrid vyn så en granne är centrerad och klicka på
 * grannen -> offset härleds ur kartbäringen (js/geo.js). Generering: skapar
 * hotspots för alla länkar (enkelriktad -> en, dubbelriktad -> två).
 */
(function () {
	"use strict";

	const panoEl = document.getElementById("panorama");
	if (!panoEl || !window.pannellum || !window.Geo) return;

	const slug = document.body.dataset.slug;
	const tour = JSON.parse(document.getElementById("tour-data").textContent);
	const mapData = JSON.parse(document.getElementById("map-data").textContent);
	if (!tour.scenes) tour.scenes = {};

	const positions = {};
	(mapData.scenes || []).forEach(function (s) { positions[s.id] = { x: s.position.x, y: s.position.y }; });

	const edges = (mapData.edges || []).map(function (e) {
		return Array.isArray(e) ? { from: e[0], to: e[1], twoway: true } : { from: e.from, to: e.to, twoway: e.twoway !== false };
	});

	// Nordoffset + vilken granne kalibreringen gjordes mot (per scen).
	const offsets = {};
	const calibRef = {};
	Object.keys(tour.scenes).forEach(function (id) {
		const o = tour.scenes[id].northOffset;
		if (o !== undefined && o !== null) offsets[id] = o;
		if (tour.scenes[id].calibRef) calibRef[id] = tour.scenes[id].calibRef;
	});

	const state = { dirty: false };
	let savedSnapshot = snapshot();

	// --- DOM ---
	const curSceneEl = document.getElementById("cur-scene");
	const calibStateEl = document.getElementById("calib-state");
	const neighborList = document.getElementById("neighbor-list");
	const readinessEl = document.getElementById("scene-readiness");
	const dirtyBadge = document.getElementById("dirty-badge");
	const saveBtn = document.getElementById("save-tour-btn");
	const discardBtn = document.getElementById("discard-tour-btn");
	const generateBtn = document.getElementById("generate-btn");
	const sceneTitleInput = document.getElementById("scene-title");
	const sceneTitleLabel = document.getElementById("scene-title-label");
	const fullresToggle = document.getElementById("fullres-toggle");
	const rollInput = document.getElementById("horizon-roll");
	const rollNum = document.getElementById("horizon-roll-num");
	let rollTimer = null;

	// Slider och inmatningsruta hålls synkade; själva omladdningen debouncas.
	function onRollChange(v) {
		const cur = viewer.getScene();
		if (!tour.scenes[cur] || isNaN(v)) return;
		v = Math.max(-20, Math.min(20, v));
		tour.scenes[cur].horizonRoll = v;
		if (rollInput) rollInput.value = v;
		if (rollNum) rollNum.value = v;
		setDirty(true);
		if (rollTimer) clearTimeout(rollTimer);
		rollTimer = setTimeout(applyRoll, 180);
	}

	let fullRes = false, applyingRes = false;
	function previewUrl(id) { return "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(id) + ".jpg"; }
	function fullUrl(id) { return tour.scenes[id].panorama; }
	function applyRes(id) {
		const cfg = viewer.getConfig().scenes[id];
		if (!cfg) return;
		const want = fullRes ? fullUrl(id) : previewUrl(id);
		if (cfg.panorama !== want) { cfg.panorama = want; applyingRes = true; viewer.loadScene(id); }
	}
	// Applicera horizonRoll på aktuell scen (kräver omladdning; behåll vyn).
	function applyRoll() {
		const cur = viewer.getScene();
		const cfg = viewer.getConfig().scenes[cur];
		if (!cfg) return;
		cfg.horizonRoll = tour.scenes[cur].horizonRoll || 0;
		applyingRes = true; // hindra res-omladdning i scenechange-hanteraren
		viewer.loadScene(cur, viewer.getPitch(), viewer.getYaw(), viewer.getHfov());
	}
	function updateTitleLabel(id) {
		if (sceneTitleLabel) sceneTitleLabel.textContent = (tour.scenes[id] && tour.scenes[id].title) || "";
	}

	// Minikarta uppe till höger: prickar för scener, markerar aktuell + hovrad.
	const mapImg = document.getElementById("scene-map-img");
	const mapDots = document.getElementById("scene-map-dots");
	const dotEls = {};
	function buildMapDots() {
		if (!mapDots || !mapImg || !mapImg.naturalWidth) return;
		mapDots.innerHTML = "";
		Object.keys(dotEls).forEach(function (k) { delete dotEls[k]; });
		(mapData.scenes || []).forEach(function (s) {
			const d = document.createElement("div");
			d.className = "scene-dot";
			d.style.left = (s.position.x / mapImg.naturalWidth * 100) + "%";
			d.style.top = (s.position.y / mapImg.naturalHeight * 100) + "%";
			d.title = "Scen " + s.id;
			mapDots.appendChild(d);
			dotEls[s.id] = d;
		});
	}
	function updateMapDots(currentId, highlightId) {
		Object.keys(dotEls).forEach(function (id) {
			dotEls[id].classList.toggle("current", id === currentId);
			dotEls[id].classList.toggle("highlight", id === highlightId);
		});
	}

	function round2(n) { return Math.round(n * 100) / 100; }

	function sceneIds() {
		return Object.keys(tour.scenes).sort(function (a, b) {
			return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
		});
	}

	function neighbors(id) {
		const set = {};
		edges.forEach(function (e) {
			if (e.from === id) set[e.to] = 1;
			if (e.to === id) set[e.from] = 1;
		});
		return Object.keys(set).filter(function (n) { return positions[n]; });
	}

	function snapshot() {
		const scenes = {};
		Object.keys(tour.scenes).forEach(function (id) {
			scenes[id] = {
				off: (offsets[id] == null ? null : offsets[id]),
				cr: calibRef[id] || null,
				ti: tour.scenes[id].title || null,
				ro: tour.scenes[id].horizonRoll || null,
				hs: tour.scenes[id].hotSpots || [],
			};
		});
		return JSON.stringify(scenes);
	}

	function setDirty(v) {
		state.dirty = v;
		if (dirtyBadge) dirtyBadge.hidden = !v;
		if (saveBtn) saveBtn.classList.toggle("has-changes", v);
		if (discardBtn) discardBtn.hidden = !v;
	}

	// --- Pannellum ---
	const cfgScenes = {};
	sceneIds().forEach(function (id) {
		cfgScenes[id] = {
			type: "equirectangular",
			panorama: "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(id) + ".jpg",
			hotSpots: (tour.scenes[id].hotSpots || []).slice(),
		};
		if (tour.scenes[id].horizonRoll) cfgScenes[id].horizonRoll = tour.scenes[id].horizonRoll;
	});
	const firstScene = (tour.default && tour.default.firstScene && cfgScenes[tour.default.firstScene])
		? tour.default.firstScene : sceneIds()[0];

	const viewer = pannellum.viewer("panorama", {
		default: { firstScene: firstScene, autoLoad: true, sceneFadeDuration: 800 },
		scenes: cfgScenes,
	});

	viewer.on("load", refreshSidebar);
	viewer.on("scenechange", function () {
		setTimeout(function () {
			refreshSidebar();
			if (applyingRes) { applyingRes = false; return; }
			applyRes(viewer.getScene()); // ladda full upplösning om läget är på
		}, 50);
	});

	if (sceneTitleInput) sceneTitleInput.addEventListener("input", function () {
		const cur = viewer.getScene();
		if (!tour.scenes[cur]) return;
		tour.scenes[cur].title = sceneTitleInput.value;
		updateTitleLabel(cur);
		setDirty(true);
	});
	if (fullresToggle) fullresToggle.addEventListener("change", function () {
		fullRes = fullresToggle.checked;
		applyRes(viewer.getScene());
	});
	if (rollInput) rollInput.addEventListener("input", function () { onRollChange(parseFloat(rollInput.value)); });
	if (rollNum) rollNum.addEventListener("input", function () { onRollChange(parseFloat(rollNum.value)); });

	if (mapImg) {
		if (mapImg.complete && mapImg.naturalWidth) buildMapDots();
		else mapImg.addEventListener("load", function () { buildMapDots(); updateMapDots(viewer.getScene(), null); });
	}

	// --- Sidopanel ---
	function refreshSidebar() {
		const cur = viewer.getScene();
		if (curSceneEl) curSceneEl.textContent = cur;
		if (sceneTitleInput) sceneTitleInput.value = (tour.scenes[cur] && tour.scenes[cur].title) || "";
		{
			const r = (tour.scenes[cur] && tour.scenes[cur].horizonRoll) || 0;
			if (rollInput) rollInput.value = r;
			if (rollNum) rollNum.value = r;
		}
		updateTitleLabel(cur);
		renderCalibState(cur);
		renderNeighbors(cur);
		renderReadiness();
		updateMapDots(cur, null);
	}

	function renderCalibState(cur) {
		if (!calibStateEl) return;
		if (offsets[cur] != null) {
			calibStateEl.className = "readiness ok";
			calibStateEl.textContent = "Kalibrerad (offset " + round2(offsets[cur]) + " grader).";
		} else {
			calibStateEl.className = "readiness warn";
			calibStateEl.textContent = "Ej kalibrerad.";
		}
	}

	function renderNeighbors(cur) {
		if (!neighborList) return;
		neighborList.innerHTML = "";
		const ns = neighbors(cur);
		if (!ns.length) {
			const p = document.createElement("p");
			p.className = "hint";
			p.textContent = "Inga länkade grannar. Länka scenen i placeringssteget först.";
			neighborList.appendChild(p);
			return;
		}
		ns.forEach(function (n) {
			const row = document.createElement("div");
			row.className = "neighbor-row";

			const isRef = calibRef[cur] === n;
			const b = document.createElement("button");
			b.type = "button";
			b.className = "secondary neighbor-btn" + (isRef ? " calibrated" : "");
			b.textContent = (isRef ? "Kalibrerad mot scen " : "Sikta mot scen ") + n;
			b.title = isRef ? "Klicka för att kalibrera om" : "";
			b.addEventListener("click", function () { calibrate(cur, n); });

			// Icke-knapp att hovra för att förhandsvisa scenen (auto-roterande).
			const peek = document.createElement("span");
			peek.className = "neighbor-peek";
			peek.textContent = "◉"; // fisköga - ser ut som ett öga/mål
			peek.title = "Förhandsvisa scen " + n;
			if (window.ScenePreview) window.ScenePreview.attach(peek, slug, n);

			// Hovra raden markerar grannens prick på minikartan.
			row.addEventListener("mouseenter", function () { updateMapDots(cur, n); });
			row.addEventListener("mouseleave", function () { updateMapDots(cur, null); });

			row.appendChild(b);
			row.appendChild(peek);
			neighborList.appendChild(row);
		});
	}

	function renderReadiness() {
		if (!readinessEl) return;
		const inGraph = {};
		edges.forEach(function (e) { inGraph[e.from] = 1; inGraph[e.to] = 1; });
		const uncal = Object.keys(inGraph).filter(function (id) { return offsets[id] == null; });
		if (!Object.keys(inGraph).length) {
			readinessEl.className = "readiness";
			readinessEl.textContent = "";
		} else if (uncal.length) {
			readinessEl.className = "readiness warn";
			readinessEl.textContent = "Okalibrerade scener: " + uncal.sort().join(", ") + ".";
		} else {
			readinessEl.className = "readiness ok";
			readinessEl.textContent = "Alla länkade scener kalibrerade - klart att generera.";
		}
	}

	// --- Kalibrering ---
	function calibrate(cur, neighbor) {
		if (!positions[cur] || !positions[neighbor]) return;
		const yaw = viewer.getYaw();
		offsets[cur] = round2(Geo.deriveOffset(positions[cur], positions[neighbor], yaw));
		calibRef[cur] = neighbor;
		setDirty(true);
		refreshSidebar();
		showToast("Scen " + cur + " kalibrerad mot " + neighbor, "ok");
	}

	// --- Generering ---
	function generate() {
		const result = {};
		const skipped = [];
		function addDir(a, b) {
			if (!positions[a] || !positions[b] || offsets[a] == null || offsets[b] == null) { skipped.push(a + "->" + b); return; }
			(result[a] = result[a] || []).push({
				pitch: 0,
				yaw: round2(Geo.hotspotYaw(positions[a], positions[b], offsets[a])),
				type: "scene",
				sceneId: b,
				targetPitch: 0,
				targetYaw: round2(Geo.targetYaw(positions[a], positions[b], offsets[b])),
			});
		}
		edges.forEach(function (e) { addDir(e.from, e.to); if (e.twoway) addDir(e.to, e.from); });

		let total = 0;
		sceneIds().forEach(function (id) {
			const scene = tour.scenes[id];
			const kept = (scene.hotSpots || []).filter(function (h) { return h.type !== "scene" || h.URL; });
			const merged = kept.concat(result[id] || []);
			merged.forEach(function (h, i) { h.id = i; });
			scene.hotSpots = merged;
			total += (result[id] || []).length;
			const cfg = viewer.getConfig().scenes[id];
			if (cfg) cfg.hotSpots = merged;
		});

		viewer.loadScene(viewer.getScene()); // visa hotspots i aktuell scen
		setDirty(true);
		let msg = "Genererade " + total + " hotspots.";
		if (skipped.length) msg += " Hoppade över " + skipped.length + " (okalibrerad/oplacerad).";
		showToast(msg, skipped.length ? "error" : "ok");
	}

	// --- Spara / släng ---
	async function save() {
		saveBtn.setAttribute("aria-busy", "true");
		try {
			const payload = { scenes: {} };
			sceneIds().forEach(function (id) {
				payload.scenes[id] = {
					northOffset: (offsets[id] == null ? null : offsets[id]),
					calibRef: calibRef[id] || null,
					title: tour.scenes[id].title || null,
					horizonRoll: tour.scenes[id].horizonRoll || null,
					hotSpots: tour.scenes[id].hotSpots || [],
				};
			});
			await apiFetch("/projects/" + encodeURIComponent(slug) + "/tour", { method: "POST", body: payload });
			savedSnapshot = snapshot();
			setDirty(false);
			showToast("Sparat", "ok");
		} catch (err) {
			showToast("Kunde inte spara: " + err.message, "error");
		} finally {
			saveBtn.removeAttribute("aria-busy");
		}
	}

	function discard() {
		if (!state.dirty) return;
		if (!confirm("Släng alla ändringar sedan senaste sparning?")) return;
		const snap = JSON.parse(savedSnapshot);
		Object.keys(tour.scenes).forEach(function (id) {
			const s = snap[id];
			if (s.off == null) delete offsets[id]; else offsets[id] = s.off;
			if (s.cr == null) delete calibRef[id]; else calibRef[id] = s.cr;
			if (s.ti == null) delete tour.scenes[id].title; else tour.scenes[id].title = s.ti;
			if (s.ro == null) delete tour.scenes[id].horizonRoll; else tour.scenes[id].horizonRoll = s.ro;
			const cfg = viewer.getConfig().scenes[id];
			if (cfg) { cfg.hotSpots = s.hs; cfg.horizonRoll = s.ro || 0; }
			tour.scenes[id].hotSpots = s.hs;
		});
		viewer.loadScene(viewer.getScene());
		setDirty(false);
		refreshSidebar();
	}

	// --- Navigering + knappar ---
	function step(delta) {
		const ids = sceneIds();
		const i = ids.indexOf(viewer.getScene());
		const next = ids[(i + delta + ids.length) % ids.length];
		if (next) viewer.loadScene(next);
	}
	const prevBtn = document.getElementById("prev-scene");
	const nextBtn = document.getElementById("next-scene");
	if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); });
	if (nextBtn) nextBtn.addEventListener("click", function () { step(1); });
	if (generateBtn) generateBtn.addEventListener("click", generate);
	if (saveBtn) saveBtn.addEventListener("click", save);
	if (discardBtn) discardBtn.addEventListener("click", discard);

	const helpBtn = document.getElementById("help-btn");
	const helpModal = document.getElementById("help-modal");
	const helpClose = document.getElementById("help-close");
	if (helpBtn && helpModal) helpBtn.addEventListener("click", function () { helpModal.hidden = false; });
	if (helpClose && helpModal) helpClose.addEventListener("click", function () { helpModal.hidden = true; });
	if (helpModal) helpModal.addEventListener("click", function (e) { if (e.target === helpModal) helpModal.hidden = true; });

	window.addEventListener("keydown", function (e) {
		if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); save(); }
		else if (e.key === "Escape" && helpModal && !helpModal.hidden) helpModal.hidden = true;
	});
	window.addEventListener("beforeunload", function (e) {
		if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
	});
})();
