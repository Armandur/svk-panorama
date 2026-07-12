/* Enkel lightbox för fullstor förhandsvisning av en bild. window.openLightbox(url, alt).
   Återanvänder .help-modal (overlay + [hidden]) så modal-a11y ger fokusfälla/Escape. */
(function () {
	"use strict";
	var overlay, img;

	function build() {
		overlay = document.createElement("div");
		overlay.className = "media-lightbox help-modal";
		overlay.hidden = true;
		overlay.innerHTML =
			'<button type="button" class="media-lb-close" aria-label="Stäng">&times;</button>' +
			'<img class="media-lb-img" alt="">';
		document.body.appendChild(overlay);
		img = overlay.querySelector(".media-lb-img");
		overlay.querySelector(".media-lb-close").addEventListener("click", close);
		overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
		document.addEventListener("keydown", function (e) { if (e.key === "Escape" && overlay && !overlay.hidden) close(); });
	}

	function close() { if (overlay) { overlay.hidden = true; img.removeAttribute("src"); } }

	window.openLightbox = function (url, alt) {
		if (!overlay) build();
		img.src = url;
		img.alt = alt || "";
		overlay.hidden = false;
	};
})();
