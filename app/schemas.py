"""Pydantic-scheman för JSON-endpoints."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ScenePosition(BaseModel):
    x: int
    y: int


class MapScene(BaseModel):
    id: str
    position: ScenePosition


class MapEdge(BaseModel):
    """Länk mellan två scener. twoway=True saknar riktning (dubbelriktad),
    twoway=False är enkelriktad from -> to."""

    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    twoway: bool = True


class MapPayload(BaseModel):
    """Body för POST /projects/{slug}/map - skrivs till map.json."""

    scenes: list[MapScene] = Field(default_factory=list)
    edges: list[MapEdge] = Field(default_factory=list)
