/* Delad mediepool (mediebibliotek v2): bläddra/ladda upp/radera/välj bilder ur
   den inloggade ägarens pool (/media/*), återanvändbara mellan projekt.

   Två lägen delar samma hämtning/filtrering/rendering:
   - window.openMediaLibrary(slug, onPick)  -> modal-väljare (onPick(url) vid val).
     slug = aktuell tur, bara för filtret "Används i denna tur".
   - window.initMediaManager(container)     -> inbäddad hanteringsvy (/media-sidan)
     med metadata (mått/storlek/datum) + härledd användning + radera. */
(function () {
	"use strict";

	function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }

	function fmtSize(n) {
		if (n == null) return "";
		if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
		if (n >= 1024) return Math.round(n / 1024) + " KB";
		return n + " B";
	}
	function fmtDate(mtime) {
		if (!mtime) return "";
		try { return new Date(mtime * 1000).toLocaleDateString("sv-SE"); }
		catch (e) { return ""; }
	}

	// --- Gemensam datakälla ------------------------------------------------
	function fetchPool() {
		return fetch("/media/list").then(function (r) {
			if (!r.ok) throw new Error("Kunde inte hämta biblioteket.");
			return r.json();
		});
	}
	function maxMb() { return window.MEDIA_MAX_MB || 20; }
	function tooBig(file) { return file.size > maxMb() * 1024 * 1024; }

	// XHR (inte fetch) för att få upload-progress per fil, likt scenbild-uppladdningen.
	function uploadOne(file, onProgress) {
		return new Promise(function (resolve, reject) {
			var xhr = new XMLHttpRequest();
			xhr.open("POST", "/media/upload");
			xhr.setRequestHeader("X-CSRF-Token", csrf());
			xhr.upload.addEventListener("progress", function (e) {
				if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
			});
			xhr.addEventListener("load", function () {
				if (xhr.status >= 200 && xhr.status < 300) {
					try { resolve(JSON.parse(xhr.responseText)); } catch (err) { resolve({}); }
				} else {
					var msg = "Uppladdning misslyckades";
					try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (err) { /* behåll */ }
					reject(new Error(msg));
				}
			});
			xhr.addEventListener("error", function () { reject(new Error("Nätverksfel")); });
			var fd = new FormData();
			fd.append("file", file);
			xhr.send(fd);
		});
	}

	// Ladda upp flera filer med progresslista (max 3 parallellt). Filer över
	// gränsen avvisas klient-side med tydligt meddelande innan de skickas.
	function uploadFiles(fileList, host, onDone) {
		var files = Array.prototype.slice.call(fileList);
		if (!files.length) return;
		host.innerHTML = "";
		host.hidden = false;
		var rows = files.map(function (f) {
			var row = document.createElement("div");
			row.className = "media-up-row";
			row.innerHTML = '<span class="media-up-name"></span>' +
				'<progress class="media-up-bar" max="100" value="0"></progress>' +
				'<span class="media-up-status"></span>';
			row.querySelector(".media-up-name").textContent = f.name;
			host.appendChild(row);
			return row;
		});
		var queue = [];
		files.forEach(function (f, i) {
			var st = rows[i].querySelector(".media-up-status");
			if (tooBig(f)) {
				rows[i].querySelector(".media-up-bar").hidden = true;
				st.textContent = "för stor (max " + maxMb() + " MB)";
				st.className = "media-up-status err";
			} else {
				queue.push({ file: f, row: rows[i] });
			}
		});
		var idx = 0, running = 0, uploaded = 0;
		function finish() {
			if (uploaded) onDone();
			setTimeout(function () {
				if (!host.querySelector(".media-up-status.err")) { host.hidden = true; host.innerHTML = ""; }
			}, 1600);
		}
		function pump() {
			if (idx >= queue.length && running === 0) { finish(); return; }
			while (running < 3 && idx < queue.length) {
				(function (item) {
					running++;
					var bar = item.row.querySelector(".media-up-bar");
					var st = item.row.querySelector(".media-up-status");
					st.textContent = "laddar upp...";
					uploadOne(item.file, function (p) { bar.value = p; }).then(function () {
						bar.value = 100; st.textContent = "klar"; st.className = "media-up-status ok"; uploaded++;
					}).catch(function (e) {
						bar.hidden = true; st.textContent = e.message || "fel"; st.className = "media-up-status err";
					}).then(function () { running--; pump(); });
				})(queue[idx++]);
			}
		}
		if (!queue.length) return; // alla för stora -> visa bara felen
		pump();
	}
	function deleteFile(name) {
		return fetch("/media/" + encodeURIComponent(name) + "/delete", {
			method: "POST", headers: { "X-CSRF-Token": csrf() },
		}).then(function (r) { if (!r.ok) throw new Error("Kunde inte ta bort."); return r.json(); });
	}

	function applyFilter(items, filter) {
		if (filter === "unused") return items.filter(function (it) { return !(it.usage && it.usage.length); });
		if (filter && filter.indexOf("slug:") === 0) {
			var slug = filter.slice(5);
			return items.filter(function (it) {
				return (it.usage || []).some(function (u) { return u.slug === slug; });
			});
		}
		return items; // "all"
	}

	function buildFilterSelect(projects, current, onChange) {
		var sel = document.createElement("select");
		sel.className = "media-filter";
		function opt(val, label) { var o = document.createElement("option"); o.value = val; o.textContent = label; sel.appendChild(o); }
		opt("all", "Alla bilder");
		opt("unused", "Oanvända");
		(projects || []).forEach(function (p) { opt("slug:" + p.slug, "Används i: " + p.name); });
		sel.value = current || "all";
		sel.addEventListener("change", function () { onChange(sel.value); });
		return sel;
	}

	function crumbLabel(u) {
		var scene = u.scene_title || ("Scen " + u.scene_id);
		var s = u.project + " › " + scene;
		return u.count > 1 ? s + " (" + u.count + ")" : s;
	}
	function usageText(usage) {
		if (!usage || !usage.length) return "Oanvänd";
		return usage.map(crumbLabel).join("; ");
	}

	// Delad rendering: samma bildkort med metadata + användnings-breadcrumbs i
	// både modal-väljaren och /media-hanteringsvyn. opts.onPick (valfri) gör bilden
	// klickbar för val, opts.onDelete kopplar radera-knappen.
	function buildCrumb(u) {
		var crumb = document.createElement("div");
		crumb.className = "media-crumb";
		var a = document.createElement("a");
		a.href = "/projects/" + encodeURIComponent(u.slug);
		a.textContent = u.project;
		crumb.appendChild(a);
		var sep = document.createElement("span");
		sep.className = "media-crumb-sep"; sep.textContent = " › ";
		crumb.appendChild(sep);
		var scene = document.createElement("span");
		scene.textContent = (u.scene_title || ("Scen " + u.scene_id)) + (u.count > 1 ? " (" + u.count + ")" : "");
		crumb.appendChild(scene);
		return crumb;
	}

	function buildUsage(usage) {
		var el = document.createElement("div");
		el.className = "media-usage";
		if (usage && usage.length) {
			usage.forEach(function (u) { el.appendChild(buildCrumb(u)); });
		} else {
			el.className += " media-unused";
			el.textContent = "Oanvänd";
		}
		return el;
	}

	function buildCell(it, opts) {
		opts = opts || {};
		var fig = document.createElement("figure");
		fig.className = "media-manage-cell";
		var cell = document.createElement("div");
		cell.className = "media-cell";
		var img = document.createElement("img");
		img.src = it.url; img.alt = it.name; img.loading = "lazy"; img.title = it.name;
		if (opts.onPick) {
			img.style.cursor = "pointer";
			img.addEventListener("click", function () { opts.onPick(it); });
		} else {
			img.style.cursor = "default";
		}
		var del = document.createElement("button");
		del.type = "button"; del.className = "media-del"; del.title = "Ta bort"; del.innerHTML = "&times;";
		del.addEventListener("click", function (e) { e.stopPropagation(); opts.onDelete(it); });
		cell.appendChild(img); cell.appendChild(del);

		var cap = document.createElement("figcaption");
		var dims = (it.width && it.height) ? it.width + "×" + it.height + " px" : "";
		var meta = [dims, fmtSize(it.size), fmtDate(it.mtime)].filter(Boolean).join(" · ");
		cap.innerHTML = '<div class="media-meta">' + meta + "</div>";
		cap.appendChild(buildUsage(it.usage));
		fig.appendChild(cell); fig.appendChild(cap);
		return fig;
	}

	// --- Modal-väljare -----------------------------------------------------
	var modal, grid, fileInput, curSlug, curOnPick, pickerData, pickerFilter;

	function build() {
		modal = document.createElement("div");
		modal.className = "media-modal help-modal";
		modal.hidden = true;
		modal.innerHTML =
			'<article class="media-article">' +
			'<div class="section-head"><h3>Mediebibliotek</h3>' +
			'<button type="button" class="secondary outline media-close" aria-label="Stäng">&times;</button></div>' +
			'<div class="media-actions"><button type="button" class="secondary media-upload">Ladda upp bilder</button>' +
			'<span class="media-filter-wrap"></span>' +
			'<input type="file" class="media-file" accept="image/png,image/jpeg" multiple hidden></div>' +
			'<p class="media-hint hint"></p>' +
			'<div class="media-upload-progress" hidden></div>' +
			'<p class="media-error login-error" hidden></p>' +
			'<div class="media-manage-grid media-grid-scroll"></div></article>';
		document.body.appendChild(modal);
		grid = modal.querySelector(".media-manage-grid");
		fileInput = modal.querySelector(".media-file");
		modal.querySelector(".media-hint").textContent = "JPG eller PNG, max " + maxMb() + " MB per bild.";
		modal.querySelector(".media-close").addEventListener("click", close);
		modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
		modal.querySelector(".media-upload").addEventListener("click", function () { fileInput.click(); });
		fileInput.addEventListener("change", function () {
			var files = fileInput.files;
			if (files && files.length) {
				showErr("");
				uploadFiles(files, modal.querySelector(".media-upload-progress"), pickerLoad);
			}
			fileInput.value = "";
		});
		document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal && !modal.hidden) close(); });
	}

	function close() { if (modal) modal.hidden = true; }
	function showErr(m) { var e = modal.querySelector(".media-error"); e.textContent = m || ""; e.hidden = !m; }

	function pickerLoad() {
		showErr("");
		grid.innerHTML = '<p class="hint">Laddar...</p>';
		fetchPool().then(function (d) {
			pickerData = d;
			var wrap = modal.querySelector(".media-filter-wrap");
			wrap.innerHTML = "";
			wrap.appendChild(buildFilterSelect(d.projects, pickerFilter, function (v) { pickerFilter = v; pickerRender(); }));
			pickerRender();
		}).catch(function (e) { grid.innerHTML = ""; showErr(e.message || "Kunde inte hämta biblioteket."); });
	}

	function pickerRender() {
		var items = applyFilter(pickerData.items || [], pickerFilter);
		grid.innerHTML = "";
		if (!items.length) { grid.innerHTML = '<p class="hint">Inga bilder. Ladda upp en.</p>'; return; }
		items.forEach(function (it) {
			grid.appendChild(buildCell(it, {
				onPick: function (picked) { if (curOnPick) curOnPick(picked.url); close(); },
				onDelete: pickerDelete,
			}));
		});
	}

	function pickerDelete(it) {
		var used = it.usage && it.usage.length;
		var msg = used
			? "Bilden används i " + usageText(it.usage) + ". Ta bort ändå? Hotspots får en bruten bild."
			: "Ta bort bilden?";
		var ask = window.confirmDialog
			? confirmDialog(msg, { danger: true, confirmText: "Ta bort" })
			: Promise.resolve(window.confirm(msg));
		ask.then(function (ok) {
			if (!ok) return;
			deleteFile(it.name).then(function () { pickerLoad(); }).catch(function () { showErr("Kunde inte ta bort."); });
		});
	}

	window.openMediaLibrary = function (slug, onPick) {
		if (!modal) build();
		curSlug = slug;
		curOnPick = onPick;
		pickerFilter = "all";
		modal.hidden = false;
		pickerLoad();
	};

	// --- Inbäddad hanteringsvy (/media) ------------------------------------
	window.initMediaManager = function (container) {
		var mgrData, mgrFilter = "all";
		container.innerHTML =
			'<div class="media-actions"><button type="button" class="secondary mgr-upload">Ladda upp bilder</button>' +
			'<span class="mgr-filter-wrap"></span>' +
			'<input type="file" class="mgr-file" accept="image/png,image/jpeg" multiple hidden></div>' +
			'<p class="mgr-hint hint"></p>' +
			'<div class="media-upload-progress" hidden></div>' +
			'<p class="mgr-error login-error" hidden></p>' +
			'<div class="media-manage-grid"></div>';
		var mgrGrid = container.querySelector(".media-manage-grid");
		var mgrFile = container.querySelector(".mgr-file");
		var mgrErr = container.querySelector(".mgr-error");
		var mgrProgress = container.querySelector(".media-upload-progress");
		container.querySelector(".mgr-hint").textContent = "JPG eller PNG, max " + maxMb() + " MB per bild.";
		function err(m) { mgrErr.textContent = m || ""; mgrErr.hidden = !m; }
		container.querySelector(".mgr-upload").addEventListener("click", function () { mgrFile.click(); });
		mgrFile.addEventListener("change", function () {
			var files = mgrFile.files;
			if (files && files.length) { err(""); uploadFiles(files, mgrProgress, load); }
			mgrFile.value = "";
		});

		function load() {
			err("");
			mgrGrid.innerHTML = '<p class="hint">Laddar...</p>';
			fetchPool().then(function (d) {
				mgrData = d;
				var wrap = container.querySelector(".mgr-filter-wrap");
				wrap.innerHTML = "";
				wrap.appendChild(buildFilterSelect(d.projects, mgrFilter, function (v) { mgrFilter = v; render(); }));
				render();
			}).catch(function (e) { mgrGrid.innerHTML = ""; err(e.message || "Kunde inte hämta biblioteket."); });
		}

		function render() {
			var items = applyFilter(mgrData.items || [], mgrFilter);
			mgrGrid.innerHTML = "";
			if (!items.length) { mgrGrid.innerHTML = '<p class="hint">Inga bilder i det här urvalet.</p>'; return; }
			items.forEach(function (it) {
				mgrGrid.appendChild(buildCell(it, { onDelete: remove }));
			});
		}

		function remove(it) {
			var used = it.usage && it.usage.length;
			var msg = used
				? "Bilden används i " + usageText(it.usage) + ". Ta bort ändå? Hotspots får en bruten bild."
				: "Ta bort bilden?";
			var ask = window.confirmDialog
				? confirmDialog(msg, { danger: true, confirmText: "Ta bort" })
				: Promise.resolve(window.confirm(msg));
			ask.then(function (ok) {
				if (!ok) return;
				deleteFile(it.name).then(load).catch(function () { err("Kunde inte ta bort."); });
			});
		}

		load();
	};
})();
