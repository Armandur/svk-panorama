/*
 * Redigeringslås (check-out/check-in) för team-turer, klientdelen.
 *
 * Vid sidladdning checkas turen ut. Håller du låset -> du redigerar (heartbeat
 * håller det färskt, "Checka in"-knapp). Håller någon ANNAN det -> läsläge med
 * en pill + "Tvinga incheck" (funkar bara för team-admin/super-admin, servern
 * avgör). Servern är garantin (skriv-endpoints ger 409); den här ger UX + släpper
 * låset vid unload. Solo-turer (locking=false) rör vi inte.
 *
 * Renderas in i #editor-lock-slot (en tom slot i _step_nav.html/.editor-topbar) -
 * INTE en egen fixed banner. Baren finns alltid på fullscreen-sidorna -> dess
 * höjd (--topbar-h) mäts alltid, inte bara när sloten har innehåll.
 */
(function () {
	"use strict";

	var slug = document.body.dataset.slug;
	if (!slug) return;
	var csrf = window.getCsrfToken ? getCsrfToken() : "";
	var base = "/projects/" + encodeURIComponent(slug);
	var HEARTBEAT_MS = 60000;

	var locking = false, holding = false, warned = false, hbTimer = null, lockSlot = null;

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

	function lockSlotEl() {
		if (!lockSlot) lockSlot = document.getElementById("editor-lock-slot");
		return lockSlot;
	}
	function renderPill(html, cls) {
		var el = lockSlotEl();
		if (!el) return null;
		el.className = "editor-topbar-lock lock-pill " + cls;
		el.innerHTML = html;
		reserveSpace();
		return el;
	}
	function clearPill() {
		var el = lockSlotEl();
		if (!el) return;
		el.className = "editor-topbar-lock";
		el.innerHTML = "";
		reserveSpace();
	}

	// Topbaren finns ALLTID på fullscreen-sidorna (inte bara vid lås) -> mät dess
	// höjd alltid, inte gate:at på om sloten har innehåll. Höjden mäts på nytt vid
	// lås-render (pillen kan radbryta på mobil) och vid fönster-resize.
	function reserveSpace() {
		var bar = document.querySelector(".editor-topbar");
		if (!bar) return;
		document.documentElement.style.setProperty("--topbar-h", bar.offsetHeight + "px");
	}

	// Släpp låset + gå till /editor. holding=false FÖRE navigering så pagehide-handlern
	// inte skickar en andra checkin-beacon.
	function doCheckin() {
		checkinFetch().then(function () { holding = false; location.href = "/editor"; });
	}

	// "Checka in": har steget osparade ändringar (editorDirty) -> fråga spara/förkasta/avbryt.
	// Spara: kör stegets editorSave, checka in bara om det faktiskt blev rent (annars stanna
	// kvar - spara misslyckades). Förkasta: editorDiscard (rensar dirty + ev. utkast) + checka in.
	var checkinBusy = false;  // guard mot dubbelklick: dubbel dialog/POST (N7)
	function checkinFlow() {
		if (checkinBusy) return;
		checkinBusy = true;
		if (!(window.editorDirty && window.editorDirty()) || !window.confirmChoice) {
			doCheckin();  // navigerar bort vid lyckad incheck -> lämna busy satt
			return;
		}
		window.confirmChoice("Du har osparade ändringar i det här steget. Vad vill du göra?", {
			title: "Osparade ändringar",
			confirmText: "Spara och checka in",
			altText: "Checka in utan att spara",
			cancelText: "Avbryt",
		}).then(function (choice) {
			if (choice === "cancel") { checkinBusy = false; return; }
			if (choice === "confirm") {
				Promise.resolve(window.editorSave && window.editorSave()).then(function () {
					if (window.editorDirty && window.editorDirty()) {
						checkinBusy = false;
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
		var b = renderPill('<span>Du redigerar den här turen.</span>', "lock-mine");
		if (!b) return;
		var btn = document.createElement("button");
		btn.type = "button"; btn.className = "lock-btn"; btn.textContent = "Checka in";
		btn.addEventListener("click", checkinFlow);
		b.appendChild(btn);
		reserveSpace();
	}
	function showReadonly(holder) {
		document.body.classList.add("editor-locked");
		var who = holder && holder.name ? holder.name : "någon annan";
		var b = renderPill('<span>🔒 Utcheckad av ' + (window.escapeHtml ? escapeHtml(who) : who) +
			' – du kan bara titta.</span>', "lock-other");
		if (!b) return;
		var btn = document.createElement("button");
		btn.type = "button"; btn.className = "lock-btn"; btn.textContent = "Tvinga incheck";
		btn.addEventListener("click", forceCheckin);
		b.appendChild(btn);
		reserveSpace();
	}

	function apply(res) {
		// checkoutPost() gav null vid ett misslyckat/nätverksfel-svar (inte ett giltigt
		// serversvar) -> lämna nuvarande visade låsstate orört i stället för att tolka
		// det som "ingen låsning" (annars kan ett transient heartbeat-fel kortvarigt
		// låsa upp UI:t för en användare som egentligen är i läsläge).
		if (!res) return;
		if (res.locking === false) { locking = false; clearPill(); document.body.classList.remove("editor-locked"); return; }
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

	// Mät baren DIREKT (inte bara efter att checkout-svaret kommit) - den finns
	// alltid på fullscreen-sidorna, så main.plan-app ska aldrig hamna under en
	// omätt (--topbar-h: 0) bar även om checkout-anropet är långsamt/misslyckas.
	reserveSpace();

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
