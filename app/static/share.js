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

	function setShared(url) {
		if (url) {
			urlInput.value = url;
			openLink.href = url;
			active.hidden = false;
			createForm.hidden = true;
		} else {
			urlInput.value = "";
			openLink.href = "#";
			active.hidden = true;
			createForm.hidden = false;
		}
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
