/* Kontokort (M365-stil) + Ändra foto-modal med interaktiv beskärning. */
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
	var errEl = document.getElementById("avatar-error");
	var current = document.getElementById("crop-current");
	var canvas = document.getElementById("crop-canvas");
	var ctx = canvas.getContext("2d");
	var hint = document.getElementById("crop-hint");
	var controls = document.getElementById("crop-controls");
	var zoomEl = document.getElementById("crop-zoom");
	var rotateBtn = document.getElementById("crop-rotate");

	var CW = 260, CH = 260, R = 120, OUT = 256;
	var crop = null; // {img, base, zoom, rot, panX, panY}

	function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }
	function showErr(m) { errEl.textContent = m; errEl.hidden = false; }

	function showCropUI(on) {
		canvas.hidden = !on;
		hint.hidden = !on;
		controls.hidden = !on;
		current.style.display = on ? "none" : "";
	}

	function openModal() {
		crop = null;
		saveBtn.disabled = true;
		errEl.hidden = true;
		showCropUI(false);
		zoomEl.value = 1;
		closeFlyout();
		modal.hidden = false;
	}
	function closeModal() { modal.hidden = true; }

	// --- Beskärningsmatte ---
	function effDims() {
		var w = crop.img.naturalWidth, h = crop.img.naturalHeight;
		return (crop.rot % 180 === 0) ? { w: w, h: h } : { w: h, h: w };
	}
	function computeBase() {
		var e = effDims();
		crop.base = Math.max(CW / e.w, CH / e.h); // "cover" - fyller alltid cirkeln
	}
	function scale() { return crop.base * crop.zoom; }
	function clampPan() {
		var e = effDims(), s = scale();
		var mx = Math.max(0, (e.w * s - CW) / 2), my = Math.max(0, (e.h * s - CH) / 2);
		crop.panX = Math.max(-mx, Math.min(mx, crop.panX));
		crop.panY = Math.max(-my, Math.min(my, crop.panY));
	}
	// Rita bilden (samma transform) i valfri kontext skalad till size.
	function drawImage(context, size) {
		var f = size / CW;
		context.save();
		context.scale(f, f);
		context.translate(CW / 2 + crop.panX, CH / 2 + crop.panY);
		context.rotate(crop.rot * Math.PI / 180);
		var sc = scale();
		context.scale(sc, sc);
		context.drawImage(crop.img, -crop.img.naturalWidth / 2, -crop.img.naturalHeight / 2);
		context.restore();
	}
	function render() {
		ctx.clearRect(0, 0, CW, CH);
		if (!crop) return;
		drawImage(ctx, CW);
		// Dimma utanför cirkeln + rita ring.
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, CW, CH);
		ctx.arc(CW / 2, CH / 2, R, 0, Math.PI * 2, true);
		ctx.fillStyle = "rgba(255,255,255,0.6)";
		ctx.fill("evenodd");
		ctx.beginPath();
		ctx.arc(CW / 2, CH / 2, R, 0, Math.PI * 2);
		ctx.strokeStyle = "rgba(0,0,0,0.35)";
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.restore();
	}

	function beginCrop(file) {
		var url = URL.createObjectURL(file);
		var img = new Image();
		img.onload = function () {
			URL.revokeObjectURL(url);
			crop = { img: img, zoom: 1, rot: 0, panX: 0, panY: 0 };
			zoomEl.value = 1;
			computeBase();
			clampPan();
			showCropUI(true);
			saveBtn.disabled = false;
			render();
		};
		img.onerror = function () { showErr("Kunde inte läsa bilden."); };
		img.src = url;
	}

	// --- Interaktion ---
	var dragging = false, lastX = 0, lastY = 0;
	canvas.addEventListener("pointerdown", function (e) {
		if (!crop) return;
		dragging = true; lastX = e.clientX; lastY = e.clientY;
		canvas.setPointerCapture(e.pointerId);
	});
	canvas.addEventListener("pointermove", function (e) {
		if (!dragging || !crop) return;
		var rect = canvas.getBoundingClientRect();
		var scaleToCanvas = CW / rect.width; // css-px -> canvas-enheter
		crop.panX += (e.clientX - lastX) * scaleToCanvas;
		crop.panY += (e.clientY - lastY) * scaleToCanvas;
		lastX = e.clientX; lastY = e.clientY;
		clampPan(); render();
	});
	function endDrag(e) { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch (x) { /* redan släppt */ } }
	canvas.addEventListener("pointerup", endDrag);
	canvas.addEventListener("pointercancel", endDrag);
	zoomEl.addEventListener("input", function () {
		if (!crop) return;
		crop.zoom = parseFloat(zoomEl.value) || 1;
		clampPan(); render();
	});
	rotateBtn.addEventListener("click", function () {
		if (!crop) return;
		crop.rot = (crop.rot + 90) % 360;
		computeBase(); clampPan(); render();
	});

	// --- Öppna/stäng/välj ---
	if (openBtn) {
		openBtn.addEventListener("click", openModal);
		openBtn.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(); } });
	}
	if (closeBtn) closeBtn.addEventListener("click", closeModal);
	if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
	modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });

	chooseBtn.addEventListener("click", function () { fileInput.click(); });
	fileInput.addEventListener("change", function () {
		var f = fileInput.files && fileInput.files[0];
		if (f) beginCrop(f);
		fileInput.value = ""; // tillåt att välja samma fil igen
	});

	saveBtn.addEventListener("click", function () {
		if (!crop) return;
		saveBtn.setAttribute("aria-busy", "true");
		var out = document.createElement("canvas");
		out.width = OUT; out.height = OUT;
		var octx = out.getContext("2d");
		octx.fillStyle = "#fff";
		octx.fillRect(0, 0, OUT, OUT);
		drawImage(octx, OUT); // samma transform, utan mask
		out.toBlob(function (blob) {
			var fd = new FormData();
			fd.append("file", blob, "avatar.png");
			fetch("/profile/avatar", { method: "POST", headers: { "X-CSRF-Token": csrf() }, body: fd })
				.then(function (r) { if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Uppladdning misslyckades"); }); return r.json(); })
				.then(function () { window.location.reload(); })
				.catch(function (e) { saveBtn.removeAttribute("aria-busy"); showErr(e.message); });
		}, "image/png");
	});

	removeBtn.addEventListener("click", function () {
		if (!confirm("Ta bort profilbilden?")) return;
		fetch("/profile/avatar/delete", { method: "POST", headers: { "X-CSRF-Token": csrf() } })
			.then(function () { window.location.reload(); })
			.catch(function (e) { showErr(e.message); });
	});
})();
