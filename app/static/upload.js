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
	var fileListEl = document.getElementById("upload-filelist");
	var noteEl = document.getElementById("upload-note");
	var closeEl = document.getElementById("upload-close");

	function showOverlay(title) {
		titleEl.textContent = title;
		detailEl.textContent = "";
		if (fileListEl) fileListEl.textContent = "";
		if (noteEl) noteEl.hidden = true;
		if (closeEl) closeEl.hidden = true;
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

	// --- Per-fil-uppladdning ------------------------------------------------
	// En request per fil så varje fil sparas på servern (bild + tour.json)
	// innan nästa startar. Avbryts uppladdningen är de klara filerna kvar.

	function buildFileList(files) {
		fileListEl.textContent = "";
		var statusEls = [];
		Array.prototype.forEach.call(files, function (f) {
			var li = document.createElement("li");
			li.className = "ufile";
			var name = document.createElement("span");
			name.className = "ufile-name";
			name.textContent = f.name;
			var status = document.createElement("span");
			status.className = "ufile-status";
			status.textContent = "väntar";
			li.appendChild(name);
			li.appendChild(status);
			fileListEl.appendChild(li);
			statusEls.push(status);
		});
		return statusEls;
	}

	function setFileStatus(el, state, text) {
		el.className = "ufile-status ufile-" + state;
		el.textContent = text;
	}

	// Laddar upp en enda fil. Resolvar med scen-id (eller null), rejectar vid fel.
	function uploadOneFile(action, csrf, file, onProgress) {
		return new Promise(function (resolve, reject) {
			var fd = new FormData();
			fd.append("csrf_token", csrf);
			fd.append("files", file, file.name);
			var xhr = new XMLHttpRequest();
			xhr.open("POST", action);
			xhr.setRequestHeader("Accept", "application/json");
			xhr.upload.addEventListener("progress", function (e) {
				if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
			});
			xhr.addEventListener("load", function () {
				if (xhr.status >= 200 && xhr.status < 300) {
					try {
						var d = JSON.parse(xhr.responseText || "{}");
						resolve(d.scenes && d.scenes[0] ? d.scenes[0] : null);
					} catch (e) { resolve(null); }
				} else {
					var msg = "Fel " + xhr.status;
					try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (e) { /* ignore */ }
					reject(new Error(msg));
				}
			});
			xhr.addEventListener("error", function () { reject(new Error("Nätverksfel")); });
			xhr.send(fd);
		});
	}

	// För-generera previews på servern med begränsad parallellitet.
	// silent=true: rör inte titel/bar/detalj (kör parallellt med tiling som
	// äger overlayns UI; previews är snabba och behöver ingen egen visning).
	function pregeneratePreviews(sceneIds, silent) {
		return new Promise(function (resolve) {
			if (!sceneIds || !sceneIds.length) { resolve(); return; }
			if (!silent) { setTitle("Genererar previews..."); setProgress(0); }
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
							if (!silent) {
								setProgress(Math.round((done / total) * 100));
								setDetail("Genererar preview " + done + "/" + total);
							}
							step();
						});
				}
			}
			step();
		});
	}

	// Starta tiling i bakgrunden (blockerar inte modalen). Själva progressen
	// spåras på sidan/huvudmenyn efter reload, inte här. Vi väntar bara in att
	// jobbet registrerats så statusen syns direkt efter omladdning.
	function startTilingBackground() {
		setTitle("Startar bildoptimering...");
		setProgress(null);
		return fetch("/projects/" + encodeURIComponent(slug) + "/tile-job", {
			method: "POST",
			headers: { "X-CSRF-Token": window.getCsrfToken ? getCsrfToken() : "" },
		}).catch(function () { /* icke-kritiskt - turen fungerar equirektangulärt */ });
	}

	function handleImages(form) {
		var input = form.querySelector('input[type="file"]');
		var files = input && input.files ? input.files : [];
		if (!files.length) { form.submit(); return; }  // låt servern validera "inga filer"
		var csrfField = form.querySelector('input[name="csrf_token"]');
		var csrf = csrfField ? csrfField.value : (window.getCsrfToken ? getCsrfToken() : "");

		showOverlay("Laddar upp bilder...");
		var statusEls = buildFileList(files);
		noteEl.hidden = false;

		var total = files.length;
		var succeeded = [];
		var failed = 0;
		var uploadDone = 0;

		// Parallellt med tak (CONC): flera filer laddas upp samtidigt för fart,
		// men varje fil är en egen request som sparas direkt (per-fil-persistens
		// kvar). Serverns lås hindrar att parallella skrivningar tappar scener.
		function uploadAll() {
			var CONC = 3, next = 0, active = 0;
			return new Promise(function (resolve) {
				function pump() {
					if (uploadDone >= total) { resolve(); return; }
					while (active < CONC && next < total) {
						(function (i) {
							active++;
							setFileStatus(statusEls[i], "uploading", "laddar upp 0%");
							uploadOneFile(form.action, csrf, files[i], function (pct) {
								setFileStatus(statusEls[i], "uploading", "laddar upp " + pct + "%");
							}).then(function (sceneId) {
								setFileStatus(statusEls[i], "done", "sparad");
								if (sceneId) succeeded.push(sceneId);
							}).catch(function (err) {
								failed++;
								setFileStatus(statusEls[i], "error", err.message);
							}).then(function () {
								active--; uploadDone++;
								setTitle("Laddar upp bilder (" + uploadDone + "/" + total + ")");
								setProgress(Math.round((uploadDone / total) * 100));
								pump();
							});
						})(next++);
					}
				}
				pump();
			});
		}

		uploadAll()
			.then(function () {
				setProgress(100);
				return pregeneratePreviews(succeeded, false);
			})
			.then(function () {
				// Tiling startas i bakgrunden och spåras på sidan/huvudmenyn -
				// modalen blockerar inte längre på den.
				if (succeeded.length) return startTilingBackground();
			})
			.then(function () {
				if (failed > 0) {
					// Behåll overlayn med resultaten - klara filer är sparade.
					setTitle("Klart, men " + failed + " av " + total + " misslyckades");
					setDetail(succeeded.length + " bilder sparade. Stäng och försök igen med de som saknas.");
					setProgress(100);
					noteEl.hidden = false;
					closeEl.hidden = false;
				} else {
					window.location.reload();
				}
			});
	}

	if (closeEl) closeEl.addEventListener("click", function () { window.location.reload(); });

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
