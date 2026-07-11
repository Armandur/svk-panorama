/*
 * Async uppladdning med progress-spinner och omedelbar preview-generering.
 *
 * Ersätter formulärens vanliga (blockerande) post med XHR så användaren ser
 * uppladdningsprogress istället för att webbläsaren hänger. Efter att
 * scenbilder laddats upp för-genereras previews på servern (HEAD-anrop mot
 * preview-endpointen) med synlig progress, och därefter genereras multires-
 * tiles (async-jobb med polling) så publicerade turer laddar snabbt. Faller
 * tillbaka på vanlig post om JS är av (formulären fungerar utan denna fil).
 */
(function () {
	"use strict";

	var slug = document.body.dataset.slug;
	var overlay = document.getElementById("upload-overlay");
	var titleEl = document.getElementById("upload-title");
	var progressEl = document.getElementById("upload-progress");
	var detailEl = document.getElementById("upload-detail");

	function showOverlay(title) {
		titleEl.textContent = title;
		detailEl.textContent = "";
		setProgress(0);
		overlay.hidden = false;
	}
	function hideOverlay() { overlay.hidden = true; }
	function setProgress(pct) {
		if (pct === null) progressEl.removeAttribute("value");
		else progressEl.value = pct;
	}
	function setTitle(t) { titleEl.textContent = t; }
	function setDetail(t) { detailEl.textContent = t; }

	// XHR-uppladdning med progress. Resolvar med parsad JSON.
	function uploadForm(form) {
		return new Promise(function (resolve, reject) {
			var xhr = new XMLHttpRequest();
			xhr.open("POST", form.action);
			xhr.setRequestHeader("Accept", "application/json");
			xhr.upload.addEventListener("progress", function (e) {
				if (e.lengthComputable) {
					var pct = Math.round((e.loaded / e.total) * 100);
					setProgress(pct);
					setDetail("Laddar upp... " + pct + "%");
					if (pct >= 100) { setTitle("Bearbetar pa servern..."); setProgress(null); }
				}
			});
			xhr.addEventListener("load", function () {
				if (xhr.status >= 200 && xhr.status < 300) {
					try { resolve(JSON.parse(xhr.responseText || "{}")); }
					catch (e) { resolve({}); }
				} else {
					var msg = "Fel " + xhr.status;
					try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (e) { /* ignore */ }
					reject(new Error(msg));
				}
			});
			xhr.addEventListener("error", function () { reject(new Error("Natverksfel")); });
			xhr.send(new FormData(form));
		});
	}

	// För-generera previews på servern med begränsad parallellitet.
	function pregeneratePreviews(sceneIds) {
		return new Promise(function (resolve) {
			if (!sceneIds || !sceneIds.length) { resolve(); return; }
			setTitle("Genererar previews...");
			setProgress(0);
			var total = sceneIds.length, done = 0, next = 0, active = 0;
			var CONC = 3;

			function step() {
				if (done >= total) { resolve(); return; }
				while (active < CONC && next < total) {
					var id = sceneIds[next++];
					active++;
					fetch("/projects/" + encodeURIComponent(slug) + "/previews/" + encodeURIComponent(id) + ".jpg", { method: "HEAD" })
						.catch(function () { /* enskilt fel stoppar inte resten */ })
						.then(function () {
							active--; done++;
							setProgress(Math.round((done / total) * 100));
							setDetail("Genererar preview " + done + "/" + total);
							step();
						});
				}
			}
			step();
		});
	}

	// Generera multires-tiles för nyuppladdade scener (async-jobb + polling).
	// Icke-blockerande fel: turen fungerar equirektangulärt även utan tiles.
	function generateTiles() {
		return new Promise(function (resolve) {
			setTitle("Genererar tiles...");
			setProgress(null);
			setDetail("Startar...");
			fetch("/projects/" + encodeURIComponent(slug) + "/tile-job", {
				method: "POST",
				headers: { "X-CSRF-Token": window.getCsrfToken ? getCsrfToken() : "" },
			})
				.then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("start " + r.status)); })
				.then(function (state) {
					if (!state.job || !state.job.total) { resolve(); return; }
					pollTiles(resolve);
				})
				.catch(function () {
					if (window.showToast) showToast("Kunde inte starta tiling (turen fungerar ändå)", "error");
					resolve();
				});
		});
	}

	function pollTiles(resolve) {
		fetch("/projects/" + encodeURIComponent(slug) + "/tile-job/status")
			.then(function (r) { return r.json(); })
			.then(function (state) {
				var job = state.job;
				if (job && job.status === "running") {
					var total = job.total || 1;
					setProgress(Math.round((job.done / total) * 100));
					setDetail("Genererar tiles " + job.done + "/" + total + (job.current ? " (scen " + job.current + ")" : ""));
					setTimeout(function () { pollTiles(resolve); }, 1500);
					return;
				}
				if (job && job.status === "error" && window.showToast) {
					showToast("Tiling misslyckades delvis (turen fungerar ändå)", "error");
				}
				resolve();
			})
			.catch(function () { resolve(); });
	}

	function handleImages(form) {
		showOverlay("Laddar upp bilder...");
		uploadForm(form)
			.then(function (data) { return pregeneratePreviews(data.scenes || []); })
			.then(function () { return generateTiles(); })
			.then(function () { window.location.reload(); })
			.catch(function (err) {
				hideOverlay();
				if (window.showToast) showToast("Uppladdning misslyckades: " + err.message, "error");
				else alert("Uppladdning misslyckades: " + err.message);
			});
	}

	function handleMap(form) {
		showOverlay("Laddar upp karta...");
		uploadForm(form)
			.then(function () { window.location.reload(); })
			.catch(function (err) {
				hideOverlay();
				if (window.showToast) showToast("Uppladdning misslyckades: " + err.message, "error");
				else alert("Uppladdning misslyckades: " + err.message);
			});
	}

	var imagesForm = document.getElementById("images-form");
	if (imagesForm) imagesForm.addEventListener("submit", function (e) { e.preventDefault(); handleImages(imagesForm); });

	var mapForm = document.getElementById("map-form");
	if (mapForm) mapForm.addEventListener("submit", function (e) { e.preventDefault(); handleMap(mapForm); });
})();
