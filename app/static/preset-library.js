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
	var POS_LABEL = { "bottom-left": "Nere v.", "bottom-right": "Nere h.", "top-left": "Uppe v.", "top-right": "Uppe h." };

	function jpost(url, bodyObj) {
		var opt = { method: "POST", headers: { "X-CSRF-Token": csrf() } };
		if (bodyObj) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(bodyObj); }
		return fetch(url, opt).then(function (r) { if (!r.ok) throw new Error(); return r; });
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

	function cardActions(p, opts, onPick, onDelete) {
		var row = el("div", "preset-card-actions");
		if (onPick) {
			var use = el("button", "preset-use");
			use.type = "button"; use.textContent = "Använd";
			use.addEventListener("click", onPick);
			row.appendChild(use);
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

		card.appendChild(cardActions(p, opts, opts.onPickTheme ? function () { opts.onPickTheme(c); } : null, function () {
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

		card.appendChild(cardActions(p, opts, opts.onPickBranding ? function () { opts.onPickBranding(c); } : null, function () {
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
		container.innerHTML =
			'<div class="preset-section"><h3>Teman</h3>' +
			'<p class="hint">Tema + inställningar (typsnitt, färger, autorotate, kartstorlek). Skapas genom att spara på förhandsvisningssteget.</p>' +
			'<div class="preset-grid preset-grid-theme"></div></div>' +
			'<div class="preset-section"><h3>Branding</h3>' +
			'<p class="hint">Logotyp/text-överlägg. Skapas genom att spara på förhandsvisningssteget.</p>' +
			'<div class="preset-grid preset-grid-brand"></div></div>';
		var themeGrid = container.querySelector(".preset-grid-theme");
		var brandGrid = container.querySelector(".preset-grid-brand");

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
