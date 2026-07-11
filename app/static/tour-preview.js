/* Turinställningar + förhandsvisning: bygg pannellum-vieweren för hela turen
   (multires), applicera globala inställningar live och bläddra mellan scener
   för att känna efter. Spara skriver default-blocket till tour.json. */
(function () {
	"use strict";

	const panoEl = document.getElementById("panorama");
	if (!panoEl || !window.pannellum) return;

	const slug = document.body.dataset.slug;
	const tour = JSON.parse(document.getElementById("tour-data").textContent);
	const mapData = JSON.parse(document.getElementById("map-data").textContent);
	if (!tour.scenes || !Object.keys(tour.scenes).length) return;

	const d = tour.default || {};

	function sceneIds() {
		return Object.keys(tour.scenes).sort(function (a, b) {
			return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
		});
	}

	// --- DOM ---
	const arEnabled = document.getElementById("ar-enabled");
	const arSpeed = document.getElementById("ar-speed");
	const arSpeedNum = document.getElementById("ar-speed-num");
	const arDelay = document.getElementById("ar-delay");
	const arDelayNum = document.getElementById("ar-delay-num");
	const fade = document.getElementById("fade");
	const fadeNum = document.getElementById("fade-num");
	const firstSceneSel = document.getElementById("first-scene");
	const dirtyBadge = document.getElementById("dirty-badge");
	const saveBtn = document.getElementById("save-btn");
	const discardBtn = document.getElementById("discard-btn");
	const curLabel = document.getElementById("cur-scene-label");
	const prevBtn = document.getElementById("prev-scene");
	const nextBtn = document.getElementById("next-scene");
	const previewMap = document.getElementById("preview-map");
	const mapImg = document.getElementById("preview-map-img");
	const mapDotsEl = document.getElementById("preview-map-dots");

	// --- Init formulär från tour.default ---
	firstSceneSel.innerHTML = "";
	sceneIds().forEach(function (id) {
		const o = document.createElement("option");
		o.value = id;
		o.textContent = "Scen " + id + (tour.scenes[id].title ? " - " + tour.scenes[id].title : "");
		firstSceneSel.appendChild(o);
	});
	firstSceneSel.value = d.firstScene && tour.scenes[d.firstScene] ? d.firstScene : sceneIds()[0];

	const ar = d.autoRotate;
	const arOn = typeof ar === "number" && ar !== 0;
	arEnabled.checked = arOn;
	setPair(arSpeed, arSpeedNum, arOn ? Math.abs(ar) : 2);
	document.querySelector('input[name="ar-dir"][value="' + (arOn && ar > 0 ? "1" : "-1") + '"]').checked = true;
	setPair(arDelay, arDelayNum, (d.autoRotateInactivityDelay != null ? d.autoRotateInactivityDelay : 2000) / 1000);
	setPair(fade, fadeNum, (d.sceneFadeDuration != null ? d.sceneFadeDuration : 1500) / 1000);
	const initMapSize = ["small", "medium", "large"].indexOf(d.mapSize) !== -1 ? d.mapSize : "medium";
	document.querySelector('input[name="map-size"][value="' + initMapSize + '"]').checked = true;
	if (previewMap) previewMap.dataset.size = initMapSize;

	function setPair(range, num, val) { range.value = val; num.value = val; }
	function dirVal() { return parseInt(document.querySelector('input[name="ar-dir"]:checked').value, 10); }
	function mapSizeVal() { return document.querySelector('input[name="map-size"]:checked').value; }
	function signedSpeed() { return dirVal() * (parseFloat(arSpeed.value) || 2); }

	// --- Pannellum ---
	let viewer = null;
	let rebuildTimer = null;

	function buildViewer(sceneId, view) {
		if (viewer) { try { viewer.destroy(); } catch (e) { /* borta */ } }
		const startId = sceneId || firstSceneSel.value || sceneIds()[0];
		if (curLabel) curLabel.textContent = "Scen " + startId; // visa direkt, inte "Scen -"
		viewer = pannellum.viewer("panorama", {
			default: {
				firstScene: sceneId || firstSceneSel.value || sceneIds()[0],
				autoLoad: true,
				autoRotate: arEnabled.checked ? signedSpeed() : false,
				autoRotateInactivityDelay: Math.round((parseFloat(arDelay.value) || 0) * 1000),
				sceneFadeDuration: Math.round((parseFloat(fade.value) || 0) * 1000),
				editorMode: false,
			},
			scenes: tour.scenes,
		});
		viewer.on("scenechange", onSceneChange);
		viewer.on("load", function () {
			if (view) {
				try {
					viewer.setYaw(view.yaw, false);
					viewer.setPitch(view.pitch, false);
					viewer.setHfov(view.hfov, false);
				} catch (e) { /* ignore */ }
			}
			onSceneChange();
		});
	}

	// Bygg om vieweren men behåll scen + vy (för fade/delay som inte har live-setters).
	function rebuildKeepView() {
		if (!viewer) return;
		const cur = viewer.getScene();
		let view = null;
		try { view = { yaw: viewer.getYaw(), pitch: viewer.getPitch(), hfov: viewer.getHfov() }; } catch (e) { /* ignore */ }
		buildViewer(cur, view);
	}
	function scheduleRebuild() {
		if (rebuildTimer) clearTimeout(rebuildTimer);
		rebuildTimer = setTimeout(rebuildKeepView, 600);
	}

	function applyAutoRotate() {
		if (!viewer) return;
		if (arEnabled.checked) viewer.startAutoRotate(signedSpeed());
		else viewer.stopAutoRotate();
	}

	// --- Karta ---
	const dotEls = {};
	function buildDots() {
		if (!mapDotsEl || !mapImg || !mapImg.naturalWidth) return;
		mapDotsEl.textContent = "";
		(mapData.scenes || []).forEach(function (s) {
			const dot = document.createElement("button");
			dot.type = "button";
			dot.className = "preview-dot";
			dot.style.left = (s.position.x / mapImg.naturalWidth * 100) + "%";
			dot.style.top = (s.position.y / mapImg.naturalHeight * 100) + "%";
			dot.title = "Scen " + s.id;
			dot.addEventListener("click", function () {
				if (viewer && viewer.getScene() !== s.id) viewer.loadScene(s.id);
			});
			mapDotsEl.appendChild(dot);
			dotEls[s.id] = dot;
		});
	}
	function markCurrent(id) {
		Object.keys(dotEls).forEach(function (k) { dotEls[k].classList.toggle("current", k === id); });
	}

	function onSceneChange() {
		if (!viewer) return;
		const cur = viewer.getScene();
		if (curLabel) curLabel.textContent = "Scen " + cur;
		markCurrent(cur);
	}

	function step(delta) {
		const ids = sceneIds();
		const i = ids.indexOf(viewer.getScene());
		const next = ids[(i + delta + ids.length) % ids.length];
		if (next) viewer.loadScene(next);
	}

	// --- Dirty & spara ---
	let dirty = false;
	function setDirty(v) {
		dirty = v;
		if (dirtyBadge) dirtyBadge.hidden = !v;
		if (discardBtn) discardBtn.hidden = !v;
	}

	function onSettingChange(rebuild) {
		setDirty(true);
		if (rebuild) scheduleRebuild();
	}

	// --- Wiring ---
	function linkPair(range, num, onChange) {
		range.addEventListener("input", function () { num.value = range.value; onChange(); });
		num.addEventListener("input", function () { range.value = num.value; onChange(); });
	}

	arEnabled.addEventListener("change", function () { applyAutoRotate(); onSettingChange(false); });
	linkPair(arSpeed, arSpeedNum, function () { applyAutoRotate(); onSettingChange(false); });
	document.querySelectorAll('input[name="ar-dir"]').forEach(function (r) {
		r.addEventListener("change", function () { applyAutoRotate(); onSettingChange(false); });
	});
	linkPair(arDelay, arDelayNum, function () { onSettingChange(true); });
	linkPair(fade, fadeNum, function () { onSettingChange(true); });
	firstSceneSel.addEventListener("change", function () { onSettingChange(false); });
	document.querySelectorAll('input[name="map-size"]').forEach(function (r) {
		r.addEventListener("change", function () {
			if (previewMap) previewMap.dataset.size = mapSizeVal();
			onSettingChange(false);
		});
	});

	if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); });
	if (nextBtn) nextBtn.addEventListener("click", function () { step(1); });

	saveBtn.addEventListener("click", function () {
		saveBtn.setAttribute("aria-busy", "true");
		apiFetch("/projects/" + encodeURIComponent(slug) + "/tour-settings", {
			method: "POST",
			body: {
				autoLoad: true,
				autoRotateEnabled: arEnabled.checked,
				autoRotateSpeed: parseFloat(arSpeed.value) || 2,
				autoRotateDir: dirVal(),
				autoRotateInactivityDelay: Math.round((parseFloat(arDelay.value) || 0) * 1000),
				sceneFadeDuration: Math.round((parseFloat(fade.value) || 0) * 1000),
				firstScene: firstSceneSel.value,
				mapSize: mapSizeVal(),
			},
		}).then(function () {
			setDirty(false);
			if (window.showToast) showToast("Inställningar sparade", "ok");
		}).catch(function (e) {
			if (window.showToast) showToast(e.message, "error");
		}).then(function () { saveBtn.removeAttribute("aria-busy"); });
	});

	if (discardBtn) discardBtn.addEventListener("click", function () { window.location.reload(); });

	// --- Start ---
	buildViewer(firstSceneSel.value, null);
	if (mapImg) {
		if (mapImg.complete && mapImg.naturalWidth) buildDots();
		else mapImg.addEventListener("load", buildDots);
	}
})();
