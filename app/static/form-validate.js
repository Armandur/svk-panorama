/* Inline fältvalidering för lösenordsformulär (progressiv förbättring).
   Markup: en <form data-pw-form> med [data-pw-new] + [data-pw-confirm] och
   valfria hint-element [data-pw-new-hint]/[data-pw-confirm-hint].

   UX-mönster: fel visas direkt vid fältet - röd outline (aria-invalid) +
   kort hint under fältet - inte bara ett banner högst upp. Servern validerar
   fortfarande (fallback utan JS). Se pw_min via data-pw-min (default 8). */
(function () {
	"use strict";

	function wire(form) {
		var newEl = form.querySelector("[data-pw-new]");
		var confEl = form.querySelector("[data-pw-confirm]");
		if (!newEl || !confEl) return;
		var MIN = parseInt(form.getAttribute("data-pw-min"), 10) || 8;
		var newHint = form.querySelector("[data-pw-new-hint]");
		var confHint = form.querySelector("[data-pw-confirm-hint]");

		function mark(el, hintEl, msg) {
			if (msg) {
				el.setAttribute("aria-invalid", "true");
				if (hintEl) { hintEl.textContent = msg; hintEl.hidden = false; }
			} else {
				el.removeAttribute("aria-invalid");
				if (hintEl) hintEl.hidden = true;
			}
		}

		// force=true -> flagga även tomt fält (används vid submit/blur).
		function checkNew(force) {
			var v = newEl.value;
			if (!v) { mark(newEl, newHint, force ? "Ange ett lösenord." : null); return false; }
			if (v.length < MIN) { mark(newEl, newHint, "Minst " + MIN + " tecken."); return false; }
			mark(newEl, newHint, null);
			return true;
		}
		function checkConfirm(force) {
			var v = confEl.value;
			if (!v) { mark(confEl, confHint, force ? "Upprepa lösenordet." : null); return false; }
			if (v !== newEl.value) { mark(confEl, confHint, "Lösenorden matchar inte."); return false; }
			mark(confEl, confHint, null);
			return true;
		}

		newEl.addEventListener("input", function () { checkNew(false); if (confEl.value) checkConfirm(false); });
		newEl.addEventListener("blur", function () { checkNew(true); });
		confEl.addEventListener("input", function () { checkConfirm(false); });
		confEl.addEventListener("blur", function () { checkConfirm(true); });
		form.addEventListener("submit", function (e) {
			var ok1 = checkNew(true), ok2 = checkConfirm(true);
			if (!ok1 || !ok2) { e.preventDefault(); (ok1 ? confEl : newEl).focus(); }
		});
	}

	document.querySelectorAll("[data-pw-form]").forEach(wire);
})();
