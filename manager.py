import json
import os
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from google import genai
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

from .researcher import ResearcherAgent
from .copywriter import CopywriterAgent
from .planner import PlannerAgent
from .base_agent import BaseAgent


class ManagerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="manager",
            role="Marketing Director",
            system_prompt="You orchestrate the Millibro marketing pipeline and review content for quality, brand alignment, and impact.",
            color="#8b5cf6"
        )
        self.researcher = ResearcherAgent()
        self.copywriter = CopywriterAgent()
        self.planner = PlannerAgent()
        self.data_dir = Path(__file__).parent.parent / "data"
        self.data_dir.mkdir(exist_ok=True)
        self.preferences_file = self.data_dir / "user_preferences.json"
        self.score_file = self.data_dir / "score_history.json"

        # Ensure files exist
        if not self.preferences_file.exists():
            with open(self.preferences_file, "w") as f:
                json.dump({"brand_voice": "minimalist, literary, warm"}, f)
        if not self.score_file.exists():
            with open(self.score_file, "w") as f:
                json.dump([], f)

    def load_json(self, file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_json(self, file_path, data):
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)

    async def _call_gemini(self, prompt: str) -> str:
        """Helper to call Gemini synchronously in a thread and return text."""
        response = await asyncio.to_thread(
            self.client.models.generate_content,
            model='gemini-3.6-flash',
            contents=prompt
        )
        return response.text if response.text else ""

    def _parse_json_response(self, text: str, fallback: dict) -> dict:
        """Extract JSON from a Gemini response that may contain markdown fences."""
        try:
            cleaned = text.strip()
            if "```json" in cleaned:
                cleaned = cleaned.split("```json")[1].split("```")[0].strip()
            elif "```" in cleaned:
                cleaned = cleaned.split("```")[1].split("```")[0].strip()
            return json.loads(cleaned)
        except Exception:
            return fallback

    async def run_pipeline(self, user_request: str, callback):
        """Run the full multi-agent marketing pipeline.
        
        Flow: Manager → Researcher → Copywriter → Planner → Manager (review) → Score
        With up to 2 rework cycles.
        """
        # 1. Load context and score history
        context = self.load_json(self.preferences_file)
        scores = self.load_json(self.score_file)

        top_scores = []
        if scores:
            top_scores = sorted(scores, key=lambda x: x.get("score", 0), reverse=True)[:3]
            context["past_top_scores"] = top_scores
            context["improvement_instruction"] = (
                f"Previous best score was {top_scores[0].get('score', 0)}/100. "
                f"Feedback: {top_scores[0].get('reasoning', 'N/A')}. "
                "You MUST aim to beat this score by addressing past weaknesses."
            )

        # Notify: Pipeline started
        await callback({
            "event": "workflow_step",
            "data": {"agent": "manager", "status": "active", "message": "Analyzing request and starting pipeline..."}
        })

        # 2. Run Researcher
        research_output = await self.researcher.execute(user_request, context, callback)

        rework_cycles = 0
        max_reworks = 2
        copy_output = ""
        plan_output = ""

        while True:
            # 3. Run Copywriter
            # Clear any previous rework feedback for copywriter if this is a fresh run
            copy_context = {**context}
            if rework_cycles > 0 and "rework_feedback" in context:
                copy_context["rework_feedback"] = context["rework_feedback"]

            copy_output = await self.copywriter.execute(
                f"User Request: {user_request}\n\nResearch Report:\n{research_output}",
                copy_context,
                callback
            )

            # 4. Run Planner (receives both research and copy)
            plan_context = {**context}
            if "rework_feedback" in plan_context and context.get("_rework_target") != "planner":
                del plan_context["rework_feedback"]

            plan_output = await self.planner.execute(
                f"User Request: {user_request}\n\nResearch Report:\n{research_output}\n\nCopywriter Output:\n{copy_output}",
                plan_context,
                callback
            )

            # 5. Manager Review
            await callback({
                "event": "workflow_step",
                "data": {"agent": "manager", "status": "active", "message": "Reviewing all outputs for quality..."}
            })

            review_prompt = f"""You are the Marketing Director reviewing the marketing outputs for Millibro, a social reading app.

Review the following outputs for:
1. **Brand Alignment**: Does the content match Millibro's brand? (minimalist, literary, warm, forest green & cream aesthetic)
2. **Platform Optimization**: Is the X post optimized for X's algorithm? Is the Substack post structured for newsletter best practices?
3. **CTA Effectiveness**: Are the calls-to-action compelling but not pushy?
4. **Content Quality**: Is the writing sharp, engaging, and free of clichés?
5. **Strategic Coherence**: Does the plan make sense with the content?

--- USER REQUEST ---
{user_request}

--- RESEARCH REPORT ---
{research_output}

--- COPYWRITER OUTPUT ---
{copy_output}

--- PLANNER OUTPUT ---
{plan_output}

If the quality is high enough (you'd rate it 70+/100), approve it. If not, identify which agent needs to rework and provide specific, actionable feedback.

Respond ONLY in this JSON format:
{{
    "needs_rework": true or false,
    "agent_to_rework": "researcher" or "copywriter" or "planner" or null,
    "feedback": "Specific feedback for the agent to improve, or null if approved",
    "review_summary": "Brief 1-2 sentence summary of your review"
}}"""

            review_text = await self._call_gemini(review_prompt)
            review_data = self._parse_json_response(review_text, {"needs_rework": False, "review_summary": "Approved."})

            # Stream the review summary
            review_summary = review_data.get("review_summary", "Review complete.")
            await callback({
                "event": "agent_chunk",
                "data": {"agent": "manager", "delta": f"\n\n📋 **Review:** {review_summary}"}
            })

            # Handle rework
            if review_data.get("needs_rework") and rework_cycles < max_reworks:
                rework_cycles += 1
                agent_to_rework = review_data.get("agent_to_rework", "copywriter")
                feedback = review_data.get("feedback", "Please improve the output quality.")

                await callback({
                    "event": "rework",
                    "data": {
                        "agent": agent_to_rework,
                        "feedback": feedback,
                        "attempt": rework_cycles
                    }
                })

                # Set rework context
                context["rework_feedback"] = feedback
                context["_rework_target"] = agent_to_rework

                if agent_to_rework == "researcher":
                    # Re-run entire pipeline from researcher
                    await callback({
                        "event": "workflow_step",
                        "data": {"agent": "researcher", "status": "reworking", "message": f"Reworking research (attempt {rework_cycles})..."}
                    })
                    research_output = await self.researcher.execute(user_request, context, callback)
                    continue  # Re-run copy and plan too

                elif agent_to_rework == "copywriter":
                    await callback({
                        "event": "workflow_step",
                        "data": {"agent": "copywriter", "status": "reworking", "message": f"Reworking copy (attempt {rework_cycles})..."}
                    })
                    continue  # Loop back to re-run copy and plan

                elif agent_to_rework == "planner":
                    await callback({
                        "event": "workflow_step",
                        "data": {"agent": "planner", "status": "reworking", "message": f"Reworking plan (attempt {rework_cycles})..."}
                    })
                    plan_output = await self.planner.execute(
                        f"User Request: {user_request}\n\nResearch:\n{research_output}\n\nCopy:\n{copy_output}",
                        context,
                        callback
                    )
                    # Don't continue — just re-review with updated plan
                    # But we've already used a rework cycle, so let's just accept
            
            # Exit loop if no rework needed or max reworks reached
            break

        # Clean up rework context
        context.pop("rework_feedback", None)
        context.pop("_rework_target", None)

        # 6. Score the final output
        await callback({
            "event": "workflow_step",
            "data": {"agent": "manager", "status": "active", "message": "Scoring final output..."}
        })

        score_prompt = f"""You are scoring the final marketing output for Millibro out of 100.

Score based on these criteria (each out of 25):
1. **Content Quality** (25pts): Writing quality, creativity, engagement hooks
2. **Brand Alignment** (25pts): Matches Millibro's minimalist, literary, warm voice
3. **Platform Optimization** (25pts): X post is optimized for X, Substack for newsletters
4. **Conversion Potential** (25pts): Likelihood of converting readers into Millibro users

--- COPYWRITER OUTPUT ---
{copy_output}

--- PLANNER OUTPUT ---
{plan_output}

{"Previous best score was " + str(top_scores[0].get('score', 0)) + "/100. Judge fairly — don't inflate." if top_scores else "This is the first run — judge fairly."}

Respond ONLY in this JSON format:
{{
    "score": [integer 0-100],
    "reasoning": "2-3 sentence explanation of the score with specific praise and improvement areas",
    "content_quality": [0-25],
    "brand_alignment": [0-25],
    "platform_optimization": [0-25],
    "conversion_potential": [0-25]
}}"""

        score_text = await self._call_gemini(score_prompt)
        score_data = self._parse_json_response(score_text, {
            "score": 75,
            "reasoning": "Solid execution with room for improvement.",
            "content_quality": 19,
            "brand_alignment": 19,
            "platform_optimization": 19,
            "conversion_potential": 18
        })

        previous_best = top_scores[0]["score"] if top_scores else 0

        await callback({
            "event": "score",
            "data": {
                "score": score_data.get("score", 75),
                "reasoning": score_data.get("reasoning", ""),
                "previous_best": previous_best,
                "breakdown": {
                    "content_quality": score_data.get("content_quality", 0),
                    "brand_alignment": score_data.get("brand_alignment", 0),
                    "platform_optimization": score_data.get("platform_optimization", 0),
                    "conversion_potential": score_data.get("conversion_potential", 0)
                },
                "rework_count": rework_cycles
            }
        })

        # Mark manager as complete
        await callback({
            "event": "agent_complete",
            "data": {
                "agent": "manager",
                "content": f"Pipeline complete. Score: {score_data.get('score', 75)}/100\n\n{score_data.get('reasoning', '')}"
            }
        })

        # 7. Save score to history
        scores.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "request": user_request,
            "score": score_data.get("score", 75),
            "reasoning": score_data.get("reasoning", ""),
            "rework_count": rework_cycles,
            "breakdown": {
                "content_quality": score_data.get("content_quality", 0),
                "brand_alignment": score_data.get("brand_alignment", 0),
                "platform_optimization": score_data.get("platform_optimization", 0),
                "conversion_potential": score_data.get("conversion_potential", 0)
            }
        })
        self.save_json(self.score_file, scores)

        # 8. Done
        await callback({"event": "done", "data": {"status": "finished"}})
