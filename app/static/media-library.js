/* Mediebibliotek för en turs uppladdade bilder: bläddra, ladda upp, radera, välj.
   window.openMediaLibrary(slug, onPick) - onPick(url) anropas när en bild väljs. */
(function () {
	"use strict";
	var modal, grid, fileInput, curSlug, curOnPick;

	function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }

	function build() {
		modal = document.createElement("div");
		modal.className = "media-modal help-modal";
		modal.hidden = true;
		modal.innerHTML =
			'<article class="media-article">' +
			'<div class="section-head"><h3>Mediebibliotek</h3>' +
			'<button type="button" class="secondary outline media-close" aria-label="Stäng">&times;</button></div>' +
			'<div class="media-actions"><button type="button" class="secondary media-upload">Ladda upp bild</button>' +
			'<input type="file" class="media-file" accept="image/png,image/jpeg" hidden></div>' +
			'<p class="media-error login-error" hidden></p>' +
			'<div class="media-grid"></div></article>';
		document.body.appendChild(modal);
		grid = modal.querySelector(".media-grid");
		fileInput = modal.querySelector(".media-file");
		modal.querySelector(".media-close").addEventListener("click", close);
		modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
		modal.querySelector(".media-upload").addEventListener("click", function () { fileInput.click(); });
		fileInput.addEventListener("change", function () {
			var f = fileInput.files && fileInput.files[0];
			fileInput.value = "";
			if (f) upload(f);
		});
		document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal && !modal.hidden) close(); });
	}

	function close() { if (modal) modal.hidden = true; }
	function showErr(m) { var e = modal.querySelector(".media-error"); e.textContent = m || ""; e.hidden = !m; }

	function load() {
		showErr("");
		grid.innerHTML = '<p class="hint">Laddar...</p>';
		fetch("/projects/" + encodeURIComponent(curSlug) + "/attachments")
			.then(function (r) { return r.json(); })
			.then(function (d) { render(d.items || []); })
			.catch(function () { grid.innerHTML = ""; showErr("Kunde inte hämta biblioteket."); });
	}

	function render(items) {
		grid.innerHTML = "";
		if (!items.length) { grid.innerHTML = '<p class="hint">Inga bilder ännu. Ladda upp en.</p>'; return; }
		items.forEach(function (it) {
			var cell = document.createElement("div");
			cell.className = "media-cell";
			var img = document.createElement("img");
			img.src = it.url; img.alt = it.name; img.loading = "lazy";
			img.title = it.name;
			img.addEventListener("click", function () { if (curOnPick) curOnPick(it.url); close(); });
			var del = document.createElement("button");
			del.type = "button"; del.className = "media-del"; del.title = "Ta bort"; del.innerHTML = "&times;";
			del.addEventListener("click", function (e) { e.stopPropagation(); doDelete(it); });
			cell.appendChild(img);
			cell.appendChild(del);
			grid.appendChild(cell);
		});
	}

	function upload(file) {
		showErr("");
		var fd = new FormData();
		fd.append("file", file);
		fetch("/projects/" + encodeURIComponent(curSlug) + "/attachments", {
			method: "POST", headers: { "X-CSRF-Token": csrf() }, body: fd,
		}).then(function (r) { if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Fel"); }); return r.json(); })
			.then(function () { load(); })
			.catch(function (e) { showErr(e.message || "Uppladdning misslyckades"); });
	}

	function doDelete(it) {
		var ask = window.confirmDialog
			? confirmDialog("Ta bort bilden? Hotspots som använder den får en bruten bild.", { danger: true, confirmText: "Ta bort" })
			: Promise.resolve(window.confirm("Ta bort bilden?"));
		ask.then(function (ok) {
			if (!ok) return;
			fetch("/projects/" + encodeURIComponent(curSlug) + "/attachments/" + encodeURIComponent(it.name) + "/delete", {
				method: "POST", headers: { "X-CSRF-Token": csrf() },
			}).then(function () { load(); }).catch(function () { showErr("Kunde inte ta bort."); });
		});
	}

	window.openMediaLibrary = function (slug, onPick) {
		if (!modal) build();
		curSlug = slug;
		curOnPick = onPick;
		modal.hidden = false;
		load();
	};
})();
