#!/usr/bin/env python
"""Run the FastAPI backend server for the Urban Planner Dataset Assistant."""

import uvicorn

if __name__ == "__main__":
    # Run on port 8000 for backend
    # React frontend runs on http://localhost:5173 (Vite default)
    uvicorn.run(
        "app.api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
