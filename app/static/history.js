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

	// Färgad rad "+ text" / "- text" / "~ text".
	function lineEl(kind, text, tag) {
		var k = KIND[kind] || { sym: "•", cls: "" };
		var el = document.createElement(tag || "div");
		el.className = "diff-line " + k.cls;
		var s = document.createElement("span");
		s.className = "diff-sym";
		s.textContent = k.sym;
		el.appendChild(s);
		el.appendChild(document.createTextNode(" " + text));
		return el;
	}

	// Behållare för en lista av noder (indenteras via CSS när den är nästlad).
	function renderNodes(nodes) {
		var wrap = document.createElement("div");
		wrap.className = "diff-nodes";
		nodes.forEach(function (n) { wrap.appendChild(renderNode(n)); });
		return wrap;
	}

	function renderNode(node) {
		var kids = node.children && node.children.length ? node.children : null;

		// Sektionsrubrik (t.ex. "Hotspots") - ingen symbol/färg, bara gruppering.
		if (node.kind === "section") {
			var sec = document.createElement("div");
			sec.className = "diff-section";
			var t = document.createElement("div");
			t.className = "diff-section-title";
			t.textContent = node.text;
			sec.appendChild(t);
			if (kids) sec.appendChild(renderNodes(kids));
			return sec;
		}

		// Collapsible nod (scen) -> accordion, kollapsat som default (kan bli långt).
		if (node.collapsible) {
			var det = document.createElement("details");
			det.className = "diff-node";
			var sum = lineEl(node.kind, node.text, "summary");
			sum.classList.add("diff-summary");
			det.appendChild(sum);
			if (kids) det.appendChild(renderNodes(kids));
			return det;
		}

		// Vanlig rad, ev. med nästlade fält-ändringar (hotspot > fält).
		var item = document.createElement("div");
		item.className = "diff-item";
		item.appendChild(lineEl(node.kind, node.text));
		if (kids) item.appendChild(renderNodes(kids));
		return item;
	}

	function renderGroups(groups) {
		var frag = document.createDocumentFragment();
		groups.forEach(function (g) {
			var det = document.createElement("details");
			det.className = "diff-group";
			det.open = true;  // grupper öppna som default; scener kollapsade inuti
			var sum = document.createElement("summary");
			sum.className = "diff-group-title";
			sum.textContent = g.title;
			det.appendChild(sum);
			det.appendChild(renderNodes(g.items));
			frag.appendChild(det);
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
