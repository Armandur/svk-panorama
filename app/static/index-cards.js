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

	// Arbetsyte-flikar (vänster) + global sök: filtrerar turlistan klient-side. Både
	// tabellrader OCH kort filtreras per slug (view-toggle döljer bara den ena vyn med
	// CSS, så filtret måste träffa båda för att överleva ett vy-byte).
	(function () {
		var WS_KEY = "editor_ws";
		var tabs = document.querySelectorAll(".ws-tab");
		var search = document.getElementById("ws-search");
		var rows = document.querySelectorAll(".projects-table tbody tr[data-ws]");
		var cards = document.querySelectorAll(".tour-card[data-ws]");
		var empty = document.querySelector(".ws-empty");
		if (!rows.length && !cards.length) return;

		var present = { all: 1 };
		[].forEach.call(rows, function (r) { present[r.dataset.ws] = 1; });
		[].forEach.call(cards, function (c) { present[c.dataset.ws] = 1; });

		var activeWs = "all";
		try {
			var saved = localStorage.getItem(WS_KEY);
			if (saved && present[saved]) activeWs = saved;  // validera mot faktiska flikar
		} catch (e) { /* privat läge */ }

		function apply() {
			var q = ((search && search.value) || "").trim().toLowerCase();
			var visible = 0;
			function test(el) {
				var ok = (activeWs === "all" || el.dataset.ws === activeWs) &&
					(!q || (el.dataset.search || "").indexOf(q) !== -1);
				el.classList.toggle("ws-hidden", !ok);
				return ok;
			}
			[].forEach.call(rows, function (r) { if (test(r)) visible++; });
			[].forEach.call(cards, test);
			if (empty) empty.hidden = visible > 0;
		}

		function setWs(ws) {
			activeWs = present[ws] ? ws : "all";
			try { localStorage.setItem(WS_KEY, activeWs); } catch (e) { /* ignore */ }
			[].forEach.call(tabs, function (t) { t.classList.toggle("active", t.dataset.ws === activeWs); });
			apply();
		}

		[].forEach.call(tabs, function (t) {
			t.addEventListener("click", function () { setWs(t.dataset.ws); });
		});
		if (search) search.addEventListener("input", apply);
		if (tabs.length) setWs(activeWs); else apply();
	})();

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
