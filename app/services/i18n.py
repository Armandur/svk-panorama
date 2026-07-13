"""Flerspråkiga UI-strängar som inte hör hemma i presets.py (tema-/branding-
sanering av turdata). Just nu bara OG-beskrivningen som visas i länkförhandsvisningar
(delningskort) - vald efter turens DEFAULT-språk (`tour.default.languages[0]`)."""
from __future__ import annotations

from app import config

_OG_DESCRIPTIONS = {
    "sv": "Utforska {name} i en virtuell 360-rundtur.",
    "en": "Explore {name} in a virtual 360 tour.",
    "de": "Entdecken Sie {name} in einer virtuellen 360-Grad-Tour.",
    "fi": "Tutustu kohteeseen {name} virtuaalisella 360-kierroksella.",
    "no": "Utforsk {name} i en virtuell 360-omvisning.",
    "da": "Udforsk {name} i en virtuel 360-rundvisning.",
}


def og_description(name: str, lang: str) -> str:
    """OG-beskrivning på `lang` (fallback DEFAULT_LANGUAGE om okänd kod)."""
    template = _OG_DESCRIPTIONS.get(lang) or _OG_DESCRIPTIONS[config.DEFAULT_LANGUAGE]
    return template.format(name=name)


def tour_default_lang(tour: dict) -> str:
    """Turens default-språk: första koden i `tour.default.languages`, annars
    DEFAULT_LANGUAGE (äldre turer saknar fältet helt)."""
    langs = (tour.get("default") or {}).get("languages") or []
    return langs[0] if langs else config.DEFAULT_LANGUAGE


def hotspot_in_lang(hs: dict, lang: str) -> bool:
    """Ska denna hotspot visas på `lang`? hs["langs"] = valfri lista begränsade
    språkkoder, satt via "Visa på språk" i hotspot-modalen (scene.js).
    Saknas/tom lista = visas på ALLA språk (bakåtkompatibelt, default för
    hotspots utan fältet). JS-spegel: static/markdown.js window.hotspotInLang
    - håll dem i synk."""
    langs = hs.get("langs") if isinstance(hs, dict) else None
    if not isinstance(langs, list) or not langs:
        return True
    return lang in langs
