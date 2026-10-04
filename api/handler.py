"""Vercel's file-based Python ASGI function. The UI keeps its existing /api URLs."""
from backend.app import app

__all__ = ["app"]
