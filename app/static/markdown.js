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

	// Koppla markdown-tooltip på rena info-hotspots (ej scen-/URL-hotspots).
	// Muterar och returnerar listan - kalla på KLONER som skickas till pannellum.
	window.attachHsTooltips = function (hotSpots) {
		(hotSpots || []).forEach(function (h) {
			if (h && h.type === "info" && !h.URL && h.text) {
				h.createTooltipFunc = window.mdHotspotTooltip;
				h.createTooltipArgs = h.text;
			}
		});
		return hotSpots;
	};
})();
