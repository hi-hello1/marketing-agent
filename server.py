import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Load environment variables (optional - on Render, env vars are set directly)
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    load_dotenv(dotenv_path=env_file)

# Determine the base directory (where server.py lives)
BASE_DIR = Path(__file__).parent

# Support both folder structures:
#   LOCAL:  static/index.html, agents/, data/
#   RENDER: index.html, *.py, *.json all flat in same dir
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"

# If "static" folder doesn't exist, serve files from the root (flat layout)
if not STATIC_DIR.exists():
    STATIC_DIR = BASE_DIR

if not DATA_DIR.exists():
    DATA_DIR = BASE_DIR

# Add parent to path so we can import agents whether flat or nested
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Try importing agents from package first, then flat
try:
    from agents.manager import ManagerAgent
except ImportError:
    from manager import ManagerAgent

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

    # Launch pipeline as background task
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
    score_file = DATA_DIR / "score_history.json"
    if score_file.exists():
        with open(score_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


# Serve the frontend — root serves index.html
@app.get("/")
async def serve_root():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"error": "index.html not found"}


# Serve static CSS/JS files at /static/ paths
# For flat layout, these files are in the same dir as server.py
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
