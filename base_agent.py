import os
import json
import asyncio
import time
import random
from pathlib import Path
from dotenv import load_dotenv

# Load .env (optional - on Render, env vars are set directly)
_env_file = Path(__file__).parent / ".env"
if not _env_file.exists():
    _env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    load_dotenv(dotenv_path=_env_file)

from google import genai

# Production-grade Model Cascade:
# Starts with highly stable gemini-2.5-flash and automatically falls back on transient 503/429 spikes
DEFAULT_MODELS = [
    os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-flash-latest",
]
MODELS_CASCADE = list(dict.fromkeys(DEFAULT_MODELS))


class BaseAgent:
    def __init__(self, name: str, role: str, system_prompt: str, color: str):
        self.name = name
        self.role = role
        self.system_prompt = system_prompt
        self.color = color
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key or api_key.startswith("your_"):
            raise ValueError(
                "GEMINI_API_KEY is not set. Please update your .env file or set the environment variable."
            )
        self.client = genai.Client(api_key=api_key)

    async def execute(self, input_data: str, context: dict, callback) -> str:
        """Execute the agent's task with streaming output, auto-retry on 503/429, and model fallback."""
        rework_note = ""
        if "rework_feedback" in context:
            rework_note = f"\n\n⚠️ REWORK REQUIRED: The manager reviewed your previous output and sent it back with this feedback:\n{context['rework_feedback']}\nPlease address ALL of the feedback points and improve your output significantly."

        score_context = ""
        if "past_top_scores" in context:
            scores_summary = "\n".join(
                [f"- Score {s.get('score', 'N/A')}/100: {s.get('reasoning', 'No details')}"
                 for s in context["past_top_scores"]]
            )
            best = context["past_top_scores"][0].get("score", 0) if context["past_top_scores"] else 0
            score_context = f"\n\n📊 PAST PERFORMANCE (aim to beat {best}/100):\n{scores_summary}"

        prompt = f"""{self.system_prompt}

--- PRODUCT CONTEXT ---
{json.dumps(context, indent=2, default=str)}

--- YOUR TASK ---
{input_data}{rework_note}{score_context}"""

        await callback({
            "event": "workflow_step",
            "data": {
                "agent": self.name,
                "status": "active",
                "message": f"{self.role} is working..."
            }
        })

        full_content = ""
        last_error = None
        success = False

        for model_idx, model in enumerate(MODELS_CASCADE):
            for attempt in range(3):
                try:
                    current_attempt_content = ""
                    # If this is a retry attempt, inform user via callback message
                    if attempt > 0 or model_idx > 0:
                        retry_msg = f"{self.role} is working ({model}, attempt {attempt + 1}/3)..."
                        await callback({
                            "event": "workflow_step",
                            "data": {
                                "agent": self.name,
                                "status": "active",
                                "message": retry_msg
                            }
                        })

                    stream = await asyncio.to_thread(
                        self.client.models.generate_content_stream,
                        model=model,
                        contents=prompt
                    )

                    for chunk in stream:
                        if chunk.text:
                            text_chunk = chunk.text
                            current_attempt_content += text_chunk
                            await callback({
                                "event": "agent_chunk",
                                "data": {"agent": self.name, "delta": text_chunk}
                            })

                    full_content = current_attempt_content
                    if full_content.strip():
                        success = True
                        break

                except Exception as e:
                    last_error = e
                    err_str = str(e).lower()
                    is_transient = any(term in err_str for term in [
                        "503", "unavailable", "high demand", "429", "resource_exhausted", "timeout", "timed out", "reset"
                    ])

                    print(f"[{self.name}] Transient error on model {model} (attempt {attempt + 1}/3): {e}")

                    if is_transient and attempt < 2:
                        delay = (1.5 * (2 ** attempt)) + random.uniform(0.1, 0.4)
                        await asyncio.sleep(delay)
                        continue
                    else:
                        # Move on to the next model in cascade
                        break

            if success:
                break

        if not success:
            error_msg = f"Error during {self.name} execution: {str(last_error)}"
            full_content = error_msg
            await callback({
                "event": "agent_chunk",
                "data": {"agent": self.name, "delta": f"\n\n❌ {error_msg}"}
            })

        await callback({
            "event": "agent_complete",
            "data": {"agent": self.name, "content": full_content}
        })

        return full_content
