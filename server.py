import asyncio
import json
import os
import sys
from pathlib import Path

from typing import Optional
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

# Try importing agents and memory from package first, then flat
try:
    from agents.manager import ManagerAgent
    from agents.memory import memory_store
except ImportError:
    from manager import ManagerAgent
    from memory import memory_store


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


@app.on_event("startup")
async def startup_check():
    # Ensure stdout handles unicode cleanly on Windows
    try:
        if sys.stdout and hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if api_key and not api_key.startswith("your_"):
        print(f"[OK] GEMINI_API_KEY is set ({len(api_key)} chars)")
    else:
        print("[WARNING] GEMINI_API_KEY is NOT set! Agents will fail.")


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class CreateConversationRequest(BaseModel):
    title: Optional[str] = None


# ─── Serve Frontend Files Explicitly ───────────────────────────────

@app.get("/")
async def serve_root():
    f = find_file("index.html")
    if f:
        return FileResponse(str(f), media_type="text/html")
    return Response(content="index.html not found", status_code=404)


@app.get("/prototype")
@app.get("/prototype.html")
async def serve_prototype():
    f = find_file("prototype.html")
    if f:
        return FileResponse(str(f), media_type="text/html")
    return Response(content="prototype.html not found", status_code=404)


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

@app.get("/api/conversations")
async def list_conversations():
    """Return all saved conversations metadata."""
    return memory_store.list_conversations()


@app.get("/api/conversations/{session_id}")
async def get_conversation(session_id: str):
    """Retrieve complete conversation history and context."""
    conv = memory_store.get_conversation(session_id)
    if not conv:
        return Response(content=json.dumps({"error": "Conversation not found"}), status_code=404, media_type="application/json")
    return conv


@app.post("/api/conversations/new")
async def create_new_conversation(req: Optional[CreateConversationRequest] = None):
    """Create a new blank conversation session."""
    title = req.title if req else None
    conv = memory_store.create_conversation(title=title)
    return conv


@app.delete("/api/conversations/{session_id}")
async def delete_conversation(session_id: str):
    """Delete a saved conversation."""
    success = memory_store.delete_conversation(session_id)
    return {"success": success}


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    """Start the multi-agent marketing pipeline or direct manager consultation, streaming results via SSE."""
    queue: asyncio.Queue = asyncio.Queue()

    async def callback(data: dict):
        await queue.put(data)

    async def run_pipeline():
        manager = ManagerAgent()
        try:
            await manager.run_conversation_turn(request.message, callback, session_id=request.session_id)
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
