/* Återanvändbar flagg-dropdown för editorn (Pico-stil), samma flagg-idé som
   viewerns .lang-toggle (viewer.js) men allmän/monterbar var som helst.
   window.mountLangDropdown(container, opts) - opts = {langs, current, onPick, showName}.
   Infälld = aktuell flagga (+ ev. språknamn om showName). Utfälld = meny med
   flagga + språknamn, aktivt språk markerat. Stänger vid val/utanförklick/Escape.
   Returnerar {setCurrent(kod), setLangs([...]), el} så anroparen kan uppdatera
   utan att montera om. Kräver LANG_NAMES/langFlag från markdown.js. */
(function () {
	"use strict";

	window.mountLangDropdown = function (container, opts) {
		opts = opts || {};
		var langs = (opts.langs || []).slice();
		var current = opts.current || langs[0];
		var onPick = typeof opts.onPick === "function" ? opts.onPick : function () {};
		var showName = !!opts.showName;

		var wrap = document.createElement("div");
		wrap.className = "lang-dropdown";

		var btn = document.createElement("button");
		btn.type = "button";
		btn.className = "lang-dd-current";
		var flagImg = document.createElement("img");
		flagImg.alt = "";
		var nameSpan = document.createElement("span");
		nameSpan.className = "lang-dd-name";
		btn.appendChild(flagImg);
		btn.appendChild(nameSpan);
		wrap.appendChild(btn);

		var menu = document.createElement("div");
		menu.className = "lang-dd-menu";
		menu.hidden = true;
		wrap.appendChild(menu);

		function renderMenu() {
			menu.innerHTML = "";
			langs.forEach(function (code) {
				var item = document.createElement("button");
				item.type = "button";
				item.className = "lang-dd-item" + (code === current ? " active" : "");
				item.dataset.lang = code;
				var f = document.createElement("img");
				f.src = window.langFlag ? window.langFlag(code) : "";
				f.alt = "";
				var name = document.createElement("span");
				name.textContent = (window.LANG_NAMES && window.LANG_NAMES[code]) || code;
				item.appendChild(f);
				item.appendChild(name);
				item.addEventListener("click", function (e) {
					e.stopPropagation();
					closeMenu();
					if (code !== current) {
						current = code;
						renderCurrent();
						onPick(code);
					}
				});
				menu.appendChild(item);
			});
		}
		function renderCurrent() {
			flagImg.src = window.langFlag ? window.langFlag(current) : "";
			nameSpan.textContent = showName ? ((window.LANG_NAMES && window.LANG_NAMES[current]) || current || "") : "";
			renderMenu();
		}
		function openMenu() { menu.hidden = false; wrap.classList.add("open"); }
		function closeMenu() { menu.hidden = true; wrap.classList.remove("open"); }

		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			if (menu.hidden) openMenu(); else closeMenu();
		});

		// Dokumentlyssnare för utanförklick/Escape. Städar sig själv vid nästa
		// händelse om wrap:en tagits bort ur DOM:en (t.ex. modalens innerHTML
		// nollställdes vid omöppning) - annars skulle listeners hopa sig över en
		// lång session.
		function outsideClick(e) {
			if (!document.body.contains(wrap)) { document.removeEventListener("click", outsideClick); return; }
			if (!wrap.contains(e.target)) closeMenu();
		}
		function onEscape(e) {
			if (!document.body.contains(wrap)) { document.removeEventListener("keydown", onEscape); return; }
			if (e.key === "Escape") closeMenu();
		}
		document.addEventListener("click", outsideClick);
		document.addEventListener("keydown", onEscape);

		renderCurrent();
		container.innerHTML = "";
		container.appendChild(wrap);

		return {
			el: wrap,
			setCurrent: function (code) { current = code; renderCurrent(); },
			setLangs: function (newLangs) {
				langs = (newLangs || []).slice();
				if (langs.indexOf(current) === -1) current = langs[0];
				renderCurrent();
			},
		};
	};
})();
