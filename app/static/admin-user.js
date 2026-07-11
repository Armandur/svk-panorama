/* Användardetaljsidan: koppla admin-avatar-modalen till crop-factoryn
   (avatar-crop.js) - postar mot target-userns avatar-endpoints. */
(function () {
	"use strict";
	if (!window.initAvatarCrop) return;
	window.initAvatarCrop({
		modal: document.getElementById("admin-avatar-modal"),
		openBtn: document.getElementById("admin-avatar-open"),
	});
})();
