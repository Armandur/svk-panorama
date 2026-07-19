/* Temaväxel: cyklar auto -> ljust -> mörkt. Auto följer prefers-color-scheme
 * (inget data-theme-attribut); ljust/mörkt tvingas via data-theme på <html>.
 * Valet sparas i localStorage och appliceras före render av inline-scriptet i base.html:s head. */
(function () {
	"use strict";
	var btn = document.getElementById("temavaljare");
	if (!btn) return;

	var SOL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
	var MANE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
	var DATOR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
	var IKON = { auto: DATOR, light: SOL, dark: MANE };
	var TEXT = { auto: "auto (systemet)", light: "ljust", dark: "mörkt" };
	var ORDNING = ["auto", "light", "dark"];

	function nuvarande() {
		var t = localStorage.getItem("svk-theme");
		return (t === "light" || t === "dark") ? t : "auto";
	}
	function applicera(mode) {
		if (mode === "auto") {
			document.documentElement.removeAttribute("data-theme");
			localStorage.removeItem("svk-theme");
		} else {
			document.documentElement.setAttribute("data-theme", mode);
			localStorage.setItem("svk-theme", mode);
		}
		btn.innerHTML = IKON[mode];
		btn.title = "Tema: " + TEXT[mode] + " (klicka för att växla)";
	}

	btn.addEventListener("click", function () {
		var i = ORDNING.indexOf(nuvarande());
		applicera(ORDNING[(i + 1) % ORDNING.length]);
	});
	applicera(nuvarande());
})();
