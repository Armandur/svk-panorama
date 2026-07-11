/* Kontokort (M365-stil): utfällning + koppla den egna avatar-modalen till
   crop-factoryn (avatar-crop.js). */
(function () {
	"use strict";

	// --- Utfällning ---
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

	// --- Egen avatar-modal ---
	if (window.initAvatarCrop) {
		window.initAvatarCrop({
			modal: document.getElementById("avatar-modal"),
			openBtn: document.getElementById("avatar-big"),
			onOpen: closeFlyout,
		});
	}
})();
