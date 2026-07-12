/* Importera projekt-zip på startsidan: ladda upp -> skapa ny tur -> gå dit. */
(function () {
	"use strict";
	var btn = document.getElementById("import-btn");
	var input = document.getElementById("import-file");
	var stateEl = document.getElementById("import-state");
	if (!btn || !input) return;

	function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }

	btn.addEventListener("click", function () { input.click(); });
	input.addEventListener("change", function () {
		var f = input.files && input.files[0];
		input.value = "";
		if (!f) return;
		btn.setAttribute("aria-busy", "true");
		btn.disabled = true;
		if (stateEl) stateEl.textContent = "Importerar " + f.name + "...";
		var fd = new FormData();
		fd.append("file", f);
		fetch("/projects/import", { method: "POST", headers: { "X-CSRF-Token": csrf() }, body: fd })
			.then(function (r) {
				if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Import misslyckades"); });
				return r.json();
			})
			.then(function (d) {
				if (stateEl) stateEl.textContent = "Importerad - öppnar...";
				window.location.href = "/projects/" + encodeURIComponent(d.slug);
			})
			.catch(function (e) {
				btn.removeAttribute("aria-busy");
				btn.disabled = false;
				if (stateEl) stateEl.textContent = "Fel: " + (e.message || "Import misslyckades");
			});
	});
})();
