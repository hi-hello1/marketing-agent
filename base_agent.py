import os
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the project root (optional - on Render, env vars are set directly)
_env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    load_dotenv(dotenv_path=_env_file)

from google import genai


class BaseAgent:
    def __init__(self, name: str, role: str, system_prompt: str, color: str):
        self.name = name
        self.role = role
        self.system_prompt = system_prompt
        self.color = color
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key or api_key.startswith("your_"):
            raise ValueError(
                f"GEMINI_API_KEY is not set. Please update your .env file."
            )
        self.client = genai.Client(api_key=api_key)

    async def execute(self, input_data: str, context: dict, callback) -> str:
        """Execute the agent's task with streaming output.
        
        Args:
            input_data: The input text/prompt for this agent
            context: Dict containing user_preferences and past scores
            callback: Async function to emit SSE events
            
        Returns:
            The full generated text content
        """
        # Build the prompt with system instruction + context + input
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

        try:
            # Run the streaming call in a thread since the SDK is synchronous
            stream = await asyncio.to_thread(
                self.client.models.generate_content_stream,
                model='gemini-3.6-flash',
                contents=prompt
            )

            # Iterate over chunks (synchronous iterator from thread)
            for chunk in stream:
                if chunk.text:
                    text_chunk = chunk.text
                    full_content += text_chunk
                    await callback({
                        "event": "agent_chunk",
                        "data": {"agent": self.name, "delta": text_chunk}
                    })

        except Exception as e:
            error_msg = f"Error during {self.name} execution: {str(e)}"
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
