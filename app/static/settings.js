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

	// Rotationsriktning (slide-toggle): av = höger, på = vänster.
	var dir = document.getElementById("preview-dir");
	if (dir) {
		var dirOut = document.getElementById("preview-dir-val");
		var isLeft = localStorage.getItem("svk_preview_dir") === "left";
		dir.checked = isLeft;
		if (dirOut) dirOut.value = isLeft ? "Vänster" : "Höger";
		dir.addEventListener("change", function () {
			localStorage.setItem("svk_preview_dir", dir.checked ? "left" : "right");
			if (dirOut) dirOut.value = dir.checked ? "Vänster" : "Höger";
		});
	}
})();
