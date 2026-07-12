/* Delad mediepool (mediebibliotek): bläddra/ladda upp/radera/välj bilder ur den
   inloggade ägarens pool (/media/*), återanvändbara mellan projekt.

   EN komponent (mountLibrary) driver båda ytorna (DRY):
   - window.initMediaManager(container)     -> /media-sidan (inbäddad hanteringsvy).
   - window.openMediaLibrary(slug, onPick)  -> samma komponent i ett modal-skal
     (väljare i scenhanteringen); onPick(url) anropas vid val, sedan stängs modalen.
   Bägge: uppladdning (flera filer + progress), filter, metadata, härledd
   användning (breadcrumbs) och radering med användnings-varning. */
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
		img.src = it.thumb || it.url; img.alt = it.name; img.loading = "lazy"; img.title = it.name;
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

	// --- Enhetlig bibliotekskomponent (DRY) --------------------------------
	// Renderar hela biblioteket (uppladdning + filter + rutnät) i valfri container.
	// SAMMA komponent driver både /media-sidan och väljar-modalen i scenhanteringen.
	// opts.onPick (valfri) gör bilderna klickbara för val -> plockar url:en.
	function mountLibrary(container, opts) {
		opts = opts || {};
		var data = { items: [], projects: [] };
		var filter = "all";
		container.innerHTML =
			'<div class="media-actions">' +
			'<button type="button" class="secondary lib-upload">Ladda upp bilder</button>' +
			'<span class="lib-filter-wrap"></span>' +
			'</div>' +
			'<input type="file" class="lib-file" accept="image/png,image/jpeg" multiple hidden>' +
			'<p class="lib-hint hint"></p>' +
			'<div class="media-upload-progress" hidden></div>' +
			'<p class="lib-error login-error" hidden></p>' +
			'<div class="media-manage-grid"></div>';
		var grid = container.querySelector(".media-manage-grid");
		var fileInput = container.querySelector(".lib-file");
		var errEl = container.querySelector(".lib-error");
		var progress = container.querySelector(".media-upload-progress");
		container.querySelector(".lib-hint").textContent = "JPG eller PNG, max " + maxMb() + " MB per bild.";
		function err(m) { errEl.textContent = m || ""; errEl.hidden = !m; }
		container.querySelector(".lib-upload").addEventListener("click", function () { fileInput.click(); });
		fileInput.addEventListener("change", function () {
			if (fileInput.files && fileInput.files.length) { err(""); uploadFiles(fileInput.files, progress, load); }
			fileInput.value = "";
		});

		function load() {
			err("");
			grid.innerHTML = '<p class="hint">Laddar...</p>';
			fetchPool().then(function (d) {
				data = d;
				var wrap = container.querySelector(".lib-filter-wrap");
				wrap.innerHTML = "";
				wrap.appendChild(buildFilterSelect(d.projects, filter, function (v) { filter = v; render(); }));
				render();
			}).catch(function (e) { grid.innerHTML = ""; err(e.message || "Kunde inte hämta biblioteket."); });
		}

		function render() {
			var items = applyFilter(data.items || [], filter);
			grid.innerHTML = "";
			if (!items.length) { grid.innerHTML = '<p class="hint">Inga bilder i det här urvalet.</p>'; return; }
			items.forEach(function (it) {
				grid.appendChild(buildCell(it, {
					onPick: opts.onPick ? function (picked) { opts.onPick(picked.url); } : null,
					onDelete: remove,
				}));
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
		return { reload: load };
	}

	// --- Modal-skal som hostar biblioteket (väljare i scenhanteringen) -----
	var modal, modalBody;
	function buildModal() {
		modal = document.createElement("div");
		modal.className = "media-modal help-modal";
		modal.hidden = true;
		modal.innerHTML =
			'<article class="media-article">' +
			'<div class="section-head"><h3>Mediebibliotek</h3>' +
			'<button type="button" class="secondary outline media-close" aria-label="Stäng">&times;</button></div>' +
			'<div class="media-modal-body"></div></article>';
		document.body.appendChild(modal);
		modalBody = modal.querySelector(".media-modal-body");
		modal.querySelector(".media-close").addEventListener("click", closeModal);
		modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
		document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal && !modal.hidden) closeModal(); });
	}
	function closeModal() { if (modal) modal.hidden = true; }

	// Väljar-modal (scenhantering): samma komponent, med onPick -> stäng vid val.
	window.openMediaLibrary = function (slug, onPick) {
		if (!modal) buildModal();
		mountLibrary(modalBody, { onPick: function (url) { if (onPick) onPick(url); closeModal(); } });
		modal.hidden = false;
	};

	// Inbäddad hanteringsvy (/media-sidan): samma komponent, utan onPick.
	window.initMediaManager = function (container) { mountLibrary(container, {}); };
})();
