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
	const tilesEl = document.getElementById("tiles-data");
	const manifest = tilesEl ? JSON.parse(tilesEl.textContent) : {};
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
	const hotspotList = document.getElementById("hotspot-list");
	const dirtyBadge = document.getElementById("dirty-badge");
	const saveBtn = document.getElementById("save-tour-btn");
	const discardBtn = document.getElementById("discard-tour-btn");
	const generateBtn = document.getElementById("generate-btn");
	const sceneTitleInput = document.getElementById("scene-title");
	const sceneTitleLabel = document.getElementById("scene-title-label");
	const resSelect = document.getElementById("res-select");
	const resHint = document.getElementById("res-hint");
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
		// Applicera först när man slutat justera (pannellum måste ladda om scenen
		// för att sätta roll; att göra det per drag-tick blir hackigt).
		if (rollTimer) clearTimeout(rollTimer);
		rollTimer = setTimeout(applyRoll, 900);
	}

	// resMode: "preview" | "multires" | "full". Multires används bara för scener
	// som har genererade tiles (finns i manifest); annars faller vyn till preview.
	let resMode = "preview", applyingRes = false;
	function previewUrl(id) { return "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(id) + ".jpg"; }
	function fullUrl(id) { return tour.scenes[id].panorama; }
	function hasTiles(id) { return !!manifest[id]; }
	function effectiveMode(id) { return (resMode === "multires" && !hasTiles(id)) ? "preview" : resMode; }
	function applyRes(id) {
		const cfg = viewer.getConfig().scenes[id];
		if (!cfg) return;
		const mode = effectiveMode(id);
		if (mode === "multires") {
			if (cfg.type === "multires" && cfg.multiRes === manifest[id]) return;
			cfg.type = "multires";
			cfg.multiRes = manifest[id];
			delete cfg.panorama;
		} else {
			const want = mode === "full" ? fullUrl(id) : previewUrl(id);
			if (cfg.type !== "multires" && cfg.panorama === want) return;
			cfg.type = "equirectangular";
			cfg.panorama = want;
			delete cfg.multiRes;
		}
		applyingRes = true;
		viewer.loadScene(id);
	}
	// Uppdatera väljarens tillgänglighet + hint för aktuell scen.
	function updateResUi(id) {
		if (!resSelect) return;
		const multiOpt = resSelect.querySelector('option[value="multires"]');
		if (multiOpt) {
			multiOpt.disabled = !hasTiles(id);
			multiOpt.textContent = hasTiles(id) ? "Multires (tiles)" : "Multires (inga tiles)";
		}
		if (resHint && resMode === "multires" && !hasTiles(id)) {
			resHint.textContent = "Scenen saknar tiles - visar preview. Ladda upp/generera tiles för multires.";
		} else if (resHint) {
			resHint.textContent = "Preview är en nedskalad bild (snabbt). Multires använder de genererade tiles-kaklen. Full laddar originalbilden (kan vara stor).";
		}
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
			d.title = "Scen " + s.id + " - klicka för att gå hit";
			// Klick på prick = navigera till scenen (som i den riktiga turen).
			d.addEventListener("click", function () {
				if (viewer.getScene() !== s.id) viewer.loadScene(s.id);
			});
			mapDots.appendChild(d);
			dotEls[s.id] = d;
		});
	}

	// Resize av minikartan genom att dra i nedre vänstra hörnet. Kartan är fäst
	// uppe till höger, så att dra åt vänster gör den bredare (höjden följer
	// bildförhållandet). Storleken sparas per projekt i localStorage.
	const sceneMap = document.getElementById("scene-map");
	const mapResize = document.getElementById("scene-map-resize");
	const mapSizeKey = "svk-scene-map-w:" + slug;
	(function initMapResize() {
		if (!sceneMap || !mapResize) return;
		const saved = parseFloat(localStorage.getItem(mapSizeKey));
		if (saved && saved > 0) sceneMap.style.width = saved + "px";
		let startX = 0, startW = 0, dragging = false;
		mapResize.addEventListener("pointerdown", function (e) {
			e.preventDefault();
			dragging = true;
			startX = e.clientX;
			startW = sceneMap.getBoundingClientRect().width;
			mapResize.setPointerCapture(e.pointerId);
		});
		mapResize.addEventListener("pointermove", function (e) {
			if (!dragging) return;
			const w = Math.max(120, Math.min(window.innerWidth * 0.8, startW - (e.clientX - startX)));
			sceneMap.style.width = w + "px";
			sceneMap.style.maxWidth = "none"; // släpp CSS-taket när användaren styr
		});
		function end(e) {
			if (!dragging) return;
			dragging = false;
			try { mapResize.releasePointerCapture(e.pointerId); } catch (err) { /* redan släppt */ }
			localStorage.setItem(mapSizeKey, parseFloat(sceneMap.style.width) || startW);
		}
		mapResize.addEventListener("pointerup", end);
		mapResize.addEventListener("pointercancel", end);
	})();
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
		if (!tour.scenes[id].hotSpots) tour.scenes[id].hotSpots = [];
		cfgScenes[id] = {
			type: "equirectangular",
			panorama: "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(id) + ".jpg",
			hotSpots: cloneHs(tour.scenes[id].hotSpots),
		};
		if (tour.scenes[id].horizonRoll) cfgScenes[id].horizonRoll = tour.scenes[id].horizonRoll;
	});
	const firstScene = (tour.default && tour.default.firstScene && cfgScenes[tour.default.firstScene])
		? tour.default.firstScene : sceneIds()[0];

	const viewer = pannellum.viewer("panorama", {
		default: { firstScene: firstScene, autoLoad: true, sceneFadeDuration: 0 },
		scenes: cfgScenes,
	});

	viewer.on("load", function () { refreshSidebar(); updateResUi(viewer.getScene()); });
	viewer.on("scenechange", function () {
		setTimeout(function () {
			refreshSidebar();
			updateResUi(viewer.getScene());
			if (applyingRes) { applyingRes = false; return; }
			applyRes(viewer.getScene()); // applicera valt upplösningsläge på nya scenen
		}, 50);
	});

	if (sceneTitleInput) sceneTitleInput.addEventListener("input", function () {
		const cur = viewer.getScene();
		if (!tour.scenes[cur]) return;
		tour.scenes[cur].title = sceneTitleInput.value;
		updateTitleLabel(cur);
		setDirty(true);
	});
	if (resSelect) resSelect.addEventListener("change", function () {
		resMode = resSelect.value;
		const cur = viewer.getScene();
		updateResUi(cur);
		applyRes(cur);
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
		renderHotspotList(cur);
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

	// --- Hotspots (info/URL) -----------------------------------------------
	// tour är ren sanningskälla; pannellum får kloner (annars smutsas datan ner
	// med DOM-referenser som bryter JSON.stringify vid spara/snapshot).

	// Editorn visar alltid vilken scen en scen-hotspot länkar till. Det görs som
	// en injicerad etikett i pannellum-klonen (tour-datans text lämnas orörd, så
	// den färdiga turen bara får tooltip om användaren skrivit egen text).
	function sceneEditorLabel(id) {
		const t = tour.scenes[id] && tour.scenes[id].title;
		return "Scen " + id + (t ? " - " + t : "");
	}
	function cloneHs(list) {
		const cloned = (list || []).map(function (h) {
			const c = Object.assign({}, h);
			if (c.type === "scene") c.text = sceneEditorLabel(c.sceneId);
			return c;
		});
		// Markdown-tooltip på info-hotspots (bara på klonerna som pannellum får).
		if (window.attachHsTooltips) window.attachHsTooltips(cloned);
		return cloned;
	}

	// Skriv om aktuell scens hotspots i pannellum-configen från turen och ladda
	// om scenen (bevarad vy) så ändringen syns.
	function syncAndReload(cur) {
		const cfg = viewer.getConfig().scenes[cur];
		if (cfg) cfg.hotSpots = cloneHs(tour.scenes[cur].hotSpots);
		applyingRes = true;
		viewer.loadScene(cur, viewer.getPitch(), viewer.getYaw(), viewer.getHfov());
	}

	function nextHotspotId(cur) {
		const ids = (tour.scenes[cur].hotSpots || []).map(function (h) { return typeof h.id === "number" ? h.id : -1; });
		return (ids.length ? Math.max.apply(null, ids) : -1) + 1;
	}

	function sceneName(id) { return (tour.scenes[id] && tour.scenes[id].title) || ("scen " + id); }
	function computeTargetYaw(from, to) {
		if (positions[from] && positions[to] && offsets[to] != null) return round2(Geo.targetYaw(positions[from], positions[to], offsets[to]));
		return null;
	}
	function hsTypeOf(hs) { return hs.type === "scene" ? "scene" : (hs.URL ? "url" : "info"); }

	// --- Hotspot-modal ---
	const hsModal = document.getElementById("hs-modal");
	const hsFieldText = document.getElementById("hs-field-text");
	const hsFieldUrl = document.getElementById("hs-field-url");
	const hsFieldSceneTop = document.getElementById("hs-field-scene-top");
	const hsFieldSceneDir = document.getElementById("hs-field-scene-dir");
	const hsText = document.getElementById("hs-text");
	const hsBody = document.getElementById("hs-body");

	// Samma markdown-editor som i admin: EasyMDE med vår sanerade preview. Teasern
	// får en kompakt toolbar, läs mer-innehållet en fylligare. Initieras en gång;
	// value() sätts/läses per hotspot och codemirror.refresh() körs när panelen visas.
	function mkEditor(el, compact) {
		if (!window.EasyMDE || !el) return null;
		return new EasyMDE({
			element: el,
			spellChecker: false,
			status: false,
			autoDownloadFontAwesome: false,
			minHeight: compact ? "60px" : "120px",
			maxHeight: compact ? "22vh" : "38vh", // skrolla vid mycket text (input + preview)
			toolbar: compact
				? ["bold", "italic", "link", "|", "preview"]
				: ["bold", "italic", "heading", "|", "unordered-list", "ordered-list", "link", "|", "preview", "guide"],
			previewRender: function (t) { return window.renderMarkdown(t); },
		});
	}
	const hsTextEditor = mkEditor(hsText, true);
	const hsBodyEditor = mkEditor(hsBody, false);
	function hsTextVal() { return hsTextEditor ? hsTextEditor.value() : (hsText ? hsText.value : ""); }
	function hsBodyVal() { return hsBodyEditor ? hsBodyEditor.value() : (hsBody ? hsBody.value : ""); }

	// --- Flikar: Teaser / Läs mer (den senare bara när expanderbar) ---
	const hsTabs = document.getElementById("hs-tabs");
	const hsTabBtns = hsTabs ? Array.prototype.slice.call(hsTabs.querySelectorAll(".hs-tab")) : [];
	const hsPanels = Array.prototype.slice.call(document.querySelectorAll("#hs-field-text .hs-tabpanel"));
	function showTab(name) {
		hsTabBtns.forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
		hsPanels.forEach(function (p) { p.hidden = p.dataset.panel !== name; });
		if (name === "teaser" && hsTextEditor) hsTextEditor.codemirror.refresh();
		if (name === "body" && hsBodyEditor) hsBodyEditor.codemirror.refresh();
	}
	hsTabBtns.forEach(function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); }); });
	const hsTooltipWidth = document.getElementById("hs-tooltip-width");
	const hsWidthWrap = document.getElementById("hs-width-wrap");
	const hsUrl = document.getElementById("hs-url");
	const hsSceneSel = document.getElementById("hs-scene");
	const hsTyaw = document.getElementById("hs-tyaw");
	const hsTyawNum = document.getElementById("hs-tyaw-num");
	const hsTyawNote = document.getElementById("hs-tyaw-note");
	let hsCtx = null;

	function fillSceneSelect(cur, selected) {
		hsSceneSel.innerHTML = "";
		sceneIds().filter(function (id) { return id !== cur; }).forEach(function (id) {
			const o = document.createElement("option");
			o.value = id;
			o.textContent = sceneName(id) + " (" + id + ")";
			if (id === selected) o.selected = true;
			hsSceneSel.appendChild(o);
		});
	}
	function setTyaw(v) { v = (v == null) ? 0 : Math.round(v); hsTyaw.value = v; hsTyawNum.value = v; }
	function tyawNote(cur) { hsTyawNote.textContent = (computeTargetYaw(cur, hsSceneSel.value) == null) ? "Auto-beräknas när båda scenerna är kalibrerade." : ""; }

	function openHsModal(ctx) {
		hsCtx = ctx;
		document.getElementById("hs-modal-title").textContent =
			(ctx.mode === "edit" ? "Redigera " : "Ny ") + ({ info: "info-hotspot", url: "URL-hotspot", scene: "scen-hotspot" }[ctx.type]);
		hsFieldText.hidden = false; // text (tooltip) valfri för alla typer
		hsFieldUrl.hidden = ctx.type !== "url";
		hsFieldSceneTop.hidden = ctx.type !== "scene";
		hsFieldSceneDir.hidden = ctx.type !== "scene";
		const teaser = (ctx.hs && ctx.hs.text != null) ? ctx.hs.text : "";
		if (hsTextEditor) hsTextEditor.value(teaser); else hsText.value = teaser;
		// Expanderbar + rutbredd bara för rena info-hotspots (ej URL/scen).
		if (hsWidthWrap) hsWidthWrap.hidden = ctx.type !== "info";
		if (hsTooltipWidth) hsTooltipWidth.value = (ctx.hs && ctx.hs.tooltipWidth) || "";
		const bodyVal = (ctx.hs && ctx.hs.body) || "";
		if (hsBodyEditor) hsBodyEditor.value(bodyVal); else if (hsBody) hsBody.value = bodyVal;
		// Både flikarna visas alltid för info; övriga typer har bara teasern.
		if (hsTabs) hsTabs.hidden = ctx.type !== "info";
		showTab("teaser");
		hsUrl.value = (ctx.hs && ctx.hs.URL) || "";
		if (ctx.type === "scene") {
			const target = (ctx.hs && ctx.hs.sceneId) || sceneIds().filter(function (id) { return id !== ctx.cur; })[0];
			hsCtx.target = target;
			fillSceneSelect(ctx.cur, target);
			const two = ctx.hs ? hasReciprocal(ctx.cur, target) : false;
			document.querySelector('input[name="hs-dir"][value="' + (two ? "two" : "one") + '"]').checked = true;
			setTyaw(ctx.hs && ctx.hs.targetYaw != null ? ctx.hs.targetYaw : computeTargetYaw(ctx.cur, target));
			tyawNote(ctx.cur);
		}
		hsModal.hidden = false;
		// EasyMDE/CodeMirror renderar 0-höjd om den initierats dold -> refresh när
		// modalen visas, sedan fokus.
		if (hsTextEditor) hsTextEditor.codemirror.refresh();
		if (ctx.type === "scene") hsSceneSel.focus();
		else if (hsTextEditor) hsTextEditor.codemirror.focus();
		else hsText.focus();
		if (ctx.type === "scene") showHsPreview(hsCtx.target);
	}
	function closeHsModal() { hsModal.hidden = true; hsCtx = null; destroyHsPreview(); }

	// Liten auto-roterande preview av vald målscen i modalen.
	let hsPreviewViewer = null, hsPreviewStop = null;
	function destroyHsPreview() {
		if (hsPreviewStop) { try { hsPreviewStop(); } catch (e) { /* borta */ } hsPreviewStop = null; }
		if (hsPreviewViewer) { try { hsPreviewViewer.destroy(); } catch (e) { /* borta */ } hsPreviewViewer = null; }
	}
	function showHsPreview(sceneId) {
		destroyHsPreview();
		const el = document.getElementById("hs-scene-preview");
		if (!el || !sceneId || !window.pannellum) return;
		void el.offsetHeight; // reflow så pannellum mäter rätt
		hsPreviewViewer = pannellum.viewer(el, {
			type: "equirectangular",
			panorama: "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(sceneId) + ".jpg",
			autoLoad: true, autoRotate: 0,
			showControls: false, showZoomCtrl: false, showFullscreenCtrl: false,
			mouseZoom: false, draggable: false, hfov: 110,
		});
		// Samma drivning (yaw + vagg) som hover-previewsen, från deras inställningar.
		if (window.ScenePreview && window.ScenePreview.driveViewer) {
			hsPreviewStop = window.ScenePreview.driveViewer(hsPreviewViewer);
		}
	}

	// Dubbelriktning härleds från om en länk tillbaka faktiskt finns i målscenen.
	function hasReciprocal(fromScene, toScene) {
		const list = (tour.scenes[toScene] && tour.scenes[toScene].hotSpots) || [];
		return list.some(function (h) { return h.type === "scene" && h.sceneId === fromScene; });
	}
	function syncConfig(id) {
		const cfg = viewer.getConfig().scenes[id];
		if (cfg) cfg.hotSpots = cloneHs(tour.scenes[id].hotSpots);
	}
	function ensureReciprocal(fromScene, toScene) {
		if (hasReciprocal(fromScene, toScene)) return;
		const list = tour.scenes[toScene].hotSpots = tour.scenes[toScene].hotSpots || [];
		const yaw = (positions[toScene] && positions[fromScene] && offsets[toScene] != null)
			? round2(Geo.hotspotYaw(positions[toScene], positions[fromScene], offsets[toScene])) : 0;
		list.push({
			id: nextHotspotId(toScene), pitch: 0, yaw: yaw, type: "scene", sceneId: fromScene,
			targetPitch: 0, targetYaw: computeTargetYaw(toScene, fromScene) || 0,
			manual: true, twoway: true,
		});
		syncConfig(toScene);
	}
	function removeReciprocal(fromScene, toScene) {
		if (!tour.scenes[toScene]) return;
		tour.scenes[toScene].hotSpots = (tour.scenes[toScene].hotSpots || []).filter(function (h) {
			return !(h.type === "scene" && h.sceneId === fromScene);
		});
		syncConfig(toScene);
	}

	function saveHsModal() {
		if (!hsCtx) return;
		const cur = hsCtx.cur;
		if (!tour.scenes[cur].hotSpots) tour.scenes[cur].hotSpots = [];
		const creating = hsCtx.mode === "create";
		let hs = creating ? { id: nextHotspotId(cur), pitch: hsCtx.pitch, yaw: hsCtx.yaw, manual: true } : hsCtx.hs;
		const teaserV = hsTextVal();
		const bodyV = hsBodyVal();
		if (hsCtx.type === "url") {
			if (!hsUrl.value) { alert("URL krävs."); return; }
			hs.type = "info"; hs.text = teaserV; hs.URL = hsUrl.value;
			delete hs.expandable; delete hs.body;
		} else if (hsCtx.type === "info") {
			hs.type = "info"; hs.text = teaserV; delete hs.URL;
			// Expanderbar härleds: finns text i Läs mer-fliken -> expanderbar.
			if (bodyV.trim()) { hs.expandable = true; hs.body = bodyV; }
			else { delete hs.expandable; delete hs.body; }
			if (hsTooltipWidth && hsTooltipWidth.value) hs.tooltipWidth = hsTooltipWidth.value;
			else delete hs.tooltipWidth;
		} else { // scene
			const target = hsSceneSel.value;
			if (!target) { alert("Välj en målscen."); return; }
			hs.type = "scene"; hs.sceneId = target; hs.targetPitch = 0;
			hs.targetYaw = parseFloat(hsTyaw.value) || 0;
			if (teaserV) hs.text = teaserV; else delete hs.text;
			delete hs.URL;
			const two = document.querySelector('input[name="hs-dir"]:checked').value === "two";
			hs.twoway = two;
			if (two) ensureReciprocal(cur, target); else removeReciprocal(cur, target);
		}
		if (creating) tour.scenes[cur].hotSpots.push(hs);
		closeHsModal();
		setDirty(true);
		syncAndReload(cur);
	}

	function beginCreate(type) {
		openHsModal({ mode: "create", type: type, cur: viewer.getScene(), pitch: round2(viewer.getPitch()), yaw: round2(viewer.getYaw()) });
	}

	// Modal-wiring
	if (hsTyaw) hsTyaw.addEventListener("input", function () { hsTyawNum.value = hsTyaw.value; });
	if (hsTyawNum) hsTyawNum.addEventListener("input", function () { hsTyaw.value = hsTyawNum.value; });
	const hsRegen = document.getElementById("hs-tyaw-regen");
	if (hsRegen) hsRegen.addEventListener("click", function () {
		if (!hsCtx || hsCtx.type !== "scene") return;
		const ty = computeTargetYaw(hsCtx.cur, hsSceneSel.value);
		if (ty == null) { alert("Kan inte beräkna - kalibrera målscenen först."); return; }
		setTyaw(ty);
	});
	if (hsSceneSel) hsSceneSel.addEventListener("change", function () {
		if (!hsCtx) return;
		const target = hsSceneSel.value;
		const ty = computeTargetYaw(hsCtx.cur, target);
		if (ty != null) setTyaw(ty);
		tyawNote(hsCtx.cur);
		// Spegla om det nya målet redan har en länk tillbaka.
		const two = hasReciprocal(hsCtx.cur, target);
		document.querySelector('input[name="hs-dir"][value="' + (two ? "two" : "one") + '"]').checked = true;
		showHsPreview(target);
	});
	if (hsModal) {
		document.getElementById("hs-save").addEventListener("click", saveHsModal);
		document.getElementById("hs-cancel").addEventListener("click", closeHsModal);
		document.getElementById("hs-modal-close").addEventListener("click", closeHsModal);
		hsModal.addEventListener("click", function (e) { if (e.target === hsModal) closeHsModal(); });
	}

	// Tangent: håll I/U/H, sikta, släpp -> modal.
	const pendingEl = document.getElementById("hs-pending");
	let pendingType = null;
	const KEY_TYPE = { i: "info", u: "url", h: "scene" };
	function typingInField() { const a = document.activeElement; return a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); }
	window.addEventListener("keydown", function (e) {
		if (e.repeat || typingInField() || (hsModal && !hsModal.hidden)) return;
		const t = KEY_TYPE[e.key.toLowerCase()];
		if (t && !pendingType) {
			pendingType = t;
			if (pendingEl) { pendingEl.className = "hs-pending hs-pending-" + t; pendingEl.hidden = false; }
		}
	});
	window.addEventListener("keyup", function (e) {
		const t = KEY_TYPE[e.key.toLowerCase()];
		if (t && pendingType === t) {
			if (pendingEl) pendingEl.hidden = true;
			pendingType = null;
			// Siktar man på en befintlig hotspot av samma typ -> redigera den i
			// stället för att skapa en ny.
			const cur = viewer.getScene();
			const aimed = nearestId != null
				? (tour.scenes[cur].hotSpots || []).find(function (h) { return h.id === nearestId; })
				: null;
			if (aimed && hsTypeOf(aimed) === t) {
				openHsModal({ mode: "edit", type: t, cur: cur, hs: aimed });
			} else {
				beginCreate(t);
			}
		}
	});

	// --- Pass 2: ring på närmaste hotspot + greppa/flytta med Space -----------
	let nearestId = null, grabbed = null;
	function currentClones() {
		const cfg = viewer.getConfig().scenes[viewer.getScene()];
		return (cfg && cfg.hotSpots) || [];
	}
	function setNearest(h) {
		currentClones().forEach(function (x) { if (x.div) x.div.classList.toggle("hs-nearest", x === h); });
		nearestId = h ? h.id : null;
	}
	// Närmast i SKÄRMPIXLAR till hårkorset (mitten), och bara om inom en tröskel -
	// annars ingen ring (globalt närmast skulle alltid markera nåt).
	function updateNearest() {
		if (grabbed || (hsModal && !hsModal.hidden)) { setNearest(null); return; }
		const rect = panoEl.getBoundingClientRect();
		const ccx = rect.left + rect.width / 2, ccy = rect.top + rect.height / 2;
		let best = null, bestD = Math.min(rect.width, rect.height) * 0.10; // tröskel
		currentClones().forEach(function (h) {
			if (!h.div) return;
			const r = h.div.getBoundingClientRect();
			if (!r.width || !r.height) return; // dold/bakom
			const d = Math.hypot(r.left + r.width / 2 - ccx, r.top + r.height / 2 - ccy);
			if (d < bestD) { bestD = d; best = h; }
		});
		setNearest(best);
	}
	(function nearestTick() { try { updateNearest(); } catch (e) { /* ännu ej redo */ } requestAnimationFrame(nearestTick); })();

	function isSpace(e) { return e.code === "Space" || e.key === " "; }
	window.addEventListener("keydown", function (e) {
		if (!isSpace(e)) return;
		if (typingInField() || (hsModal && !hsModal.hidden) || grabbed || nearestId == null) return;
		const cur = viewer.getScene();
		const hs = (tour.scenes[cur].hotSpots || []).find(function (h) { return h.id === nearestId; });
		if (!hs) return;
		e.preventDefault();
		grabbed = hs;
		try { viewer.removeHotSpot(hs.id); } catch (er) { /* redan borta */ }
		if (pendingEl) { pendingEl.className = "hs-pending hs-pending-grab"; pendingEl.hidden = false; }
	});
	window.addEventListener("keyup", function (e) {
		if (!isSpace(e) || !grabbed) return;
		const cur = viewer.getScene();
		grabbed.pitch = round2(viewer.getPitch());
		grabbed.yaw = round2(viewer.getYaw());
		grabbed = null;
		if (pendingEl) pendingEl.hidden = true;
		setDirty(true);
		syncAndReload(cur);
	});

	function moveHotspot(cur, hs) {
		hs.pitch = round2(viewer.getPitch());
		hs.yaw = round2(viewer.getYaw());
		setDirty(true);
		syncAndReload(cur);
	}

	function removeHotspot(cur, hs) {
		tour.scenes[cur].hotSpots = (tour.scenes[cur].hotSpots || []).filter(function (h) { return h !== hs; });
		setDirty(true);
		syncAndReload(cur);
	}

	function mkHsBtn(text, fn, danger) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "secondary outline hs-btn" + (danger ? " hs-danger" : "");
		b.textContent = text;
		b.addEventListener("click", fn);
		return b;
	}

	function renderHotspotList(cur) {
		if (!hotspotList) return;
		hotspotList.innerHTML = "";
		const list = tour.scenes[cur].hotSpots || [];
		if (!list.length) {
			const li = document.createElement("li");
			li.className = "hint";
			li.textContent = "Inga hotspots i denna scen.";
			hotspotList.appendChild(li);
			return;
		}
		list.forEach(function (hs) {
			const li = document.createElement("li");
			li.className = "hotspot-item";
			const label = document.createElement("span");
			label.className = "hotspot-label";
			const kind = hs.type === "scene" ? "Scen" : (hs.URL ? "URL" : "Info");
			const raw = hs.type === "scene" ? sceneName(hs.sceneId) + (hasReciprocal(cur, hs.sceneId) ? " (dubbel)" : " (enkel)") : (hs.text || "(tom)");
			// Platt en-rads-label (markdown-tecken + radbrytningar bort); CSS cappar med "...".
			const body = String(raw).replace(/[#*_`>[\]!]/g, "").replace(/\s+/g, " ").trim();
			label.textContent = kind + ": " + body;
			label.title = body;
			const btns = document.createElement("div");
			btns.className = "hotspot-btns";
			btns.appendChild(mkHsBtn("Flytta hit", function () { moveHotspot(cur, hs); }));
			btns.appendChild(mkHsBtn("Redigera", function () { openHsModal({ mode: "edit", type: hsTypeOf(hs), cur: cur, hs: hs }); }));
			btns.appendChild(mkHsBtn("Ta bort", function () { removeHotspot(cur, hs); }, true));
			li.appendChild(label);
			li.appendChild(btns);
			hotspotList.appendChild(li);
		});
	}

	// --- Generering ---
	// Skapar scen-hotspots ur kartlänkarna, men bevarar alla manuella hotspots
	// och hoppar över länkar som redan har en manuell scen-hotspot till målet.
	function generate() {
		const skipped = [];
		let total = 0;
		sceneIds().forEach(function (id) {
			const list = tour.scenes[id].hotSpots || [];
			const kept = list.filter(function (h) { return h.manual || h.type === "info"; });
			const manualTargets = {};
			kept.forEach(function (h) { if (h.type === "scene" && h.sceneId) manualTargets[h.sceneId] = 1; });

			const gen = [];
			edges.forEach(function (e) {
				const targets = [];
				if (e.from === id) targets.push(e.to);
				if (e.twoway && e.to === id) targets.push(e.from);
				targets.forEach(function (to) {
					if (manualTargets[to]) return;
					if (!positions[id] || !positions[to] || offsets[id] == null || offsets[to] == null) { skipped.push(id + "->" + to); return; }
					gen.push({
						pitch: 0, yaw: round2(Geo.hotspotYaw(positions[id], positions[to], offsets[id])),
						type: "scene", sceneId: to, targetPitch: 0,
						targetYaw: round2(Geo.targetYaw(positions[id], positions[to], offsets[to])),
					});
				});
			});

			const merged = kept.concat(gen);
			merged.forEach(function (h, i) { h.id = i; });
			tour.scenes[id].hotSpots = merged;
			total += gen.length;
			const cfg = viewer.getConfig().scenes[id];
			if (cfg) cfg.hotSpots = cloneHs(merged);
		});

		applyingRes = true;
		viewer.loadScene(viewer.getScene(), viewer.getPitch(), viewer.getYaw(), viewer.getHfov());
		setDirty(true);
		renderHotspotList(viewer.getScene());
		let msg = "Genererade " + total + " scen-hotspots (manuella orörda).";
		if (skipped.length) msg += " Hoppade över " + skipped.length + " (okalibrerad).";
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
		window.confirmDialog("Släng alla ändringar sedan senaste sparning?", { danger: true, confirmText: "Släng" }).then(function (ok) {
			if (!ok) return;
			const snap = JSON.parse(savedSnapshot);
			Object.keys(tour.scenes).forEach(function (id) {
				const s = snap[id];
				if (s.off == null) delete offsets[id]; else offsets[id] = s.off;
				if (s.cr == null) delete calibRef[id]; else calibRef[id] = s.cr;
				if (s.ti == null) delete tour.scenes[id].title; else tour.scenes[id].title = s.ti;
				if (s.ro == null) delete tour.scenes[id].horizonRoll; else tour.scenes[id].horizonRoll = s.ro;
				const cfg = viewer.getConfig().scenes[id];
				if (cfg) { cfg.hotSpots = cloneHs(s.hs); cfg.horizonRoll = s.ro || 0; }
				tour.scenes[id].hotSpots = s.hs;
			});
			viewer.loadScene(viewer.getScene());
			setDirty(false);
			refreshSidebar();
		});
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
	const addInfoBtn = document.getElementById("add-info-btn");
	const addUrlBtn = document.getElementById("add-url-btn");
	const addSceneBtn = document.getElementById("add-scene-btn");
	if (addInfoBtn) addInfoBtn.addEventListener("click", function () { beginCreate("info"); });
	if (addUrlBtn) addUrlBtn.addEventListener("click", function () { beginCreate("url"); });
	if (addSceneBtn) addSceneBtn.addEventListener("click", function () { beginCreate("scene"); });

	const helpBtn = document.getElementById("help-btn");
	const helpModal = document.getElementById("help-modal");
	const helpClose = document.getElementById("help-close");
	if (helpBtn && helpModal) helpBtn.addEventListener("click", function () { helpModal.hidden = false; });
	if (helpClose && helpModal) helpClose.addEventListener("click", function () { helpModal.hidden = true; });
	if (helpModal) helpModal.addEventListener("click", function (e) { if (e.target === helpModal) helpModal.hidden = true; });

	window.addEventListener("keydown", function (e) {
		if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); save(); }
		else if (e.key === "Escape") {
			if (hsModal && !hsModal.hidden) closeHsModal();
			else if (helpModal && !helpModal.hidden) helpModal.hidden = true;
		}
	});
	window.addEventListener("beforeunload", function (e) {
		if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
	});
})();
