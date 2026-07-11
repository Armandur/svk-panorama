/* Stylad bekräftelsedialog som ersätter native confirm().

   Två användningssätt:
   1. Formulär: <form data-confirm="Fråga?" [data-confirm-danger] [data-confirm-ok="Ta bort"]>
      fångas automatiskt - inget JS behövs per formulär.
   2. JS: confirmDialog("Fråga?", {danger:true, confirmText:"Ta bort"}).then(ok => { ... })
      returnerar ett Promise<boolean> (async - till skillnad från confirm()). */
(function () {
	"use strict";

	var overlay, titleEl, msgEl, okBtn, cancelBtn, boxEl, resolver, lastFocus;

	function build() {
		overlay = document.createElement("div");
		overlay.className = "confirm-modal";
		overlay.hidden = true;
		overlay.innerHTML =
			'<article class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">' +
			'<h3 id="confirm-title"></h3>' +
			'<p class="confirm-msg"></p>' +
			'<div class="confirm-actions">' +
			'<button type="button" class="secondary outline confirm-cancel"></button>' +
			'<button type="button" class="confirm-ok"></button>' +
			'</div></article>';
		document.body.appendChild(overlay);
		boxEl = overlay.querySelector(".confirm-box");
		titleEl = overlay.querySelector("#confirm-title");
		msgEl = overlay.querySelector(".confirm-msg");
		okBtn = overlay.querySelector(".confirm-ok");
		cancelBtn = overlay.querySelector(".confirm-cancel");
		okBtn.addEventListener("click", function () { done(true); });
		cancelBtn.addEventListener("click", function () { done(false); });
		overlay.addEventListener("click", function (e) { if (e.target === overlay) done(false); });
		document.addEventListener("keydown", function (e) {
			if (overlay.hidden) return;
			if (e.key === "Escape") done(false);
		});
	}

	function done(result) {
		if (overlay.hidden) return;
		overlay.hidden = true;
		if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (x) { /* borta */ } }
		var r = resolver; resolver = null;
		if (r) r(result);
	}

	window.confirmDialog = function (message, opts) {
		opts = opts || {};
		if (!overlay) build();
		lastFocus = document.activeElement;
		titleEl.textContent = opts.title || "Bekräfta";
		msgEl.textContent = message || "";
		okBtn.textContent = opts.confirmText || "OK";
		cancelBtn.textContent = opts.cancelText || "Avbryt";
		boxEl.classList.toggle("danger", !!opts.danger);
		overlay.hidden = false;
		okBtn.focus();
		return new Promise(function (resolve) { resolver = resolve; });
	};

	// Drop-in för <form data-confirm="...">: fånga submit, fråga, skicka vid ja.
	document.addEventListener("submit", function (e) {
		var form = e.target;
		if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-confirm")) return;
		if (form.dataset.confirmed === "1") { delete form.dataset.confirmed; return; }
		e.preventDefault();
		window.confirmDialog(form.getAttribute("data-confirm"), {
			danger: form.hasAttribute("data-confirm-danger"),
			confirmText: form.getAttribute("data-confirm-ok") || "OK",
		}).then(function (ok) {
			if (!ok) return;
			form.dataset.confirmed = "1";
			if (typeof form.requestSubmit === "function") form.requestSubmit();
			else form.submit();
		});
	}, true);
})();
