/* Tiling-status på projekthemsidan: pollar tile-jobbet och visar en
   sammanfattande badge + per-scen-rader med progress-bar (samma vy som förr
   låg i uppladdningsmodalen, nu ett spårbart steg på sidan). Kör-om-knapp när
   scener saknar tiles. */
(function () {
	"use strict";

	var slug = document.body.dataset.slug;
	var section = document.getElementById("tile-section");
	if (!slug || !section) return;

	var overall = document.getElementById("tile-overall");
	var rowsEl = document.getElementById("tile-rows");
	var genBtn = document.getElementById("tile-generate");
	var rows = {};
	var timer = null;

	function buildRows(scenes) {
		rowsEl.textContent = "";
		rows = {};
		scenes.forEach(function (s) {
			var li = document.createElement("li");
			li.className = "ufile";
			var name = document.createElement("span");
			name.className = "ufile-name";
			name.textContent = "Scen " + s.id;
			var bar = document.createElement("progress");
			bar.className = "ufile-bar";
			bar.max = 100;
			bar.value = s.progress || 0;
			var st = document.createElement("span");
			st.className = "ufile-status";
			st.textContent = "väntar";
			li.appendChild(name);
			li.appendChild(bar);
			li.appendChild(st);
			rowsEl.appendChild(li);
			rows[s.id] = { bar: bar, st: st };
		});
	}

	function updateRows(scenes) {
		scenes.forEach(function (s) {
			var r = rows[s.id];
			if (!r) return;
			if (s.status === "done") { r.bar.value = 100; r.st.className = "ufile-status ufile-done"; r.st.textContent = "klar"; }
			else if (s.status === "error") { r.bar.value = 0; r.st.className = "ufile-status ufile-error"; r.st.textContent = "fel"; }
			else if (s.status === "running") { r.bar.value = s.progress || 0; r.st.className = "ufile-status ufile-uploading"; r.st.textContent = s.stage || "genererar"; }
			else { r.bar.value = 0; r.st.className = "ufile-status"; r.st.textContent = "väntar"; }
		});
	}

	function setOverall(cls, busy, text) {
		overall.className = "tile-badge tile-" + cls;
		if (busy) overall.setAttribute("aria-busy", "true");
		else overall.removeAttribute("aria-busy");
		overall.textContent = text;
	}

	function render(state) {
		var job = state.job;
		if (state.tileable === 0) { section.hidden = true; return; }
		section.hidden = false;

		if (job && job.status === "running") {
			var scenes = job.scenes || [];
			if (Object.keys(rows).length !== scenes.length) buildRows(scenes);
			updateRows(scenes);
			setOverall("running", true, "Genererar tiles " + job.done + "/" + job.total);
			genBtn.hidden = true;
			return;
		}

		rowsEl.textContent = "";
		rows = {};
		if (job && job.status === "error") setOverall("error", false, "Tiling-fel");
		else if (state.tiled >= state.tileable && state.tileable > 0) setOverall("done", false, "Tiles klara (" + state.tiled + "/" + state.tileable + ")");
		else setOverall("partial", false, state.tiled + "/" + state.tileable + " tilade");
		genBtn.hidden = state.tiled >= state.tileable;
	}

	function poll() {
		fetch("/projects/" + encodeURIComponent(slug) + "/tile-job/status")
			.then(function (r) { return r.json(); })
			.then(function (state) {
				render(state);
				var running = state.job && state.job.status === "running";
				if (timer) clearTimeout(timer);
				timer = setTimeout(poll, running ? 1000 : 4000);
			})
			.catch(function () {
				if (timer) clearTimeout(timer);
				timer = setTimeout(poll, 4000);
			});
	}

	genBtn.addEventListener("click", function () {
		genBtn.hidden = true;
		fetch("/projects/" + encodeURIComponent(slug) + "/tile-job", {
			method: "POST",
			headers: { "X-CSRF-Token": window.getCsrfToken ? getCsrfToken() : "" },
		})
			.then(function () { poll(); })
			.catch(function () { if (window.showToast) showToast("Kunde inte starta tiling", "error"); });
	});

	poll();
})();
