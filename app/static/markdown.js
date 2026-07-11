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
	window.mdHotspotTooltip = function (div, text) {
		div.classList.add("pnlm-tooltip");
		var span = document.createElement("span");
		span.className = "hs-md";
		span.innerHTML = window.renderMarkdown(text);
		div.appendChild(span);
		span.style.width = (span.scrollWidth - 20) + "px";
		span.style.marginLeft = -(span.scrollWidth - div.offsetWidth) / 2 + "px";
		span.style.marginTop = (-span.scrollHeight - 12) + "px";
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
	window.attachHsTooltips = function (hotSpots) {
		(hotSpots || []).forEach(function (h) {
			if (!h || h.type !== "info" || h.URL) return;
			if (h.text) {
				h.createTooltipFunc = window.mdHotspotTooltip;
				h.createTooltipArgs = h.text;
			}
			if (h.expandable && h.body) {
				// Pannellum ersätter default-klasserna när cssClass sätts - ta med
				// pnlm-hotspot + pnlm-info så ikonen behålls, plus vår affordans.
				h.cssClass = "pnlm-hotspot pnlm-info hs-expandable";
				h.clickHandlerFunc = function (e, body) { window.openHsSheet(body); };
				h.clickHandlerArgs = h.body;
			}
		});
		return hotSpots;
	};
})();
