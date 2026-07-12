/* Delad mall-bibliotekskomponent: ägarens tema- och branding-mallar som kort med
   förhandsvisning. EN komponent (mountPresetLibrary) driver båda ytorna (DRY):
   - window.initPresetManager(container)         -> /mallar-sidan (hantera).
   - window.openPresetLibrary({onPickTheme,onPickBranding}) -> samma komponent i ett
     modal-skal (väljare på preview-steget); onPick applicerar mallen och stänger.
   Speglar media-library.js. Tema-kort = schematiskt (färgrutor + typsnittsprov +
   badges), branding-kort = renderad overlay-teaser. */
(function () {
	"use strict";

	function csrf() { return window.getCsrfToken ? getCsrfToken() : ""; }
	function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

	// Samma font-stackar som viewer/tour-preview så typsnittsprovet stämmer.
	var FONTS = {
		sans: '"Nimbus Sans L","Liberation Sans",Arial,sans-serif',
		serif: 'Georgia,"Times New Roman",serif',
		mono: 'ui-monospace,"Courier New",monospace',
		humanist: '"Segoe UI","Trebuchet MS","Nimbus Sans L",sans-serif',
	};
	var FONT_LABEL = { sans: "Sans", serif: "Serif", mono: "Mono", humanist: "Humanist" };
	var SIZE_LABEL = { small: "Liten", medium: "Mellan", large: "Stor" };
	var POS_LABEL = { "bottom-left": "Nere t.v.", "bottom-right": "Nere t.h.", "top-left": "Uppe t.v.", "top-right": "Uppe t.h." };

	function jpost(url, bodyObj) {
		var opt = { method: "POST", headers: { "X-CSRF-Token": csrf() } };
		if (bodyObj) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(bodyObj); }
		return fetch(url, opt).then(function (r) {
			if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.detail) || "Något gick fel"); }, function () { throw new Error("Något gick fel"); });
			return r;
		});
	}

	// --- Datakällor ---
	function fetchThemes() { return fetch("/presets").then(function (r) { return r.json(); }).then(function (d) { return d.presets || []; }); }
	function fetchBrandings() { return fetch("/branding-presets").then(function (r) { return r.json(); }).then(function (d) { return d.presets || []; }); }

	// --- Gemensamma kort-delar ---
	function cardHead(p, kind, onDefault) {
		var head = el("div", "preset-card-head");
		var name = el("span", "preset-card-name");
		name.textContent = p.name;
		name.title = p.name;
		head.appendChild(name);
		var star = el("button", "preset-star" + (p.is_default ? " active" : ""));
		star.type = "button";
		star.title = p.is_default ? "Standard för nya turer" : "Gör till standard för nya turer";
		star.setAttribute("aria-pressed", p.is_default ? "true" : "false");
		star.textContent = (p.is_default ? "★" : "☆") + " Standard";
		star.addEventListener("click", function () { onDefault(!p.is_default); });
		head.appendChild(star);
		return head;
	}

	function cardActions(p, opts, onPick, onEdit, onDelete) {
		var row = el("div", "preset-card-actions");
		if (onPick) {
			var use = el("button", "preset-use");
			use.type = "button"; use.textContent = "Använd";
			use.addEventListener("click", onPick);
			row.appendChild(use);
		}
		if (onEdit) {
			var edit = el("button", "preset-edit secondary");
			edit.type = "button"; edit.textContent = "Redigera";
			edit.addEventListener("click", onEdit);
			row.appendChild(edit);
		}
		var del = el("button", "preset-del secondary outline");
		del.type = "button"; del.textContent = "Radera";
		del.addEventListener("click", onDelete);
		row.appendChild(del);
		return row;
	}

	// --- Tema-kort (schematiskt) ---
	function themeCard(p, opts, reload) {
		var c = p.config || {};
		var th = c.theme || {};
		var card = el("figure", "preset-card");
		card.appendChild(cardHead(p, "theme", function (v) {
			jpost("/presets/" + p.id + "/default", { isDefault: v }).then(reload).catch(function () { toast("Kunde inte ändra standard", "error"); });
		}));

		var body = el("div", "preset-theme-body");
		var swatches = el("div", "preset-swatches");
		[[th.dotColor || "#666666", "Prick"], [th.currentColor || "#8b0000", "Aktiv"]].forEach(function (s) {
			var w = el("span", "preset-swatch");
			var dot = el("span", "preset-swatch-dot"); dot.style.background = s[0];
			w.appendChild(dot);
			var lbl = el("span", "preset-swatch-lbl"); lbl.textContent = s[1];
			w.appendChild(lbl);
			swatches.appendChild(w);
		});
		body.appendChild(swatches);

		var sample = el("div", "preset-font-sample");
		sample.style.fontFamily = FONTS[th.font] || FONTS.sans;
		sample.textContent = "Aa Bb Cc";
		body.appendChild(sample);

		var badges = el("div", "preset-badges");
		var ar = c.autoRotate;
		var arOn = typeof ar === "number" && ar !== 0;
		badges.appendChild(badge((FONT_LABEL[th.font] || "Sans")));
		badges.appendChild(badge("Karta: " + (SIZE_LABEL[c.mapSize] || "Mellan")));
		badges.appendChild(badge(arOn ? "Autorotate på" : "Autorotate av"));
		body.appendChild(badges);
		card.appendChild(body);

		card.appendChild(cardActions(p, opts,
			opts.onPickTheme ? function () { opts.onPickTheme(c); } : null,
			opts.manage ? function () { openThemeEdit(p, reload); } : null,
			function () {
				confirmDel('tema-mallen "' + p.name + '"').then(function (ok) {
					if (!ok) return;
					jpost("/presets/" + p.id + "/delete").then(reload).catch(function () { toast("Kunde inte radera", "error"); });
				});
			}));
		return card;
	}

	// --- Branding-kort (renderad overlay) ---
	function brandingCard(p, opts, reload) {
		var c = p.config || {};
		var card = el("figure", "preset-card");
		card.appendChild(cardHead(p, "brand", function (v) {
			jpost("/branding-presets/" + p.id + "/default", { isDefault: v }).then(reload).catch(function () { toast("Kunde inte ändra standard", "error"); });
		}));

		var stage = el("div", "preset-brand-stage");
		var overlay = el("div");
		if (window.renderBrandingInto) window.renderBrandingInto(overlay, c);
		else overlay.textContent = c.content || "";
		stage.appendChild(overlay);
		card.appendChild(stage);

		var badges = el("div", "preset-badges");
		badges.appendChild(badge(SIZE_LABEL[c.size] || "Mellan"));
		badges.appendChild(badge(POS_LABEL[c.position] || "Nere h."));
		card.appendChild(badges);

		card.appendChild(cardActions(p, opts,
			opts.onPickBranding ? function () { opts.onPickBranding(c); } : null,
			opts.manage ? function () { openBrandingEdit(p, reload); } : null,
			function () {
				confirmDel('branding-mallen "' + p.name + '"').then(function (ok) {
					if (!ok) return;
					jpost("/branding-presets/" + p.id + "/delete").then(reload).catch(function () { toast("Kunde inte radera", "error"); });
				});
			}));
		return card;
	}

	function badge(text) { var b = el("span", "preset-badge"); b.textContent = text; return b; }
	function toast(m, t) { if (window.showToast) showToast(m, t); }
	function confirmDel(what) {
		var msg = "Ta bort " + what + "? Det går inte att ångra.";
		return window.confirmDialog ? confirmDialog(msg, { danger: true, confirmText: "Ta bort" }) : Promise.resolve(window.confirm(msg));
	}

	// --- Enhetlig komponent (DRY) ---
	function mountPresetLibrary(container, opts) {
		opts = opts || {};
		// Hanteringsläge (ingen väljare) -> korten får Redigera-knapp.
		opts.manage = !(opts.onPickTheme || opts.onPickBranding);
		function newBtn(cls, label) { return opts.manage ? '<button type="button" class="preset-new secondary ' + cls + '">' + label + '</button>' : ''; }
		container.innerHTML =
			'<div class="preset-section"><div class="preset-section-head"><h3>Teman</h3>' + newBtn("preset-new-theme", "+ Ny tema-mall") + '</div>' +
			'<p class="hint">Tema + inställningar (typsnitt, färger, autorotate, kartstorlek).</p>' +
			'<div class="preset-grid preset-grid-theme"></div></div>' +
			'<div class="preset-section"><div class="preset-section-head"><h3>Branding</h3>' + newBtn("preset-new-brand", "+ Ny branding-mall") + '</div>' +
			'<p class="hint">Logotyp/text-överlägg.</p>' +
			'<div class="preset-grid preset-grid-brand"></div></div>';
		var themeGrid = container.querySelector(".preset-grid-theme");
		var brandGrid = container.querySelector(".preset-grid-brand");
		var ntBtn = container.querySelector(".preset-new-theme"); if (ntBtn) ntBtn.addEventListener("click", function () { openThemeEdit(null, load); });
		var nbBtn = container.querySelector(".preset-new-brand"); if (nbBtn) nbBtn.addEventListener("click", function () { openBrandingEdit(null, load); });

		function load() {
			themeGrid.innerHTML = '<p class="hint">Laddar...</p>';
			brandGrid.innerHTML = '<p class="hint">Laddar...</p>';
			Promise.all([fetchThemes(), fetchBrandings()]).then(function (res) {
				var themes = res[0], brandings = res[1];
				themeGrid.innerHTML = "";
				if (!themes.length) themeGrid.innerHTML = '<p class="hint">Inga tema-mallar ännu.</p>';
				else themes.forEach(function (p) { themeGrid.appendChild(themeCard(p, opts, load)); });
				brandGrid.innerHTML = "";
				if (!brandings.length) brandGrid.innerHTML = '<p class="hint">Inga branding-mallar ännu.</p>';
				else brandings.forEach(function (p) { brandGrid.appendChild(brandingCard(p, opts, load)); });
			}).catch(function () {
				themeGrid.innerHTML = brandGrid.innerHTML = '<p class="hint">Kunde inte hämta mallarna.</p>';
			});
		}
		load();
		return { reload: load };
	}

	// --- Redigera-modal (tema + branding, bara i hanteringsläget) -----------
	var editModal, editBody;
	function buildEditModal() {
		editModal = el("div", "preset-edit-modal help-modal");
		editModal.hidden = true;
		editModal.innerHTML =
			'<article class="preset-edit-article">' +
			'<div class="section-head"><h3 class="preset-edit-title">Redigera</h3>' +
			'<button type="button" class="secondary outline preset-edit-close" aria-label="Stäng">&times;</button></div>' +
			'<div class="preset-edit-body"></div></article>';
		document.body.appendChild(editModal);
		editBody = editModal.querySelector(".preset-edit-body");
		editModal.querySelector(".preset-edit-close").addEventListener("click", closeEdit);
		editModal.addEventListener("click", function (e) { if (e.target === editModal) closeEdit(); });
		document.addEventListener("keydown", function (e) { if (e.key === "Escape" && editModal && !editModal.hidden) closeEdit(); });
	}
	function closeEdit() { if (editModal) editModal.hidden = true; }
	function showEdit(title) { if (!editModal) buildEditModal(); editModal.querySelector(".preset-edit-title").textContent = title; editModal.hidden = false; }

	function openThemeEdit(p, reload) {
		var isNew = !(p && p.id);
		showEdit(isNew ? 'Ny tema-mall' : 'Redigera tema');
		var c = (p && p.config) || {}, th = c.theme || {};
		var ar = c.autoRotate, arOn = typeof ar === "number" && ar !== 0;
		editBody.innerHTML =
			'<label>Namn <input type="text" class="pe-name" maxlength="120"></label>' +
			'<label>Typsnitt <select class="pe-font"><option value="sans">Sans</option><option value="serif">Serif</option><option value="humanist">Humanist</option><option value="mono">Monospace</option></select></label>' +
			'<div class="pe-row"><label>Kartprickar <input type="text" class="pe-dot coloris-input" data-coloris></label><label>Aktiv scen <input type="text" class="pe-cur coloris-input" data-coloris></label></div>' +
			'<label class="pe-switch"><input type="checkbox" class="pe-ar" role="switch"> Rotera automatiskt</label>' +
			'<div class="pe-row"><label>Hastighet (°/s) <input type="number" class="pe-speed" min="0.5" max="10" step="0.5"></label>' +
			'<div class="pe-field"><span class="pe-field-label">Riktning</span><div class="dir-toggle"><span class="pe-dir-left">Vänster</span><input type="checkbox" class="pe-dir" role="switch" aria-label="Rotationsriktning (vänster/höger)"><span class="pe-dir-right">Höger</span></div></div></div>' +
			'<div class="pe-row"><label>Scen-övergång (s) <input type="number" class="pe-fade" min="0" max="3" step="0.1"></label><label>Återuppta (s) <input type="number" class="pe-delay" min="0" max="15" step="0.5"></label></div>' +
			'<label>Kartstorlek <select class="pe-map"><option value="small">Liten</option><option value="medium">Mellan</option><option value="large">Stor</option></select></label>' +
			'<div class="preset-edit-actions"><button type="button" class="pe-save">Spara</button><button type="button" class="pe-cancel secondary outline">Avbryt</button></div>';
		var q = function (s) { return editBody.querySelector(s); };
		q(".pe-name").value = (p && p.name) || "";
		q(".pe-font").value = ["sans", "serif", "humanist", "mono"].indexOf(th.font) !== -1 ? th.font : "sans";
		q(".pe-dot").value = /^#[0-9a-fA-F]{6}$/.test(th.dotColor) ? th.dotColor : "#666666";
		q(".pe-cur").value = /^#[0-9a-fA-F]{6}$/.test(th.currentColor) ? th.currentColor : "#8b0000";
		// Coloris-inputs skapas dynamiskt här -> (om)initiera så swatch/picker binds.
		if (window.Coloris) { Coloris({ el: "[data-coloris]", format: "hex", alpha: false }); [".pe-dot", ".pe-cur"].forEach(function (s) { q(s).dispatchEvent(new Event("input", { bubbles: true })); }); }
		q(".pe-ar").checked = arOn;
		q(".pe-speed").value = arOn ? Math.abs(ar) : 2;
		// Switch: checkad = Höger (-1), som i scen-editorn/preview.
		q(".pe-dir").checked = !(arOn && ar > 0);
		function syncDir() { q(".pe-dir-left").classList.toggle("active", !q(".pe-dir").checked); q(".pe-dir-right").classList.toggle("active", q(".pe-dir").checked); }
		syncDir();
		q(".pe-dir").addEventListener("change", syncDir);
		q(".pe-fade").value = (c.sceneFadeDuration != null ? c.sceneFadeDuration : 1500) / 1000;
		q(".pe-delay").value = (c.autoRotateInactivityDelay != null ? c.autoRotateInactivityDelay : 2000) / 1000;
		q(".pe-map").value = ["small", "medium", "large"].indexOf(c.mapSize) !== -1 ? c.mapSize : "medium";
		// Rotationsinställningarna (hastighet/riktning/återuppta) gråas ut när
		// autorotate är av - de har ingen effekt då.
		function syncArState() {
			var on = q(".pe-ar").checked;
			q(".pe-speed").disabled = !on;
			q(".pe-dir").disabled = !on;
			q(".pe-delay").disabled = !on;
			q(".pe-speed").closest("label").classList.toggle("pe-disabled", !on);
			q(".pe-delay").closest("label").classList.toggle("pe-disabled", !on);
			q(".pe-dir").closest(".pe-field").classList.toggle("pe-disabled", !on);
		}
		syncArState();
		q(".pe-ar").addEventListener("change", syncArState);
		q(".pe-cancel").addEventListener("click", closeEdit);
		q(".pe-save").addEventListener("click", function () {
			var name = q(".pe-name").value.trim();
			if (!name) { toast("Namn krävs", "error"); return; }
			var arEnabled = q(".pe-ar").checked;
			var speed = parseFloat(q(".pe-speed").value) || 2;
			var dir = q(".pe-dir").checked ? -1 : 1;
			var config = {
				autoRotate: arEnabled ? dir * speed : false,
				autoRotateInactivityDelay: Math.round((parseFloat(q(".pe-delay").value) || 0) * 1000),
				sceneFadeDuration: Math.round((parseFloat(q(".pe-fade").value) || 0) * 1000),
				mapSize: q(".pe-map").value,
				theme: { font: q(".pe-font").value, dotColor: q(".pe-dot").value, currentColor: q(".pe-cur").value },
			};
			jpost(isNew ? "/presets" : "/presets/" + p.id, { name: name, config: config })
				.then(function () { toast("Tema-mall sparad", "ok"); closeEdit(); reload(); })
				.catch(function (e) { toast(e.message || "Kunde inte spara", "error"); });
		});
	}

	function openBrandingEdit(p, reload) {
		var isNew = !(p && p.id);
		showEdit(isNew ? 'Ny branding-mall' : 'Redigera branding');
		var c = (p && p.config) || {};
		editBody.innerHTML =
			'<label>Namn <input type="text" class="pe-name" maxlength="120"></label>' +
			'<label>Innehåll (markdown) <textarea class="pe-content" rows="4"></textarea></label>' +
			'<div class="preset-edit-tools"><button type="button" class="pe-img secondary outline">Infoga bild</button></div>' +
			'<div class="pe-row"><label>Storlek <select class="pe-size"><option value="small">Liten</option><option value="medium">Mellan</option><option value="large">Stor</option></select></label><label>Position <select class="pe-pos"><option value="bottom-left">Nere vänster</option><option value="bottom-right">Nere höger</option><option value="top-left">Uppe vänster</option><option value="top-right">Uppe höger</option></select></label></div>' +
			'<div class="preset-brand-stage pe-preview"><div></div></div>' +
			'<div class="preset-edit-actions"><button type="button" class="pe-save">Spara</button><button type="button" class="pe-cancel secondary outline">Avbryt</button></div>';
		var q = function (s) { return editBody.querySelector(s); };
		q(".pe-name").value = (p && p.name) || "";
		q(".pe-content").value = c.content || "";
		q(".pe-size").value = ["small", "medium", "large"].indexOf(c.size) !== -1 ? c.size : "medium";
		q(".pe-pos").value = ["bottom-left", "bottom-right", "top-left", "top-right"].indexOf(c.position) !== -1 ? c.position : "bottom-right";
		var prev = q(".pe-preview div");
		function livePreview() {
			if (window.renderBrandingInto) window.renderBrandingInto(prev, { content: q(".pe-content").value, size: q(".pe-size").value, position: q(".pe-pos").value });
		}
		livePreview();
		q(".pe-content").addEventListener("input", livePreview);
		q(".pe-size").addEventListener("change", livePreview);
		q(".pe-pos").addEventListener("change", livePreview);
		q(".pe-img").addEventListener("click", function () {
			if (!window.openMediaLibrary) { toast("Mediebiblioteket kunde inte öppnas", "error"); return; }
			window.openMediaLibrary(null, function (url) {
				var t = q(".pe-content"), ins = "![](" + url + ")";
				var s = t.selectionStart != null ? t.selectionStart : t.value.length, e = t.selectionEnd != null ? t.selectionEnd : t.value.length;
				t.value = t.value.slice(0, s) + ins + t.value.slice(e);
				livePreview();
			});
		});
		q(".pe-cancel").addEventListener("click", closeEdit);
		q(".pe-save").addEventListener("click", function () {
			var name = q(".pe-name").value.trim();
			if (!name) { toast("Namn krävs", "error"); return; }
			if (!q(".pe-content").value.trim()) { toast("Innehåll krävs", "error"); return; }
			jpost(isNew ? "/branding-presets" : "/branding-presets/" + p.id, { name: name, config: { content: q(".pe-content").value, size: q(".pe-size").value, position: q(".pe-pos").value } })
				.then(function () { toast("Branding-mall sparad", "ok"); closeEdit(); reload(); })
				.catch(function (e) { toast(e.message || "Kunde inte spara", "error"); });
		});
	}

	// --- Modal-skal (väljare på preview-steget) ---
	var modal, modalBody;
	function buildModal() {
		modal = el("div", "preset-modal help-modal");
		modal.hidden = true;
		modal.innerHTML =
			'<article class="preset-article">' +
			'<div class="section-head"><h3>Mallar</h3>' +
			'<button type="button" class="secondary outline preset-close" aria-label="Stäng">&times;</button></div>' +
			'<div class="preset-modal-body"></div></article>';
		document.body.appendChild(modal);
		modalBody = modal.querySelector(".preset-modal-body");
		modal.querySelector(".preset-close").addEventListener("click", closeModal);
		modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
		document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal && !modal.hidden) closeModal(); });
	}
	function closeModal() { if (modal) modal.hidden = true; }

	// Väljare: onPickTheme(config)/onPickBranding(config) applicerar + stänger.
	window.openPresetLibrary = function (opts) {
		opts = opts || {};
		if (!modal) buildModal();
		mountPresetLibrary(modalBody, {
			onPickTheme: opts.onPickTheme ? function (c) { opts.onPickTheme(c); closeModal(); } : null,
			onPickBranding: opts.onPickBranding ? function (c) { opts.onPickBranding(c); closeModal(); } : null,
		});
		modal.hidden = false;
	};

	// Inbäddad hanteringsvy (/mallar): samma komponent utan onPick.
	window.initPresetManager = function (container) { mountPresetLibrary(container, {}); };
})();
