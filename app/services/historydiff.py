"""Semantisk diff mellan två versioner (history) av en tur.

Rå JSON-textdiff blir brusig för strukturerad data (tab-indentering, nyckel-
ordning, stora scen-/hotspot-block). Denna modul jämför i stället på ENTITETSNIVÅ
- scener, hotspots, språk, tema, branding, inställningar, kartposition/länkar - och
returnerar en JSON-serialiserbar lista av grupper med +/-/~-markerade rader som UI:t
färgkodar. Ren funktion, inga sidoeffekter.

Ändringens riktning: `diff(old, new)` beskriver hur man kom FRÅN old-läget TILL new-
läget (added = finns i new men inte old). Anroparen skickar den kronologiskt
föregående (äldre) versionen som old och den nyare som new.

`old`/`new` har formen som `history.read_version` returnerar:
{"tour.json": {...}, "map.json": {...}} - båda nycklarna kan saknas (tidig snapshot).
"""
from __future__ import annotations

from typing import Any

ADD = "added"
REMOVE = "removed"
CHANGE = "changed"

_MAX_TEXT = 60  # trunkeringslängd för textvärden i diffen


def _default_lang(tour: dict[str, Any]) -> str:
    langs = tour.get("default", {}).get("languages") or []
    return langs[0] if langs else "sv"


def _text_summary(value: Any, lang: str) -> str:
    """Läsbar kortsträng för ett textfält (str eller {kod: text} i18n-map)."""
    if value is None:
        return ""
    if isinstance(value, dict):
        # Visa default-språket om det finns, annars första icke-tomma; markera
        # att fältet är flerspråkigt.
        text = value.get(lang) or next((v for v in value.values() if v), "")
        text = _trunc(str(text))
        extra = [k for k in value if k != lang and value.get(k)]
        return f"{text} [{lang}{'+' + ','.join(extra) if extra else ''}]" if value else text
    return _trunc(str(value))


def _trunc(s: str) -> str:
    s = " ".join(s.split())  # kollapsa radbrytningar/whitespace
    return s if len(s) <= _MAX_TEXT else s[: _MAX_TEXT - 1] + "…"


def _scene_label(sid: str, scene: dict[str, Any] | None, lang: str) -> str:
    title = _text_summary(scene.get("title"), lang) if scene else ""
    return f'{title} ({sid})' if title else f"Scen {sid}"


def _hotspot_key(hs: dict[str, Any]) -> Any:
    """Matcha hotspots mellan versioner på id (det enda stabila fältet). Saknas
    id används hela hotspoten som nyckel (behandlas som unik -> add/remove)."""
    return hs.get("id", id(hs))


def _hotspot_label(hs: dict[str, Any], lang: str) -> str:
    t = hs.get("type")
    if t == "scene":
        return f"→ scen {hs.get('sceneId', '?')}"
    if t == "info":
        teaser = _text_summary(hs.get("text") or hs.get("body"), lang)
        return f"info: {teaser}" if teaser else "info"
    if t == "url":
        teaser = _text_summary(hs.get("text"), lang)
        return f"länk: {teaser}" if teaser else "länk"
    return t or "hotspot"


def _change_line(label: str, old: Any, new: Any, lang: str | None = None) -> dict:
    o = _text_summary(old, lang) if lang else _fmt(old)
    n = _text_summary(new, lang) if lang else _fmt(new)
    return {"kind": CHANGE, "text": f"{label}: {o} → {n}"}


def _hotspot_field_changes(old: dict[str, Any], new: dict[str, Any], lang: str) -> list[dict]:
    """Fältnivå-ändringar inom EN hotspot (samma id, olika innehåll)."""
    ch = []
    if old.get("text") != new.get("text"):
        ch.append(_change_line("text", old.get("text"), new.get("text"), lang))
    if old.get("body") != new.get("body"):
        ch.append(_change_line("brödtext", old.get("body"), new.get("body"), lang))
    parts = []
    if old.get("yaw") != new.get("yaw"):
        parts.append(f"yaw {_fmt(old.get('yaw'))} → {_fmt(new.get('yaw'))}")
    if old.get("pitch") != new.get("pitch"):
        parts.append(f"pitch {_fmt(old.get('pitch'))} → {_fmt(new.get('pitch'))}")
    if parts:
        ch.append({"kind": CHANGE, "text": "placering: " + ", ".join(parts)})
    if old.get("sceneId") != new.get("sceneId"):
        ch.append(_change_line("målscen", old.get("sceneId"), new.get("sceneId")))
    if old.get("targetYaw") != new.get("targetYaw") or old.get("targetPitch") != new.get("targetPitch"):
        ch.append({"kind": CHANGE, "text": "målriktning ändrad"})
    if old.get("URL") != new.get("URL"):
        ch.append(_change_line("URL", old.get("URL"), new.get("URL")))
    if old.get("langs") != new.get("langs"):
        ch.append(_change_line("visas på språk", old.get("langs"), new.get("langs")))
    if old.get("type") != new.get("type"):
        ch.append(_change_line("typ", old.get("type"), new.get("type")))
    return ch


def _diff_hotspots(old_hs: list, new_hs: list, lang: str) -> list[dict]:
    """Hotspot-noder för en scen. Ändrad hotspot får `children` med fältnivå-diff."""
    old_map = {_hotspot_key(h): h for h in old_hs if isinstance(h, dict)}
    new_map = {_hotspot_key(h): h for h in new_hs if isinstance(h, dict)}
    nodes = []
    for k, h in new_map.items():
        if k not in old_map:
            nodes.append({"kind": ADD, "text": _hotspot_label(h, lang)})
    for k, h in old_map.items():
        if k not in new_map:
            nodes.append({"kind": REMOVE, "text": _hotspot_label(h, lang)})
    for k, h in new_map.items():
        if k in old_map and old_map[k] != h:
            fields = _hotspot_field_changes(old_map[k], h, lang)
            nodes.append({"kind": CHANGE, "text": _hotspot_label(h, lang), "children": fields})
    return nodes


def _diff_scene(old: dict[str, Any], new: dict[str, Any], lang: str) -> list[dict]:
    """Children för en scen som finns i båda versionerna: scenfält + en Hotspots-
    sektion (semantisk gruppering scen > hotspot > fält)."""
    children = []
    if old.get("title") != new.get("title"):
        children.append(_change_line("titel", old.get("title"), new.get("title"), lang))
    parts = []
    if old.get("yaw") != new.get("yaw"):
        parts.append(f"yaw {_fmt(old.get('yaw'))} → {_fmt(new.get('yaw'))}")
    if old.get("pitch") != new.get("pitch"):
        parts.append(f"pitch {_fmt(old.get('pitch'))} → {_fmt(new.get('pitch'))}")
    if parts:
        children.append({"kind": CHANGE, "text": "startriktning: " + ", ".join(parts)})
    if old.get("northOffset") != new.get("northOffset"):
        children.append(_change_line("kalibrering (nordoffset)", old.get("northOffset"), new.get("northOffset")))
    if old.get("horizonRoll") != new.get("horizonRoll"):
        children.append(_change_line("horisontlutning", old.get("horizonRoll"), new.get("horizonRoll")))
    if _pano_name(old.get("panorama")) != _pano_name(new.get("panorama")):
        children.append({"kind": CHANGE, "text": "panoramabild ersatt"})
    hs = _diff_hotspots(old.get("hotSpots") or [], new.get("hotSpots") or [], lang)
    if hs:
        children.append({"kind": "section", "text": "Hotspots", "children": hs})
    return children


def _pano_name(url: Any) -> str:
    """Filnamnsdel av en panorama-URL (bytt bild = ändrat filnamn)."""
    if not url:
        return ""
    return str(url).rstrip("/").rsplit("/", 1)[-1]


def _diff_scenes(old_tour: dict, new_tour: dict, lang: str) -> list[dict]:
    old_scenes = old_tour.get("scenes", {}) or {}
    new_scenes = new_tour.get("scenes", {}) or {}
    items = []
    for sid, sc in new_scenes.items():
        if sid not in old_scenes:
            n = len(sc.get("hotSpots") or [])
            note = f" ({n} hotspot{'ar' if n != 1 else ''})" if n else ""
            items.append({"kind": ADD, "text": _scene_label(sid, sc, lang) + note})
    for sid, sc in old_scenes.items():
        if sid not in new_scenes:
            items.append({"kind": REMOVE, "text": _scene_label(sid, sc, lang)})
    for sid, sc in new_scenes.items():
        if sid in old_scenes:
            children = _diff_scene(old_scenes[sid], sc, lang)
            if children:
                # collapsible -> renderas som accordion (kan bli långt vid många hotspots).
                items.append({"kind": CHANGE, "text": _scene_label(sid, sc, lang),
                              "collapsible": True, "children": children})
    return items


def _diff_list(old: list, new: list, label: str) -> list[dict]:
    """Diff av en enkel lista av jämförbara värden (t.ex. språk-koder)."""
    old_set, new_set = set(old or []), set(new or [])
    items = []
    for v in new_set - old_set:
        items.append({"kind": ADD, "text": str(v)})
    for v in old_set - new_set:
        items.append({"kind": REMOVE, "text": str(v)})
    return items


def _diff_dict_fields(old: dict, new: dict, fields: dict[str, str]) -> list[dict]:
    """Diff av namngivna skalära fält i ett dict (fältnyckel -> visningsnamn)."""
    old, new = old or {}, new or {}
    items = []
    for key, label in fields.items():
        ov, nv = old.get(key), new.get(key)
        if ov == nv:
            continue
        if ov is None:
            items.append({"kind": ADD, "text": f"{label}: {_fmt(nv)}"})
        elif nv is None:
            items.append({"kind": REMOVE, "text": f"{label}: {_fmt(ov)}"})
        else:
            items.append({"kind": CHANGE, "text": f"{label}: {_fmt(ov)} → {_fmt(nv)}"})
    return items


