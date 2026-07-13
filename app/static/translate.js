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
		// targets = valfri delmängd av TARGETS (t.ex. en språkbegränsad hotspot,
		// se hotspotInLang i markdown.js) - default hela TARGETS.
		function addGaps(kind, sceneId, hotspotIndex, value, targets) {
			const src = sourceText(value).trim();
			if (!src) return;
			(targets || TARGETS).forEach(function (lang) {
				if (!langText(value, lang).trim()) {
					out.push({ kind: kind, sceneId: sceneId, hotspotIndex: hotspotIndex, lang: lang, sourceText: src, targetText: "", translated: false });
				}
			});
		}
		sceneIds().forEach(function (sceneId) {
			const scene = tour.scenes[sceneId];
			addGaps("title", sceneId, null, scene.title);
			(scene.hotSpots || []).forEach(function (hs, idx) {
				// En hotspot begränsad till vissa språk (hs.langs) ska inte ge
				// "saknad översättning"-luckor för målspråk den inte visas på.
				const hsTargets = window.hotspotInLang ? TARGETS.filter(function (lang) { return window.hotspotInLang(hs, lang); }) : TARGETS;
				addGaps("hotspot_text", sceneId, idx, hs.text, hsTargets);
				if (hs.expandable) addGaps("hotspot_body", sceneId, idx, hs.body, hsTargets);
			});
		});
		addGaps("branding", null, null, tour.default && tour.default.branding && tour.default.branding.content);
		return out;
	}

	// --- "Alla texter"-läget: SAMMA fältvandring som buildGaps, men listar VARJE
	// (fält × språk)-par som har källspråksinnehåll - källspråket SJÄLVT (redigerbart
	// här också) plus varje målspråk, översatta som ej. targetText/translated
	// speglar tour-datans FAKTISKA nuläge (källspråksposter har alltid innehåll
	// -> translated: true, targetText = källtexten). ---
	function buildAllEntries() {
		const out = [];
		function addAll(kind, sceneId, hotspotIndex, value, langs) {
			const src = sourceText(value).trim();
			if (!src) return;
			(langs || languages).forEach(function (lang) {
				if (lang === SOURCE) {
					out.push({ kind: kind, sceneId: sceneId, hotspotIndex: hotspotIndex, lang: lang, sourceText: src, targetText: src, translated: true });
					return;
				}
				const tgt = langText(value, lang).trim();
				out.push({ kind: kind, sceneId: sceneId, hotspotIndex: hotspotIndex, lang: lang, sourceText: src, targetText: tgt, translated: !!tgt });
			});
		}
		sceneIds().forEach(function (sceneId) {
			const scene = tour.scenes[sceneId];
			addAll("title", sceneId, null, scene.title);
			(scene.hotSpots || []).forEach(function (hs, idx) {
				const hsLangs = window.hotspotInLang ? languages.filter(function (lang) { return window.hotspotInLang(hs, lang); }) : languages;
				addAll("hotspot_text", sceneId, idx, hs.text, hsLangs);
				if (hs.expandable) addAll("hotspot_body", sceneId, idx, hs.body, hsLangs);
			});
		});
		addAll("branding", null, null, tour.default && tour.default.branding && tour.default.branding.content);
		return out;
	}

	// mode: "gaps" (default, dagens beteende - bara saknade) eller "all" (alla
	// översättningsbara fält, översatta som ej).
	function buildEntries() { return mode === "all" ? buildAllEntries() : buildGaps(); }

	function sceneIds() {
		return Object.keys(tour.scenes).sort(function (a, b) {
			return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
		});
	}
	function sceneTitleFor(id) {
		const scene = tour.scenes[id];
		return (scene && sourceText(scene.title)) || ("Scen " + id);
	}

	// --- Accordion-gruppering + N/M-räknare per scen/språk. Räknas UTAN koppling
	// till `gaps` (som bara innehåller SAKNADE översättningar) - vi läser rakt ur
	// tour-datan så en scen som blir klar fortsätter visas (med bock) i stället
	// för att försvinna. SAMMA fält-urval som addGaps ovan (title + hotspot text/
	// body, respekterar hotspotInLang per språk). ---
	function groupKeyFor(g) { return g.kind === "branding" ? "__branding__" : g.sceneId; }
	function sceneLangStats(sceneId, lang) {
		const scene = tour.scenes[sceneId];
		let total = 0, done = 0;
		function check(value) {
			if (!sourceText(value).trim()) return;
			total++;
			if (langText(value, lang).trim()) done++;
		}
		if (scene) {
			check(scene.title);
			(scene.hotSpots || []).forEach(function (hs) {
				if (window.hotspotInLang && !window.hotspotInLang(hs, lang)) return;
				check(hs.text);
				if (hs.expandable) check(hs.body);
			});
		}
		return { total: total, done: done };
	}
	function brandingLangStats(lang) {
		const content = tour.default && tour.default.branding && tour.default.branding.content;
		const src = sourceText(content).trim();
		if (!src) return { total: 0, done: 0 };
		return { total: 1, done: langText(content, lang).trim() ? 1 : 0 };
	}
	function statsForAllTargets(fn) {
		const out = {};
		TARGETS.forEach(function (lang) { out[lang] = fn(lang); });
		return out;
	}
	function sceneHasAnyTarget(sceneId) {
		return TARGETS.some(function (lang) { return sceneLangStats(sceneId, lang).total > 0; });
	}
	function brandingHasAnyTarget() {
		return TARGETS.some(function (lang) { return brandingLangStats(lang).total > 0; });
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
	// sträng). Hotspots KLONAS och får tooltips renderade på KÄLLSPRÅKET via
	// attachHsTooltips (annars visar pannellum "[object Object]" för {kod:text}-
	// text). Originalen i tour.scenes lämnas orörda - gap-scan/spar läser dem
	// (rawValue/hotspotFor) och berörs inte.
	function resolvedTitle(id) {
		const scene = tour.scenes[id];
		return (scene && sourceText(scene.title)) || ("Scen " + id);
	}
	function sceneNamesResolved() {
		const m = {};
		Object.keys(tour.scenes).forEach(function (id) { m[id] = resolvedTitle(id); });
		return m;
	}
	function pannellumScenes() {
		const out = {};
		const names = sceneNamesResolved();
		Object.keys(tour.scenes).forEach(function (id) {
			const cloned = (tour.scenes[id].hotSpots || []).map(function (h) { return Object.assign({}, h); });
			if (window.attachHsTooltips) window.attachHsTooltips(cloned, names, SOURCE, languages);
			out[id] = Object.assign({}, tour.scenes[id], { title: resolvedTitle(id), hotSpots: cloned });
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
	const filterRow = document.getElementById("translate-filter-row");
	const filterSelect = document.getElementById("translate-lang-filter");
	const modeSelect = document.getElementById("translate-mode-select");
	const sourceFieldEl = document.getElementById("translate-source-field");

	let mode = "gaps"; // "gaps" (default) eller "all"
	let gaps = buildEntries();
	let activeIndex = -1;
	let langFilter = ""; // "" = alla målspråk
	let activeGroupKey = null; // scenId, eller "__branding__" - gruppen som hålls utfälld
	const openKeys = new Set(); // manuellt/aktivt utfällda grupper, överlever om-render

	// Språkfilter: byggs om vid varje lägesbyte - "Alla texter" får källspråket
	// som eget filtreringsval (utöver målspråken) så man kan beta av bara
	// källtexterna, "Saknade" är oförändrat (bara målspråk). Bara meningsfullt
	// visa filtret när det finns >=2 val (utöver "Alla").
	function buildFilterOptions() {
		filterSelect.textContent = "";
		const allOpt = document.createElement("option");
		allOpt.value = ""; allOpt.textContent = "Alla";
		filterSelect.appendChild(allOpt);
		const opts = mode === "all" ? [SOURCE].concat(TARGETS) : TARGETS;
		opts.forEach(function (lang) {
			const opt = document.createElement("option");
			opt.value = lang;
			opt.textContent = (window.LANG_NAMES && window.LANG_NAMES[lang]) || lang;
			filterSelect.appendChild(opt);
		});
		filterRow.hidden = opts.length <= 1;
		langFilter = "";
		filterSelect.value = "";
	}
	filterSelect.addEventListener("change", function () {
		langFilter = filterSelect.value;
		renderGapList();
	});

	modeSelect.addEventListener("change", function () {
		mode = modeSelect.value;
		buildFilterOptions();
		rebuildEntries();
	});
	buildFilterOptions();

	// Räknas alltid ur den FAKTISKA tour-datan (inte listlängden) - så siffrorna
	// stämmer i BÅDA lägena oavsett om posten tas bort ur listan (Saknade) eller
	// bara markeras översatt på plats (Alla texter).
	function overallStats() {
		let total = 0, done = 0;
		sceneIds().forEach(function (id) {
			TARGETS.forEach(function (lang) {
				const s = sceneLangStats(id, lang);
				total += s.total; done += s.done;
			});
		});
		TARGETS.forEach(function (lang) {
			const s = brandingLangStats(lang);
			total += s.total; done += s.done;
		});
		return { total: total, done: done };
	}

	function updateProgress() {
		const st = overallStats();
		if (st.total === 0) {
			progressLabel.textContent = "Inga texter att översätta.";
			progressBar.value = 1; progressBar.max = 1;
		} else {
			const remaining = st.total - st.done;
			progressLabel.textContent = st.done + "/" + st.total + " översatta (" + remaining + " kvar)";
			progressBar.value = st.done; progressBar.max = st.total;
		}
	}

	// Accordion: en <details> per scen (numerisk ordning) + en för Branding sist.
	// Bara scener/branding med FAKTISKT översättningsbart innehåll för minst ett
	// målspråk listas - en scen utan hotspottexter tar ingen plats. `openKeys`
	// styr vilka som är utfällda (synkas mot faktisk DOM via "toggle"-lyssnaren,
	// så manuella klick överlever nästa om-render).
	function renderGapList() {
		listEl.textContent = "";
		if (!gaps.length) {
			doneMsgEl.hidden = false;
			editorEl.hidden = true;
			updateProgress();
			return;
		}
		doneMsgEl.hidden = true;

		const keys = sceneIds().filter(sceneHasAnyTarget);
		if (brandingHasAnyTarget()) keys.push("__branding__");

		keys.forEach(function (key) {
			const idxs = [];
			gaps.forEach(function (g, i) { if (groupKeyFor(g) === key) idxs.push(i); });
			const visibleIdxs = idxs.filter(function (i) { return !langFilter || gaps[i].lang === langFilter; });

			const stats = key === "__branding__" ? statsForAllTargets(brandingLangStats) : statsForAllTargets(function (lang) { return sceneLangStats(key, lang); });
			const allDone = TARGETS.every(function (lang) { return stats[lang].total === 0 || stats[lang].done === stats[lang].total; });

			const details = document.createElement("details");
			details.className = "translate-scene-group" + (allDone ? " done" : "");
			details.open = openKeys.has(key);
			details.addEventListener("toggle", function () {
				if (details.open) openKeys.add(key); else openKeys.delete(key);
			});

			const summary = document.createElement("summary");
			const nameWrap = document.createElement("span");
			nameWrap.className = "translate-scene-name";
			if (key === "__branding__") {
				nameWrap.append("Branding");
			} else {
				nameWrap.append(sceneTitleFor(key));
				const idTag = document.createElement("span");
				idTag.className = "scene-id-tag";
				idTag.textContent = "#" + key;
				nameWrap.appendChild(idTag);
			}
			summary.appendChild(nameWrap);

			const counters = document.createElement("span");
			counters.className = "translate-scene-counters";
			TARGETS.forEach(function (lang) {
				const s = stats[lang];
				if (!s.total) return;
				const badge = document.createElement("span");
				badge.className = "lang-counter" + (s.done === s.total ? " complete" : "");
				const flag = document.createElement("img");
				flag.className = "lang-order-flag";
				flag.src = window.langFlag ? window.langFlag(lang) : "";
				flag.alt = lang;
				badge.appendChild(flag);
				badge.append(" " + s.done + "/" + s.total);
				counters.appendChild(badge);
			});
			if (allDone) {
				const check = document.createElement("span");
				check.className = "translate-scene-check";
				check.textContent = "✓";
				counters.appendChild(check);
			}
			summary.appendChild(counters);
			details.appendChild(summary);

			if (!visibleIdxs.length) {
				const hint = document.createElement("p");
				hint.className = "translate-group-hint";
				hint.textContent = idxs.length ? "Inget kvar på valt språk." : "Allt översatt.";
				details.appendChild(hint);
			} else {
				const ul = document.createElement("ul");
				ul.className = "translate-gap-group";
				visibleIdxs.forEach(function (i) {
					const g = gaps[i];
					const li = document.createElement("li");
					li.className = "translate-gap-row" + (i === activeIndex ? " active" : "") + (g.translated ? " is-translated" : "");
					li.dataset.idx = String(i);
					const flag = document.createElement("img");
					flag.className = "lang-order-flag";
					flag.src = window.langFlag ? window.langFlag(g.lang) : "";
					flag.alt = "";
					li.appendChild(flag);
					// Status-bock (bara meningsfull i "Alla texter" - i "Saknade" är
					// g.translated alltid false, så ikonen blir aldrig synlig där).
					if (mode === "all") {
						const status = document.createElement("span");
						status.className = "translate-row-status";
						status.textContent = g.translated ? "✓" : "";
						li.appendChild(status);
					}
					const kindEl = document.createElement("span");
					kindEl.className = "translate-gap-kind";
					kindEl.textContent = KIND_LABELS[g.kind] || g.kind;
					li.appendChild(kindEl);
					const snippet = document.createElement("span");
					// Redan översatt post visar MÅLTEXT-snutten (så man ser vad som
					// faktiskt står där), oöversatt visar källtexten som idag.
					const snippetSrc = g.translated ? g.targetText : g.sourceText;
					snippet.className = "translate-gap-snippet" + (g.translated ? " is-translated" : "");
					snippet.textContent = snippetSrc.length > 60 ? snippetSrc.slice(0, 60) + "…" : snippetSrc;
					li.appendChild(snippet);
					li.addEventListener("click", function () { selectGap(i); });
					ul.appendChild(li);
				});
				details.appendChild(ul);
			}

			listEl.appendChild(details);
		});

		const activeRow = listEl.querySelector(".translate-gap-row.active");
		if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
		updateProgress();
	}

	// Sätts inne i selectGap SJÄLV (inte bara i "load"-lyssnaren nedan) - annars
	// kan ett klick som hinner före vieweren första "load"-event bli överskrivet
	// när auto-valet av lucka 0 triggar strax efter (kapplöpning: multires-tiles
	// hinner inte ladda innan panelen med luckor redan är klickbar).
	let userInteracted = false;
	function selectGap(i) {
		if (i < 0 || !gaps[i]) return;
		userInteracted = true;
		activeIndex = i;
		const key = groupKeyFor(gaps[i]);
		if (key !== activeGroupKey) {
			openKeys.delete(activeGroupKey);
			activeGroupKey = key;
		}
		openKeys.add(activeGroupKey);
		renderGapList(); // fäller ihop föregående scens grupp + fäller ut den nya, uppdaterar aktiv rad
		showEditor(gaps[i]);
		directCamera(gaps[i]);
	}

	// Navigering (Hoppa till nästa / auto-avancera efter spar) respekterar ett
	// ev. aktivt språkfilter - hoppar bara mellan luckor för det valda språket.
	function filteredIndices() {
		const arr = [];
		gaps.forEach(function (g, i) { if (!langFilter || g.lang === langFilter) arr.push(i); });
		return arr;
	}
	function nextFilteredIndex(from) {
		const arr = filteredIndices();
		if (!arr.length) return -1;
		const pos = arr.indexOf(from);
		return arr[(pos + 1) % arr.length];
	}

	function showEditor(g) {
		editorEl.hidden = false;
		// Källspråksposter (bara i "Alla texter") redigerar KÄLLTEXTEN direkt -
		// då är det redigerbara fältet källan, en separat skrivskyddad
		// källreferens ovanför vore bara redundant. Döljs i stället, och
		// målfältets etikett märks tydligt som källspråk.
		const isSource = g.lang === SOURCE;
		document.getElementById("translate-editor-title").textContent = KIND_LABELS[g.kind] || g.kind;
		sourceFieldEl.hidden = isSource;
		document.getElementById("translate-source-flag").src = window.langFlag ? window.langFlag(SOURCE) : "";
		document.getElementById("translate-source-name").textContent = (window.LANG_NAMES && window.LANG_NAMES[SOURCE]) || SOURCE;
		document.getElementById("translate-target-flag").src = window.langFlag ? window.langFlag(g.lang) : "";
		document.getElementById("translate-target-name").textContent = ((window.LANG_NAMES && window.LANG_NAMES[g.lang]) || g.lang) + (isSource ? " (källspråk)" : "");

		const srcBox = document.getElementById("translate-source-text");
		const md = isMarkdownKind(g.kind);
		targetPlainWrap.hidden = md;
		targetMdWrap.hidden = !md;

		// Förifyll med BEFINTLIG måltext ("Alla texter": redan översatta poster,
		// inklusive källspråksposter, ska gå att redigera vidare). I "Saknade"
		// är targetText alltid "" (som idag), så prefillen blir tom precis som
		// innan.
		if (md) {
			srcBox.innerHTML = window.renderMarkdown ? window.renderMarkdown(g.sourceText) : window.escapeHtml(g.sourceText);
			ensureMdEditor();
			if (mdEditor) { mdEditor.value(g.targetText || ""); mdEditor.codemirror.refresh(); mdEditor.codemirror.focus(); }
			else { targetMd.value = g.targetText || ""; targetMd.focus(); }
		} else {
			srcBox.textContent = g.sourceText;
			targetInput.value = g.targetText || "";
			targetInput.focus();
		}
	}

	// Bygger om listan när läget (Saknade/Alla) byts - behåller ev. språkfilter,
	// väljer första matchande post (som selectGap() sköter grupp-utfällning +
	// kamera + rendering för).
	function rebuildEntries() {
		gaps = buildEntries();
		activeIndex = -1;
		activeGroupKey = null;
		editorEl.hidden = true;
		const arr = filteredIndices();
		if (arr.length) selectGap(arr[0]);
		else renderGapList();
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

	// Efter spar: "Saknade" - luckan är borttagen ur gaps (splice:ad av anroparen),
	// hoppa till nästa lucka som matchar ev. aktivt språkfilter (första med index
	// >= den nyss sparade, annars wrap till första). Ger filtret inget träffbart
	// alls kvar (allt på det språket är klart) - nollställ filtret i stället för
	// att stranda användaren i ett tomt läge.
	// "Alla texter" - posten ligger KVAR (bara markerad översatt), så vi hoppar
	// i stället till NÄSTA post i listan (samma logik som "Hoppa till nästa").
	function advanceAfterSave() {
		if (!gaps.length) {
			editorEl.hidden = true;
			activeIndex = -1;
			activeGroupKey = null;
			renderGapList();
			return;
		}
		if (mode === "all") {
			const ni = nextFilteredIndex(activeIndex);
			if (ni !== -1) selectGap(ni); else renderGapList();
			return;
		}
		const arr = filteredIndices();
		if (arr.length) {
			let ni = arr[0];
			for (let k = 0; k < arr.length; k++) { if (arr[k] >= activeIndex) { ni = arr[k]; break; } }
			selectGap(ni);
		} else {
			langFilter = "";
			filterSelect.value = "";
			selectGap(Math.min(activeIndex, gaps.length - 1));
		}
	}

	// Redigera källspråket ("Alla texter") ändrar den text MÅLSPRÅKS-posterna för
	// SAMMA fält visar som källreferens - synka alla syskon-poster i den redan
	// byggda `gaps`-listan (annars visar de kvarvarande in-memory den gamla
	// källtexten tills nästa lägesbyte bygger om listan).
	function syncSourceText(g, newSrc) {
		gaps.forEach(function (other) {
			if (other.kind === g.kind && other.sceneId === g.sceneId && other.hotspotIndex === g.hotspotIndex) {
				other.sourceText = newSrc;
			}
		});
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
			const trimmed = (value || "").trim();
			applyLocal(g, trimmed);
			if (mode === "all") {
				// Posten stannar kvar i listan, bara markerad översatt (radens
				// bock/färg + N/M-räknarna uppdateras via renderGapList/updateProgress).
				g.targetText = trimmed;
				g.translated = !!trimmed;
				if (g.lang === SOURCE) syncSourceText(g, trimmed);
			} else {
				gaps.splice(activeIndex, 1);
			}
			if (window.showToast) showToast("Sparat", "ok");
			advanceAfterSave();
		}).catch(function (e) {
			if (window.showToast) showToast(e.message, "error");
		}).then(function () { btn.removeAttribute("aria-busy"); });
	});

	// Enter i det vanliga textfältet (scentitlar m.fl. icke-markdown-luckor) =
	// spara + gå vidare. EasyMDE-fältet rör vi inte - där ska Enter ge radbrytning.
	targetInput.addEventListener("keydown", function (e) {
		if (e.key !== "Enter") return;
		e.preventDefault();
		document.getElementById("translate-save-btn").click();
	});

	document.getElementById("translate-skip-btn").addEventListener("click", function () {
		if (!gaps.length) return;
		const ni = nextFilteredIndex(activeIndex);
		if (ni !== -1) selectGap(ni);
	});

	// --- Start ---
	if (gaps.length) {
		activeGroupKey = groupKeyFor(gaps[0]);
		openKeys.add(activeGroupKey);
	}
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
