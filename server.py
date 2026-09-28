import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, Response
from pydantic import BaseModel

# Load environment variables (optional - on Render, env vars are set directly)
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    load_dotenv(dotenv_path=env_file)

BASE_DIR = Path(__file__).parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

try:
    from agents.manager import ManagerAgent
except ImportError:
    from manager import ManagerAgent


def find_file(filename):
    for candidate in (BASE_DIR / "static" / filename, BASE_DIR / filename):
        if candidate.exists():
            return candidate
    return None


def find_data_file(filename):
    for candidate in (BASE_DIR / "data" / filename, BASE_DIR / filename):
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
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if api_key and not api_key.startswith("your_"):
        print(f"✅ GEMINI_API_KEY is set ({len(api_key)} chars)")
    else:
        print("❌ WARNING: GEMINI_API_KEY is NOT set! Agents will fail.")


class ChatRequest(BaseModel):
    message: str


@app.api_route("/", methods=["GET", "HEAD"])
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


@app.get("/health")
async def health():
    api_key = os.environ.get("GEMINI_API_KEY", "")
    return {
        "status": "ok",
        "gemini_configured": bool(api_key and not api_key.startswith("your_")),
        "model": "gemini-3.5-flash",
    }


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    message = (request.message or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message cannot be empty.")

    queue: asyncio.Queue = asyncio.Queue()

    async def callback(data: dict):
        await queue.put(data)

    async def run_pipeline():
        try:
            manager = ManagerAgent()
            await manager.run_pipeline(message, callback)
        except Exception as e:
            import traceback
            traceback.print_exc()
            await queue.put({
                "event": "workflow_step",
                "data": {"agent": "system", "status": "error", "message": f"Pipeline error: {str(e)}"},
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
                yield "event: keepalive\ndata: {}\n\n"

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
    f = find_data_file("score_history.json")
    if not f or not f.exists():
        return []
    try:
        with open(f, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []
