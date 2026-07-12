/* Projekt-backup: starta bygget av en redigerbar projekt-zip, polla progress,
   visa nedladdningslänk. Speglar export.js men mot /backup-endpoints. */
(function () {
	"use strict";
	var slug = document.body.dataset.slug;
	var btn = document.getElementById("backup-btn");
	var stateEl = document.getElementById("backup-state");
	var progress = document.getElementById("backup-progress");
	var download = document.getElementById("backup-download");
	if (!slug || !btn) return;

	var polling = false;

	function render(state) {
		var job = state.job;
		var running = job && job.status === "running";
		btn.disabled = running;
		btn.textContent = running ? "Bygger..." : "Skapa säkerhetskopia";
		progress.hidden = !running;
		download.hidden = !state.hasZip;
		if (running) {
			progress.max = job.total || 1;
			progress.value = job.done || 0;
			stateEl.textContent = "Bygger backup: " + job.done + "/" + (job.total || "?") + " filer";
			return;
		}
		if (job && job.status === "error") { stateEl.textContent = "Fel: " + (job.error || "okänt fel"); return; }
		stateEl.textContent = state.hasZip ? "Backup klar att ladda ner." : "";
	}

	async function poll() {
		if (polling) return;
		polling = true;
		try {
			while (true) {
				var state = await apiFetch("/projects/" + slug + "/backup/status");
				render(state);
				var job = state.job;
				if (!job || job.status !== "running") {
					if (job && job.status === "done") showToast("Backup klar", "ok");
					else if (job && job.status === "error") showToast("Backup misslyckades", "error");
					break;
				}
				await new Promise(function (r) { setTimeout(r, 800); });
			}
		} catch (e) {
			stateEl.textContent = "Kunde inte hämta status: " + e.message;
		} finally {
			polling = false;
		}
	}

	btn.addEventListener("click", async function () {
		try {
			var state = await apiFetch("/projects/" + slug + "/backup", { method: "POST" });
			render(state);
			poll();
		} catch (e) {
			showToast(e.message, "error");
		}
	});

	apiFetch("/projects/" + slug + "/backup/status").then(function (state) {
		render(state);
		if (state.job && state.job.status === "running") poll();
	}).catch(function () { /* tyst */ });
})();
