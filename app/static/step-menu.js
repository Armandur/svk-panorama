/* Stäng steg-hoppmenyn (details.step-menu) vid klick utanför eller Escape. */
(function () {
	"use strict";
	function closeAll(except) {
		document.querySelectorAll("details.step-menu[open]").forEach(function (d) {
			if (d !== except) d.removeAttribute("open");
		});
	}
	document.addEventListener("click", function (e) {
		var inside = e.target.closest ? e.target.closest("details.step-menu") : null;
		closeAll(inside);
	});
	document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(null); });
})();
