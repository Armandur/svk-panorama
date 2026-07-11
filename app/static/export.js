/* Bundle-export: starta bygget, polla progress och visa nedladdningslänk.
   Använder apiFetch/showToast från utils.js. */
(function () {
	"use strict";

	const slug = document.body.dataset.slug;
	const btn = document.getElementById("export-btn");
	const stateEl = document.getElementById("export-state");
	const progress = document.getElementById("export-progress");
	const download = document.getElementById("export-download");
	if (!slug || !btn) return;

	let polling = false;

	function render(state) {
		const job = state.job;
		const running = job && job.status === "running";
		btn.disabled = running;
		btn.textContent = running ? "Bygger..." : "Exportera bundle";
		progress.hidden = !running;
		download.hidden = !state.hasZip;

		if (running) {
			progress.max = job.total || 1;
			progress.value = job.done || 0;
			stateEl.textContent = "Bygger bundle: " + job.done + "/" + (job.total || "?") + " filer";
			return;
		}
		if (job && job.status === "error") {
			stateEl.textContent = "Fel: " + (job.error || "okänt fel");
			return;
		}
		if (state.tileable > 0 && state.tiled < state.tileable) {
			stateEl.textContent = state.tiled + "/" + state.tileable + " scener har tiles - exporten tar med originalbilder för resten.";
		} else if (state.hasZip) {
			stateEl.textContent = "Bundle klar att ladda ner.";
		} else {
			stateEl.textContent = "";
		}
	}

	async function poll() {
		if (polling) return;
		polling = true;
		try {
			while (true) {
				const state = await apiFetch("/projects/" + slug + "/export/status");
				render(state);
				const job = state.job;
				if (!job || job.status !== "running") {
					if (job && job.status === "done") showToast("Bundle klar", "ok");
					else if (job && job.status === "error") showToast("Export misslyckades", "error");
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
			const state = await apiFetch("/projects/" + slug + "/export", { method: "POST" });
			render(state);
			poll();
		} catch (e) {
			showToast(e.message, "error");
		}
	});

	apiFetch("/projects/" + slug + "/export/status").then(function (state) {
		render(state);
		if (state.job && state.job.status === "running") poll();
	}).catch(function () { /* tyst - sektionen är inte kritisk */ });
})();
