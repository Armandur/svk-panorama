"""Cross-tour-hotspots: resolvera en tur-REFERENS till en konkret URL per visnings-
kontext.

En scen-hotspot kan bära `tourRef = {slug, scene?}` i stället för en rå `URL`. Den
renderas som en scen-pil men navigerar till en ANNAN tur. Servern injicerar en färdig
`URL` (pannellum-nativ) i SERVERINGS-kopian av turen före rendering - precis som
asset-paths skrivs om i viewer.py/public.py/bundle.py. Deep-link till en scen görs med
HASH (`#scene=`), eftersom viewern läser hash och inte query.

URL:en beror på kontext:
- `view`   -> `/projects/<slug>/view#scene=N`      (inloggad runtime)
- `share`  -> `/s/<token>#scene=N`                 (målturens share_token; None om odelad)
- `bundle` -> `../<slug>/index.html#scene=N`       (sibling-mapp-konvention)

Se projekt-doc "Design: cross-tour tur-referens + URL-resolver" (TASK-28). Designval
2026-07-17: A=slug, B=sibling-mappar, C=odelad måltur -> utelämna länk, D=egna/team.
"""
from __future__ import annotations

from urllib.parse import quote


def _frag(scene) -> str:
    return f"#scene={quote(str(scene))}" if scene not in (None, "") else ""


def resolve_tour_ref(ref: dict, context: str, *, share_token: str | None = None) -> str | None:
    """tourRef {slug, scene?} -> URL för `context`, eller None om olänkbar (t.ex. odelad
    måltur i share-kontext). `share_token` = MÅLTURENS token (bara relevant för share)."""
    slug = (ref or {}).get("slug")
    if not slug:
        return None
    frag = _frag(ref.get("scene"))
    if context == "view":
        return f"/projects/{slug}/view{frag}"
    if context == "bundle":
        return f"../{slug}/index.html{frag}"
    if context == "share":
        return f"/s/{share_token}{frag}" if share_token else None
    return None


def apply_tour_links(tour: dict, context: str, *, share_token_of=None) -> dict:
    """Muterar en SERVERINGS-kopia av `tour`: för varje scen-hotspot med `tourRef`, sätt
    `URL` = resolverad URL (eller ta bort länkbarheten om None) och droppa `tourRef` ur den
    serverade turen (intern metadata, inte till pannellum). Hotspots UTAN tourRef (inkl. rå
    URL-länkar) rörs inte. `share_token_of(slug) -> token|None` krävs i share-kontext.

    Returnerar antal utelämnade länkar (olänkbara mål) via `tour`-oberoende - kallaren kan
    räkna själv vid behov; här muteras bara turen."""
    for scene in tour.get("scenes", {}).values():
        for hs in scene.get("hotSpots", []):
            ref = hs.get("tourRef")
            if not ref:
                continue
            token = share_token_of(ref.get("slug")) if (context == "share" and share_token_of) else None
            url = resolve_tour_ref(ref, context, share_token=token)
            if url:
                hs["URL"] = url
                hs.setdefault("attributes", {"target": "_self"})
            else:
                hs.pop("URL", None)       # olänkbar -> bara scen-pilen, ingen navigering
                hs.pop("attributes", None)
            hs.pop("tourRef", None)
    return tour


def unresolved_share_targets(tour: dict, share_token_of) -> list[str]:
    """Måltur-slugs som en tourRef pekar på men som INTE är delade (saknar token) -> länken
    utelämnas i /s-kontext. För readiness-varning inför delning (designval C)."""
    out: list[str] = []
    for scene in tour.get("scenes", {}).values():
        for hs in scene.get("hotSpots", []):
            ref = hs.get("tourRef")
            if ref and ref.get("slug") and not share_token_of(ref["slug"]):
                if ref["slug"] not in out:
                    out.append(ref["slug"])
    return out
