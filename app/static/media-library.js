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

	// Aktiv arbetsytas pool-query (?slug=... redigeringskontext / ?owner=... /media-
	// sidan). Sätts av mountLibrary; alla media-anrop hängs på den så rätt yta träffas.
	var poolQ = "";
	function setPoolQuery(opts) {
		poolQ = opts.slug ? "?slug=" + encodeURIComponent(opts.slug)
			: (opts.owner ? "?owner=" + encodeURIComponent(opts.owner) : "");
	}

	// --- Gemensam datakälla ------------------------------------------------
	function fetchPool() {
		return fetch("/media/list" + poolQ).then(function (r) {
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
			xhr.open("POST", "/media/upload" + poolQ);
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
		return fetch("/media/" + encodeURIComponent(name) + "/delete" + poolQ, {
			method: "POST", headers: { "X-CSRF-Token": csrf() },
		}).then(function (r) { if (!r.ok) throw new Error("Kunde inte ta bort."); return r.json(); });
	}

	function applyFilter(items, filter) {
		if (filter === "unused") return items.filter(function (it) { return !(it.usage && it.usage.length); });
		return items; // "all"
	}

	function buildFilterSelect(current, onChange) {
		// Per-tur-filtrering flyttad till sökfältets tur:-token; här bara status.
		var sel = document.createElement("select");
		sel.className = "media-filter";
		function opt(val, label) { var o = document.createElement("option"); o.value = val; o.textContent = label; sel.appendChild(o); }
		opt("all", "Alla bilder");
		opt("unused", "Oanvända");
		sel.value = current === "unused" ? "unused" : "all";
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
		function lightbox() { if (window.openLightbox) openLightbox(it.url, it.name); }
		if (opts.onPick) {
			img.style.cursor = "pointer";
			img.addEventListener("click", function () { opts.onPick(it); });
		} else {
			img.style.cursor = "zoom-in";
			img.addEventListener("click", lightbox);
		}
		var del = document.createElement("button");
		del.type = "button"; del.className = "media-del"; del.title = "Ta bort"; del.innerHTML = "&times;";
		del.addEventListener("click", function (e) { e.stopPropagation(); opts.onDelete(it); });
		// Förhandsvisa-knapp (lightbox) i BÅDA lägen - i väljarläget plockar bildklick,
		// så den här knappen ger förhandsvisning utan att välja.
		var zoom = document.createElement("button");
		zoom.type = "button"; zoom.className = "media-zoom"; zoom.title = "Förhandsvisa"; zoom.setAttribute("aria-label", "Förhandsvisa");
		zoom.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="10" cy="10" r="6.5"/><line x1="15" y1="15" x2="21" y2="21"/></svg>';
		zoom.addEventListener("click", function (e) { e.stopPropagation(); lightbox(); });
		cell.appendChild(img); cell.appendChild(del); cell.appendChild(zoom);

		// Batch-markering (kryssruta) om anroparen förser en selection-Set.
		if (opts.selection) {
			var chk = document.createElement("input");
			chk.type = "checkbox"; chk.className = "media-check"; chk.title = "Markera";
			chk.checked = opts.selection.has(it.name);
			if (chk.checked) fig.classList.add("selected");
			chk.addEventListener("click", function (e) { e.stopPropagation(); });
			chk.addEventListener("change", function () {
				if (chk.checked) opts.selection.add(it.name); else opts.selection.delete(it.name);
				fig.classList.toggle("selected", chk.checked);
				if (opts.onSelectChange) opts.onSelectChange();
			});
			cell.appendChild(chk);
		}

		var cap = document.createElement("figcaption");
		var fname = document.createElement("div");
		fname.className = "media-fname";
		fname.textContent = it.orig || it.name;
		fname.title = it.orig || it.name;
		cap.appendChild(fname);
		var dims = (it.width && it.height) ? it.width + "×" + it.height + " px" : "";
		var metaEl = document.createElement("div");
		metaEl.className = "media-meta";
		metaEl.textContent = [dims, fmtSize(it.size), fmtDate(it.mtime), it.uploader ? "av " + it.uploader : ""].filter(Boolean).join(" · ");
		cap.appendChild(metaEl);
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
		setPoolQuery(opts);  // vilken arbetsytas pool anropen ska träffa
		var data = { items: [], projects: [] };
		var filter = "all";
		container.innerHTML =
			'<div class="media-actions">' +
			'<button type="button" class="secondary lib-upload">Ladda upp bilder</button>' +
			'<span class="lib-search-wrap">' +
			'<div class="lib-search-box">' +
			'<span class="lib-chips"></span>' +
			'<input type="text" class="lib-search-input" placeholder="Sök filnamn, eller tur:" aria-label="Sök">' +
			'</div>' +
			'<div class="lib-suggest" hidden></div>' +
			'</span>' +
			'<span class="lib-filter-wrap"></span>' +
			'<button type="button" class="secondary outline lib-view"></button>' +
			'</div>' +
			'<input type="file" class="lib-file" accept="image/png,image/jpeg" multiple hidden>' +
			'<p class="lib-hint hint"></p>' +
			'<div class="media-batch" hidden>' +
			'<span class="media-batch-count"></span>' +
			'<button type="button" class="secondary lib-batch-del">Ta bort markerade</button>' +
			'<button type="button" class="secondary outline lib-batch-clear">Avmarkera</button>' +
			'</div>' +
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

		// Sök: tur-filter som chips (Discord-stil) + fritext på filnamn. Skriv tur:
		// -> autocomplete med turer (pil upp/ner + Enter, eller klick) -> blir ett chip.
		// AND mellan textterm(er) + tur-filtret; OR mellan flera tur-chips.
		var searchBox = container.querySelector(".lib-search-box");
		var searchInput = container.querySelector(".lib-search-input");
		var chipsEl = container.querySelector(".lib-chips");
		var suggest = container.querySelector(".lib-suggest");
		var tourFilters = [];   // [{slug, name}]
		var suggestHits = [];   // aktuella autocomplete-träffar
		var activeIdx = -1;     // markerat alternativ (tangentbord)

		function renderChips() {
			chipsEl.innerHTML = "";
			tourFilters.forEach(function (t, i) {
				var chip = document.createElement("span");
				chip.className = "lib-chip";
				var label = document.createElement("span");
				label.textContent = "tur: " + t.name;
				chip.appendChild(label);
				var x = document.createElement("button");
				x.type = "button"; x.className = "lib-chip-x"; x.setAttribute("aria-label", "Ta bort tur-filter"); x.innerHTML = "&times;";
				x.addEventListener("click", function () { tourFilters.splice(i, 1); renderChips(); render(); searchInput.focus(); });
				chip.appendChild(x);
				chipsEl.appendChild(chip);
			});
		}
		function inputTokens() { return searchInput.value.split(/\s+/).filter(Boolean); }
		function currentPartial() {  // tur:-token som håller på att skrivas
			var toks = inputTokens();
			for (var i = toks.length - 1; i >= 0; i--) {
				if (toks[i].toLowerCase().indexOf("tur:") === 0) return toks[i].slice(4).toLowerCase();
			}
			return null;
		}
		function textTerms() {  // fritexttermer (icke-tur-tokens)
			return inputTokens().filter(function (t) { return t.toLowerCase().indexOf("tur:") !== 0; }).map(function (t) { return t.toLowerCase(); });
		}
		function matchesSearch(it) {
			if (tourFilters.length) {
				var usage = it.usage || [];
				var ok = tourFilters.some(function (t) { return usage.some(function (u) { return u.slug === t.slug; }); });
				if (!ok) return false;
			}
			var fn = (it.orig || it.name).toLowerCase();
			return textTerms().every(function (t) { return fn.indexOf(t) !== -1; });
		}

		function setActive(i) {
			var items = suggest.querySelectorAll(".lib-suggest-item");
			activeIdx = i;
			Array.prototype.forEach.call(items, function (el, idx) { el.classList.toggle("active", idx === activeIdx); });
			if (items[activeIdx]) items[activeIdx].scrollIntoView({ block: "nearest" });
		}
		function renderSuggest() {
			var partial = currentPartial();
			if (partial === null) { suggest.hidden = true; suggestHits = []; return; }
			var chosen = {};
			tourFilters.forEach(function (t) { chosen[t.slug] = 1; });
			suggestHits = (data.projects || []).filter(function (p) {
				if (chosen[p.slug]) return false;
				return !partial || p.name.toLowerCase().indexOf(partial) !== -1 || p.slug.toLowerCase().indexOf(partial) !== -1;
			}).slice(0, 8);
			suggest.innerHTML = "";
			if (!suggestHits.length) { suggest.hidden = true; return; }
			suggestHits.forEach(function (p, idx) {
				var b = document.createElement("button");
				b.type = "button"; b.className = "lib-suggest-item";
				var nm = document.createElement("strong"); nm.textContent = p.name;
				b.appendChild(nm);
				if (p.slug !== p.name) { var sg = document.createElement("span"); sg.textContent = p.slug; b.appendChild(sg); }
				b.addEventListener("mouseenter", function () { setActive(idx); });
				b.addEventListener("mousedown", function (e) { e.preventDefault(); pickTour(p); });
				suggest.appendChild(b);
			});
			suggest.hidden = false;
			setActive(0);
		}
		function pickTour(p) {
			if (!tourFilters.some(function (t) { return t.slug === p.slug; })) tourFilters.push({ slug: p.slug, name: p.name });
			// ta bort tur:-token som skrevs, behåll ev. textterm(er)
			searchInput.value = inputTokens().filter(function (t) { return t.toLowerCase().indexOf("tur:") !== 0; }).join(" ");
			if (searchInput.value) searchInput.value += " ";
			suggest.hidden = true;
			renderChips();
			searchInput.focus();
			render();
		}

		searchInput.addEventListener("input", function () { renderSuggest(); render(); });
		searchInput.addEventListener("keydown", function (e) {
			var open = !suggest.hidden && suggestHits.length;
			if (open && e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(activeIdx + 1, suggestHits.length - 1)); }
			else if (open && e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
			else if (open && e.key === "Enter") { e.preventDefault(); if (suggestHits[activeIdx]) pickTour(suggestHits[activeIdx]); }
			else if (e.key === "Escape") { suggest.hidden = true; }
			else if (e.key === "Backspace" && !searchInput.value && tourFilters.length) { tourFilters.pop(); renderChips(); render(); }
		});
		searchInput.addEventListener("blur", function () { setTimeout(function () { suggest.hidden = true; }, 150); });
		searchBox.addEventListener("click", function (e) { if (e.target === searchBox || e.target === chipsEl) searchInput.focus(); });

		// Kort-/list-vy (sparas i localStorage, delas mellan /media och modalen).
		var view = "card";
		try { view = localStorage.getItem("media_view") === "list" ? "list" : "card"; } catch (e) { /* privatläge */ }
		var viewBtn = container.querySelector(".lib-view");
		function applyView() {
			grid.classList.toggle("media-list", view === "list");
			viewBtn.textContent = view === "list" ? "Kortvy" : "Listvy";
		}
		viewBtn.addEventListener("click", function () {
			view = view === "list" ? "card" : "list";
			try { localStorage.setItem("media_view", view); } catch (e) { /* ignore */ }
			applyView();
		});
		applyView();
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
				wrap.appendChild(buildFilterSelect(filter, function (v) { filter = v; render(); }));
				render();
			}).catch(function (e) { grid.innerHTML = ""; err(e.message || "Kunde inte hämta biblioteket."); });
		}

		// Batch-markering: en Set av markerade filnamn + åtgärdsrad.
		var selection = new Set();
		var batchBar = container.querySelector(".media-batch");
		var batchCount = container.querySelector(".media-batch-count");
		function updateBatch() {
			batchBar.hidden = selection.size === 0;
			batchCount.textContent = selection.size + " markerade";
		}
		container.querySelector(".lib-batch-clear").addEventListener("click", function () {
			selection.clear(); render(); updateBatch();
		});
		container.querySelector(".lib-batch-del").addEventListener("click", function () {
			var names = Array.from(selection);
			if (!names.length) return;
			var used = (data.items || []).filter(function (it) { return selection.has(it.name) && it.usage && it.usage.length; }).length;
			var msg = "Ta bort " + names.length + " markerade bilder?" + (used ? " " + used + " av dem används i turer (hotspots får bruten bild)." : "");
			var ask = window.confirmDialog
				? confirmDialog(msg, { danger: true, confirmText: "Ta bort" })
				: Promise.resolve(window.confirm(msg));
			ask.then(function (ok) {
				if (!ok) return;
				fetch("/media/batch-delete" + poolQ, {
					method: "POST",
					headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" },
					body: JSON.stringify({ names: names }),
				}).then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
					.then(function () { selection.clear(); load(); })
					.catch(function () { err("Kunde inte ta bort markerade."); });
			});
		});

		function render() {
			var items = applyFilter(data.items || [], filter).filter(matchesSearch);
			grid.innerHTML = "";
			if (!items.length) { grid.innerHTML = '<p class="hint">Inga bilder i det här urvalet.</p>'; updateBatch(); return; }
			items.forEach(function (it) {
				grid.appendChild(buildCell(it, {
					onPick: opts.onPick ? function (picked) { opts.onPick(picked.url); } : null,
					onDelete: remove,
					// Batch-markering bara i hanteringsläget (/media) - INTE i väljar-
					// modalen (där man plockar EN bild; massradering hör inte hemma där).
					selection: opts.onPick ? null : selection,
					onSelectChange: opts.onPick ? null : updateBatch,
				}));
			});
			updateBatch();
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
	// slug -> turens arbetsyta (media följer turens yta: personlig/team-pool).
	window.openMediaLibrary = function (slug, onPick) {
		if (!modal) buildModal();
		mountLibrary(modalBody, { slug: slug, onPick: function (url) { if (onPick) onPick(url); closeModal(); } });
		modal.hidden = false;
	};

	// Inbäddad hanteringsvy (/media-sidan): yta-växlare (owner) om >1 yta.
	window.initMediaManager = function (container) {
		var switcher = document.getElementById("media-workspace");
		function mount() {
			mountLibrary(container, switcher && switcher.value ? { owner: switcher.value } : {});
		}
		if (switcher) switcher.addEventListener("change", mount);
		mount();
	};
})();
