/* Runtime-viewer: ren visning av en publicerad tur. Ingen editor-logik.
   Pannellum sköter all hotspot-rendering och scen-navigering; det enda vi
   lägger till är kartöverlägget (klickbara prickar + markering av aktiv scen),
   branding-overlägget och flerspråkighet (språkväljare + resolvering av
   text-fält som kan vara {sv,en,...}). Turdata och kartdata bäddas in som
   JSON-script-taggar av mallen. */
(function () {
	const tour = JSON.parse(document.getElementById("tour-data").textContent);
	const mapEl = document.getElementById("map-data");
	const mapData = mapEl ? JSON.parse(mapEl.textContent) : { scenes: [] };

	// Publicerad tur körs alltid utan editor-läge, oavsett vad filen säger.
	tour.default = tour.default || {};
	tour.default.editorMode = false;
	// Säkerhet: escapa scen-titel/hotspot-text i pannellums default-rendering
	// (info-hotspots har egen DOMPurify-väg via attachHsTooltips och påverkas ej).
	// escapeHTML är en top-level general-option i pannellum (syskon till default/scenes).
	tour.escapeHTML = true;

	// --- Flerspråkighet: språklista + val av aktuellt språk ----------------
	// tour.default.languages = koder, FÖRST = default. Saknas på äldre turer ->
	// monospråkigt (bara "sv"). resolveText/attachHsTooltips/renderBrandingInto
	// kommer från markdown.js (delad kontrakt, ändras inte här).
	var langs = (tour.default && Array.isArray(tour.default.languages) && tour.default.languages.length)
		? tour.default.languages : ["sv"];

	// Pannellum har en egen inbyggd titel-ruta som läser scene.title RAKT AV och
	// skulle visa "[object Object]" för en flerspråkig {kod:text}-titel. Vi
	// resolverar därför titeln till en ren sträng och skriver in den i
	// tour.scenes[id].title inför varje (om)byggnad - men läser alltid ur denna
	// orörda kopia (annars vore originalet borta vid nästa språkbyte). Säkert:
	// runtime-vieweren sparar aldrig tillbaka tour.
	var origTitle = {};
	Object.keys(tour.scenes || {}).forEach(function (id) { origTitle[id] = tour.scenes[id].title; });

	// --- Djuplänkning (#scene=..&yaw=..&pitch=..&hfov=..&lang=..) ----------
	// Läs ev. vy + språk ur URL-hashen så en delad länk landar på rätt scen,
	// riktning och språk. Skrivs tillbaka vid scenbyte, vy-ändring och språkbyte
	// (INTE under autorotate - då skulle URL:en flimra). Gäller /view, publik /s
	// och bundlen.
	function parseHash() {
		const h = (location.hash || "").replace(/^#/, "");
		if (!h) return null;
		const p = new URLSearchParams(h);
		return {
			scene: p.get("scene"),
			yaw: parseFloat(p.get("yaw")),
			pitch: parseFloat(p.get("pitch")),
			hfov: parseFloat(p.get("hfov")),
			lang: p.get("lang"),
		};
	}
	const initialHash = parseHash();

	// Precedens: ?lang= i hashen -> tidigare val (localStorage) -> 2-bokstavs-
	// match av webbläsarspråket -> första språket i turen. Måste vara ett av
	// turens språk, annars langs[0].
	function pickInitialLang() {
		if (initialHash && initialHash.lang && langs.indexOf(initialHash.lang) !== -1) return initialHash.lang;
		try {
			var stored = localStorage.getItem("tour_lang");
			if (stored && langs.indexOf(stored) !== -1) return stored;
		} catch (e) { /* privat läge/blockerad storage - ignorera */ }
		var nav = ((navigator.language || "") + "").slice(0, 2).toLowerCase();
		if (nav && langs.indexOf(nav) !== -1) return nav;
		return langs[0];
	}
	var currentLang = pickInitialLang();

	if (initialHash && initialHash.scene && tour.scenes && tour.scenes[initialHash.scene]) {
		tour.default.firstScene = initialHash.scene;
	}
	let pendingView = initialHash && [initialHash.yaw, initialHash.pitch, initialHash.hfov].some(isFinite) ? initialHash : null;

	// --- Tema (typsnitt + färger) ------------------------------------------
	const FONTS = {
		sans: '"Nimbus Sans L","Liberation Sans",Arial,sans-serif',
		serif: 'Georgia,"Times New Roman",serif',
		mono: 'ui-monospace,"Courier New",monospace',
		humanist: '"Segoe UI","Trebuchet MS","Nimbus Sans L",sans-serif',
		dmsans: '"DM Sans","Nimbus Sans L","Liberation Sans",Arial,sans-serif',
		spectral: '"Spectral",Georgia,"Times New Roman",serif',
	};
	(function applyTheme() {
		const t = tour.default.theme || {};
		const root = document.documentElement.style;
		root.setProperty("--tour-font", FONTS[t.font] || FONTS.sans);
		root.setProperty("--dot-color", t.dotColor || "#666666");
		root.setProperty("--current-dot-color", t.currentColor || "#8b0000");
	})();

	// Rendera info-/scen-/URL-hotspotarnas text som markdown i tooltipen, på
	// aktuellt språk. sceneNames = REDAN RESOLVERADE scentitlar (kontraktet
	// kräver det). Körs vid varje buildViewer() (init + språkbyte) - muterar
	// tour.scenes[id].hotSpots, pannellum får kloner via sitt eget init.
	function updateHotspotTooltips() {
		var sceneNames = {};
		Object.keys(tour.scenes || {}).forEach(function (id) {
			var resolved = window.resolveText(origTitle[id], currentLang, langs);
			sceneNames[id] = resolved;
			// Skriv in ren sträng så pannellums titel-ruta inte visar [object Object].
			if (resolved) tour.scenes[id].title = resolved;
			else delete tour.scenes[id].title;
		});
		if (!window.attachHsTooltips) return;
		Object.keys(tour.scenes || {}).forEach(function (id) {
			attachHsTooltips(tour.scenes[id].hotSpots, sceneNames, currentLang, langs);
		});
	}

	// --- Branding-overlay (logotyp/text) ----------------------------------
	// Litet överlägg (logga eller församlingsnamn med länk) konfigurerat på
	// preview-steget. Ligger som fixed-element över panoramat; flyttas in i det
	// fullskärmade elementet vid helskärm (se relocateOverlay längre ner, delad
	// med kart-/språk-kontrollerna).
	var brandingEl = null;
	// Kart-överlägget hamnar uppe till höger (mobil: full bredd upptill). Bara en
	// branding som ligger uppe till höger krockar med det -> bara den ska gömmas
	// när kartan fälls ut. top-left/bottom-left/bottom-right lämnas synliga.
	var brandingHidesForMap = false;
	(function setupBranding() {
		var b = tour.default.branding;
		if (!b || !b.content || !window.renderBrandingInto) return;
		brandingHidesForMap = b.position === "top-right";
		brandingEl = document.createElement("div");
		document.body.appendChild(brandingEl);
	})();
	function updateBranding() {
		if (brandingEl) window.renderBrandingInto(brandingEl, tour.default.branding, currentLang, langs);
	}

	// --- Pannellum-instans (byggs om vid språkbyte) -------------------------
	// Pannellum djupkopierar hotspot-config vid init - ett språkbyte kräver
	// därför en fullständig ombyggnad (destroy + nytt pannellum.viewer(...)),
	// inte bara en omkoppling av tooltip-argumenten.
	var viewer = null;

	function writeHash() {
		try {
			const h = "#scene=" + encodeURIComponent(viewer.getScene()) +
				"&yaw=" + Math.round(viewer.getYaw() * 10) / 10 +
				"&pitch=" + Math.round(viewer.getPitch() * 10) / 10 +
				"&hfov=" + Math.round(viewer.getHfov()) +
				"&lang=" + encodeURIComponent(currentLang);
			history.replaceState(null, "", h);
		} catch (e) { /* getters ej redo ännu */ }
	}

	function attachViewerEvents() {
		viewer.on("load", function () {
			if (pendingView) {
				try {
					if (isFinite(pendingView.yaw)) viewer.setYaw(pendingView.yaw, false);
					if (isFinite(pendingView.pitch)) viewer.setPitch(pendingView.pitch, false);
					if (isFinite(pendingView.hfov)) viewer.setHfov(pendingView.hfov, false);
				} catch (e) { /* ignore */ }
				pendingView = null;
			}
			writeHash();
			positionLangToggle();  // pannellums kontroller finns nu -> placera under dem
		});
		// Användarstyrda vy-ändringar (drag/zoom/scenbyte) - inte autorotate.
		["scenechange", "mouseup", "touchend", "zoomchange"].forEach(function (ev) {
			viewer.on(ev, writeHash);
		});
		viewer.on("scenechange", markCurrent);
	}

	// Bygger (eller bygger om) pannellum-instansen för currentLang. Kör alltid
	// hotspot-tooltips/branding/UI-chrome-strängarna på nytt så de matchar
	// currentLang, oavsett om det är första bygget eller en ombyggnad.
	function buildViewer() {
		document.documentElement.lang = currentLang;
		updateHotspotTooltips();
		updateBranding();
		updateUiChrome();
		viewer = pannellum.viewer("panorama", tour);
		attachViewerEvents();
	}

	// Flyttar kart-/branding-/språk-kontrollerna tillbaka till <body> innan en
	// ombyggnad. De kan ligga inflyttade i panorama-diven (helskärm, se
	// relocateOverlay) - viewer.destroy() tömmer den diven (innerHTML = "") och
	// skulle annars radera kontrollerna med.
	function parkOverlayInBody() {
		if (brandingEl) document.body.appendChild(brandingEl);
		if (showBtn) document.body.appendChild(showBtn);
		if (container) document.body.appendChild(container);
		if (langToggle) document.body.appendChild(langToggle);
	}

	// Bygger om vieweren för ett nytt currentLang: fångar aktuell vy, förstör
	// den gamla instansen och skapar en ny med samma scen/vy återställd.
	function rebuildViewer() {
		var scene = null, yaw, pitch, hfov;
		if (viewer) {
			try {
				scene = viewer.getScene();
				yaw = viewer.getYaw();
				pitch = viewer.getPitch();
				hfov = viewer.getHfov();
			} catch (e) { scene = null; }
			parkOverlayInBody();
			viewer.destroy();
		}
		if (scene && tour.scenes && tour.scenes[scene]) {
			tour.default.firstScene = scene;
			pendingView = { yaw: yaw, pitch: pitch, hfov: hfov };
		}
		buildViewer();
		if (Object.keys(dotEls).length) markCurrent(viewer.getScene());
		// Flytta tillbaka in i helskärmselementet om vi fortfarande är i
		// helskärm (no-op annars, host blir då bara body igen).
		relocateOverlay();
	}

	// Gyro/enhetsorientering hanteras av pannellums INBYGGDA knapp (visas
	// automatiskt på https + mobil). Ingen egen knapp behövs. Ev. aktiv
	// gyro-läsning nollställs vid ett språkbyte (ny pannellum-instans) - samma
	// sak som vid vanlig scenladdning, inget vi behöver återställa manuellt.

	// --- Kartöverlägg (element + hjälpare) ----------------------------------
	const container = document.getElementById("map-container");
	const mapImg = container ? document.getElementById("map-img") : null;
	const dotsLayer = container ? document.getElementById("map-dots") : null;
	const showBtn = container ? document.getElementById("show-map-btn") : null;
	const closeBtn = container ? document.getElementById("close-map-btn") : null;
	const dotEls = {};

	if (container) container.dataset.size = (tour.default && tour.default.mapSize) || "medium";

	function buildDots() {
		if (!container || !mapImg.naturalWidth) return;
		dotsLayer.textContent = "";
		Object.keys(dotEls).forEach(function (k) { delete dotEls[k]; });
		(mapData.scenes || []).forEach(function (s) {
			const d = document.createElement("button");
			d.type = "button";
			d.className = "map-dot";
			// Procent av naturlig bildstorlek -> upplösningsoberoende.
			d.style.left = (s.position.x / mapImg.naturalWidth * 100) + "%";
			d.style.top = (s.position.y / mapImg.naturalHeight * 100) + "%";
			d.title = window.uiStr("scene", currentLang) + " " + s.id;
			d.addEventListener("click", function () {
				if (viewer.getScene() === s.id) return;
				// Ankomst via kartan (inte hotspot) -> visa scenens startriktning.
				var sc = tour.scenes[s.id];
				var y = sc && typeof sc.yaw === "number" ? sc.yaw : undefined;
				var pi = sc && typeof sc.pitch === "number" ? sc.pitch : undefined;
				viewer.loadScene(s.id, pi, y);
			});
			dotsLayer.appendChild(d);
			dotEls[s.id] = d;
		});
		markCurrent(viewer.getScene());
	}

	function markCurrent(id) {
		Object.keys(dotEls).forEach(function (k) {
			dotEls[k].classList.toggle("current", k === id);
		});
	}

	// När kartan är utfälld döljs branding-överlägget helt (annars ligger det
	// transparent ovanpå den transparenta kartpopupen -> rörigt).
	function setBrandingForMap(mapOpen) {
		if (brandingEl) brandingEl.style.display = (mapOpen && brandingHidesForMap) ? "none" : "";
	}

	// Uppdaterar allt hårdkodat UI-chrome (kartknapp/etiketter/språkväljare) till
	// currentLang. Körs vid varje buildViewer() (init + ombyggnad).
	function updateUiChrome() {
		if (container) {
			showBtn.textContent = window.uiStr("map", currentLang);
			closeBtn.setAttribute("aria-label", window.uiStr("closeMap", currentLang));
			mapImg.alt = window.uiStr("mapAlt", currentLang);
			Object.keys(dotEls).forEach(function (id) {
				dotEls[id].title = window.uiStr("scene", currentLang) + " " + id;
			});
		}
		if (langToggle) {
			langBtn.setAttribute("aria-label", window.uiStr("language", currentLang) + ": " + (window.LANG_NAMES[currentLang] || currentLang));
			if (langCurrentFlag) langCurrentFlag.src = window.langFlag(currentLang);
			markLangActive();
			positionLangToggle();
		}
	}

	// --- Språkväljare (flaggor, bara vid fler än ett språk) -----------------
	// Infälld: bara aktuell flagga. Utfälld: meny med flagga + språknamn.
	// Placeras längs vänsterkanten under pannellums verktygsknappar (positioneras
	// mot .pnlm-controls-container efter bygget).
	var langToggle = null, langBtn = null, langCurrentFlag = null, langMenu = null;
	function markLangActive() {
		if (!langMenu) return;
		Array.prototype.forEach.call(langMenu.children, function (it) {
			it.classList.toggle("active", it.dataset.lang === currentLang);
		});
	}
	function openLangMenu() { if (langMenu) { langMenu.hidden = false; langToggle.classList.add("open"); markLangActive(); } }
	function closeLangMenu() { if (langMenu) { langMenu.hidden = true; langToggle.classList.remove("open"); } }
	function positionLangToggle() {
		if (!langToggle) return;
		var cc = document.querySelector(".pnlm-controls-container");
		if (cc) {
			var r = cc.getBoundingClientRect();
			langToggle.style.top = (r.bottom + 6) + "px";
			langToggle.style.left = Math.max(4, r.left) + "px";
		} else {
			langToggle.style.top = "96px";
			langToggle.style.left = "4px";
		}
	}
	if (langs.length >= 2) {
		langToggle = document.createElement("div");
		langToggle.className = "lang-toggle";
		langBtn = document.createElement("button");
		langBtn.type = "button";
		langBtn.className = "lang-current";
		langCurrentFlag = document.createElement("img");
		langCurrentFlag.alt = "";
		langBtn.appendChild(langCurrentFlag);
		langToggle.appendChild(langBtn);
		langMenu = document.createElement("div");
		langMenu.className = "lang-menu";
		langMenu.hidden = true;
		langs.forEach(function (code) {
			var item = document.createElement("button");
			item.type = "button";
			item.className = "lang-item";
			item.dataset.lang = code;
			var f = document.createElement("img");
			f.src = window.langFlag(code); f.alt = "";
			var name = document.createElement("span");
			name.textContent = window.LANG_NAMES[code] || code;
			item.appendChild(f); item.appendChild(name);
			item.addEventListener("click", function () { closeLangMenu(); setLang(code); });
			langMenu.appendChild(item);
		});
		langToggle.appendChild(langMenu);
		langBtn.addEventListener("click", function (e) {
			e.stopPropagation();
			if (langMenu.hidden) openLangMenu(); else closeLangMenu();
		});
		document.addEventListener("click", closeLangMenu);
		document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLangMenu(); });
		window.addEventListener("resize", positionLangToggle);
		document.body.appendChild(langToggle);
	}

	function setLang(lang) {
		if (langs.indexOf(lang) === -1 || lang === currentLang) return;
		currentLang = lang;
		try { localStorage.setItem("tour_lang", currentLang); } catch (e) { /* privat läge/blockerad storage */ }
		writeHash(); // uppdaterar #lang= direkt (viewer finns fortfarande kvar här)
		rebuildViewer();
	}

	// --- Bygg den första pannellum-instansen --------------------------------
	buildViewer();

	if (container) {
		if (mapImg.complete && mapImg.naturalWidth) buildDots();
		else mapImg.addEventListener("load", buildDots);

		showBtn.addEventListener("click", function () {
			container.hidden = false;
			showBtn.hidden = true;
			setBrandingForMap(true);
		});
		closeBtn.addEventListener("click", function () {
			container.hidden = true;
			showBtn.hidden = false;
			setBrandingForMap(false);
		});
	}

	// Pannellums helskärm renderar bara det fullskärmade elementet + dess barn.
	// Kart-/branding-/språk-kontrollerna ligger utanför pannellums container och
	// försvinner annars i helskärm - flytta in dem i det fullskärmade elementet
	// (och tillbaka till body när man går ur). Robust oavsett vilket element som
	// fullskärmas.
	function relocateOverlay() {
		var fs = document.fullscreenElement || document.webkitFullscreenElement;
		var host = fs || document.body;
		if (brandingEl) host.appendChild(brandingEl);
		if (showBtn) host.appendChild(showBtn);
		if (container) host.appendChild(container);
		if (langToggle) host.appendChild(langToggle);
	}
	document.addEventListener("fullscreenchange", relocateOverlay);
	document.addEventListener("webkitfullscreenchange", relocateOverlay);
})();
