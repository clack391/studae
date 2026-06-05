"""Ownership checks for entities referenced by their UUID.

The backend uses the service-role Supabase client, which bypasses Row Level
Security. Without explicit user_id filtering, a malicious client holding
a valid JWT could read another user's data just by guessing IDs (a classic
IDOR — Insecure Direct Object Reference — vulnerability).

Every endpoint that takes an entity ID in the URL or body MUST verify that
the caller owns that entity. These helpers raise HTTP 404 on a miss so the
existence of the entity itself isn't leaked.
"""
from fastapi import HTTPException

from .clients import supabase


def _require(table: str, entity_id: str, user_id: str, name: str):
    rows = supabase.table(table).select("id") \
        .eq("id", entity_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail=f"{name} not found")


def require_document(document_id: str, user_id: str):
    _require("documents", document_id, user_id, "document")


def require_session(session_id: str, user_id: str):
    _require("chat_sessions", session_id, user_id, "session")


def require_assessment(assessment_id: str, user_id: str):
    _require("assessments", assessment_id, user_id, "assessment")


def require_focus_area(focus_area_id: str, user_id: str):
    _require("focus_areas", focus_area_id, user_id, "focus area")
