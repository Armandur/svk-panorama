/*
 * Auto-roterande förhandsvisning av panoraman, en i taget.
 *
 * Två lägen som delar samma ruta och pannellum-vy:
 *  - hover: transient, följer muspekaren, ingen interaktion (pointer-events: none)
 *  - pinnad: stannar kvar med åtgärdsknappar (t.ex. "Ta bort från karta")
 *
 * Bilden är den nedskalade previewen (/projects/<slug>/previews/<id>.jpg), som
 * genereras lat på servern.
 *
 * API:
 *  ScenePreview.attach(el, slug, sceneId)         - koppla hover på ett element
 *  ScenePreview.pin(slug, sceneId, x, y, actions) - fäst rutan med knappar
 *  ScenePreview.unpin()                           - stäng den fästa rutan
 * Statiska element med data-preview-scene + data-preview-slug kopplas automatiskt.
 */
(function () {
	"use strict";

	var box, inner, cap, actionsEl, viewer, currentKey, showTimer, hideTimer, rafId;
	var pinned = false;
	var suppressed = false; // stäng av hover helt (t.ex. medan man drar länkar)
	var W = 320, H = 180;
	// Användarspecifika inställningar (localStorage). 0 = av.
	function setting(key, def) {
		var v = parseFloat(localStorage.getItem(key));
		return isNaN(v) ? def : v;
	}
	function rotateSpeed() { return setting("svk_preview_speed", 5); }      // yaw, grader/s
	function pitchAmp() { return setting("svk_preview_pitch_amp", 12); }    // vagg-amplitud, grader
	function pitchPeriod() { return setting("svk_preview_pitch_period", 3.5); } // sekunder per vagg
	function rotateDir() { return localStorage.getItem("svk_preview_dir") === "left" ? 1 : -1; } // matchar togglens riktning

	function ensureBox() {
		if (box) return;
		box = document.createElement("div");
		box.id = "scene-preview";
		inner = document.createElement("div");
		inner.className = "scene-preview-inner";
		cap = document.createElement("div");
		cap.className = "scene-preview-cap";
		actionsEl = document.createElement("div");
		actionsEl.className = "scene-preview-actions";
		box.appendChild(inner);
		box.appendChild(cap);
		box.appendChild(actionsEl);
		document.body.appendChild(box);
	}

	function destroyViewer() {
		stopPreviewAnimation();
		if (viewer) {
			try { viewer.destroy(); } catch (e) { /* redan borta */ }
			viewer = null;
		}
	}

	// Driv både sidledsrotation (yaw) och upp/ned-vaggning (pitch) själva, med
	// instant sättning (animated=false) - annars startar pannellum en tween per
	// frame mot ett rörligt mål och inget rör sig. Alla tre värden är
	// användarinställningar; 0 stänger av respektive rörelse.
	function startPreviewAnimation() {
		stopPreviewAnimation();
		var speed = rotateSpeed() * rotateDir();
		var amp = pitchAmp();
		var periodMs = Math.max(0.5, pitchPeriod()) * 1000;
		if ((rotateSpeed() <= 0 && amp <= 0) || !viewer) return;
		var t0 = performance.now(), last = t0;
		var yaw = 0;
		try { yaw = viewer.getYaw(); } catch (e) { /* default 0 */ }
		function frame(now) {
			if (!viewer) return;
			var dt = (now - last) / 1000; last = now;
			yaw -= speed * dt;
			var pitch = amp * Math.sin((now - t0) / periodMs * 2 * Math.PI);
			try {
				viewer.setYaw(yaw, false);
				viewer.setPitch(pitch, false);
			} catch (e) { /* ännu ej redo */ }
			rafId = requestAnimationFrame(frame);
		}
		rafId = requestAnimationFrame(frame);
	}

	function stopPreviewAnimation() {
		if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
	}

	// Driv en godtycklig pannellum-vy med samma inställningar (yaw + vagg) som
	// hover-previewsen. Returnerar en stop-funktion. Skapa vyn med autoRotate: 0.
	function driveViewer(v) {
		const speed = rotateSpeed() * rotateDir();
		const amp = pitchAmp();
		const periodMs = Math.max(0.5, pitchPeriod()) * 1000;
		if ((rotateSpeed() <= 0 && amp <= 0) || !v) return function () {};
		const t0 = performance.now();
		let last = t0, raf, yaw = 0;
		try { yaw = v.getYaw(); } catch (e) { /* default 0 */ }
		function frame(now) {
			if (!v) return;
			const dt = (now - last) / 1000; last = now;
			yaw -= speed * dt;
			try { v.setYaw(yaw, false); v.setPitch(amp * Math.sin((now - t0) / periodMs * 2 * Math.PI), false); } catch (e) { /* ännu ej redo */ }
			raf = requestAnimationFrame(frame);
		}
		raf = requestAnimationFrame(frame);
		return function stop() { if (raf) cancelAnimationFrame(raf); raf = null; };
	}

	function position(x, y, extra) {
		var pad = 14;
		var h = H + 22 + (extra || 0);
		var left = x + pad;
		var top = y + pad;
		if (left + W > window.innerWidth) left = x - W - pad;
		if (top + h > window.innerHeight) top = y - h - pad;
		box.style.left = Math.max(4, left) + "px";
		box.style.top = Math.max(4, top) + "px";
	}

	// Skapa (eller återanvänd) pannellum-vyn för en scen i rutan.
	function renderViewer(slug, sceneId) {
		cap.textContent = "Scen " + sceneId;
		var key = slug + "/" + sceneId + "/" + (pinned ? "pin" : "hover");
		if (key === currentKey && viewer) return;
		currentKey = key;
		destroyViewer();
		inner.innerHTML = "";
		if (!window.pannellum) return;
		// Tvinga layout-flush så pannellum mäter containern korrekt (annars svart).
		void inner.offsetHeight;
		viewer = pannellum.viewer(inner, {
			type: "equirectangular",
			panorama: "/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(sceneId) + ".jpg",
			autoLoad: true,
			autoRotate: 0,
			showControls: false,
			showZoomCtrl: false,
			showFullscreenCtrl: false,
			mouseZoom: false,
			draggable: false,
			hfov: 110,
		});
		startPreviewAnimation();
	}

	// --- Hover (transient) -------------------------------------------------

	function show(slug, sceneId, x, y) {
		if (pinned || suppressed) return;
		ensureBox();
		box.style.display = "block";
		position(x, y);
		renderViewer(slug, sceneId);
	}

	function hide() {
		if (pinned || !box) return;
		box.style.display = "none";
		currentKey = null;
		destroyViewer();
	}

	function attach(el, slug, sceneId) {
		el.addEventListener("mouseenter", function (e) {
			if (pinned) return;
			clearTimeout(hideTimer);
			var mx = e.clientX, my = e.clientY;
			showTimer = setTimeout(function () { show(slug, sceneId, mx, my); }, 140);
		});
		el.addEventListener("mousemove", function (e) {
			if (pinned) return;
			if (box && box.style.display === "block") position(e.clientX, e.clientY);
		});
		el.addEventListener("mouseleave", function () {
			clearTimeout(showTimer);
			hideTimer = setTimeout(hide, 120);
		});
	}

	// --- Pinnad (persistent med knappar) -----------------------------------

	function pin(slug, sceneId, x, y, actions) {
		ensureBox();
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
		pinned = true;
		box.classList.add("pinned");
		box.style.pointerEvents = "auto";
		box.style.display = "block";

		actionsEl.innerHTML = "";
		(actions || []).forEach(function (a) {
			var b = document.createElement("button");
			b.type = "button";
			b.textContent = a.label;
			b.className = "scene-preview-btn" + (a.kind ? " " + a.kind : "");
			b.addEventListener("click", function (ev) { ev.stopPropagation(); a.onClick(); });
			actionsEl.appendChild(b);
		});
		var close = document.createElement("button");
		close.type = "button";
		close.textContent = "Stäng";
		close.className = "scene-preview-btn";
		close.addEventListener("click", function (ev) { ev.stopPropagation(); unpin(); });
		actionsEl.appendChild(close);

		position(x, y, actionsEl.offsetHeight || 42);
		renderViewer(slug, sceneId);
		// Klick utanför stänger. Fördröj så samma klick som öppnade inte stänger.
		setTimeout(function () { document.addEventListener("pointerdown", outsideClose, true); }, 0);
	}

	function outsideClose(e) {
		if (box && !box.contains(e.target)) unpin();
	}

	function unpin() {
		document.removeEventListener("pointerdown", outsideClose, true);
		pinned = false;
		if (box) {
			box.classList.remove("pinned");
			box.style.pointerEvents = "none";
			actionsEl.innerHTML = "";
			box.style.display = "none";
			currentKey = null;
		}
		destroyViewer();
	}

	function scan() {
		document.querySelectorAll("[data-preview-scene][data-preview-slug]").forEach(function (el) {
			attach(el, el.dataset.previewSlug, el.dataset.previewScene);
		});
	}

	// Stäng av/på hover-previewen helt. Vid avstängning: göm ev. synlig ruta och
	// avbryt väntande visning (annars kan en preview skymma det man drar till).
	function setSuppressed(v) {
		suppressed = !!v;
		if (suppressed) {
			clearTimeout(showTimer);
			hide();
		}
	}

	window.ScenePreview = { attach: attach, pin: pin, unpin: unpin, driveViewer: driveViewer, setSuppressed: setSuppressed };

	if (document.readyState !== "loading") scan();
	else document.addEventListener("DOMContentLoaded", scan);
})();
