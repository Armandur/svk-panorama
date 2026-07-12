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
			if (text) span.innerHTML = window.renderMarkdown(text);
			if (body) {
				var more = document.createElement("button");
				more.type = "button";
				more.className = "hs-more";
				more.textContent = "Läs mer";
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
			'<button type="button" class="hs-sheet-close" aria-label="Stäng">&times;</button>' +
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
		_sheetBody.innerHTML = window.renderMarkdown(md);
		_sheetBody.scrollTop = 0;
		_sheet.hidden = false;
	};

	// Koppla markdown-tooltip (teaser) på rena info-hotspots. Expanderbara får
	// dessutom en klick-handler som öppnar fullskärms-arket med body + en
	// affordans-klass. Muterar listan - kalla på KLONER som skickas till pannellum.
	// Touch-primära enheter (mobil) saknar hover -> öppna INTE arket direkt på tap;
	// tap ska visa teaser-tooltipen med "Läs mer"-knappen i stället.
	var _touchPrimary = !!(window.matchMedia && window.matchMedia("(hover: none)").matches);

	// sceneNames: {sceneId: titel} för scen-hotspotarnas "leder till"-etikett.
	window.attachHsTooltips = function (hotSpots, sceneNames) {
		sceneNames = sceneNames || {};
		(hotSpots || []).forEach(function (h) {
			if (!h) return;
			if (h.type === "info" && !h.URL) {
				var body = (h.expandable && h.body) ? h.body : null;
				if (h.text || body) {
					h.createTooltipFunc = window.mdHotspotTooltip;
					h.createTooltipArgs = { text: h.text || "", body: body, width: h.tooltipWidth || null };
				}
				// Dator: klick på hotspoten öppnar arket. Mobil: tap visar tooltip + "Läs mer".
				if (body && !_touchPrimary) {
					h.clickHandlerFunc = function (e, b) { window.openHsSheet(b); };
					h.clickHandlerArgs = body;
				}
			} else if (h.type === "scene") {
				// Scen-hotspot: ev. teaser (MD) ovanför + "-> leder till"-etikett nedanför.
				var target = sceneNames[h.sceneId] || ("Scen " + h.sceneId);
				h.createTooltipFunc = window.mdHotspotTooltip;
				h.createTooltipArgs = { text: h.text || "", width: h.tooltipWidth || null, belowLabel: "→ " + target };
			} else if (h.URL && h.text) {
				// URL-hotspot: rendera texten som MD-teaser (samma väg, inget ark).
				h.createTooltipFunc = window.mdHotspotTooltip;
				h.createTooltipArgs = { text: h.text, width: h.tooltipWidth || null };
			}
		});
		return hotSpots;
	};
})();
