/*
 * Auto-roterande hover-förhandsvisning av panoraman, en i taget.
 *
 * Spinner upp en liten pannellum-vy i en flytande ruta som följer muspekaren
 * när man hovrar en scen (i scenlistan eller på kartan). Bilden är den
 * nedskalade previewen (/projects/<slug>/previews/<id>.jpg), som genereras
 * lat på servern. Bara en vy lever åt gången - föregående förstörs.
 *
 * API: ScenePreview.attach(el, slug, sceneId). Statiska element med
 * data-preview-scene + data-preview-slug kopplas automatiskt.
 */
(function () {
	"use strict";

	var box, inner, cap, viewer, currentKey, showTimer, hideTimer;
	var W = 320, H = 180;

	function ensureBox() {
		if (box) return;
		box = document.createElement("div");
		box.id = "scene-preview";
		inner = document.createElement("div");
		inner.className = "scene-preview-inner";
		cap = document.createElement("div");
		cap.className = "scene-preview-cap";
		box.appendChild(inner);
		box.appendChild(cap);
		document.body.appendChild(box);
	}

	function destroyViewer() {
		if (viewer) {
			try { viewer.destroy(); } catch (e) { /* redan borta */ }
			viewer = null;
		}
	}

	function position(x, y) {
		var pad = 14;
		var left = x + pad;
		var top = y + pad;
		if (left + W > window.innerWidth) left = x - W - pad;
		if (top + H + 22 > window.innerHeight) top = y - H - 22 - pad;
		box.style.left = Math.max(4, left) + "px";
		box.style.top = Math.max(4, top) + "px";
	}

	function show(slug, sceneId, x, y) {
		ensureBox();
		box.style.display = "block";
		position(x, y);
		cap.textContent = "Scen " + sceneId;
		var key = slug + "/" + sceneId;
		if (key === currentKey && viewer) return; // redan igång
		currentKey = key;
		destroyViewer();
		inner.innerHTML = "";
		if (!window.pannellum) return;
		viewer = pannellum.viewer(inner, {
			type: "equirectangular",
			panorama: "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(sceneId) + ".jpg",
			autoLoad: true,
			autoRotate: -5,
			showControls: false,
			showZoomCtrl: false,
			showFullscreenCtrl: false,
			mouseZoom: false,
			draggable: false,
			hfov: 110,
		});
	}

	function hide() {
		if (!box) return;
		box.style.display = "none";
		currentKey = null;
		destroyViewer();
	}

	function attach(el, slug, sceneId) {
		el.addEventListener("mouseenter", function (e) {
			clearTimeout(hideTimer);
			var mx = e.clientX, my = e.clientY;
			showTimer = setTimeout(function () { show(slug, sceneId, mx, my); }, 140);
		});
		el.addEventListener("mousemove", function (e) {
			if (box && box.style.display === "block") position(e.clientX, e.clientY);
		});
		el.addEventListener("mouseleave", function () {
			clearTimeout(showTimer);
			hideTimer = setTimeout(hide, 120);
		});
	}

	function scan() {
		document.querySelectorAll("[data-preview-scene][data-preview-slug]").forEach(function (el) {
			attach(el, el.dataset.previewSlug, el.dataset.previewScene);
		});
	}

	window.ScenePreview = { attach: attach };

	if (document.readyState !== "loading") scan();
	else document.addEventListener("DOMContentLoaded", scan);
})();
