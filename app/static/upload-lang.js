/* Uppladdningssteget: montera språkpickern och spara ENBART språkvalet
   (POST /projects/{slug}/languages) vid varje ändring - separat från
   turinställningarna på förhandsvisningssteget. */
(function () {
	"use strict";
	var container = document.getElementById("lang-picker");
	if (!container || !window.mountLangPicker) return;

	var slug = document.body.dataset.slug;
	var dataEl = document.getElementById("languages-data");
	var selected = dataEl ? JSON.parse(dataEl.textContent) : ["sv"];

	window.mountLangPicker(container, {
		selected: selected,
		onChange: function (languages) {
			apiFetch("/projects/" + encodeURIComponent(slug) + "/languages", {
				method: "POST",
				body: { languages: languages },
			}).then(function () {
				if (window.showToast) showToast("Språk sparade", "ok");
			}).catch(function (e) {
				if (window.showToast) showToast(e.message, "error");
			});
		},
	});
})();
