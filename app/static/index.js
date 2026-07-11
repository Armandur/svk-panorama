/* Projektlistan: live-uppdatera tiling-status-badges. Pollar bulk-endpointen
   /tile-jobs (billig, in-memory) så länge något jobb kör. Turer utan aktivt
   jobb behåller sin server-renderade badge. */
(function () {
	"use strict";

	var badges = document.querySelectorAll(".tile-badge[data-slug]");
	if (!badges.length) return;

	function setBadge(el, status, done, total) {
		el.className = "tile-badge tile-" + status;
		if (status === "running") {
			el.setAttribute("aria-busy", "true");
			el.textContent = "Genererar tiles " + done + "/" + total;
		} else {
			el.removeAttribute("aria-busy");
			if (status === "done") el.textContent = "Tiles klara";
			else if (status === "error") el.textContent = "Tiling-fel";
		}
	}

	var byslug = {};
	badges.forEach(function (b) { byslug[b.dataset.slug] = b; });

	var timer = null;
	function poll() {
		fetch("/tile-jobs")
			.then(function (r) { return r.json(); })
			.then(function (jobs) {
				var anyRunning = false;
				Object.keys(jobs).forEach(function (slug) {
					var el = byslug[slug];
					if (!el) return;
					var j = jobs[slug];
					setBadge(el, j.status, j.done, j.total);
					if (j.status === "running") anyRunning = true;
				});
				// Fortsätt bara polla om något faktiskt kör (annars vila).
				if (anyRunning) timer = setTimeout(poll, 2000);
				else timer = setTimeout(poll, 5000);
			})
			.catch(function () { timer = setTimeout(poll, 5000); });
	}
	poll();
})();
