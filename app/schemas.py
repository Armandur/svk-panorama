"""Pydantic-scheman för JSON-endpoints."""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ScenePosition(BaseModel):
    x: int
    y: int


class MapScene(BaseModel):
    id: str
    position: ScenePosition


class MapPayload(BaseModel):
    """Body för POST /projects/{slug}/map - skrivs rakt av till map.json."""

    scenes: list[MapScene] = Field(default_factory=list)
    edges: list[list[str]] = Field(default_factory=list)

    @field_validator("edges")
    @classmethod
    def edges_har_tva_andar(cls, v: list[list[str]]) -> list[list[str]]:
        for edge in v:
            if len(edge) != 2:
                raise ValueError("varje länk måste ha exakt två scen-id:n")
        return v
