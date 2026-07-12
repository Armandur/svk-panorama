/* Tillgänglighet för de återanvända .help-modal-overlayerna (hjälp, hotspot,
   startscen, inställningar, mediebibliotek): dialogroll, fokusfälla och
   fokusåterställning. Aktiveras/avaktiveras när modalens `hidden` togglas -
   ingen ändring krävs i varje modals öppna-logik. confirm-modal.js har egen
   hantering och rörs inte. */
(function () {
	"use strict";
	var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
	var active = new WeakMap(); // modal -> {prev, onKey}

	function dialogEl(modal) { return modal.querySelector("article") || modal; }

	function visibleFocusables(modal) {
		return Array.prototype.filter.call(modal.querySelectorAll(FOCUSABLE), function (el) {
			return el.offsetParent !== null; // hoppa över dolda element
		});
	}

	function open(modal) {
		if (active.has(modal)) return;
		var dlg = dialogEl(modal);
		if (!dlg.getAttribute("role")) dlg.setAttribute("role", "dialog");
		dlg.setAttribute("aria-modal", "true");
		var prev = document.activeElement;
		var f = visibleFocusables(modal);
		if (f.length) { try { f[0].focus(); } catch (e) { /* ignore */ } }
		function onKey(e) {
			if (e.key !== "Tab") return;
			var list = visibleFocusables(modal);
			if (!list.length) return;
			var first = list[0], last = list[list.length - 1];
			if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
		}
		modal.addEventListener("keydown", onKey);
		active.set(modal, { prev: prev, onKey: onKey });
	}

	function close(modal) {
		var st = active.get(modal);
		if (!st) return;
		modal.removeEventListener("keydown", st.onKey);
		dialogEl(modal).setAttribute("aria-modal", "false");
		active.delete(modal);
		if (st.prev && st.prev.focus) { try { st.prev.focus(); } catch (e) { /* ignore */ } }
	}

	function watch(modal) {
		if (modal.__a11yWatched) return;
		modal.__a11yWatched = true;
		new MutationObserver(function () {
			if (modal.hidden) close(modal); else open(modal);
		}).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
		if (!modal.hidden) open(modal);
	}

	function scan(root) {
		if (root.classList && root.classList.contains("help-modal")) watch(root);
		if (root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll(".help-modal"), watch);
	}

	document.addEventListener("DOMContentLoaded", function () {
		scan(document);
		// Modaler som byggs dynamiskt (t.ex. mediebiblioteket) fångas här.
		new MutationObserver(function (muts) {
			muts.forEach(function (m) {
				Array.prototype.forEach.call(m.addedNodes, function (n) {
					if (n.nodeType === 1) scan(n);
				});
			});
		}).observe(document.body, { childList: true, subtree: true });
	});
})();
