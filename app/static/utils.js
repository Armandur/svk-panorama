/* Gemensamma hjälpfunktioner: apiFetch, showToast, escapeHtml. */
(function () {
	"use strict";

	function escapeHtml(str) {
		const div = document.createElement("div");
		div.textContent = str == null ? "" : String(str);
		return div.innerHTML;
	}

	function getCsrfToken() {
		const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
		return match ? decodeURIComponent(match[1]) : "";
	}

	// Wrapper runt fetch: lägger på CSRF-header, JSON:ifierar objekt-body,
	// kastar med serverns felmeddelande om svaret inte är ok.
	async function apiFetch(url, options) {
		const opts = Object.assign({}, options || {});
		opts.headers = Object.assign({}, opts.headers || {}, {
			"X-CSRF-Token": getCsrfToken(),
		});
		if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
			opts.body = JSON.stringify(opts.body);
			opts.headers["Content-Type"] = "application/json";
		}
		const res = await fetch(url, opts);
		if (!res.ok) {
			let detail = "Något gick fel (" + res.status + ")";
			try {
				const data = await res.json();
				if (data && data.detail) {
					detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
				}
			} catch (e) {
				/* svaret var inte JSON - behåll standardmeddelandet */
			}
			throw new Error(detail);
		}
		const contentType = res.headers.get("content-type") || "";
		if (contentType.indexOf("application/json") !== -1) return res.json();
		return res.text();
	}

	function showToast(message, kind) {
		let container = document.getElementById("toast-container");
		if (!container) {
			container = document.createElement("div");
			container.id = "toast-container";
			document.body.appendChild(container);
		}
		const toast = document.createElement("div");
		toast.className = "toast" + (kind ? " toast-" + kind : "");
		toast.textContent = message;
		container.appendChild(toast);
		requestAnimationFrame(function () {
			toast.classList.add("visible");
		});
		setTimeout(function () {
			toast.classList.remove("visible");
			setTimeout(function () {
				toast.remove();
			}, 300);
		}, 3000);
	}

	window.apiFetch = apiFetch;
	window.showToast = showToast;
	window.escapeHtml = escapeHtml;
	window.getCsrfToken = getCsrfToken;
})();
