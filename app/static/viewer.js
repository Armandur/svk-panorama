/* Runtime-viewer: ren visning av en publicerad tur. Ingen editor-logik.
   Pannellum sköter all hotspot-rendering och scen-navigering; det enda vi
   lägger till är kartöverlägget (klickbara prickar + markering av aktiv scen).
   Turdata och kartdata bäddas in som JSON-script-taggar av mallen. */
(function () {
	const tour = JSON.parse(document.getElementById("tour-data").textContent);
	const mapEl = document.getElementById("map-data");
	const mapData = mapEl ? JSON.parse(mapEl.textContent) : { scenes: [] };

	// Publicerad tur körs alltid utan editor-läge, oavsett vad filen säger.
	tour.default = tour.default || {};
	tour.default.editorMode = false;

	const viewer = pannellum.viewer("panorama", tour);

	// --- Kartöverlägg ------------------------------------------------------
	const container = document.getElementById("map-container");
	if (!container) return; // Turen saknar kartbild.

	const mapImg = document.getElementById("map-img");
	const dotsLayer = document.getElementById("map-dots");
	const showBtn = document.getElementById("show-map-btn");
	const closeBtn = document.getElementById("close-map-btn");
	const dotEls = {};

	function buildDots() {
		if (!mapImg.naturalWidth) return;
		dotsLayer.textContent = "";
		Object.keys(dotEls).forEach(function (k) { delete dotEls[k]; });
		(mapData.scenes || []).forEach(function (s) {
			const d = document.createElement("button");
			d.type = "button";
			d.className = "map-dot";
			// Procent av naturlig bildstorlek -> upplösningsoberoende.
			d.style.left = (s.position.x / mapImg.naturalWidth * 100) + "%";
			d.style.top = (s.position.y / mapImg.naturalHeight * 100) + "%";
			d.title = "Scen " + s.id;
			d.addEventListener("click", function () {
				if (viewer.getScene() !== s.id) viewer.loadScene(s.id);
			});
			dotsLayer.appendChild(d);
			dotEls[s.id] = d;
		});
		markCurrent(viewer.getScene());
	}

	function markCurrent(id) {
		Object.keys(dotEls).forEach(function (k) {
			dotEls[k].classList.toggle("current", k === id);
		});
	}

	if (mapImg.complete && mapImg.naturalWidth) buildDots();
	else mapImg.addEventListener("load", buildDots);

	viewer.on("scenechange", markCurrent);

	showBtn.addEventListener("click", function () {
		container.hidden = false;
		showBtn.hidden = true;
	});
	closeBtn.addEventListener("click", function () {
		container.hidden = true;
		showBtn.hidden = false;
	});
})();
