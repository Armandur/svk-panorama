/* Delad markdown-renderare: marked -> DOMPurify-sanerad HTML.
   Används av arbetsgångstexten, EasyMDE-previews och (kommande) info-hotspots.
   Kräver att marked.min.js + purify.min.js laddats före denna fil. */
(function () {
	"use strict";
	window.renderMarkdown = function (md) {
		if (!md) return "";
		var html = window.marked ? window.marked.parse(String(md)) : String(md);
		return window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
	};

	// Härda alla <a>-länkar inuti `el` mot reverse tabnabbing: en redigerare kan
	// skriva rå HTML-ankare med target="_blank" i markdown-källan (marked släpper
	// igenom, DOMPurify saneras men strippar inte target/rel) - utan noopener kan
	// destinationssidan navigera ursprungsfliken (window.opener). Körs EFTER varje
	// innerHTML-tilldelning av renderMarkdown-output (branding, hotspot-tooltip,
	// hotspot-ark) så alla tre renderingsvägar härdas likadant.
	function _hardenLinks(el) {
		if (!el) return;
		var links = el.getElementsByTagName("a");
		for (var i = 0; i < links.length; i++) { links[i].target = "_blank"; links[i].rel = "noopener noreferrer"; }
	}

	// --- Flerspråkighet -----------------------------------------------------
	// Kanoniska språk editorn kan välja bland (kod -> visningsnamn på eget språk).
	// SAMMA uppsättning som config.LANGUAGES (Python) - håll dem i synk. Turen
	// väljer en delmängd i tour.default.languages; först i den listan = default.
	window.LANG_NAMES = {
		sv: "Svenska", en: "English", de: "Deutsch",
		fi: "Suomi", no: "Norsk", da: "Dansk",
	};

	// Flaggor: vendorade SVG:er (flag-icons, MIT) som data-URI:er -> renderas
	// IDENTISKT på alla enheter (till skillnad från flagg-emoji som Windows inte
	// stödjer). Delas av runtime-vieweren, branding-editorn och /mallar. Språk ->
	// land: en=GB, da=DK; övriga = samma kod.
	window.LANG_FLAG = { sv: "se", en: "gb", de: "de", fi: "fi", no: "no", da: "dk" };
	window.FLAG_SVGS = {
		se: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGlkPSJmbGFnLWljb25zLXNlIiB2aWV3Qm94PSIwIDAgNjQwIDQ4MCI+CiAgPHBhdGggZmlsbD0iIzAwNTI5MyIgZD0iTTAgMGg2NDB2NDgwSDB6Ii8+CiAgPHBhdGggZmlsbD0iI2ZlY2IwMCIgZD0iTTE3NiAwdjE5Mkgwdjk2aDE3NnYxOTJoOTZWMjg4aDM2OHYtOTZIMjcyVjB6Ii8+Cjwvc3ZnPgo=",
		gb: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGlkPSJmbGFnLWljb25zLWdiIiB2aWV3Qm94PSIwIDAgNjQwIDQ4MCI+CiAgPHBhdGggZmlsbD0iIzAxMjE2OSIgZD0iTTAgMGg2NDB2NDgwSDB6Ii8+CiAgPHBhdGggZmlsbD0iI0ZGRiIgZD0ibTc1IDAgMjQ0IDE4MUw1NjIgMGg3OHY2Mkw0MDAgMjQxbDI0MCAxNzh2NjFoLTgwTDMyMCAzMDEgODEgNDgwSDB2LTYwbDIzOS0xNzhMMCA2NFYweiIvPgogIDxwYXRoIGZpbGw9IiNDODEwMkUiIGQ9Im00MjQgMjgxIDIxNiAxNTl2NDBMMzY5IDI4MXptLTE4NCAyMCA2IDM1TDU0IDQ4MEgwek02NDAgMHYzTDM5MSAxOTFsMi00NEw1OTAgMHpNMCAwbDIzOSAxNzZoLTYwTDAgNDJ6Ii8+CiAgPHBhdGggZmlsbD0iI0ZGRiIgZD0iTTI0MSAwdjQ4MGgxNjBWMHpNMCAxNjB2MTYwaDY0MFYxNjB6Ii8+CiAgPHBhdGggZmlsbD0iI0M4MTAyRSIgZD0iTTAgMTkzdjk2aDY0MHYtOTZ6TTI3MyAwdjQ4MGg5NlYweiIvPgo8L3N2Zz4K",
		de: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGlkPSJmbGFnLWljb25zLWRlIiB2aWV3Qm94PSIwIDAgNjQwIDQ4MCI+CiAgPHBhdGggZmlsbD0iI2ZjMCIgZD0iTTAgMzIwaDY0MHYxNjBIMHoiLz4KICA8cGF0aCBmaWxsPSIjMDAwMDAxIiBkPSJNMCAwaDY0MHYxNjBIMHoiLz4KICA8cGF0aCBmaWxsPSJyZWQiIGQ9Ik0wIDE2MGg2NDB2MTYwSDB6Ii8+Cjwvc3ZnPgo=",
		fi: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGlkPSJmbGFnLWljb25zLWZpIiB2aWV3Qm94PSIwIDAgNjQwIDQ4MCI+CiAgPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTAgMGg2NDB2NDgwSDB6Ii8+CiAgPHBhdGggZmlsbD0iIzAwMmY2YyIgZD0iTTAgMTc0LjVoNjQwdjEzMUgweiIvPgogIDxwYXRoIGZpbGw9IiMwMDJmNmMiIGQ9Ik0xNzUuNSAwaDEzMC45djQ4MGgtMTMxeiIvPgo8L3N2Zz4K",
		no: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGlkPSJmbGFnLWljb25zLW5vIiB2aWV3Qm94PSIwIDAgNjQwIDQ4MCI+CiAgPHBhdGggZmlsbD0iI2VkMjkzOSIgZD0iTTAgMGg2NDB2NDgwSDB6Ii8+CiAgPHBhdGggZmlsbD0iI2ZmZiIgZD0iTTE4MCAwaDEyMHY0ODBIMTgweiIvPgogIDxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0wIDE4MGg2NDB2MTIwSDB6Ii8+CiAgPHBhdGggZmlsbD0iIzAwMjY2NCIgZD0iTTIxMCAwaDYwdjQ4MGgtNjB6Ii8+CiAgPHBhdGggZmlsbD0iIzAwMjY2NCIgZD0iTTAgMjEwaDY0MHY2MEgweiIvPgo8L3N2Zz4K",
		dk: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGlkPSJmbGFnLWljb25zLWRrIiB2aWV3Qm94PSIwIDAgNjQwIDQ4MCI+CiAgPHBhdGggZmlsbD0iI2M4MTAyZSIgZD0iTTAgMGg2NDAuMXY0ODBIMHoiLz4KICA8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMjA1LjcgMGg2OC42djQ4MGgtNjguNnoiLz4KICA8cGF0aCBmaWxsPSIjZmZmIiBkPSJNMCAyMDUuN2g2NDAuMXY2OC42SDB6Ii8+Cjwvc3ZnPgo=",
	};
	// Flagg-data-URI för en språkkod (tom sträng om okänd).
	window.langFlag = function (langCode) {
		return window.FLAG_SVGS[window.LANG_FLAG[langCode]] || "";
	};

	// resolveText: plockar rätt språk ur ett textfält. Ren sträng = default-språk
	// (bakåtkompat/monospråkigt). Objekt {sv,en,...} -> valt språk, annars fallback:
	// default (langs[0]), sedan första icke-tomma. Tom sträng om inget finns.
	window.resolveText = function (value, lang, langs) {
		if (value == null) return "";
		if (typeof value === "string") return value;
		if (typeof value === "object") {
			if (lang && value[lang]) return value[lang];
			var order = langs || [];
			for (var i = 0; i < order.length; i++) { if (value[order[i]]) return value[order[i]]; }
			for (var k in value) { if (value[k]) return value[k]; }
		}
		return "";
	};

	// hotspotInLang: ska denna hotspot visas på `lang`? hs.langs = valfri lista
	// begränsade språkkoder, satt via "Visa på språk" i hotspot-modalen
	// (scene.js). Saknas/tom lista = visas på ALLA språk (bakåtkompatibelt,
	// default för hotspots utan fältet). Python-spegel: app/services/i18n.py
	// hotspot_in_lang - håll dem i synk.
	window.hotspotInLang = function (hs, lang) {
		return !hs || !Array.isArray(hs.langs) || hs.langs.length === 0 || hs.langs.indexOf(lang) !== -1;
	};

	// Lokaliserade UI-chrome-strängar (knappar/etiketter som besökaren ser).
	var _UI = {
		readMore: { sv: "Läs mer", en: "Read more", de: "Mehr lesen", fi: "Lue lisää", no: "Les mer", da: "Læs mere" },
		map: { sv: "Karta", en: "Map", de: "Karte", fi: "Kartta", no: "Kart", da: "Kort" },
		closeMap: { sv: "Stäng karta", en: "Close map", de: "Karte schließen", fi: "Sulje kartta", no: "Lukk kart", da: "Luk kort" },
		mapAlt: { sv: "Översiktskarta", en: "Overview map", de: "Übersichtskarte", fi: "Yleiskartta", no: "Oversiktskart", da: "Oversigtskort" },
		scene: { sv: "Scen", en: "Scene", de: "Szene", fi: "Kohtaus", no: "Scene", da: "Scene" },
		close: { sv: "Stäng", en: "Close", de: "Schließen", fi: "Sulje", no: "Lukk", da: "Luk" },
		language: { sv: "Språk", en: "Language", de: "Sprache", fi: "Kieli", no: "Språk", da: "Sprog" },
	};
	window.uiStr = function (key, lang) {
		var m = _UI[key] || {};
		return m[lang] || m.sv || "";
	};

	// Branding-overlay (logotyp/text/länk som markdown) i vieweren. Renderar in i
	// ett .tour-branding-element och sätter storleks-/positionsklass; externa
	// länkar öppnas i ny flik. branding = {content, size, position} | null
	// (null/tom content -> elementet döljs). Delad av runtime-vieweren och
	// preview-stegets live-förhandsvisning.
	var _BR_SIZES = { small: 1, medium: 1, large: 1 };
	var _BR_POS = { "bottom-left": 1, "bottom-right": 1, "top-left": 1, "top-right": 1 };
	window.renderBrandingInto = function (el, branding, lang, langs) {
		if (!el) return;
		el.className = "tour-branding";
		var content = branding && window.resolveText(branding.content, lang, langs);
		if (!content) { el.hidden = true; el.innerHTML = ""; return; }
		var size = _BR_SIZES[branding.size] ? branding.size : "medium";
		var pos = _BR_POS[branding.position] ? branding.position : "bottom-right";
		el.classList.add("branding-" + size, "branding-" + pos);
		el.innerHTML = window.renderMarkdown(content);
		_hardenLinks(el);
		el.hidden = false;
	};

	// Pannellum-createTooltipFunc: rendera hotspot-text som (sanerad) markdown i
	// tooltipen. Replikerar pannellums default-positionering (centrerad ovanför
	// hotspoten). Klassen .pnlm-tooltip styr hover-visning; .hs-md stylar innehållet.
	// args: {text, body}. text = teaser (markdown), body = ev. läs mer-innehåll.
	// Expanderbara hotspots får en "Läs mer"-knapp i tooltipen (visas bara vid
	// hover/tap) som öppnar fullskärms-arket.
	// args: {text, body, width, belowLabel}. text = teaser (markdown, ovanför),
	// body = ev. läs mer, belowLabel = etikett NEDANFÖR hotspoten (t.ex. scen-mål).
	window.mdHotspotTooltip = function (div, args) {
		div.classList.add("pnlm-tooltip");
		var text = (typeof args === "string") ? args : (args && args.text) || "";
		var body = (args && typeof args === "object") ? args.body : null;
		var belowLabel = (args && typeof args === "object") ? args.belowLabel : null;

		if (text || body) {
			var span = document.createElement("span");
			span.className = "hs-md";
			if (text) { span.innerHTML = window.renderMarkdown(text); _hardenLinks(span); }
			if (body) {
				var more = document.createElement("button");
				more.type = "button";
				more.className = "hs-more";
				more.textContent = (args && args.readMore) || "Läs mer";
				more.addEventListener("click", function (e) { e.stopPropagation(); window.openHsSheet(body); });
				span.appendChild(more);
			}
			div.appendChild(span);
			// Bredd: preset per hotspot, annars flödar den mellan min/max (CSS).
			var W = { narrow: 220, medium: 320, wide: 440 };
			var w = (typeof args === "object" && args) ? W[args.width] : null;
			if (w) span.style.width = w + "px";
			// Centrera + placera ovanför utifrån FAKTISK renderad storlek.
			var place = function () {
				span.style.marginLeft = -(span.offsetWidth - div.offsetWidth) / 2 + "px";
				span.style.marginTop = (-span.offsetHeight - 6) + "px";
			};
			place();
			// Bilder laddar asynkront -> höjden ändras; räkna om positionen.
			var imgs = span.getElementsByTagName("img");
			for (var i = 0; i < imgs.length; i++) {
				if (!imgs[i].complete) imgs[i].addEventListener("load", place);
			}
		}
		// Etikett nedanför hotspoten (t.ex. scen-hotspotens mål). CSS positionerar den.
		if (belowLabel) {
			// Scen-etiketten är alltid synlig (app.css: `.pnlm-scene span { visibility:
			// visible !important }`), så innan pannellum hunnit projicera hotspoten blinkar
			// den i (0,0) uppe till vänster. `hs-await-pos` (högre specificitet) gömmer
			// span:en tills pannellums renderloop satt en transform (positionerat den);
			// rAF-poll tar bort klassen då. Endast belowLabel-fallet (scen-editorn) berörs.
			div.classList.add("hs-await-pos");
			var reveal = function () {
				if (div.style.transform) div.classList.remove("hs-await-pos");
				else requestAnimationFrame(reveal);
			};
			requestAnimationFrame(reveal);
			var lbl = document.createElement("span");
			lbl.className = "hs-scenelabel";
			lbl.textContent = belowLabel;
			div.appendChild(lbl);
		}
	};

	// --- Fullskärms-ark för expanderbara hotspots ("läs mer") ---
	var _sheet, _sheetBody;
	function buildSheet() {
		_sheet = document.createElement("div");
		_sheet.className = "hs-sheet";
		_sheet.hidden = true;
		_sheet.innerHTML =
			'<div class="hs-sheet-inner">' +
			'<button type="button" class="hs-sheet-close close-x" aria-label="Stäng">&times;</button>' +
			'<div class="hs-sheet-body markdown-body"></div>' +
			'</div>';
		document.body.appendChild(_sheet);
		_sheetBody = _sheet.querySelector(".hs-sheet-body");
		_sheet.querySelector(".hs-sheet-close").addEventListener("click", closeSheet);
		_sheet.addEventListener("click", function (e) { if (e.target === _sheet) closeSheet(); });
		document.addEventListener("keydown", function (e) { if (e.key === "Escape" && _sheet && !_sheet.hidden) closeSheet(); });
	}
	function closeSheet() { if (_sheet) _sheet.hidden = true; }
	window.openHsSheet = function (md) {
		if (!_sheet) buildSheet();
		// I pannellums helskärm renderas bara det fullskärmade elementet + dess barn.
		// Arket ligger annars på body (utanför) -> flytta in det i fullscreen-elementet
		// vid öppning så "Läs mer" fungerar även i helskärm (som karta/branding-relocate).
		var fs = document.fullscreenElement || document.webkitFullscreenElement;
		(fs || document.body).appendChild(_sheet);
		_sheetBody.innerHTML = window.renderMarkdown(md);
		_hardenLinks(_sheetBody);
		_sheetBody.scrollTop = 0;
		_sheet.hidden = false;
	};

	// Koppla markdown-tooltip (teaser) på rena info-hotspots. Expanderbara får
	// dessutom en klick-handler som öppnar fullskärms-arket med body + en
	// affordans-klass. Muterar listan - kalla på KLONER som skickas till pannellum.
	// Touch-primära enheter (mobil) saknar hover -> öppna INTE arket direkt på tap;
	// tap ska visa teaser-tooltipen med "Läs mer"-knappen i stället.
	var _touchPrimary = !!(window.matchMedia && window.matchMedia("(hover: none)").matches);

	// sceneNames: {sceneId: RESOLVERAD titel} för scen-hotspotarnas "leder till"-
	// etikett (kallaren resolverar titeln för aktuellt språk). lang/langs styr
	// vilket språk hotspot-text/body/body-knapp visas på. Text-fält kan vara ren
	// sträng (monospråkigt) eller {sv,en,...} (resolveText väljer).
	// opts.sceneLabel: visa scen-hotspotarnas "→ leder till"-etikett NEDANFÖR. Det är en
	// BYGGHJÄLP - bara scen-editorn (scene.js) skickar true. I preview och färdiga turer
	// (viewer/bundle/translate) utelämnas den, och en scen-hotspot utan teaser får då
	// ingen tooltip alls (bara pilen).
	window.attachHsTooltips = function (hotSpots, sceneNames, lang, langs, opts) {
		sceneNames = sceneNames || {};
		var showSceneLabel = !!(opts && opts.sceneLabel);
		var readMore = window.uiStr("readMore", lang);
		(hotSpots || []).forEach(function (h) {
			if (!h) return;
			var text = window.resolveText(h.text, lang, langs);
			if (h.type === "info" && !h.URL) {
				var bodyText = (h.expandable && h.body) ? window.resolveText(h.body, lang, langs) : "";
				var body = bodyText || null;
				if (text || body) {
					h.createTooltipFunc = window.mdHotspotTooltip;
					h.createTooltipArgs = { text: text, body: body, width: h.tooltipWidth || null, readMore: readMore };
				}
				// Dator: klick på hotspoten öppnar arket. Mobil: tap visar tooltip + "Läs mer".
				if (body && !_touchPrimary) {
					h.clickHandlerFunc = function (e, b) { window.openHsSheet(b); };
					h.clickHandlerArgs = body;
				}
			} else if (h.type === "scene") {
				// Scen-hotspot. Editor: teaser (MD) ovanför + "-> leder till"-etikett nedanför.
				// Preview/runtime: bara teaser om den finns, ALDRIG etiketten (bygghjälp).
				if (showSceneLabel) {
					// Extern (URL/_external) scen-hotspot -> "annan tur"; annars målscenens titel.
					var target = (h._external || h.URL || h.tourRef) ? "annan tur"
						: (sceneNames[h.sceneId] || (window.uiStr("scene", lang) + " " + h.sceneId));
					h.createTooltipFunc = window.mdHotspotTooltip;
					h.createTooltipArgs = { text: text, width: h.tooltipWidth || null, belowLabel: "→ " + target };
				} else if (text) {
					h.createTooltipFunc = window.mdHotspotTooltip;
					h.createTooltipArgs = { text: text, width: h.tooltipWidth || null };
				}
			} else if (h.URL && text) {
				// URL-hotspot: rendera texten som MD-teaser (samma väg, inget ark).
				h.createTooltipFunc = window.mdHotspotTooltip;
				h.createTooltipArgs = { text: text, width: h.tooltipWidth || null };
			}
		});
		return hotSpots;
	};
})();
