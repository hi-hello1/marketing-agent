import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, Response
from pydantic import BaseModel

# Load environment variables (optional - on Render, env vars are set directly)
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    load_dotenv(dotenv_path=env_file)

# Base directory (where server.py lives)
BASE_DIR = Path(__file__).parent

# Add to sys.path so flat imports work
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Try importing agents from package first, then flat
try:
    from agents.manager import ManagerAgent
except ImportError:
    from manager import ManagerAgent


def find_file(filename):
    """Find a file in either the static/ subfolder or the root (flat layout)."""
    # Check static/ subfolder first (local dev)
    candidate = BASE_DIR / "static" / filename
    if candidate.exists():
        return candidate
    # Check root (flat layout on Render)
    candidate = BASE_DIR / filename
    if candidate.exists():
        return candidate
    return None


def find_data_file(filename):
    """Find a data file in either the data/ subfolder or the root."""
    candidate = BASE_DIR / "data" / filename
    if candidate.exists():
        return candidate
    candidate = BASE_DIR / filename
    if candidate.exists():
        return candidate
    return None


app = FastAPI(title="Millibro Marketing Agent System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


# ─── Serve Frontend Files Explicitly ───────────────────────────────

@app.get("/")
async def serve_root():
    f = find_file("index.html")
    if f:
        return FileResponse(str(f), media_type="text/html")
    return Response(content="index.html not found", status_code=404)


@app.get("/styles.css")
@app.get("/static/styles.css")
async def serve_css():
    f = find_file("styles.css")
    if f:
        return FileResponse(str(f), media_type="text/css")
    return Response(content="styles.css not found", status_code=404)


@app.get("/app.js")
@app.get("/static/app.js")
async def serve_js():
    f = find_file("app.js")
    if f:
        return FileResponse(str(f), media_type="application/javascript")
    return Response(content="app.js not found", status_code=404)


# ─── API Endpoints ─────────────────────────────────────────────────

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    """Start the multi-agent marketing pipeline and stream results via SSE."""
    queue: asyncio.Queue = asyncio.Queue()

    async def callback(data: dict):
        await queue.put(data)

    async def run_pipeline():
        manager = ManagerAgent()
        try:
            await manager.run_pipeline(request.message, callback)
        except Exception as e:
            import traceback
            traceback.print_exc()
            await queue.put({
                "event": "workflow_step",
                "data": {"agent": "system", "status": "error", "message": f"Pipeline error: {str(e)}"}
            })
            await queue.put({"event": "done", "data": {"status": "error", "error": str(e)}})

    asyncio.create_task(run_pipeline())

    async def event_generator():
        while True:
            try:
                data = await asyncio.wait_for(queue.get(), timeout=300)
                event_type = data.get("event", "message")
                event_data = json.dumps(data.get("data", {}))
                yield f"event: {event_type}\ndata: {event_data}\n\n"
                if event_type == "done":
                    break
            except asyncio.TimeoutError:
                yield f"event: keepalive\ndata: {{}}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/history")
async def get_history():
    """Return the score history."""
    f = find_data_file("score_history.json")
    if f and f.exists():
        with open(f, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return []
