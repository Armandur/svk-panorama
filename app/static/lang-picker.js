/* Återanvändbar språkval-picker: bock + dra-och-släpp-ordna lista över de 6
   stödda språken (LANG_NAMES/langFlag i markdown.js). Ordning bland de
   ikryssade = prioritet, först i listan = turens standardspråk. Minst ett
   språk måste förbli ikryssat. Extraherad ur tour-preview.js så samma UI kan
   monteras på uppladdningssteget.

   window.mountLangPicker(container, opts):
     opts.selected  - ikryssade koder i ordning (default ["sv"])
     opts.onChange  - fn(orderedSelectedKoder) - anropas vid varje bock- eller
                       ordningsändring
   Returnerar { setSelected(list), getSelected() }. */
(function () {
	"use strict";

	window.mountLangPicker = function (container, opts) {
		opts = opts || {};
		var onChange = typeof opts.onChange === "function" ? opts.onChange : function () {};
		var LANG_ORDER = Object.keys(window.LANG_NAMES || { sv: 1 });
		var selected = (Array.isArray(opts.selected) && opts.selected.length) ? opts.selected.slice() : ["sv"];
		var workOrder = selected.concat(LANG_ORDER.filter(function (c) { return selected.indexOf(c) === -1; }));
		var draggingRow = null;

		function render() {
			container.innerHTML = "";
			workOrder.forEach(function (code) {
				var checked = selected.indexOf(code) !== -1;
				var row = document.createElement("div");
				row.className = "lang-order-row";
				row.draggable = true;
				row.dataset.lang = code;

				var handle = document.createElement("span");
				handle.className = "lang-order-handle";
				handle.setAttribute("aria-hidden", "true");
				handle.title = "Dra för att ändra ordning";
				handle.textContent = "≡";
				row.appendChild(handle);

				var cb = document.createElement("input");
				cb.type = "checkbox";
				cb.checked = checked;
				cb.addEventListener("change", function () { onCheckboxChange(cb); });
				row.appendChild(cb);

				var flag = document.createElement("img");
				flag.className = "lang-order-flag";
				flag.src = window.langFlag ? window.langFlag(code) : "";
				flag.alt = "";
				row.appendChild(flag);

				var name = document.createElement("span");
				name.className = "lang-order-name";
				name.textContent = (window.LANG_NAMES && window.LANG_NAMES[code]) || code;
				row.appendChild(name);

				var idx = selected.indexOf(code);
				if (idx !== -1) {
					var badge = document.createElement("span");
					badge.className = "lang-badge" + (idx === 0 ? " lang-badge-default" : "");
					badge.textContent = idx === 0 ? "standard" : String(idx + 1);
					row.appendChild(badge);
				}

				row.addEventListener("dragstart", onDragStart);
				row.addEventListener("dragend", onDragEnd);
				row.addEventListener("dragover", onDragOver);
				container.appendChild(row);
			});
		}

		function onDragStart(e) {
			draggingRow = this;
			this.classList.add("dragging");
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				try { e.dataTransfer.setData("text/plain", this.dataset.lang); } catch (err) { /* Firefox kräver setData */ }
			}
		}
		function onDragOver(e) {
			e.preventDefault();
			if (!draggingRow || draggingRow === this) return;
			var rect = this.getBoundingClientRect();
			var before = (e.clientY - rect.top) < rect.height / 2;
			container.insertBefore(draggingRow, before ? this : this.nextSibling);
		}
		function onDragEnd() {
			if (draggingRow) draggingRow.classList.remove("dragging");
			draggingRow = null;
			commitOrder();
			render();
			fireChange();
		}
		container.addEventListener("dragover", function (e) {
			if (!draggingRow) return;
			e.preventDefault();
			if (e.target === container) container.appendChild(draggingRow);
		});

		function commitOrder() {
			workOrder = Array.prototype.map.call(container.children, function (r) { return r.dataset.lang; });
			selected = workOrder.filter(function (code) {
				var row = container.querySelector('.lang-order-row[data-lang="' + code + '"]');
				var cb = row && row.querySelector("input[type=checkbox]");
				return cb && cb.checked;
			});
		}
		function onCheckboxChange(cb) {
			if (!cb.checked) {
				var stillChecked = Array.prototype.some.call(container.querySelectorAll("input[type=checkbox]"), function (c) { return c.checked; });
				if (!stillChecked) {
					cb.checked = true;
					if (window.showToast) showToast("Minst ett språk måste vara valt.", "error");
					return;
				}
			}
			commitOrder();
			render();
			fireChange();
		}
		function fireChange() { onChange(selected.slice()); }

		render();
		return {
			setSelected: function (list) {
				selected = (Array.isArray(list) && list.length) ? list.slice() : ["sv"];
				workOrder = selected.concat(LANG_ORDER.filter(function (c) { return selected.indexOf(c) === -1; }));
				render();
			},
			getSelected: function () { return selected.slice(); },
		};
	};
})();
