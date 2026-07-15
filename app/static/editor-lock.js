/*
 * Redigeringslås (check-out/check-in) för team-turer, klientdelen.
 *
 * Vid sidladdning checkas turen ut. Håller du låset -> du redigerar (heartbeat
 * håller det färskt, "Checka in"-knapp). Håller någon ANNAN det -> läsläge med
 * banner + "Tvinga incheck" (funkar bara för team-admin/super-admin, servern
 * avgör). Servern är garantin (skriv-endpoints ger 409); den här ger UX + släpper
 * låset vid unload. Solo-turer (locking=false) rör vi inte.
 */
(function () {
	"use strict";

	var slug = document.body.dataset.slug;
	if (!slug) return;
	var csrf = window.getCsrfToken ? getCsrfToken() : "";
	var base = "/projects/" + encodeURIComponent(slug);
	var HEARTBEAT_MS = 60000;

	var locking = false, holding = false, warned = false, hbTimer = null, banner = null;

	function checkoutPost() {
		return fetch(base + "/checkout", {
			method: "POST",
			headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
		}).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
	}
	function checkinFetch() {
		var fd = new FormData();
		fd.append("csrf_token", csrf);
		return fetch(base + "/checkin", { method: "POST", body: fd });
	}

	function ensureBanner() {
		if (banner) return banner;
		banner = document.createElement("div");
		banner.className = "editor-lock-banner";
		banner.hidden = true;
		document.body.appendChild(banner);
		return banner;
	}
	function renderBanner(html, cls) {
		var b = ensureBanner();
		b.className = "editor-lock-banner " + cls;
		b.innerHTML = html;
		b.hidden = false;
		return b;
	}

	// Baren är fixed (top:0) -> reservera dess höjd så den inte täcker stegens verktygsfält.
	// Höjden mäts (text+knapp kan radbrytas på mobil); plan-fullscreen krymps via CSS på main.
	function reserveSpace() {
		if (banner && !banner.hidden) {
			document.documentElement.style.setProperty("--lock-banner-h", banner.offsetHeight + "px");
			document.body.classList.add("has-lock-banner");
		} else {
			document.body.classList.remove("has-lock-banner");
			document.documentElement.style.removeProperty("--lock-banner-h");
		}
	}

	// Släpp låset + gå till /editor. holding=false FÖRE navigering så pagehide-handlern
	// inte skickar en andra checkin-beacon.
	function doCheckin() {
		checkinFetch().then(function () { holding = false; location.href = "/editor"; });
	}

	// "Checka in": har steget osparade ändringar (editorDirty) -> fråga spara/förkasta/avbryt.
	// Spara: kör stegets editorSave, checka in bara om det faktiskt blev rent (annars stanna
	// kvar - spara misslyckades). Förkasta: editorDiscard (rensar dirty + ev. utkast) + checka in.
	function checkinFlow() {
		if (!(window.editorDirty && window.editorDirty()) || !window.confirmChoice) {
			doCheckin();
			return;
		}
		window.confirmChoice("Du har osparade ändringar i det här steget. Vad vill du göra?", {
			title: "Osparade ändringar",
			confirmText: "Spara och checka in",
			altText: "Checka in utan att spara",
			cancelText: "Avbryt",
		}).then(function (choice) {
			if (choice === "cancel") return;
			if (choice === "confirm") {
				Promise.resolve(window.editorSave && window.editorSave()).then(function () {
					if (window.editorDirty && window.editorDirty()) {
						if (window.showToast) showToast("Kunde inte spara - du är fortfarande utcheckad.", "error");
					} else {
						doCheckin();
					}
				});
			} else {  // "alt" = förkasta
				if (window.editorDiscard) window.editorDiscard();
				doCheckin();
			}
		});
	}

	function showHolding() {
		document.body.classList.remove("editor-locked");
		var b = renderBanner('<span>Du redigerar den här turen.</span>', "lock-mine");
		var btn = document.createElement("button");
		btn.type = "button"; btn.className = "lock-btn"; btn.textContent = "Checka in";
		btn.addEventListener("click", checkinFlow);
		b.appendChild(btn);
		reserveSpace();
	}
	function showReadonly(holder) {
		document.body.classList.add("editor-locked");
		var who = holder && holder.name ? holder.name : "någon annan";
		var b = renderBanner('<span>🔒 Utcheckad av ' + (window.escapeHtml ? escapeHtml(who) : who) +
			' – du kan bara titta.</span>', "lock-other");
		var btn = document.createElement("button");
		btn.type = "button"; btn.className = "lock-btn"; btn.textContent = "Tvinga incheck";
		btn.addEventListener("click", forceCheckin);
		b.appendChild(btn);
		reserveSpace();
	}

	function apply(res) {
		if (!res || res.locking === false) { locking = false; if (banner) banner.hidden = true; reserveSpace(); document.body.classList.remove("editor-locked"); return; }
		locking = true;
		if (res.acquired) {
			holding = true; warned = false; showHolding();
		} else {
			if (holding && !warned) {
				warned = true;
				if (window.showToast) showToast("Turen togs över av " + (res.holder ? res.holder.name : "någon annan") +
					" – dina osparade ändringar kan inte sparas. Kopiera ut det du behöver.", "error");
			}
			holding = false;
			showReadonly(res.holder);
		}
	}

	function forceCheckin() {
		checkinFetch().then(function () { return checkoutPost(); }).then(function (res) {
			if (res && res.acquired) {
				if (window.showToast) showToast("Du har nu turen utcheckad.", "success");
			} else if (window.showToast) {
				showToast("Kunde inte ta över – bara team-admin kan tvinga incheck.", "error");
			}
			apply(res);
		});
	}

	function heartbeat() { checkoutPost().then(apply); }

	// Start: checka ut, sätt igång heartbeat om turen låses.
	checkoutPost().then(function (res) {
		apply(res);
		if (locking) hbTimer = setInterval(heartbeat, HEARTBEAT_MS);
	});

	// Baren kan radbryta vid omritning -> mät om höjden.
	window.addEventListener("resize", reserveSpace);

	// Släpp låset när man lämnar sidan (best-effort; sendBeacon kan inte sätta
	// header -> CSRF i FormData-body, checkin är form-CSRF-endpoint).
	window.addEventListener("pagehide", function () {
		if (!holding) return;
		try {
			var fd = new FormData();
			fd.append("csrf_token", csrf);
			navigator.sendBeacon(base + "/checkin", fd);
		} catch (e) { /* best-effort */ }
	});
})();
