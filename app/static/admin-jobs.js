/* Admin: samlad jobb-status-vy (/admin/jobs). Pollar /admin/jobs.json och
   grupperar registret klient-side i Kör/Köade/Nyligen klara - jobqueue:s
   register växer obundet (done-jobb tas aldrig bort), så bara de senaste
   ~20 avslutade visas. */
(function () {
	"use strict";

	var emptyEl = document.getElementById("jobs-empty");
	var runningSection = document.getElementById("jobs-running-section");
	var queuedSection = document.getElementById("jobs-queued-section");
	var recentSection = document.getElementById("jobs-recent-section");
	var runningBody = document.getElementById("jobs-running-body");
	var queuedBody = document.getElementById("jobs-queued-body");
	var recentBody = document.getElementById("jobs-recent-body");
	var runningCount = document.getElementById("jobs-running-count");
	var queuedCount = document.getElementById("jobs-queued-count");
	if (!runningBody || !queuedBody || !recentBody) return;

	var RECENT_LIMIT = 20;

	var KIND_LABELS = { tiling: "Tiling", export: "Export", backup: "Backup" };
	var STATUS_LABELS = { queued: "köad", running: "kör", done: "klar", error: "fel" };
	var STATUS_CLASS = { queued: "tile-partial", running: "tile-running", done: "tile-done", error: "tile-error" };

	function rel(ms) {
		var s = Math.round((Date.now() - ms) / 1000);
		if (s < 5) return "just nu";
		if (s < 60) return "för " + s + " s sedan";
		var m = Math.round(s / 60);
		if (m < 60) return "för " + m + " min sedan";
		var h = Math.round(m / 60);
		if (h < 24) return "för " + h + " tim sedan";
		return "för " + Math.round(h / 24) + " dygn sedan";
	}

	function timeCell(ts) {
		var td = document.createElement("td");
		if (!ts) { td.textContent = "-"; return td; }
		var ms = ts * 1000;
		td.textContent = rel(ms);
		td.title = new Date(ms).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "medium" });
		return td;
	}

	function statusBadge(status) {
		var span = document.createElement("span");
		span.className = "tile-badge " + (STATUS_CLASS[status] || "");
		span.textContent = STATUS_LABELS[status] || status;
		return span;
	}

	function row(job) {
		var tr = document.createElement("tr");

		var kindTd = document.createElement("td");
		kindTd.textContent = KIND_LABELS[job.kind] || job.kind;
		tr.appendChild(kindTd);

		var slugTd = document.createElement("td");
		if (job.slug) {
			var a = document.createElement("a");
			a.href = "/projects/" + encodeURIComponent(job.slug) + "/preview";
			a.textContent = job.label || job.slug;
			slugTd.appendChild(a);
		} else {
			slugTd.textContent = "-";
		}
		tr.appendChild(slugTd);

		var sceneTd = document.createElement("td");
		sceneTd.textContent = job.scene_id != null ? job.scene_id : "-";
		tr.appendChild(sceneTd);

		var statusTd = document.createElement("td");
		statusTd.appendChild(statusBadge(job.status));
		tr.appendChild(statusTd);

		tr.appendChild(timeCell(job.ts));
		return tr;
	}

	function fillBody(tbody, jobs, emptyText) {
		tbody.textContent = "";
		if (!jobs.length) {
			var tr = document.createElement("tr");
			var td = document.createElement("td");
			td.colSpan = 5;
			td.className = "hint";
			td.textContent = emptyText;
			tr.appendChild(td);
			tbody.appendChild(tr);
			return;
		}
		jobs.forEach(function (j) { tbody.appendChild(row(j)); });
	}

	function render(jobs) {
		var running = jobs.filter(function (j) { return j.status === "running"; })
			.sort(function (a, b) { return a.ts - b.ts; });
		var queued = jobs.filter(function (j) { return j.status === "queued"; })
			.sort(function (a, b) { return a.ts - b.ts; });
		var recent = jobs.filter(function (j) { return j.status === "done" || j.status === "error"; })
			.sort(function (a, b) { return b.ts - a.ts; })
			.slice(0, RECENT_LIMIT);

		if (!jobs.length) {
			emptyEl.hidden = false;
			runningSection.hidden = true;
			queuedSection.hidden = true;
			recentSection.hidden = true;
			return;
		}
		emptyEl.hidden = true;
		runningSection.hidden = false;
		queuedSection.hidden = false;
		recentSection.hidden = false;

		runningCount.textContent = running.length ? "(" + running.length + ")" : "";
		queuedCount.textContent = queued.length ? "(" + queued.length + ")" : "";

		fillBody(runningBody, running, "Inga körande jobb.");
		fillBody(queuedBody, queued, "Inga köade jobb.");
		fillBody(recentBody, recent, "Inga nyligen avslutade jobb.");
	}

	var timer = null;
	function poll() {
		apiFetch("/admin/jobs.json")
			.then(function (jobs) {
				render(jobs);
				var anyActive = jobs.some(function (j) { return j.status === "running" || j.status === "queued"; });
				if (timer) clearTimeout(timer);
				timer = setTimeout(poll, anyActive ? 2000 : 5000);
			})
			.catch(function () {
				if (timer) clearTimeout(timer);
				timer = setTimeout(poll, 5000);
			});
	}

	window.addEventListener("beforeunload", function () {
		if (timer) clearTimeout(timer);
	});

	poll();
})();
