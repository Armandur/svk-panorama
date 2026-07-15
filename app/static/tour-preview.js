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

	// --- Flerspråkighet: turens valda språk (första = standard). Sätts numera på
	// uppladdningssteget (lang-picker.js) - READ-ONLY här, ingen redigering kvar
	// på denna sida. previewLang styr vilket språk förhandsvisningen just nu
	// renderas på. Styr hotspot-tooltips, scentitlar och branding (se markdown.js:
	// resolveText/attachHsTooltips/renderBrandingInto). ---
	const selectedLangs = (Array.isArray(d.languages) && d.languages.length) ? d.languages.slice() : ["sv"];
	let previewLang = selectedLangs[0];
	// Ospärrad kopia av original-titlarna (ren sträng | {kod:text}). Pannellum
	// får scenerna direkt (scenes: tour.scenes) och har en egen inbyggd
	// titel-ruta som läser scene.title rakt av - den förstår inte {kod:text}.
	// Vi resolverar därför OCH skriver in en ren sträng i tour.scenes[id].title
	// inför varje (om)byggnad (applyHotspotLanguage), men läser alltid ur denna
	// orörda kopia så vi kan resolvera om vid nästa språkbyte.
	const origTitle = {};
	Object.keys(tour.scenes).forEach(function (id) { origTitle[id] = tour.scenes[id].title; });

	// Samma mönster för hotspots: en språkbegränsad hotspot (hs.langs, se
	// hotspotInLang i markdown.js) ska kunna dyka upp/försvinna vid
	// previewLang-byte. Filtrerar vi tour.scenes[id].hotSpots direkt in-place
	// skulle bortfiltrerade hotspots vara permanent borta vid NÄSTA byte
	// (arrayen är redan kortare) - spara därför en orörd kopia EN gång och
	// filtrera ALLTID därifrån.
	const origHotSpots = {};
	Object.keys(tour.scenes).forEach(function (id) { origHotSpots[id] = (tour.scenes[id].hotSpots || []).slice(); });

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
	const brandingLangTabs = document.getElementById("branding-lang-tabs");
	const panoramaWrap = document.querySelector(".panorama-wrap");
	const previewLangToggle = document.getElementById("preview-lang-toggle");
	let previewLangDD = null;

	// --- Init formulär från tour.default ---
	let firstScene = d.firstScene && tour.scenes[d.firstScene] ? d.firstScene : sceneIds()[0];
	function resolvedTitle(id) { return tour.scenes[id] ? (window.resolveText ? window.resolveText(origTitle[id], previewLang, selectedLangs) : (origTitle[id] || "")) : ""; }
	function sceneLabel(id) { const t = resolvedTitle(id); return "Scen " + id + (t ? " - " + t : ""); }

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
	// Bygg om startscen-select/knapp-etiketterna (t.ex. vid preview-språkbyte).
	function refreshSceneLabels() {
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
		updateFirstSceneBtn();
	}

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
		dmsans: '"DM Sans","Nimbus Sans L","Liberation Sans",Arial,sans-serif',
		spectral: '"Spectral",Georgia,"Times New Roman",serif',
	};
	const th = d.theme || {};
	themeFont.value = ["sans", "serif", "mono", "humanist", "dmsans", "spectral"].indexOf(th.font) !== -1 ? th.font : "sans";
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
		// slug -> turens arbetsyta (personlig/team-pool), inte användarens primära.
		fetch("/media/upload?slug=" + encodeURIComponent(slug), {
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

	// Branding per språk: state {kod: text} + EN delad EasyMDE-instans som byter
	// innehåll när man byter flik (samma mönster som hotspot-modalens teaser/läs
	// mer i scene.js). Kollapsas till ren sträng vid ett enda valt språk.
	let brandingState = {};
	(function initBrandingState() {
		var c = brand.content;
		if (c && typeof c === "object") brandingState = Object.assign({}, c);
		else if (c) brandingState[selectedLangs[0]] = c;
	})();
	let brandingTab = selectedLangs[0];

	if (window.EasyMDE && brandingContent) {
		brandingEditor = new EasyMDE({
			element: brandingContent,
			spellChecker: false,
			status: false,
			autoDownloadFontAwesome: false,
			minHeight: "56px",
			maxHeight: "22vh",
			uploadImage: true,
			imageUploadFunction: uploadBrandImage,
			toolbar: ["bold", "italic", "heading", "link", "upload-image", brandMediaBtn, "|", "preview", "guide"],
			previewRender: function (t) { return window.renderMarkdown(t); },
			placeholder: "![Logotyp](...) eller **Församlingen**",
		});
		brandingEditor.value(brandingState[brandingTab] || "");
	} else if (brandingContent) {
		brandingContent.value = brandingState[brandingTab] || "";
	}
	function brandingVal() { return brandingEditor ? brandingEditor.value() : (brandingContent ? brandingContent.value : ""); }
	function setBrandingVal(v) {
		if (brandingEditor) brandingEditor.value(v || "");
		else if (brandingContent) brandingContent.value = v || "";
	}

	// Flagg-dropdown (ett val per valt språk) - visas bara vid >1 språk. Byte
	// sparar nuvarande fälts text i state innan nästa språks text laddas in.
	let brandingLangDD = null;
	function ensureBrandingTab() {
		if (selectedLangs.indexOf(brandingTab) === -1) {
			brandingTab = selectedLangs[0];
			setBrandingVal(brandingState[brandingTab] || "");
		}
	}
	function renderBrandingTabs() {
		if (!brandingLangTabs) return;
		if (selectedLangs.length <= 1) { brandingLangTabs.hidden = true; brandingLangDD = null; brandingLangTabs.innerHTML = ""; return; }
		ensureBrandingTab();
		brandingLangTabs.hidden = false;
		if (!brandingLangDD) {
			brandingLangDD = window.mountLangDropdown(brandingLangTabs, {
				langs: selectedLangs,
				current: brandingTab,
				showName: true,
				onPick: switchBrandingTab,
			});
		} else {
			brandingLangDD.setLangs(selectedLangs);
			brandingLangDD.setCurrent(brandingTab);
		}
	}
	function switchBrandingTab(code) {
		if (code === brandingTab) return;
		brandingState[brandingTab] = brandingVal();
		brandingTab = code;
		setBrandingVal(brandingState[code] || "");
		if (brandingLangDD) brandingLangDD.setCurrent(brandingTab);
		if (brandingEditor) brandingEditor.codemirror.refresh();
	}

	let brandingEl = null;
	// Slår ihop state (inkl. aktiva flikens ej ännu synkade värde) till
	// content = ren sträng (1 språk) eller {kod: text} (>1 språk, tomma bort).
	function currentBranding() {
		brandingState[brandingTab] = brandingVal();
		var content;
		if (selectedLangs.length > 1) {
			var dict = {};
			selectedLangs.forEach(function (code) {
				var t = (brandingState[code] || "").trim();
				if (t) dict[code] = t;
			});
			if (!Object.keys(dict).length) return null;
			content = dict;
		} else {
			var single = (brandingState[selectedLangs[0]] || "").trim();
			if (!single) return null;
			content = single;
		}
		return { content: content, size: brandingSize ? brandingSize.value : "medium", position: brandingPos ? brandingPos.value : "bottom-right" };
	}
	function applyBrandingLive() {
		if (!panoramaWrap || !window.renderBrandingInto) return;
		if (!brandingEl) { brandingEl = document.createElement("div"); panoramaWrap.appendChild(brandingEl); }
		window.renderBrandingInto(brandingEl, currentBranding(), previewLang, selectedLangs);
	}
	renderBrandingTabs();
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
			positionPreviewLangToggle(); // pannellums kontroller finns nu -> placera under dem
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

	// Gråa ut/inaktivera hastighet, riktning och återuppta när autorotate är av -
	// de har ingen effekt då (samma som tema-mall-editorn).
	function syncArState() {
		var on = arEnabled.checked;
		var sub = document.getElementById("ar-sub");
		if (sub) sub.classList.toggle("ar-dim", !on);
		[arSpeed, arSpeedNum, arDelay, arDelayNum, arDirToggle].forEach(function (el) { if (el) el.disabled = !on; });
	}
	syncArState();

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

	arEnabled.addEventListener("change", function () { applyAutoRotate(); syncArState(); onSettingChange(false); });
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

	// Returnerar HELA kedjan (inkl. setDirty) så check-in kan await:a den innan re-check.
	function save() {
		saveBtn.setAttribute("aria-busy", "true");
		var brandingNow = currentBranding();
		return apiFetch("/projects/" + encodeURIComponent(slug) + "/tour-settings", {
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
				brandingContent: brandingNow ? brandingNow.content : "",
				brandingSize: brandingSize ? brandingSize.value : "medium",
				brandingPosition: brandingPos ? brandingPos.value : "bottom-right",
			},
		}).then(function () {
			setDirty(false);
			if (window.showToast) showToast("Inställningar sparade", "ok");
		}).catch(function (e) {
			if (window.showToast) showToast(e.message, "error");
		}).then(function () { saveBtn.removeAttribute("aria-busy"); });
	}
	saveBtn.addEventListener("click", save);

	if (discardBtn) discardBtn.addEventListener("click", function () { window.location.reload(); });

	// Skydda mot hård navigering bort (stäng flik/klicka länk) med osparade ändringar -
	// samma browser-varning som plan.js/scene.js. Check-in-knappen har sitt eget flöde.
	window.addEventListener("beforeunload", function (e) {
		if (dirty) { e.preventDefault(); e.returnValue = ""; }
	});

	// Check-in-kontrakt (editor-lock.js läser dessa före incheck).
	window.editorDirty = function () { return dirty; };
	window.editorSave = save;
	window.editorDiscard = function () { setDirty(false); };

	// --- Mall-väljare (tema + branding) -------------------------------------
	// Bläddra bland sparade mallar i den visuella väljar-modalen (preset-library.js)
	// och tillämpa på turen; "Spara som mall" skapar/skriver över per namn. Hantera,
	// redigera och sätt standard sker på /mallar-sidan.
	(function () {
		function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }

		function readThemePreset() {
			return {
				autoRotate: arEnabled.checked ? signedSpeed() : false,
				autoRotateInactivityDelay: Math.round((parseFloat(arDelay.value) || 0) * 1000),
				sceneFadeDuration: Math.round((parseFloat(fade.value) || 0) * 1000),
				mapSize: mapSizeVal(),
				theme: { font: themeFont.value, dotColor: themeDot.value, currentColor: themeCurrent.value },
			};
		}
		function applyThemePreset(c) {
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
			themeFont.value = ["sans", "serif", "mono", "humanist", "dmsans", "spectral"].indexOf(th.font) !== -1 ? th.font : "sans";
			themeDot.value = th.dotColor || "#666666";
			themeCurrent.value = th.currentColor || "#8b0000";
			updateArDirLabels();
			syncArState();
			applyThemeLive();
			setDirty(true);
			rebuildKeepView();
		}
		function applyBrandingPreset(c) {
			c = c || {};
			var content = c.content;
			brandingState = {};
			if (content && typeof content === "object") brandingState = Object.assign({}, content);
			else if (content) brandingState[selectedLangs[0]] = content;
			brandingTab = selectedLangs[0];
			setBrandingVal(brandingState[brandingTab] || "");
			renderBrandingTabs();
			if (brandingSize) brandingSize.value = SIZES.indexOf(c.size) !== -1 ? c.size : "medium";
			if (brandingPos) brandingPos.value = POSES.indexOf(c.position) !== -1 ? c.position : "bottom-right";
			applyBrandingLive();
			setDirty(true);
		}

		// Bläddra: öppna den visuella väljaren; Använd applicerar respektive typ + stänger.
		function browse() {
			if (!window.openPresetLibrary) return;
			openPresetLibrary({
				onPickTheme: function (c) { applyThemePreset(c); if (window.showToast) showToast("Tema tillämpat - spara turen för att behålla", "ok"); },
				onPickBranding: function (c) { applyBrandingPreset(c); if (window.showToast) showToast("Branding tillämpad - spara turen för att behålla", "ok"); },
			});
		}
		["preset-browse", "brand-preset-browse"].forEach(function (id) {
			var btn = document.getElementById(id);
			if (btn) btn.addEventListener("click", browse);
		});

		function saveMall(url, cfg, label) {
			var name = window.prompt("Namn på mallen:", "");
			if (name == null || !name.trim()) return;
			fetch(url, { method: "POST", headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), config: cfg }) })
				.then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
				.then(function () { if (window.showToast) showToast(label + " sparad", "ok"); })
				.catch(function () { if (window.showToast) showToast("Kunde inte spara", "error"); });
		}
		var saveTheme = document.getElementById("preset-save");
		if (saveTheme) saveTheme.addEventListener("click", function () { saveMall("/presets", readThemePreset(), "Tema-mall"); });
		var saveBrand = document.getElementById("brand-preset-save");
		if (saveBrand) saveBrand.addEventListener("click", function () {
			var cfg = currentBranding();
			if (!cfg) { if (window.showToast) showToast("Skriv branding först", "error"); return; }
			saveMall("/branding-presets", cfg, "Branding-mall");
		});
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
	// Dölj branding-överlägget när kartan är utfälld - men bara om det ligger uppe
	// till höger (där kart-överlägget hamnar). Andra hörn krockar inte (samma regel
	// som runtime-vieweren).
	function setBrandingForMap(mapOpen) {
		if (!brandingEl) return;
		var pos = brandingPos ? brandingPos.value : "bottom-right";
		brandingEl.style.display = (mapOpen && pos === "top-right") ? "none" : "";
	}
	if (previewMapToggle && previewMap) {
		previewMapToggle.addEventListener("click", function () { previewMap.hidden = false; previewMapToggle.hidden = true; setBrandingForMap(true); });
	}
	if (previewMapClose && previewMap) {
		previewMapClose.addEventListener("click", function () { previewMap.hidden = true; if (previewMapToggle) previewMapToggle.hidden = false; setBrandingForMap(false); });
	}

	// --- Flagg-overlay på panoramat för förhandsvisningsspråk (turens språk är
	// read-only här - satta på uppladdningssteget, se lang-picker.js). ---
	function renderPreviewLangToggle() {
		if (!previewLangToggle) return;
		if (selectedLangs.length <= 1) { previewLangToggle.hidden = true; previewLangDD = null; previewLangToggle.innerHTML = ""; return; }
		previewLangToggle.hidden = false;
		if (!previewLangDD) {
			previewLangDD = window.mountLangDropdown(previewLangToggle, {
				langs: selectedLangs,
				current: previewLang,
				showName: false,
				onPick: function (code) {
					previewLang = code;
					applyHotspotLanguage();
					refreshSceneLabels();
					applyBrandingLive();
					rebuildKeepView();
				},
			});
		} else {
			previewLangDD.setLangs(selectedLangs);
			previewLangDD.setCurrent(previewLang);
		}
		positionPreviewLangToggle();
	}
	function positionPreviewLangToggle() {
		if (!previewLangToggle || previewLangToggle.hidden || !panoramaWrap) return;
		const cc = panoramaWrap.querySelector(".pnlm-controls-container");
		const wrapRect = panoramaWrap.getBoundingClientRect();
		if (cc) {
			const r = cc.getBoundingClientRect();
			previewLangToggle.style.top = (r.bottom - wrapRect.top + 6) + "px";
			previewLangToggle.style.left = Math.max(4, r.left - wrapRect.left) + "px";
		} else {
			previewLangToggle.style.top = "96px";
			previewLangToggle.style.left = "4px";
		}
	}
	window.addEventListener("resize", positionPreviewLangToggle);

	// Markdown-tooltip på info-hotspots + scen-hotspotarnas "leder till"-etikett,
	// på valt förhandsvisningsspråk (funktionerna stannar på objekten över rebuilds).
	// Skriver även in den resolverade titeln i tour.scenes[id].title (läses ur
	// origTitle, INTE tour.scenes) så Pannellums inbyggda titel-ruta visar rätt
	// språk i stället för "[object Object]". Denna sida sparar aldrig scentitlar
	// (bara tour.default) så mutationen är ofarlig - bara en visnings-detalj.
	function applyHotspotLanguage() {
		var sceneNames = {};
		sceneIds().forEach(function (id) {
			var t = resolvedTitle(id) || ("Scen " + id);
			sceneNames[id] = t;
			tour.scenes[id].title = t;
			// Filtrera FÖRE attachHsTooltips - se origHotSpots-kommentaren ovan.
			// Bara vid flerspråkig tur (annars visas alla, jfr viewer.js).
			tour.scenes[id].hotSpots = (selectedLangs.length > 1)
				? origHotSpots[id].filter(function (h) { return window.hotspotInLang(h, previewLang); })
				: origHotSpots[id].slice();
		});
		if (!window.attachHsTooltips) return;
		sceneIds().forEach(function (id) { attachHsTooltips(tour.scenes[id].hotSpots, sceneNames, previewLang, selectedLangs); });
	}

	// --- Start ---
	renderPreviewLangToggle();
	applyHotspotLanguage();

	buildViewer(firstScene, null);
	if (mapImg) {
		if (mapImg.complete && mapImg.naturalWidth) buildDots();
		else mapImg.addEventListener("load", buildDots);
	}
})();
