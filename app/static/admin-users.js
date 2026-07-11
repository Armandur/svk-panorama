/* Användarlistan: batch-markering + åtgärdsrad. */
(function () {
	"use strict";
	var form = document.getElementById("batch-form");
	if (!form) return;
	var checkAll = document.getElementById("check-all");
	var apply = document.getElementById("batch-apply");
	var actionSel = document.getElementById("batch-action");
	var countEl = document.getElementById("batch-count");

	function rows() { return Array.prototype.slice.call(form.querySelectorAll(".row-check")); }
	function checked() { return rows().filter(function (c) { return c.checked; }); }

	function sync() {
		var n = checked().length;
		countEl.textContent = n ? n + " markerade" : "";
		apply.disabled = !(n > 0 && actionSel.value);
		if (checkAll) {
			var all = rows();
			checkAll.checked = all.length > 0 && n === all.length;
			checkAll.indeterminate = n > 0 && n < all.length;
		}
	}

	if (checkAll) {
		checkAll.addEventListener("change", function () {
			rows().forEach(function (c) { c.checked = checkAll.checked; });
			sync();
		});
	}
	form.addEventListener("change", function (e) {
		if (e.target.classList.contains("row-check") || e.target === actionSel) sync();
	});

	form.addEventListener("submit", function (e) {
		if (form.dataset.confirmed === "1") { delete form.dataset.confirmed; return; }
		e.preventDefault();
		if (apply.disabled) return;
		var n = checked().length;
		var labels = {
			reset_password: "Tvinga lösenordsbyte för " + n + " användare?",
			disable: "Spärra " + n + " konton?",
			enable: "Aktivera " + n + " konton?",
			delete: "Ta bort " + n + " användare? Detta går inte att ångra.",
		};
		var isDelete = actionSel.value === "delete";
		window.confirmDialog(labels[actionSel.value] || "Utför åtgärd på " + n + " användare?", {
			danger: isDelete,
			confirmText: isDelete ? "Ta bort" : "Kör",
		}).then(function (ok) {
			if (!ok) return;
			form.dataset.confirmed = "1";
			if (typeof form.requestSubmit === "function") form.requestSubmit();
			else form.submit();
		});
	});

	sync();
})();
