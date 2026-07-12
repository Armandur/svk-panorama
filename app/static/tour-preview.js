/* Turinställningar + förhandsvisning: bygg pannellum-vieweren för hela turen
   (multires), applicera globala inställningar live och bläddra mellan scener
   för att känna efter. Spara skriver default-blocket till tour.json. */
(function () {
	"use strict";

	const panoEl = document.getElementById("panorama");
	if (!panoEl || !window.pannellum) return;

	const slug = document.body.dataset.slug;
	const tour = JSON.parse(document.getElementById("tour-data").textContent);
	const mapData = JSON.parse(document.getElementById("map-data").textContent);
	if (!tour.scenes || !Object.keys(tour.scenes).length) return;

	const d = tour.default || {};

	// --- Upplösning (preview/multires/full) - global för hela förhandsvisningen.
	// Multires appliceras klient-side (defaultar multires) så man kan byta. Speglar
	// scenvyns logik men för alla scener på en gång. ---
	const resSelect = document.getElementById("res-select");
	const resHint = document.getElementById("res-hint");
	const manifest = (function () { const el = document.getElementById("tiles-data"); return el ? JSON.parse(el.textContent) : {}; })();
	const origPanorama = {};
	Object.keys(tour.scenes).forEach(function (id) { origPanorama[id] = tour.scenes[id].panorama; });
	let resMode = "multires";
	function hasTiles(id) { return !!manifest[id]; }
	function previewUrl(id) { return "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(id) + ".jpg"; }
	function setSceneRes(id) {
		const sc = tour.scenes[id];
		if (!sc) return;
		const eff = (resMode === "multires" && !hasTiles(id)) ? "preview" : resMode;
		if (eff === "multires") {
			sc.type = "multires"; sc.multiRes = manifest[id]; delete sc.panorama;
		} else {
			sc.type = "equirectangular";
			sc.panorama = (eff === "full") ? origPanorama[id] : previewUrl(id);
			delete sc.multiRes;
		}
	}
	function applyRes() { Object.keys(tour.scenes).forEach(setSceneRes); }
	applyRes(); // defaultar multires innan första bygget

	function sceneIds() {
		return Object.keys(tour.scenes).sort(function (a, b) {
			return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
		});
	}

	// --- DOM ---
	const arEnabled = document.getElementById("ar-enabled");
	const arSpeed = document.getElementById("ar-speed");
	const arSpeedNum = document.getElementById("ar-speed-num");
	const arDelay = document.getElementById("ar-delay");
	const arDelayNum = document.getElementById("ar-delay-num");
	const fade = document.getElementById("fade");
	const fadeNum = document.getElementById("fade-num");
	const arDirToggle = document.getElementById("ar-dir-toggle");
	const firstSceneSel = document.getElementById("first-scene");    // fallback utan karta
	const firstSceneBtn = document.getElementById("first-scene-btn"); // kartbaserad väljare
	const dirtyBadge = document.getElementById("dirty-badge");
	const saveBtn = document.getElementById("save-btn");
	const discardBtn = document.getElementById("discard-btn");
	const curLabel = document.getElementById("cur-scene-label");
	const prevBtn = document.getElementById("prev-scene");
	const nextBtn = document.getElementById("next-scene");
	const previewMap = document.getElementById("preview-map");
	const mapImg = document.getElementById("preview-map-img");
	const mapDotsEl = document.getElementById("preview-map-dots");
	const themeFont = document.getElementById("theme-font");
	const themeDot = document.getElementById("theme-dot");
	const themeCurrent = document.getElementById("theme-current");
	const brandingContent = document.getElementById("branding-content");
	const brandingSize = document.getElementById("branding-size");
	const brandingPos = document.getElementById("branding-position");
	const panoramaWrap = document.querySelector(".panorama-wrap");

	// --- Init formulär från tour.default ---
	let firstScene = d.firstScene && tour.scenes[d.firstScene] ? d.firstScene : sceneIds()[0];
	function sceneLabel(id) { return "Scen " + id + (tour.scenes[id] && tour.scenes[id].title ? " - " + tour.scenes[id].title : ""); }

	if (firstSceneSel) {
		firstSceneSel.innerHTML = "";
		sceneIds().forEach(function (id) {
			const o = document.createElement("option");
			o.value = id;
			o.textContent = sceneLabel(id);
			firstSceneSel.appendChild(o);
		});
		firstSceneSel.value = firstScene;
	}
	function updateFirstSceneBtn() { if (firstSceneBtn) firstSceneBtn.textContent = sceneLabel(firstScene); }
	updateFirstSceneBtn();

	const ar = d.autoRotate;
	const arOn = typeof ar === "number" && ar !== 0;
	arEnabled.checked = arOn;
	setPair(arSpeed, arSpeedNum, arOn ? Math.abs(ar) : 2);
	// Toggle: Höger (checked) = negativ rotation (som default -2); Vänster = positiv.
	arDirToggle.checked = !(arOn && ar > 0);
	setPair(arDelay, arDelayNum, (d.autoRotateInactivityDelay != null ? d.autoRotateInactivityDelay : 2000) / 1000);
	setPair(fade, fadeNum, (d.sceneFadeDuration != null ? d.sceneFadeDuration : 1500) / 1000);
	const initMapSize = ["small", "medium", "large"].indexOf(d.mapSize) !== -1 ? d.mapSize : "medium";
	document.querySelector('input[name="map-size"][value="' + initMapSize + '"]').checked = true;
	if (previewMap) previewMap.dataset.size = initMapSize;

	// Tema: init från tour.default.theme + live-applicering på förhandsvisningen.
	const FONTS = {
		sans: '"Nimbus Sans L","Liberation Sans",Arial,sans-serif',
		serif: 'Georgia,"Times New Roman",serif',
		mono: 'ui-monospace,"Courier New",monospace',
		humanist: '"Segoe UI","Trebuchet MS","Nimbus Sans L",sans-serif',
	};
	const th = d.theme || {};
	themeFont.value = ["sans", "serif", "mono", "humanist"].indexOf(th.font) !== -1 ? th.font : "sans";
	themeDot.value = th.dotColor || "#666666";
	themeCurrent.value = th.currentColor || "#8b0000";
	function applyThemeLive() {
		if (!panoramaWrap) return;
		panoramaWrap.style.setProperty("--tour-font", FONTS[themeFont.value] || FONTS.sans);
		panoramaWrap.style.setProperty("--dot-color", themeDot.value);
		panoramaWrap.style.setProperty("--current-dot-color", themeCurrent.value);
	}
	applyThemeLive();

	// Branding: init från tour.default.branding + live-överlägg i panorama-wrap.
	const SIZES = ["small", "medium", "large"];
	const POSES = ["bottom-left", "bottom-right", "top-left", "top-right"];
	const brand = d.branding || {};
	if (brandingSize) brandingSize.value = SIZES.indexOf(brand.size) !== -1 ? brand.size : "medium";
	if (brandingPos) brandingPos.value = POSES.indexOf(brand.position) !== -1 ? brand.position : "bottom-right";

	// Markdown-editor (EasyMDE) för branding-innehållet - samma som hotspot-editorn,
	// med en toolbar-knapp mot mediebiblioteket. Faller tillbaka på textarean om
	// EasyMDE saknas. value() sätts/läses via helpers nedan.
	function uploadBrandImage(file, onSuccess, onError) {
		var fd = new FormData();
		fd.append("file", file);
		fetch("/media/upload", {
			method: "POST",
			headers: { "X-CSRF-Token": window.getCsrfToken ? getCsrfToken() : "" },
			body: fd,
		}).then(function (r) {
			if (!r.ok) return r.json().then(function (dd) { throw new Error(dd.detail || "Uppladdning misslyckades"); });
			return r.json();
		}).then(function (dd) { onSuccess(dd.url); })
			.catch(function (e) { onError(e.message || "Uppladdning misslyckades"); });
	}
	function brandMediaAction(editor) {
		if (!window.openMediaLibrary) return;
		window.openMediaLibrary(slug, function (url) {
			var cm = editor.codemirror;
			cm.replaceSelection("![](" + url + ")");
			cm.focus();
		});
	}
	var brandMediaBtn = { name: "media", action: brandMediaAction, className: "fa fa-th", title: "Mediebibliotek" };
	var brandingEditor = null;
	if (window.EasyMDE && brandingContent) {
		brandingEditor = new EasyMDE({
			element: brandingContent,
			spellChecker: false,
			status: false,
			autoDownloadFontAwesome: false,
			minHeight: "80px",
			maxHeight: "26vh",
			uploadImage: true,
			imageUploadFunction: uploadBrandImage,
			toolbar: ["bold", "italic", "heading", "link", "upload-image", brandMediaBtn, "|", "preview", "guide"],
			previewRender: function (t) { return window.renderMarkdown(t); },
			placeholder: "![Logotyp](...) eller **Församlingen**",
		});
		brandingEditor.value(brand.content || "");
	} else if (brandingContent) {
		brandingContent.value = brand.content || "";
	}
	function brandingVal() { return brandingEditor ? brandingEditor.value() : (brandingContent ? brandingContent.value : ""); }
	function setBrandingVal(v) {
		if (brandingEditor) brandingEditor.value(v || "");
		else if (brandingContent) brandingContent.value = v || "";
	}

	let brandingEl = null;
	function currentBranding() {
		var c = (brandingVal() || "").trim();
		if (!c) return null;
		return { content: c, size: brandingSize ? brandingSize.value : "medium", position: brandingPos ? brandingPos.value : "bottom-right" };
	}
	function applyBrandingLive() {
		if (!panoramaWrap || !window.renderBrandingInto) return;
		if (!brandingEl) { brandingEl = document.createElement("div"); panoramaWrap.appendChild(brandingEl); }
		window.renderBrandingInto(brandingEl, currentBranding());
	}
	applyBrandingLive();

	function setPair(range, num, val) { range.value = val; num.value = val; }
	function updateArDirLabels() {
		const l = document.getElementById("ar-dir-left"), r = document.getElementById("ar-dir-right");
		if (l) l.classList.toggle("active", !arDirToggle.checked);
		if (r) r.classList.toggle("active", arDirToggle.checked);
	}
	updateArDirLabels();
	function dirVal() { return arDirToggle.checked ? -1 : 1; }
	function mapSizeVal() { return document.querySelector('input[name="map-size"]:checked').value; }
	function signedSpeed() { return dirVal() * (parseFloat(arSpeed.value) || 2); }

	// --- Pannellum ---
	let viewer = null;
	let rebuildTimer = null;

	function buildViewer(sceneId, view) {
		if (viewer) { try { viewer.destroy(); } catch (e) { /* borta */ } }
		const startId = sceneId || firstScene || sceneIds()[0];
		if (curLabel) curLabel.textContent = "Scen " + startId; // visa direkt, inte "Scen -"
		viewer = pannellum.viewer("panorama", {
			escapeHTML: true, // säkerhet: escapa titel/hotspot-text (top-level, se viewer.js)
			default: {
				firstScene: startId,
				autoLoad: true,
				autoRotate: arEnabled.checked ? signedSpeed() : false,
				autoRotateInactivityDelay: Math.round((parseFloat(arDelay.value) || 0) * 1000),
				sceneFadeDuration: Math.round((parseFloat(fade.value) || 0) * 1000),
				editorMode: false,
			},
			scenes: tour.scenes,
		});
		viewer.on("scenechange", onSceneChange);
		viewer.on("load", function () {
			if (view) {
				try {
					viewer.setYaw(view.yaw, false);
					viewer.setPitch(view.pitch, false);
					viewer.setHfov(view.hfov, false);
				} catch (e) { /* ignore */ }
			}
			onSceneChange();
		});
	}

	// Bygg om vieweren men behåll scen + vy (för fade/delay som inte har live-setters).
	function rebuildKeepView() {
		if (!viewer) return;
		const cur = viewer.getScene();
		let view = null;
		try { view = { yaw: viewer.getYaw(), pitch: viewer.getPitch(), hfov: viewer.getHfov() }; } catch (e) { /* ignore */ }
		buildViewer(cur, view);
	}
	function scheduleRebuild() {
		if (rebuildTimer) clearTimeout(rebuildTimer);
		rebuildTimer = setTimeout(rebuildKeepView, 600);
	}

	function applyAutoRotate() {
		if (!viewer) return;
		if (arEnabled.checked) viewer.startAutoRotate(signedSpeed());
		else viewer.stopAutoRotate();
	}

	// --- Karta ---
	const dotEls = {};
	function buildDots() {
		if (!mapDotsEl || !mapImg || !mapImg.naturalWidth) return;
		mapDotsEl.textContent = "";
		(mapData.scenes || []).forEach(function (s) {
			const dot = document.createElement("button");
			dot.type = "button";
			dot.className = "preview-dot";
			dot.style.left = (s.position.x / mapImg.naturalWidth * 100) + "%";
			dot.style.top = (s.position.y / mapImg.naturalHeight * 100) + "%";
			dot.title = "Scen " + s.id;
			dot.addEventListener("click", function () {
				if (viewer && viewer.getScene() !== s.id) viewer.loadScene(s.id, scenePitch(s.id), sceneYaw(s.id));
			});
			mapDotsEl.appendChild(dot);
			dotEls[s.id] = dot;
		});
		// Markera aktuell scen direkt när prickarna byggts (annars syns ingen aktiv
		// prick förrän man byter scen).
		if (viewer) markCurrent(viewer.getScene());
	}
	function markCurrent(id) {
		Object.keys(dotEls).forEach(function (k) { dotEls[k].classList.toggle("current", k === id); });
	}

	function onSceneChange() {
		if (!viewer) return;
		const cur = viewer.getScene();
		if (curLabel) curLabel.textContent = "Scen " + cur;
		markCurrent(cur);
	}

	// Scenens startriktning (default yaw/pitch) - vid ankomst utan hotspot/länk.
	function sceneYaw(id) {
		var sc = tour.scenes[id];
		return sc && typeof sc.yaw === "number" ? sc.yaw : undefined;
	}
	function scenePitch(id) {
		var sc = tour.scenes[id];
		return sc && typeof sc.pitch === "number" ? sc.pitch : undefined;
	}

	function step(delta) {
		const ids = sceneIds();
		const i = ids.indexOf(viewer.getScene());
		const next = ids[(i + delta + ids.length) % ids.length];
		if (next) viewer.loadScene(next, scenePitch(next), sceneYaw(next));
	}

	// --- Dirty & spara ---
	let dirty = false;
	function setDirty(v) {
		dirty = v;
		if (dirtyBadge) dirtyBadge.hidden = !v;
		if (discardBtn) discardBtn.hidden = !v;
	}

	function onSettingChange(rebuild) {
		setDirty(true);
		if (rebuild) scheduleRebuild();
	}

	// --- Wiring ---
	function linkPair(range, num, onChange) {
		range.addEventListener("input", function () { num.value = range.value; onChange(); });
		num.addEventListener("input", function () { range.value = num.value; onChange(); });
	}

	arEnabled.addEventListener("change", function () { applyAutoRotate(); onSettingChange(false); });
	linkPair(arSpeed, arSpeedNum, function () { applyAutoRotate(); onSettingChange(false); });
	arDirToggle.addEventListener("change", function () { updateArDirLabels(); applyAutoRotate(); onSettingChange(false); });
	linkPair(arDelay, arDelayNum, function () { onSettingChange(true); });
	linkPair(fade, fadeNum, function () { onSettingChange(true); });
	if (firstSceneSel) firstSceneSel.addEventListener("change", function () { firstScene = firstSceneSel.value; onSettingChange(false); });
	document.querySelectorAll('input[name="map-size"]').forEach(function (r) {
		r.addEventListener("change", function () {
			if (previewMap) previewMap.dataset.size = mapSizeVal();
			onSettingChange(false);
		});
	});
	themeFont.addEventListener("change", function () { applyThemeLive(); onSettingChange(false); });
	[themeDot, themeCurrent].forEach(function (inp) {
		inp.addEventListener("input", function () { applyThemeLive(); onSettingChange(false); });
	});

	if (brandingEditor) brandingEditor.codemirror.on("change", function () { applyBrandingLive(); onSettingChange(false); });
	else if (brandingContent) brandingContent.addEventListener("input", function () { applyBrandingLive(); onSettingChange(false); });
	[brandingSize, brandingPos].forEach(function (s) {
		if (s) s.addEventListener("change", function () { applyBrandingLive(); onSettingChange(false); });
	});

	// Upplösningsbyte: applicera på alla scener + bygg om vieweren (behåll scen/vy).
	// Påverkar bara förhandsvisningen, inte det som sparas (default-blocket).
	if (resSelect) resSelect.addEventListener("change", function () {
		resMode = resSelect.value;
		applyRes();
		rebuildKeepView();
	});

	if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); });
	if (nextBtn) nextBtn.addEventListener("click", function () { step(1); });

	saveBtn.addEventListener("click", function () {
		saveBtn.setAttribute("aria-busy", "true");
		apiFetch("/projects/" + encodeURIComponent(slug) + "/tour-settings", {
			method: "POST",
			body: {
				autoLoad: true,
				autoRotateEnabled: arEnabled.checked,
				autoRotateSpeed: parseFloat(arSpeed.value) || 2,
				autoRotateDir: dirVal(),
				autoRotateInactivityDelay: Math.round((parseFloat(arDelay.value) || 0) * 1000),
				sceneFadeDuration: Math.round((parseFloat(fade.value) || 0) * 1000),
				firstScene: firstScene,
				mapSize: mapSizeVal(),
				themeFont: themeFont.value,
				themeDotColor: themeDot.value,
				themeCurrentColor: themeCurrent.value,
				brandingContent: brandingVal(),
				brandingSize: brandingSize ? brandingSize.value : "medium",
				brandingPosition: brandingPos ? brandingPos.value : "bottom-right",
			},
		}).then(function () {
			setDirty(false);
			if (window.showToast) showToast("Inställningar sparade", "ok");
		}).catch(function (e) {
			if (window.showToast) showToast(e.message, "error");
		}).then(function () { saveBtn.removeAttribute("aria-busy"); });
	});

	if (discardBtn) discardBtn.addEventListener("click", function () { window.location.reload(); });

	// --- Tema-/inställningsförinställningar (presets) -----------------------
	// Preset = subset av tour.default (autoRotate/delay/fade/mapSize/theme), ej
	// startscen. Läses ur/appliceras på samma kontroller som Spara-blocket.
	(function () {
		var sel = document.getElementById("preset-select");
		var applyBtn = document.getElementById("preset-apply");
		var saveBtn2 = document.getElementById("preset-save");
		var delBtn = document.getElementById("preset-delete");
		var defChk = document.getElementById("preset-default");
		if (!sel) return;
		var cache = [];
		function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }
		function readPreset() {
			return {
				autoRotate: arEnabled.checked ? signedSpeed() : false,
				autoRotateInactivityDelay: Math.round((parseFloat(arDelay.value) || 0) * 1000),
				sceneFadeDuration: Math.round((parseFloat(fade.value) || 0) * 1000),
				mapSize: mapSizeVal(),
				theme: { font: themeFont.value, dotColor: themeDot.value, currentColor: themeCurrent.value },
			};
		}
		function applyPreset(c) {
			var ar = c.autoRotate, arOn = typeof ar === "number" && ar !== 0;
			arEnabled.checked = arOn;
			setPair(arSpeed, arSpeedNum, arOn ? Math.abs(ar) : 2);
			arDirToggle.checked = !(arOn && ar > 0);
			setPair(arDelay, arDelayNum, (c.autoRotateInactivityDelay != null ? c.autoRotateInactivityDelay : 2000) / 1000);
			setPair(fade, fadeNum, (c.sceneFadeDuration != null ? c.sceneFadeDuration : 1500) / 1000);
			var ms = ["small", "medium", "large"].indexOf(c.mapSize) !== -1 ? c.mapSize : "medium";
			var msr = document.querySelector('input[name="map-size"][value="' + ms + '"]');
			if (msr) msr.checked = true;
			if (previewMap) previewMap.dataset.size = ms;
			var th = c.theme || {};
			themeFont.value = ["sans", "serif", "mono", "humanist"].indexOf(th.font) !== -1 ? th.font : "sans";
			themeDot.value = th.dotColor || "#666666";
			themeCurrent.value = th.currentColor || "#8b0000";
			updateArDirLabels();
			applyThemeLive();
			setDirty(true);
			rebuildKeepView();
		}
		function selected() { return cache.filter(function (p) { return String(p.id) === sel.value; })[0]; }
		function syncDef() { var p = selected(); if (defChk) { defChk.checked = !!(p && p.is_default); defChk.disabled = !p; } }
		function renderOpts() {
			var cur = sel.value;
			sel.innerHTML = '<option value="">- välj förinställning -</option>';
			cache.forEach(function (p) {
				var o = document.createElement("option");
				o.value = String(p.id);
				o.textContent = p.name + (p.is_default ? " (standard)" : "");
				sel.appendChild(o);
			});
			sel.value = cur;
			syncDef();
		}
		function load(selectId) {
			fetch("/presets").then(function (r) { return r.json(); }).then(function (d) {
				cache = d.presets || [];
				renderOpts();
				if (selectId != null) { sel.value = String(selectId); syncDef(); }
			}).catch(function () { /* tyst */ });
		}
		sel.addEventListener("change", syncDef);
		applyBtn.addEventListener("click", function () {
			var p = selected();
			if (!p) { if (window.showToast) showToast("Välj en förinställning först", "error"); return; }
			applyPreset(p.config);
			if (window.showToast) showToast("Tillämpad - spara för att behålla", "ok");
		});
		saveBtn2.addEventListener("click", function () {
			var p = selected();
			var name = window.prompt("Namn på förinställningen:", (p && p.name) || "");
			if (name == null || !name.trim()) return;
			fetch("/presets", {
				method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" },
				body: JSON.stringify({ name: name.trim(), config: readPreset() }),
			}).then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
				.then(function (d) { if (window.showToast) showToast("Förinställning sparad", "ok"); load(d.preset.id); })
				.catch(function () { if (window.showToast) showToast("Kunde inte spara", "error"); });
		});
		delBtn.addEventListener("click", function () {
			var p = selected();
			if (!p) { if (window.showToast) showToast("Välj en förinställning först", "error"); return; }
			var ask = window.confirmDialog ? confirmDialog('Ta bort förinställningen "' + p.name + '"?', { danger: true, confirmText: "Ta bort" }) : Promise.resolve(window.confirm("Ta bort?"));
			ask.then(function (ok) {
				if (!ok) return;
				fetch("/presets/" + p.id + "/delete", { method: "POST", headers: { "X-CSRF-Token": csrf() } })
					.then(function () { load(); if (window.showToast) showToast("Borttagen", "ok"); }).catch(function () { /* tyst */ });
			});
		});
		if (defChk) defChk.addEventListener("change", function () {
			var p = selected();
			if (!p) return;
			fetch("/presets/" + p.id + "/default", {
				method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" },
				body: JSON.stringify({ isDefault: defChk.checked }),
			}).then(function () { load(sel.value); }).catch(function () { /* tyst */ });
		});
		load();
	})();

	// --- Branding-mallar (egen mall, skild från tema-presets) --------------
	// Spara/använd bara logga+storlek+position. En kan vara standard för nya turer.
	(function () {
		var sel = document.getElementById("brand-preset-select");
		var applyBtn = document.getElementById("brand-preset-apply");
		var saveBtn2 = document.getElementById("brand-preset-save");
		var delBtn = document.getElementById("brand-preset-delete");
		var defChk = document.getElementById("brand-preset-default");
		if (!sel) return;
		var cache = [];
		function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }
		function applyCfg(c) {
			c = c || {};
			setBrandingVal(c.content || "");
			if (brandingSize) brandingSize.value = SIZES.indexOf(c.size) !== -1 ? c.size : "medium";
			if (brandingPos) brandingPos.value = POSES.indexOf(c.position) !== -1 ? c.position : "bottom-right";
			applyBrandingLive();
			setDirty(true);
		}
		function selected() { return cache.filter(function (p) { return String(p.id) === sel.value; })[0]; }
		function syncDef() { var p = selected(); if (defChk) { defChk.checked = !!(p && p.is_default); defChk.disabled = !p; } }
		function renderOpts() {
			var cur = sel.value;
			sel.innerHTML = '<option value="">- välj branding-mall -</option>';
			cache.forEach(function (p) {
				var o = document.createElement("option");
				o.value = String(p.id);
				o.textContent = p.name + (p.is_default ? " (standard)" : "");
				sel.appendChild(o);
			});
			sel.value = cur;
			syncDef();
		}
		function load(selectId) {
			fetch("/branding-presets").then(function (r) { return r.json(); }).then(function (d) {
				cache = d.presets || [];
				renderOpts();
				if (selectId != null) { sel.value = String(selectId); syncDef(); }
			}).catch(function () { /* tyst */ });
		}
		sel.addEventListener("change", syncDef);
		applyBtn.addEventListener("click", function () {
			var p = selected();
			if (!p) { if (window.showToast) showToast("Välj en branding-mall först", "error"); return; }
			applyCfg(p.config);
			if (window.showToast) showToast("Tillämpad - spara för att behålla", "ok");
		});
		saveBtn2.addEventListener("click", function () {
			var cfg = currentBranding();
			if (!cfg) { if (window.showToast) showToast("Skriv branding först", "error"); return; }
			var p = selected();
			var name = window.prompt("Namn på branding-mallen:", (p && p.name) || "");
			if (name == null || !name.trim()) return;
			fetch("/branding-presets", {
				method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" },
				body: JSON.stringify({ name: name.trim(), config: cfg }),
			}).then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
				.then(function (d) { if (window.showToast) showToast("Branding-mall sparad", "ok"); load(d.preset.id); })
				.catch(function () { if (window.showToast) showToast("Kunde inte spara", "error"); });
		});
		delBtn.addEventListener("click", function () {
			var p = selected();
			if (!p) { if (window.showToast) showToast("Välj en branding-mall först", "error"); return; }
			var ask = window.confirmDialog ? confirmDialog('Ta bort branding-mallen "' + p.name + '"?', { danger: true, confirmText: "Ta bort" }) : Promise.resolve(window.confirm("Ta bort?"));
			ask.then(function (ok) {
				if (!ok) return;
				fetch("/branding-presets/" + p.id + "/delete", { method: "POST", headers: { "X-CSRF-Token": csrf() } })
					.then(function () { load(); if (window.showToast) showToast("Borttagen", "ok"); }).catch(function () { /* tyst */ });
			});
		});
		if (defChk) defChk.addEventListener("change", function () {
			var p = selected();
			if (!p) return;
			fetch("/branding-presets/" + p.id + "/default", {
				method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" },
				body: JSON.stringify({ isDefault: defChk.checked }),
			}).then(function () { load(sel.value); }).catch(function () { /* tyst */ });
		});
		load();
	})();

	// --- Startscen-väljare (modal med karta + hover-preview) ---------------
	const startModal = document.getElementById("start-modal");
	const startMapImg = document.getElementById("start-map-img");
	const startMapDots = document.getElementById("start-map-dots");
	const startPreviewEl = document.getElementById("start-preview");
	const startClose = document.getElementById("start-close");
	let startViewer = null, startStop = null, startDotsBuilt = false;

	function destroyStartPreview() {
		if (startStop) { try { startStop(); } catch (e) { /* borta */ } startStop = null; }
		if (startViewer) { try { startViewer.destroy(); } catch (e) { /* borta */ } startViewer = null; }
	}
	// Samma preview-vy (nedskalad bild, autoRotate:0) driven av de delade
	// preview-inställningarna - precis som hotspot-modalens scenpreview.
	function showStartPreview(sceneId) {
		destroyStartPreview();
		if (!startPreviewEl || !sceneId || !window.pannellum) return;
		void startPreviewEl.offsetHeight;
		startViewer = pannellum.viewer(startPreviewEl, {
			type: "equirectangular",
			panorama: "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(sceneId) + ".jpg",
			autoLoad: true, autoRotate: 0,
			showControls: false, showZoomCtrl: false, showFullscreenCtrl: false,
			mouseZoom: false, draggable: false, hfov: 110,
		});
		if (window.ScenePreview && window.ScenePreview.driveViewer) startStop = window.ScenePreview.driveViewer(startViewer);
	}

	const startDotEls = {};
	function buildStartDots() {
		if (startDotsBuilt || !startMapDots || !startMapImg || !startMapImg.naturalWidth) return;
		startMapDots.textContent = "";
		(mapData.scenes || []).forEach(function (s) {
			const dot = document.createElement("button");
			dot.type = "button";
			dot.className = "preview-dot";
			dot.style.left = (s.position.x / startMapImg.naturalWidth * 100) + "%";
			dot.style.top = (s.position.y / startMapImg.naturalHeight * 100) + "%";
			dot.title = "Scen " + s.id;
			dot.addEventListener("mouseenter", function () { showStartPreview(s.id); });
			dot.addEventListener("click", function () {
				firstScene = s.id;
				updateFirstSceneBtn();
				markStartCurrent();
				onSettingChange(false);
				closeStartModal();
			});
			startMapDots.appendChild(dot);
			startDotEls[s.id] = dot;
		});
		startDotsBuilt = true;
	}
	function markStartCurrent() {
		Object.keys(startDotEls).forEach(function (k) { startDotEls[k].classList.toggle("current", k === firstScene); });
	}
	function openStartModal() {
		startModal.hidden = false;
		if (startMapImg.complete && startMapImg.naturalWidth) buildStartDots();
		else startMapImg.addEventListener("load", buildStartDots, { once: true });
		markStartCurrent();
		showStartPreview(firstScene);
	}
	function closeStartModal() {
		startModal.hidden = true;
		destroyStartPreview();
	}
	if (firstSceneBtn) firstSceneBtn.addEventListener("click", openStartModal);
	if (startClose) startClose.addEventListener("click", closeStartModal);
	if (startModal) startModal.addEventListener("click", function (e) { if (e.target === startModal) closeStartModal(); });

	// --- Karta: fäll in/ut (samma beteende som runtime-vieweren) ------------
	const previewMapToggle = document.getElementById("preview-map-toggle");
	const previewMapClose = document.getElementById("preview-map-close");
	if (previewMapToggle && previewMap) {
		previewMapToggle.addEventListener("click", function () { previewMap.hidden = false; previewMapToggle.hidden = true; });
	}
	if (previewMapClose && previewMap) {
		previewMapClose.addEventListener("click", function () { previewMap.hidden = true; if (previewMapToggle) previewMapToggle.hidden = false; });
	}

	// --- Start ---
	// Markdown-tooltip på info-hotspots (funktionerna stannar på objekten över rebuilds).
	if (window.attachHsTooltips) {
		var sceneNames = {};
		sceneIds().forEach(function (id) { sceneNames[id] = tour.scenes[id].title || ("Scen " + id); });
		sceneIds().forEach(function (id) { attachHsTooltips(tour.scenes[id].hotSpots, sceneNames); });
	}

	buildViewer(firstScene, null);
	if (mapImg) {
		if (mapImg.complete && mapImg.naturalWidth) buildDots();
		else mapImg.addEventListener("load", buildDots);
	}
})();