def _fmt(v: Any) -> str:
    if v is None:
        return "–"  # saknat värde (t.ex. odefinierad yaw = default)
    if isinstance(v, bool):
        return "på" if v else "av"
    if isinstance(v, list):
        return ", ".join(str(x) for x in v) or "–"
    return _trunc(str(v))


def _diff_branding(old: Any, new: Any, lang: str) -> list[dict]:
    old = old if isinstance(old, dict) else ({"content": old} if old else {})
    new = new if isinstance(new, dict) else ({"content": new} if new else {})
    items = []
    if old.get("content") != new.get("content"):
        items.append({"kind": CHANGE,
                      "text": f'text: {_text_summary(old.get("content"), lang)} → {_text_summary(new.get("content"), lang)}'})
    items.extend(_diff_dict_fields(old, new, {"size": "storlek", "position": "position"}))
    return items


def _diff_map(old_map: dict, new_map: dict, new_tour: dict, old_tour: dict, lang: str) -> list[dict]:
    def positions(m):
        return {s.get("id"): (s.get("position") or {}) for s in (m.get("scenes") or [])}

    def edge_key(e):
        a, b = e.get("from"), e.get("to")
        return frozenset((a, b))

    op, np_ = positions(old_map), positions(new_map)
    new_scenes = new_tour.get("scenes", {}) or {}
    old_scenes = old_tour.get("scenes", {}) or {}
    items = []
    for sid in np_.keys() - op.keys():
        items.append({"kind": ADD, "text": f"{_scene_label(sid, new_scenes.get(sid), lang)} placerad på kartan"})
    for sid in op.keys() - np_.keys():
        items.append({"kind": REMOVE, "text": f"{_scene_label(sid, old_scenes.get(sid), lang)} borttagen från kartan"})
    for sid in np_.keys() & op.keys():
        if op[sid] != np_[sid]:
            items.append({"kind": CHANGE, "text": f"{_scene_label(sid, new_scenes.get(sid), lang)} flyttad"})

    old_edges = {edge_key(e): e for e in (old_map.get("edges") or [])}
    new_edges = {edge_key(e): e for e in (new_map.get("edges") or [])}

    def elabel(e):
        arrow = "↔" if e.get("twoway", True) else "→"
        return f'{e.get("from")} {arrow} {e.get("to")}'

    for k, e in new_edges.items():
        if k not in old_edges:
            items.append({"kind": ADD, "text": f"länk {elabel(e)}"})
    for k, e in old_edges.items():
        if k not in new_edges:
            items.append({"kind": REMOVE, "text": f"länk {elabel(e)}"})
    for k, e in new_edges.items():
        if k in old_edges and (old_edges[k].get("twoway", True) != e.get("twoway", True)
                               or old_edges[k].get("from") != e.get("from")):
            items.append({"kind": CHANGE, "text": f"länk {elabel(e)} riktning ändrad"})
    return items


def diff(old: dict[str, dict], new: dict[str, dict], *, lang: str | None = None) -> list[dict]:
    """Semantisk diff old -> new. Returnerar [{title, items:[{kind,text,sub?}]}]
    med bara icke-tomma grupper."""
    old_tour = old.get("tour.json", {}) or {}
    new_tour = new.get("tour.json", {}) or {}
    old_map = old.get("map.json", {}) or {}
    new_map = new.get("map.json", {}) or {}
    lang = lang or _default_lang(new_tour)

    old_def = old_tour.get("default", {}) or {}
    new_def = new_tour.get("default", {}) or {}

    groups = [
        ("Scener", _diff_scenes(old_tour, new_tour, lang)),
        ("Språk", _diff_list(old_def.get("languages"), new_def.get("languages"), "språk")),
        ("Tema", _diff_dict_fields(old_def.get("theme"), new_def.get("theme"),
                                   {"font": "typsnitt", "dotColor": "prickfärg", "currentColor": "aktiv prickfärg"})),
        ("Branding", _diff_branding(old_def.get("branding"), new_def.get("branding"), lang)),
        ("Inställningar", _diff_dict_fields(old_def, new_def, {
            "autoRotate": "autorotation", "autoRotateInactivityDelay": "rotationsfördröjning",
            "sceneFadeDuration": "scentoning", "firstScene": "startscen", "mapSize": "kartstorlek",
            "autoLoad": "autoladdning"})),
        ("Karta", _diff_map(old_map, new_map, new_tour, old_tour, lang)),
    ]
    return [{"title": t, "items": items} for t, items in groups if items]
