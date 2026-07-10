/*
 * Användarspecifika inställningar i localStorage. Kopplar preview-reglagen
 * (snurrhastighet, vagg-amplitud, vagg-takt) mot localStorage så preview.js
 * läser värdena vid nästa hover.
 */
(function () {
	"use strict";
	var controls = [
		{ id: "preview-speed", out: "preview-speed-val", key: "svk_preview_speed", def: "5" },
		{ id: "preview-amp", out: "preview-amp-val", key: "svk_preview_pitch_amp", def: "12" },
		{ id: "preview-period", out: "preview-period-val", key: "svk_preview_pitch_period", def: "3.5" },
	];
	controls.forEach(function (c) {
		var input = document.getElementById(c.id);
		if (!input) return;
		var out = document.getElementById(c.out);
		var stored = localStorage.getItem(c.key);
		if (stored === null) stored = c.def;
		input.value = stored;
		if (out) out.value = stored;
		input.addEventListener("input", function () {
			localStorage.setItem(c.key, input.value);
			if (out) out.value = input.value;
		});
	});

	// Rotationsriktning (slide-toggle): knoppen till vänster = vänster (av),
	// till höger = höger (på). Vänster/Höger-etiketter flankerar switchen.
	var dir = document.getElementById("preview-dir");
	if (dir) {
		var dirLeft = document.getElementById("dir-left");
		var dirRight = document.getElementById("dir-right");
		function applyDir(isRight) {
			dir.checked = isRight;
			if (dirLeft) dirLeft.classList.toggle("active", !isRight);
			if (dirRight) dirRight.classList.toggle("active", isRight);
		}
		applyDir(localStorage.getItem("svk_preview_dir") !== "left"); // default höger
		dir.addEventListener("change", function () {
			localStorage.setItem("svk_preview_dir", dir.checked ? "right" : "left");
			applyDir(dir.checked);
		});
	}

	// Inställnings-modal (öppnas från valfritt steg).
	var openBtn = document.getElementById("settings-btn");
	var modal = document.getElementById("settings-modal");
	var closeBtn = document.getElementById("settings-close");
	if (openBtn && modal) openBtn.addEventListener("click", function () { modal.hidden = false; });
	if (closeBtn && modal) closeBtn.addEventListener("click", function () { modal.hidden = true; });
	if (modal) modal.addEventListener("click", function (e) { if (e.target === modal) modal.hidden = true; });
	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape" && modal && !modal.hidden) modal.hidden = true;
	});
})();
