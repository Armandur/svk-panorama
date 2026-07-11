/* Bildoptimering: starta multires-tiling och polla progress. Fristående
   (bloatar inte scene.js). Använder apiFetch/showToast från utils.js. */
(function () {
	"use strict";

	const slug = document.body.dataset.slug;
	const btn = document.getElementById("tile-btn");
	const stateEl = document.getElementById("tile-state");
	const progress = document.getElementById("tile-progress");
	if (!slug || !btn) return;

	let polling = false;

	function render(state) {
		const job = state.job;
		const running = job && job.status === "running";
		btn.disabled = running;
		btn.textContent = running ? "Genererar..." : "Generera tiles";

		if (running) {
			progress.hidden = false;
			progress.max = job.total || 1;
			progress.value = job.done || 0;
			const cur = job.current ? "scen " + job.current : "startar";
			stateEl.textContent = "Genererar tiles (" + cur + "): " + job.done + "/" + job.total;
			return;
		}

		progress.hidden = true;
		if (job && job.status === "error") {
			stateEl.textContent = "Fel: " + (job.error || "okänt fel");
			return;
		}
		if (state.tileable === 0) {
			stateEl.textContent = "Inga scener med bild att tila ännu.";
			return;
		}
		stateEl.textContent = state.tiled + " av " + state.tileable + " scener har tiles.";
	}

	async function poll() {
		if (polling) return;
		polling = true;
		try {
			while (true) {
				const state = await apiFetch("/projects/" + slug + "/tile-job/status");
				render(state);
				const job = state.job;
				if (!job || job.status !== "running") {
					if (job && job.status === "done" && (state.tiled || 0) > 0) {
						showToast("Tiles genererade", "success");
					} else if (job && job.status === "error") {
						showToast("Tiling misslyckades", "error");
					}
					break;
				}
				await new Promise(function (r) { setTimeout(r, 1500); });
			}
		} catch (e) {
			stateEl.textContent = "Kunde inte hämta status: " + e.message;
		} finally {
			polling = false;
		}
	}

	btn.addEventListener("click", async function () {
		try {
			const state = await apiFetch("/projects/" + slug + "/tile-job", { method: "POST" });
			render(state);
			poll();
		} catch (e) {
			showToast(e.message, "error");
		}
	});

	// Visa nuläge (och återuppta polling om ett jobb redan kör) vid sidladdning.
	apiFetch("/projects/" + slug + "/tile-job/status").then(function (state) {
		render(state);
		if (state.job && state.job.status === "running") poll();
	}).catch(function () { /* tyst - sektionen är inte kritisk */ });
})();
