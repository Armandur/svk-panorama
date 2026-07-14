// Projektlistan: växla lista/kort (localStorage) + hover-preview i korten
// (turens första scen som snurrande mini-pannellum, återanvänder ScenePreview-
// snurrningen). Statisk tumnagel tills man hovrar.
(function () {
	"use strict";

	var VIEW_KEY = "editor_view";
	var views = document.getElementById("projects-views");

	function setView(v) {
		if (!views) return;
		views.dataset.view = v;
		try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* privat läge */ }
		document.querySelectorAll(".view-btn").forEach(function (b) {
			b.classList.toggle("active", b.dataset.view === v);
		});
	}

	if (views) {
		var saved = null;
		try { saved = localStorage.getItem(VIEW_KEY); } catch (e) { /* ignore */ }
		setView(saved === "cards" ? "cards" : "table");
		var toggle = document.querySelector(".view-toggle");
		if (toggle) toggle.addEventListener("click", function (e) {
			var b = e.target.closest(".view-btn");
			if (b) setView(b.dataset.view);
		});
	}

	// Hover -> live mini-pannellum av turens första scen (i tumnagelrutan, ovanpå
	// den statiska bilden). pointer-events: none så klick fortsatt går till länken.
	document.querySelectorAll(".tour-card[data-first-scene]").forEach(function (card) {
		var slug = card.dataset.slug, scene = card.dataset.firstScene;
		var thumb = card.querySelector(".tour-card-thumb");
		var viewer = null, overlay = null, stop = null, tmr = null;

		function enter() {
			if (!window.pannellum || !thumb || viewer || tmr) return;
			tmr = setTimeout(function () {
				tmr = null;
				overlay = document.createElement("div");
				overlay.className = "tour-card-live";
				thumb.appendChild(overlay);
				void overlay.offsetHeight;  // layout-flush så pannellum mäter rätt
				try {
					viewer = pannellum.viewer(overlay, {
						type: "equirectangular",
						panorama: "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(scene) + ".jpg",
						autoLoad: true, autoRotate: 0, showControls: false,
						showZoomCtrl: false, showFullscreenCtrl: false,
						mouseZoom: false, draggable: false, hfov: 110,
					});
					if (window.ScenePreview && ScenePreview.driveViewer) stop = ScenePreview.driveViewer(viewer);
				} catch (e) { /* strunt - behåll statisk tumnagel */ }
			}, 160);
		}

		function leave() {
			if (tmr) { clearTimeout(tmr); tmr = null; }
			if (stop) { stop(); stop = null; }
			if (viewer) { try { viewer.destroy(); } catch (e) { /* redan borta */ } viewer = null; }
			if (overlay) { overlay.remove(); overlay = null; }
		}

		card.addEventListener("mouseenter", enter);
		card.addEventListener("mouseleave", leave);
	});
})();
