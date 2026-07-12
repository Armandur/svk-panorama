/* Publik delningslänk på preview-steget: skapa/sluta dela async så länken dyker
   upp (eller försvinner) i rutan utan omladdning. Progressiv förbättring -
   formulären fungerar utan JS (redirect), med JS fångas de och postas via fetch. */
(function () {
	"use strict";
	var art = document.getElementById("share-article");
	if (!art) return;

	var active = art.querySelector(".share-active");
	var createForm = art.querySelector(".share-create");
	var urlInput = document.getElementById("share-url");
	var openLink = document.getElementById("share-open");
	var qrImg = document.getElementById("share-qr-img");
	var qrDownload = document.getElementById("share-qr-download");
	var embedCode = document.getElementById("share-embed-code");
	var embedCopy = document.getElementById("share-embed-copy");

	function embedSnippet(url) {
		return '<iframe src="' + url + '" width="100%" height="480" ' +
			'style="border:0;border-radius:8px" allowfullscreen loading="lazy" ' +
			'title="Virtuell rundtur"></iframe>';
	}

	function renderExtras(url) {
		if (qrImg && window.qrcode) {
			try {
				var qr = qrcode(0, "M");
				qr.addData(url);
				qr.make();
				var dataUrl = qr.createDataURL(6, 8);
				qrImg.src = dataUrl;
				if (qrDownload) qrDownload.href = dataUrl;
			} catch (e) {
				if (qrImg) qrImg.removeAttribute("src");
			}
		}
		if (embedCode) embedCode.value = embedSnippet(url);
	}

	function setShared(url) {
		if (url) {
			urlInput.value = url;
			openLink.href = url;
			renderExtras(url);
			active.hidden = false;
			createForm.hidden = true;
		} else {
			urlInput.value = "";
			openLink.href = "#";
			active.hidden = true;
			createForm.hidden = false;
		}
	}

	// Sidladdning: turen kan redan vara delad (server-renderad länk) -> fyll QR/embed.
	if (urlInput && urlInput.value) renderExtras(urlInput.value);

	if (embedCopy && embedCode) {
		embedCopy.addEventListener("click", function () {
			embedCode.select();
			var ok = false;
			try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
			if (navigator.clipboard && !ok) navigator.clipboard.writeText(embedCode.value);
			if (window.showToast) showToast("Embed-kod kopierad", "ok");
		});
	}

	Array.prototype.forEach.call(art.querySelectorAll(".share-form"), function (form) {
		form.addEventListener("submit", function (e) {
			e.preventDefault();
			var btn = form.querySelector('button[type="submit"]');
			if (btn) btn.setAttribute("aria-busy", "true");
			function done() { if (btn) btn.removeAttribute("aria-busy"); }
			fetch(form.action, {
				method: "POST",
				headers: { "Accept": "application/json" },
				body: new FormData(form),
			}).then(function (r) {
				if (!r.ok) throw new Error();
				return r.json();
			}).then(function (d) {
				done();
				setShared(d.share_url);
				if (window.showToast) showToast(d.share_url ? "Delningslänk skapad" : "Delning stoppad", "ok");
			}).catch(function () {
				done();
				if (window.showToast) showToast("Något gick fel - försök igen", "error");
			});
		});
	});
})();
