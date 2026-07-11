/* Kontokort: utfällning (M365-stil) + Ändra foto-modal. */
(function () {
	"use strict";

	var btn = document.getElementById("account-btn");
	var flyout = document.getElementById("account-flyout");

	function closeFlyout() {
		if (!flyout) return;
		flyout.hidden = true;
		if (btn) btn.setAttribute("aria-expanded", "false");
	}
	if (btn && flyout) {
		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			var willOpen = flyout.hidden;
			flyout.hidden = !willOpen;
			btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
		});
		document.addEventListener("click", function (e) {
			if (!flyout.hidden && !flyout.contains(e.target) && !btn.contains(e.target)) closeFlyout();
		});
		document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeFlyout(); });
	}

	// --- Ändra foto-modal ---
	var modal = document.getElementById("avatar-modal");
	if (!modal) return;
	var openBtn = document.getElementById("avatar-big");
	var closeBtn = document.getElementById("avatar-modal-close");
	var cancelBtn = document.getElementById("avatar-cancel");
	var chooseBtn = document.getElementById("avatar-choose");
	var fileInput = document.getElementById("avatar-file");
	var saveBtn = document.getElementById("avatar-save");
	var removeBtn = document.getElementById("avatar-remove");
	var preview = document.getElementById("avatar-preview");
	var errEl = document.getElementById("avatar-error");
	var chosenFile = null;

	function showErr(m) { errEl.textContent = m; errEl.hidden = false; }
	function openModal() {
		chosenFile = null;
		saveBtn.disabled = true;
		errEl.hidden = true;
		closeFlyout();
		modal.hidden = false;
	}
	function closeModal() { modal.hidden = true; }

	function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }

	if (openBtn) openBtn.addEventListener("click", openModal);
	if (closeBtn) closeBtn.addEventListener("click", closeModal);
	if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
	modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });

	chooseBtn.addEventListener("click", function () { fileInput.click(); });
	fileInput.addEventListener("change", function () {
		var f = fileInput.files && fileInput.files[0];
		if (!f) return;
		chosenFile = f;
		saveBtn.disabled = false;
		errEl.hidden = true;
		var reader = new FileReader();
		reader.onload = function (ev) { preview.src = ev.target.result; preview.style.display = ""; };
		reader.readAsDataURL(f);
	});

	saveBtn.addEventListener("click", function () {
		if (!chosenFile) return;
		saveBtn.setAttribute("aria-busy", "true");
		var fd = new FormData();
		fd.append("file", chosenFile, chosenFile.name);
		fetch("/profile/avatar", { method: "POST", headers: { "X-CSRF-Token": csrf() }, body: fd })
			.then(function (r) { if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Uppladdning misslyckades"); }); return r.json(); })
			.then(function () { window.location.reload(); })
			.catch(function (e) { saveBtn.removeAttribute("aria-busy"); showErr(e.message); });
	});

	removeBtn.addEventListener("click", function () {
		if (!confirm("Ta bort profilbilden?")) return;
		fetch("/profile/avatar/delete", { method: "POST", headers: { "X-CSRF-Token": csrf() } })
			.then(function () { window.location.reload(); })
			.catch(function (e) { showErr(e.message); });
	});
})();
