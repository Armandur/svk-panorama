/*
 * Användarspecifika inställningar i localStorage. Just nu: snurrhastighet för
 * hover-previews. Kopplar en range-input (#preview-speed) mot localStorage så
 * preview.js läser värdet vid nästa hover.
 */
(function () {
	"use strict";
	var KEY = "svk_preview_speed";
	var input = document.getElementById("preview-speed");
	if (!input) return;
	var out = document.getElementById("preview-speed-val");

	var stored = localStorage.getItem(KEY);
	if (stored === null) stored = "5";
	input.value = stored;
	if (out) out.value = stored;

	input.addEventListener("input", function () {
		localStorage.setItem(KEY, input.value);
		if (out) out.value = input.value;
	});
})();
