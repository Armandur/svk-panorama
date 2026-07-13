/* Översätt-steget: guidat verktyg för att komplettera saknade översättningar.
   Vänsterpanelen listar luckor (fält som har källspråkstext men saknar ett
   målspråk), höger panel är samma pannellum multires-uppsättning som
   tour-preview.js (manifest-merge, viewer.loadScene(id, pitch, yaw)) - klick
   på en lucka riktar kameran mot fältet (hotspotens egen pitch/yaw för
   hotspot-luckor). Spara postar EN lucka i taget till den granulära
   /translate-endpointen (routes/translate.py). */
(function () {
	"use strict";

	const panoEl = document.getElementById("panorama");
	if (!panoEl || !window.pannellum) return;

	const slug = document.body.dataset.slug;
	const tour = JSON.parse(document.getElementById("tour-data").textContent);
	if (!tour.scenes || !Object.keys(tour.scenes).length) return;

	const languages = (tour.default && Array.isArray(tour.default.languages)) ? tour.default.languages : [];
	if (languages.length <= 1) return; // servern redirectar redan enspråkiga turer hit, men var defensiv
	const SOURCE = languages[0];
	const TARGETS = languages.slice(1);

	const KIND_LABELS = {
		title: "Scentitel",
		hotspot_text: "Hotspot-text",
		hotspot_body: "Läs mer",
		branding: "Branding",
	};
	function isMarkdownKind(kind) { return kind === "hotspot_text" || kind === "hotspot_body" || kind === "branding"; }

	// --- Textfält kan vara ren sträng (= källspråket, bakåtkompat) eller
	// {kod:text}. sourceText/langText läser UTAN fallback - en lucka ska visa
	// tomt för målspråket, inte en annan språkvariant. ---
	function sourceText(value) {
		if (typeof value === "string") return value;
		if (value && typeof value === "object") return value[SOURCE] || "";
		return "";
	}
	function langText(value, lang) {
		if (value && typeof value === "object") return value[lang] || "";
		return "";
	}

	// --- Gap-scan: SAMMA definition som app/services/bundle.py:missing_translations. ---
	function buildGaps() {
		const out = [];
		function addGaps(kind, sceneId, hotspotIndex, value) {
			const src = sourceText(value).trim();
			if (!src) return;
			TARGETS.forEach(function (lang) {
				if (!langText(value, lang).trim()) {
					out.push({ kind: kind, sceneId: sceneId, hotspotIndex: hotspotIndex, lang: lang, sourceText: src, targetText: "" });
				}
			});
		}
		sceneIds().forEach(function (sceneId) {
			const scene = tour.scenes[sceneId];
			addGaps("title", sceneId, null, scene.title);
			(scene.hotSpots || []).forEach(function (hs, idx) {
				addGaps("hotspot_text", sceneId, idx, hs.text);
				if (hs.expandable) addGaps("hotspot_body", sceneId, idx, hs.body);
			});
		});
		addGaps("branding", null, null, tour.default && tour.default.branding && tour.default.branding.content);
		return out;
	}

	function sceneIds() {
		return Object.keys(tour.scenes).sort(function (a, b) {
			return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
		});
	}
	function sceneTitleFor(id) {
		const scene = tour.scenes[id];
		return (scene && sourceText(scene.title)) || ("Scen " + id);
	}
	function sceneYaw(id) { const sc = tour.scenes[id]; return sc && typeof sc.yaw === "number" ? sc.yaw : undefined; }
	function scenePitch(id) { const sc = tour.scenes[id]; return sc && typeof sc.pitch === "number" ? sc.pitch : undefined; }

	function rawValue(g) {
		if (g.kind === "title") return tour.scenes[g.sceneId] && tour.scenes[g.sceneId].title;
		if (g.kind === "branding") return tour.default && tour.default.branding && tour.default.branding.content;
		const hs = hotspotFor(g);
		return hs ? (g.kind === "hotspot_text" ? hs.text : hs.body) : undefined;
	}
	function hotspotFor(g) {
		const scene = tour.scenes[g.sceneId];
		return scene && scene.hotSpots && scene.hotSpots[g.hotspotIndex];
	}

	// --- Multires (samma klient-mönster som tour-preview.js: byt equirektangulär
	// mot multires där tiles finns; övriga scener behåller rå tour.json-panoraman). ---
	const manifest = (function () { const el = document.getElementById("tiles-data"); return el ? JSON.parse(el.textContent) : {}; })();
	Object.keys(tour.scenes).forEach(function (id) {
		if (manifest[id]) {
			const sc = tour.scenes[id];
			sc.type = "multires"; sc.multiRes = manifest[id]; delete sc.panorama;
		}
	});

	// --- Pannellum ---
	// Pannellums inbyggda titel-ruta läser scene.title rakt av och förstår inte
	// {kod:text} - ge den en STATISK klon per scen med källspråkets titel (ren
	// sträng) i stället. hotSpots delas (samma referens) - vi muterar dem aldrig
	// från denna sida, bara läser pitch/yaw/text/body ur den ORIGINALA tour.scenes
	// (rawValue/hotspotFor), så gap-scan och spar berörs inte av detta.
	function resolvedTitle(id) {
		const scene = tour.scenes[id];
		return (scene && sourceText(scene.title)) || ("Scen " + id);
	}
	function pannellumScenes() {
		const out = {};
		Object.keys(tour.scenes).forEach(function (id) {
			out[id] = Object.assign({}, tour.scenes[id], { title: resolvedTitle(id) });
		});
		return out;
	}

	let viewer = null;
	function buildViewer(startId) {
		viewer = pannellum.viewer("panorama", {
			escapeHTML: true,
			default: { firstScene: startId, autoLoad: true, autoRotate: false, editorMode: false },
			scenes: pannellumScenes(),
		});
	}
	function directCamera(g) {
		if (!viewer) return;
		if (g.kind === "branding") {
			const start = (tour.default && tour.default.firstScene && tour.scenes[tour.default.firstScene]) ? tour.default.firstScene : sceneIds()[0];
			viewer.loadScene(start, scenePitch(start), sceneYaw(start));
			return;
		}
		const sceneId = g.sceneId;
		if (!sceneId || !tour.scenes[sceneId]) return;
		if (g.kind === "hotspot_text" || g.kind === "hotspot_body") {
			const hs = hotspotFor(g);
			const pitch = hs && typeof hs.pitch === "number" ? hs.pitch : scenePitch(sceneId);
			const yaw = hs && typeof hs.yaw === "number" ? hs.yaw : sceneYaw(sceneId);
			viewer.loadScene(sceneId, pitch, yaw);
		} else { // title
			viewer.loadScene(sceneId, scenePitch(sceneId), sceneYaw(sceneId));
		}
	}

	// --- Markdown-editor (delad, som scene.js/tour-preview.js) för hotspot-text/
	// läs mer/branding - mediebiblioteks-knapp infogar bild-markdown. ---
	function uploadImg(file, onSuccess, onError) {
		const fd = new FormData();
		fd.append("file", file);
		fetch("/media/upload", {
			method: "POST",
			headers: { "X-CSRF-Token": window.getCsrfToken ? getCsrfToken() : "" },
			body: fd,
		}).then(function (r) {
			if (!r.ok) return r.json().then(function (d) { throw new Error(d.detail || "Uppladdning misslyckades"); });
			return r.json();
		}).then(function (d) { onSuccess(d.url); })
			.catch(function (e) { onError(e.message || "Uppladdning misslyckades"); });
	}
	function mediaAction(editor) {
		if (!window.openMediaLibrary) return;
		window.openMediaLibrary(slug, function (url) {
			const cm = editor.codemirror;
			cm.replaceSelection("![](" + url + ")");
			cm.focus();
		});
	}
	const mediaBtn = { name: "media", action: mediaAction, className: "fa fa-th", title: "Mediebibliotek" };
	let mdEditor = null;
	function ensureMdEditor() {
		if (mdEditor || !window.EasyMDE) return;
		mdEditor = new EasyMDE({
			element: document.getElementById("translate-target-md"),
			spellChecker: false,
			status: false,
			autoDownloadFontAwesome: false,
			minHeight: "80px",
			maxHeight: "30vh",
			uploadImage: true,
			imageUploadFunction: uploadImg,
			toolbar: ["bold", "italic", "heading", "link", "upload-image", mediaBtn, "|", "preview", "guide"],
			previewRender: function (t) { return window.renderMarkdown(t); },
		});
	}

	// --- DOM ---
	const listEl = document.getElementById("translate-gap-list");
	const doneMsgEl = document.getElementById("translate-done-msg");
	const editorEl = document.getElementById("translate-editor");
	const progressLabel = document.getElementById("translate-progress-label");
	const progressBar = document.getElementById("translate-progress-bar");
	const targetInput = document.getElementById("translate-target-input");
	const targetMd = document.getElementById("translate-target-md");
	const targetPlainWrap = document.getElementById("translate-target-plain-wrap");
	const targetMdWrap = document.getElementById("translate-target-md-wrap");

	let gaps = buildGaps();
	let totalGaps = gaps.length;
	let activeIndex = -1;

	function updateProgress() {
		const remaining = gaps.length;
		const done = Math.max(0, totalGaps - remaining);
		if (totalGaps === 0) {
			progressLabel.textContent = "Inga saknade översättningar.";
			progressBar.value = 1; progressBar.max = 1;
		} else {
			progressLabel.textContent = done + "/" + totalGaps + " översatta (" + remaining + " kvar)";
			progressBar.value = done; progressBar.max = totalGaps;
		}
	}

	function renderGapList() {
		listEl.textContent = "";
		if (!gaps.length) {
			doneMsgEl.hidden = false;
			editorEl.hidden = true;
			updateProgress();
			return;
		}
		doneMsgEl.hidden = true;

		const groups = {}; const order = [];
		gaps.forEach(function (g, i) {
			const key = g.sceneId || "__branding__";
			if (!groups[key]) { groups[key] = []; order.push(key); }
			groups[key].push(i);
		});
		order.sort(function (a, b) {
			if (a === "__branding__") return 1;
			if (b === "__branding__") return -1;
			return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
		});

		order.forEach(function (key) {
			const wrap = document.createElement("div");
			wrap.className = "translate-group";
			const h = document.createElement("h4");
			h.textContent = key === "__branding__" ? "Branding" : sceneTitleFor(key);
			wrap.appendChild(h);
			const ul = document.createElement("ul");
			ul.className = "translate-gap-group";
			groups[key].forEach(function (i) {
				const g = gaps[i];
				const li = document.createElement("li");
				li.className = "translate-gap-row" + (i === activeIndex ? " active" : "");
				li.dataset.idx = String(i);
				const flag = document.createElement("img");
				flag.className = "lang-order-flag";
				flag.src = window.langFlag ? window.langFlag(g.lang) : "";
				flag.alt = "";
				li.appendChild(flag);
				const kindEl = document.createElement("span");
				kindEl.className = "translate-gap-kind";
				kindEl.textContent = KIND_LABELS[g.kind] || g.kind;
				li.appendChild(kindEl);
				const snippet = document.createElement("span");
				snippet.className = "translate-gap-snippet";
				snippet.textContent = g.sourceText.length > 60 ? g.sourceText.slice(0, 60) + "…" : g.sourceText;
				li.appendChild(snippet);
				li.addEventListener("click", function () { selectGap(i); });
				ul.appendChild(li);
			});
			wrap.appendChild(ul);
			listEl.appendChild(wrap);
		});
		updateProgress();
	}

	// Sätts inne i selectGap SJÄLV (inte bara i "load"-lyssnaren nedan) - annars
	// kan ett klick som hinner före vieweren första "load"-event bli överskrivet
	// när auto-valet av lucka 0 triggar strax efter (kapplöpning: multires-tiles
	// hinner inte ladda innan panelen med luckor redan är klickbar).
	let userInteracted = false;
	function selectGap(i) {
		userInteracted = true;
		const prev = listEl.querySelector(".translate-gap-row.active");
		if (prev) prev.classList.remove("active");
		activeIndex = i;
		const row = listEl.querySelector('.translate-gap-row[data-idx="' + i + '"]');
		if (row) row.classList.add("active");
		showEditor(gaps[i]);
		directCamera(gaps[i]);
	}

	function showEditor(g) {
		editorEl.hidden = false;
		document.getElementById("translate-editor-title").textContent = KIND_LABELS[g.kind] || g.kind;
		document.getElementById("translate-source-flag").src = window.langFlag ? window.langFlag(SOURCE) : "";
		document.getElementById("translate-source-name").textContent = (window.LANG_NAMES && window.LANG_NAMES[SOURCE]) || SOURCE;
		document.getElementById("translate-target-flag").src = window.langFlag ? window.langFlag(g.lang) : "";
		document.getElementById("translate-target-name").textContent = (window.LANG_NAMES && window.LANG_NAMES[g.lang]) || g.lang;

		const srcBox = document.getElementById("translate-source-text");
		const md = isMarkdownKind(g.kind);
		targetPlainWrap.hidden = md;
		targetMdWrap.hidden = !md;

		if (md) {
			srcBox.innerHTML = window.renderMarkdown ? window.renderMarkdown(g.sourceText) : window.escapeHtml(g.sourceText);
			ensureMdEditor();
			if (mdEditor) { mdEditor.value(""); mdEditor.codemirror.refresh(); mdEditor.codemirror.focus(); }
			else { targetMd.value = ""; targetMd.focus(); }
		} else {
			srcBox.textContent = g.sourceText;
			targetInput.value = "";
			targetInput.focus();
		}
	}

	// Håller den JS-lokala tour-kopian i synk efter en lyckad spar (så luckelistans
	// scentitlar/källtexter förblir korrekta för resten av sessionen).
	function mergeLang(current, lang, text) {
		let d = {};
		if (typeof current === "string") { if (current) d[SOURCE] = current; }
		else if (current && typeof current === "object") { d = Object.assign({}, current); }
		if (text) d[lang] = text; else delete d[lang];
		return d;
	}
	function applyLocal(g, text) {
		if (g.kind === "title") {
			const scene = tour.scenes[g.sceneId];
			scene.title = mergeLang(scene.title, g.lang, text);
		} else if (g.kind === "branding") {
			tour.default.branding = tour.default.branding || {};
			tour.default.branding.content = mergeLang(tour.default.branding.content, g.lang, text);
		} else {
			const hs = hotspotFor(g);
			const field = g.kind === "hotspot_text" ? "text" : "body";
			hs[field] = mergeLang(hs[field], g.lang, text);
		}
	}

	function advanceAfterSave() {
		if (!gaps.length) { editorEl.hidden = true; activeIndex = -1; return; }
		selectGap(Math.min(activeIndex, gaps.length - 1));
	}

	document.getElementById("translate-save-btn").addEventListener("click", function () {
		if (activeIndex < 0 || !gaps[activeIndex]) return;
		const g = gaps[activeIndex];
		const value = isMarkdownKind(g.kind) ? (mdEditor ? mdEditor.value() : targetMd.value) : targetInput.value;
		const btn = this;
		btn.setAttribute("aria-busy", "true");
		apiFetch("/projects/" + encodeURIComponent(slug) + "/translate", {
			method: "POST",
			body: { kind: g.kind, sceneId: g.sceneId, hotspotIndex: g.hotspotIndex, lang: g.lang, value: value },
		}).then(function () {
			applyLocal(g, (value || "").trim());
			gaps.splice(activeIndex, 1);
			renderGapList();
			if (window.showToast) showToast("Sparat", "ok");
			advanceAfterSave();
		}).catch(function (e) {
			if (window.showToast) showToast(e.message, "error");
		}).then(function () { btn.removeAttribute("aria-busy"); });
	});

	document.getElementById("translate-skip-btn").addEventListener("click", function () {
		if (!gaps.length) return;
		selectGap((activeIndex + 1 + gaps.length) % gaps.length);
	});

	// --- Start ---
	renderGapList();
	const startId = (gaps[0] && gaps[0].sceneId) || (tour.default && tour.default.firstScene && tour.scenes[tour.default.firstScene] && tour.default.firstScene) || sceneIds()[0];
	buildViewer(startId);
	// pannellums "load" event fires på VARJE scenbyte (inte bara den första) -
	// selectGap() anropar själv loadScene(), så en ovillkorad lyssnare skulle
	// trigga sig själv i oändlighet. Välj bara lucka 0 automatiskt en gång, och
	// bara om användaren inte redan hunnit klicka en annan lucka (userInteracted,
	// satt inne i selectGap - se ovan).
	if (gaps.length) {
		viewer.on("load", function () {
			if (userInteracted) return;
			selectGap(0);
		});
	}
})();
