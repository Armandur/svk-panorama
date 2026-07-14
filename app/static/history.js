// Versionshistorik: formatera tidsstämplar (besökarens tidszon) + lat-ladda
// semantisk diff när en versionsrad expanderas.
(function () {
	"use strict";

	function rel(ms) {
		var s = Math.round((Date.now() - ms) / 1000);
		if (s < 60) return "nyss";
		var m = Math.round(s / 60);
		if (m < 60) return "för " + m + " min sedan";
		var h = Math.round(m / 60);
		if (h < 24) return "för " + h + " tim sedan";
		return "för " + Math.round(h / 24) + " dygn sedan";
	}

	document.querySelectorAll(".hist-time[data-ms]").forEach(function (el) {
		var ms = parseInt(el.dataset.ms, 10);
		el.textContent = "Gällde till " + new Date(ms).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
		el.title = rel(ms);
	});

	// Slug ur /projects/<slug>/history.
	var m = location.pathname.match(/\/projects\/([^/]+)\/history/);
	var slug = m ? m[1] : null;

	var KIND = {
		added: { sym: "+", cls: "diff-add" },
		removed: { sym: "−", cls: "diff-del" },
		changed: { sym: "~", cls: "diff-chg" }
	};

	function line(kind, text) {
		var k = KIND[kind] || { sym: "•", cls: "" };
		var li = document.createElement("li");
		li.className = "diff-line " + k.cls;
		var s = document.createElement("span");
		s.className = "diff-sym";
		s.textContent = k.sym;
		li.appendChild(s);
		li.appendChild(document.createTextNode(" " + text));
		return li;
	}

	function renderGroups(groups) {
		var frag = document.createDocumentFragment();
		groups.forEach(function (g) {
			var h = document.createElement("h4");
			h.className = "diff-group-title";
			h.textContent = g.title;
			frag.appendChild(h);
			var ul = document.createElement("ul");
			ul.className = "diff-lines";
			g.items.forEach(function (it) {
				var li = line(it.kind, it.text);
				if (it.sub && it.sub.length) {
					var sub = document.createElement("ul");
					sub.className = "diff-lines diff-sub";
					it.sub.forEach(function (s) { sub.appendChild(line(s.kind, s.text)); });
					li.appendChild(sub);
				}
				ul.appendChild(li);
			});
			frag.appendChild(ul);
		});
		return frag;
	}

	function loadDiff(details) {
		var body = details.querySelector(".hist-diff-body");
		if (!body || body.dataset.loaded === "1") return;
		body.dataset.loaded = "1";
		var version = details.closest(".hist-item").dataset.version;
		fetch("/projects/" + encodeURIComponent(slug) + "/history/" + encodeURIComponent(version) + "/diff", {
			headers: { "Accept": "application/json" }
		}).then(function (r) {
			if (!r.ok) throw new Error("diff " + r.status);
			return r.json();
		}).then(function (d) {
			body.innerHTML = "";
			if (d.oldest) {
				body.innerHTML = '<p class="diff-empty">Äldsta sparade läget - inget att jämföra mot.</p>';
			} else if (!d.groups.length) {
				body.innerHTML = '<p class="diff-empty">Inga spårade ändringar.</p>';
			} else {
				body.appendChild(renderGroups(d.groups));
			}
		}).catch(function () {
			body.dataset.loaded = "0";  // tillåt nytt försök vid nästa öppning
			body.innerHTML = '<p class="diff-empty">Kunde inte ladda ändringarna.</p>';
		});
	}

	if (slug) {
		document.querySelectorAll("details.hist-diff").forEach(function (d) {
			d.addEventListener("toggle", function () { if (d.open) loadDiff(d); });
		});
	}
})();
