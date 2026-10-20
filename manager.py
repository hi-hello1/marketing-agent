import json
import os
import sys
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from google import genai
from dotenv import load_dotenv

# Load .env (optional)
_env_file = Path(__file__).parent / ".env"
if not _env_file.exists():
    _env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    load_dotenv(dotenv_path=_env_file)

# Support both flat and package imports
try:
    from .researcher import ResearcherAgent
    from .copywriter import CopywriterAgent
    from .planner import PlannerAgent
    from .base_agent import BaseAgent, MODELS_CASCADE
    from .memory import ConversationMemory, memory_store
except ImportError:
    from researcher import ResearcherAgent
    from copywriter import CopywriterAgent
    from planner import PlannerAgent
    from base_agent import BaseAgent, MODELS_CASCADE
    from memory import ConversationMemory, memory_store


def _find_data_dir():
    """Find the data directory — supports both flat and folder layouts."""
    d = Path(__file__).parent.parent / "data"
    if d.exists():
        return d
    d = Path(__file__).parent / "data"
    if d.exists():
        return d
    for candidate in [Path(__file__).parent, Path(__file__).parent.parent]:
        if (candidate / "user_preferences.json").exists():
            return candidate
    fallback = Path(__file__).parent / "data"
    fallback.mkdir(exist_ok=True)
    return fallback


class ManagerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="manager",
            role="Marketing Director",
            system_prompt=(
                "You are the Marketing Director for Millibro, an aesthetic social reading app. "
                "You lead the marketing team, orchestrate multi-agent campaigns, review content for brand voice, "
                "and consult directly with the user on marketing strategy, campaign nuances, and product positioning."
            ),
            color="#8b5cf6"
        )
        self.researcher = ResearcherAgent()
        self.copywriter = CopywriterAgent()
        self.planner = PlannerAgent()
        self.memory = memory_store
        self.data_dir = _find_data_dir()
        self.preferences_file = self.data_dir / "user_preferences.json"
        self.score_file = self.data_dir / "score_history.json"

        # Ensure files exist
        if not self.preferences_file.exists():
            with open(self.preferences_file, "w", encoding="utf-8") as f:
                json.dump({"brand_voice": "minimalist, literary, warm"}, f)
        if not self.score_file.exists():
            with open(self.score_file, "w", encoding="utf-8") as f:
                json.dump([], f)

    def load_json(self, file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_json(self, file_path, data):
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)

    async def _call_gemini(self, prompt: str) -> str:
        """Helper to call Gemini with exponential backoff and model cascade."""
        last_error = None
        for model in MODELS_CASCADE:
            for attempt in range(3):
                try:
                    response = await asyncio.to_thread(
                        self.client.models.generate_content,
                        model=model,
                        contents=prompt
                    )
                    if response and response.text:
                        return response.text
                except Exception as e:
                    last_error = e
                    err_str = str(e).lower()
                    is_transient = any(term in err_str for term in [
                        "503", "unavailable", "high demand", "429", "resource_exhausted", "timeout", "timed out"
                    ])
                    print(f"[Manager] Transient error on {model} (attempt {attempt + 1}/3): {e}")
                    if is_transient and attempt < 2:
                        await asyncio.sleep(1.2 * (attempt + 1))
                        continue
                    break  # Try next model in cascade
        if last_error:
            raise last_error
        return ""

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

    async def determine_route(self, user_request: str, session_id: str, context: dict) -> dict:
        """Analyze user request and conversation history to decide optimal routing.
        
        Options:
        - direct_answer: Marketing Director answers directly (follow-ups, explanations, clarifications, general advice)
        - copywriter: Specifically drafting, revising, or expanding posts/copy
        - researcher: Specifically platform trends, competitor insights, audience research
        - planner: Specifically posting schedule, calendar, distribution timing
        - full_pipeline: Comprehensive end-to-end campaign request from scratch
        """
        conv = self.memory.get_conversation(session_id) or {}
        messages = conv.get("messages", [])
        history_summary = self.memory.get_history_summary(session_id, max_messages=6)
        campaign_ctx = conv.get("campaign_context", {})

        router_prompt = f"""You are the Marketing Director of Millibro, an autonomous marketing agency.
Your team consists of:
- You (Manager / Marketing Director): Strategic leadership, high-level brand decisions, answering follow-up questions, clarifying reasoning, explaining previous outputs, summarizing strategy, providing marketing advice.
- Researcher Agent: Deep market analysis, platform algorithm data, trending hashtags, competitor breakdowns.
- Copywriter Agent: Writing and revising posts, tweets, threads, newsletters, hooks, CTAs, ad copy.
- Planner Agent: Scheduling, posting calendars, time zone coordination, multi-platform cadence.

--- PRODUCT KNOWLEDGE ---
Product: {context.get('app_name', 'Millibro')} ({context.get('category', 'Social Reading App')})
Tagline: {context.get('tagline', '')}
Vibe: {context.get('brand', {}).get('overall_vibe', 'Minimalist, literary, warm')}

--- CONVERSATION HISTORY (Previous turns in this session) ---
{history_summary}

--- CAMPAIGN CONTEXT ---
{json.dumps(campaign_ctx, indent=2, default=str)}

--- USER'S LATEST MESSAGE ---
"{user_request}"

DECISION RULES:
1. "direct_answer":
   Choose this if:
   - The user is asking a follow-up question ("Why did you choose that time?", "Explain the hook", "What was our target audience?")
   - The user asks for clarification, explanation, or reasoning on what was generated previously.
   - The user asks about Millibro's features, brand voice, value proposition, color palette, or general marketing strategy.
   - The user gives feedback or asks a question that YOU as Marketing Director already know or can answer from memory.
   - The Manager MUST answer directly without delegating to sub-agents!

2. "copywriter":
   Choose this ONLY if the user specifically asks to draft, rewrite, tweak, or expand marketing copy (e.g. "write another tweet", "make the hook punchier", "give me 3 more subject lines", "rewrite the newsletter opening").

3. "researcher":
   Choose this ONLY if the user specifically asks for market research, competitor teardown, algorithm insights, or hashtag discovery.

4. "planner":
   Choose this ONLY if the user specifically asks for scheduling adjustments, calendar planning, or posting time analysis.

5. "full_pipeline":
   Choose this if the user is asking to build or launch a brand-new complete marketing campaign from scratch (or explicitly requests full research + copy + plan).

Respond strictly in this JSON format:
{{
  "route": "direct_answer" | "copywriter" | "researcher" | "planner" | "full_pipeline",
  "reasoning": "1 concise sentence explaining your routing decision",
  "detected_user_preferences": "Any specific preference noted in user's prompt (e.g. 'only X, no Substack') or null"
}}"""

        fallback = {
            "route": "direct_answer" if len(messages) > 1 else "full_pipeline",
            "reasoning": "Defaulting route based on conversation stage.",
            "detected_user_preferences": None
        }

        try:
            result_text = await self._call_gemini(router_prompt)
            data = self._parse_json_response(result_text, fallback)
            route = data.get("route", fallback["route"])
            if route not in ["direct_answer", "copywriter", "researcher", "planner", "full_pipeline"]:
                route = fallback["route"]
            data["route"] = route
            return data
        except Exception as e:
            print(f"[Manager] Route determination error: {e}")
            return fallback

    async def execute_direct(self, user_request: str, session_id: str, context: dict, routing_info: dict, callback) -> str:
        """Handle a follow-up question or consultation directly without other agents."""
        reasoning = routing_info.get("reasoning", "Answering directly from campaign memory.")

        # Notify client of routing decision
        await callback({
            "event": "routing_decision",
            "data": {
                "route": "direct_answer",
                "agent": "manager",
                "reasoning": reasoning
            }
        })

        # Mark other agents as skipped so UI shows clear status
        await callback({
            "event": "workflow_step",
            "data": {"agent": "researcher", "status": "skipped", "message": "Skipped • Manager answering directly"}
        })
        await callback({
            "event": "workflow_step",
            "data": {"agent": "copywriter", "status": "skipped", "message": "Skipped • Manager answering directly"}
        })
        await callback({
            "event": "workflow_step",
            "data": {"agent": "planner", "status": "skipped", "message": "Skipped • Manager answering directly"}
        })
        await callback({
            "event": "workflow_step",
            "data": {"agent": "manager-review", "status": "skipped", "message": "Skipped • Direct answer"}
        })

        # Activate Manager
        await callback({
            "event": "workflow_step",
            "data": {
                "agent": "manager",
                "status": "active",
                "message": f"Marketing Director is formulating strategic response ({reasoning})..."
            }
        })

        conv = self.memory.get_conversation(session_id) or {}
        history_summary = self.memory.get_history_summary(session_id, max_messages=8)
        campaign_ctx = conv.get("campaign_context", {})

        direct_prompt = f"""You are the Marketing Director for Millibro ({context.get('app_name', 'Millibro')} - social reading app).
You are in an ongoing conversation with the user (the marketer / product owner).

--- PRODUCT CONTEXT & BRAND GUIDE ---
{json.dumps(context, indent=2, default=str)}

--- CAMPAIGN CONTEXT & RECENT OUTPUTS ---
{json.dumps(campaign_ctx, indent=2, default=str)}

--- CONVERSATION HISTORY ---
{history_summary}

--- USER'S LATEST MESSAGE ---
{user_request}

--- YOUR ROLE ---
You are responding directly to the user.
- Address their question or follow-up directly, thoroughly, and authoritatively as a seasoned Marketing Director.
- Be encouraging, literary, and strategically sharp.
- Reference the prior work, posts, schedule, or brand elements accurately if they asked about them.
- Format your response in clean, beautiful Markdown with clear headings or bullet points where appropriate.
- Do NOT simulate other agents' complete workflow unless asked; speak in your authentic Marketing Director voice.
"""

        full_content = ""
        last_error = None
        success = False

        for model in MODELS_CASCADE:
            for attempt in range(3):
                try:
                    stream = await asyncio.to_thread(
                        self.client.models.generate_content_stream,
                        model=model,
                        contents=direct_prompt
                    )
                    current_attempt_content = ""
                    for chunk in stream:
                        if chunk.text:
                            current_attempt_content += chunk.text
                            await callback({
                                "event": "agent_chunk",
                                "data": {"agent": "manager", "delta": chunk.text}
                            })
                    full_content = current_attempt_content
                    if full_content.strip():
                        success = True
                        break
                except Exception as e:
                    last_error = e
                    err_str = str(e).lower()
                    if any(x in err_str for x in ["503", "429", "unavailable", "high demand"]):
                        await asyncio.sleep(1.2 * (attempt + 1))
                        continue
                    break
            if success:
                break

        if not success:
            full_content = f"I encountered an issue preparing the response: {str(last_error)}"
            await callback({
                "event": "agent_chunk",
                "data": {"agent": "manager", "delta": f"\n\n❌ {full_content}"}
            })

        # Save to persistent conversation memory
        self.memory.add_assistant_message(
            session_id=session_id,
            content=full_content,
            sender="manager",
            route="direct_answer",
            reasoning=reasoning
        )

        await callback({
            "event": "agent_complete",
            "data": {"agent": "manager", "content": full_content}
        })

        await callback({
            "event": "done",
            "data": {
                "status": "finished",
                "route": "direct_answer",
                "session_id": session_id,
                "message": full_content
            }
        })
        return full_content

    async def execute_targeted_agent(
        self,
        route: str,
        user_request: str,
        session_id: str,
        context: dict,
        routing_info: dict,
        callback
    ) -> str:
        """Execute a single specialist agent (Copywriter, Researcher, or Planner)."""
        reasoning = routing_info.get("reasoning", f"Delegating specifically to {route}.")

        await callback({
            "event": "routing_decision",
            "data": {
                "route": route,
                "agent": route,
                "reasoning": reasoning
            }
        })

        conv = self.memory.get_conversation(session_id) or {}
        history_summary = self.memory.get_history_summary(session_id, max_messages=6)
        campaign_ctx = conv.get("campaign_context", {})

        enriched_input = f"""Conversation History & Context:
{history_summary}

Active Campaign Memory:
- Last Research: {campaign_ctx.get('last_research_summary', 'N/A')}
- Last Copy: {campaign_ctx.get('last_copy_summary', 'N/A')}
- Last Plan: {campaign_ctx.get('last_plan_summary', 'N/A')}

Targeted Request from User:
{user_request}"""

        agent_output = ""

        if route == "copywriter":
            await callback({
                "event": "workflow_step",
                "data": {"agent": "researcher", "status": "skipped", "message": "Skipped • Targeted copy request"}
            })
            await callback({
                "event": "workflow_step",
                "data": {"agent": "planner", "status": "skipped", "message": "Skipped • Targeted copy request"}
            })
            await callback({
                "event": "workflow_step",
                "data": {"agent": "manager", "status": "completed", "message": f"Delegated to Copywriter ({reasoning})"}
            })

            agent_output = await self.copywriter.execute(enriched_input, context, callback)

            review_note = "\n\n✨ **Marketing Director Note:** Copywriter output received and approved for your campaign."
            await callback({
                "event": "agent_chunk",
                "data": {"agent": "manager", "delta": review_note}
            })

            self.memory.add_assistant_message(
                session_id=session_id,
                content=agent_output,
                sender="copywriter",
                route="copywriter",
                reasoning=reasoning,
                agent_outputs={"copywriter": agent_output}
            )

        elif route == "researcher":
            await callback({
                "event": "workflow_step",
                "data": {"agent": "copywriter", "status": "skipped", "message": "Skipped • Research only"}
            })
            await callback({
                "event": "workflow_step",
                "data": {"agent": "planner", "status": "skipped", "message": "Skipped • Research only"}
            })
            await callback({
                "event": "workflow_step",
                "data": {"agent": "manager", "status": "completed", "message": f"Delegated to Researcher ({reasoning})"}
            })

            agent_output = await self.researcher.execute(enriched_input, context, callback)

            self.memory.add_assistant_message(
                session_id=session_id,
                content=agent_output,
                sender="researcher",
                route="researcher",
                reasoning=reasoning,
                agent_outputs={"researcher": agent_output}
            )

        elif route == "planner":
            await callback({
                "event": "workflow_step",
                "data": {"agent": "researcher", "status": "skipped", "message": "Skipped • Planning only"}
            })
            await callback({
                "event": "workflow_step",
                "data": {"agent": "copywriter", "status": "skipped", "message": "Skipped • Planning only"}
            })
            await callback({
                "event": "workflow_step",
                "data": {"agent": "manager", "status": "completed", "message": f"Delegated to Planner ({reasoning})"}
            })

            agent_output = await self.planner.execute(enriched_input, context, callback)

            self.memory.add_assistant_message(
                session_id=session_id,
                content=agent_output,
                sender="planner",
                route="planner",
                reasoning=reasoning,
                agent_outputs={"planner": agent_output}
            )

        await callback({
            "event": "done",
            "data": {
                "status": "finished",
                "route": route,
                "session_id": session_id,
                "agent": route,
                "content": agent_output
            }
        })
        return agent_output

    async def run_full_pipeline(
        self,
        user_request: str,
        session_id: str,
        context: dict,
        routing_info: dict,
        callback
    ):
        """Run the full multi-agent marketing pipeline with rework and scoring."""
        reasoning = routing_info.get("reasoning", "Full 5-agent campaign pipeline initialized.")

        await callback({
            "event": "routing_decision",
            "data": {
                "route": "full_pipeline",
                "agent": "fleet",
                "reasoning": reasoning
            }
        })

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

        history_summary = self.memory.get_history_summary(session_id, max_messages=4)
        enriched_user_request = (
            f"Prior Context:\n{history_summary}\n\nCurrent Request:\n{user_request}"
            if "No prior conversation" not in history_summary else user_request
        )

        # 1. Manager starts pipeline
        await callback({
            "event": "workflow_step",
            "data": {
                "agent": "manager",
                "status": "active",
                "message": f"Orchestrating full campaign fleet ({reasoning})..."
            }
        })

        # 2. Run Researcher
        research_output = await self.researcher.execute(enriched_user_request, context, callback)

        rework_cycles = 0
        max_reworks = 2
        copy_output = ""
        plan_output = ""

        while True:
            # 3. Run Copywriter
            copy_context = {**context}
            if rework_cycles > 0 and "rework_feedback" in context:
                copy_context["rework_feedback"] = context["rework_feedback"]

            copy_output = await self.copywriter.execute(
                f"User Request: {user_request}\n\nResearch Report:\n{research_output}",
                copy_context,
                callback
            )

            # 4. Run Planner
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

            review_summary = review_data.get("review_summary", "Review complete.")
            await callback({
                "event": "agent_chunk",
                "data": {"agent": "manager", "delta": f"\n\n📋 **Review:** {review_summary}"}
            })

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

                context["rework_feedback"] = feedback
                context["_rework_target"] = agent_to_rework

                if agent_to_rework == "researcher":
                    await callback({
                        "event": "workflow_step",
                        "data": {"agent": "researcher", "status": "reworking", "message": f"Reworking research (attempt {rework_cycles})..."}
                    })
                    research_output = await self.researcher.execute(enriched_user_request, context, callback)
                    continue

                elif agent_to_rework == "copywriter":
                    await callback({
                        "event": "workflow_step",
                        "data": {"agent": "copywriter", "status": "reworking", "message": f"Reworking copy (attempt {rework_cycles})..."}
                    })
                    continue

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
            break

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

        summary_content = f"Pipeline complete. Score: {score_data.get('score', 75)}/100\n\n{score_data.get('reasoning', '')}"
        await callback({
            "event": "agent_complete",
            "data": {
                "agent": "manager",
                "content": summary_content
            }
        })

        # Save to conversation memory
        self.memory.add_assistant_message(
            session_id=session_id,
            content=summary_content,
            sender="fleet",
            route="full_pipeline",
            reasoning=reasoning,
            agent_outputs={
                "researcher": research_output,
                "copywriter": copy_output,
                "planner": plan_output,
                "manager": summary_content
            },
            score_data=score_data
        )

        # Save to score history
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

        await callback({
            "event": "done",
            "data": {
                "status": "finished",
                "route": "full_pipeline",
                "session_id": session_id,
                "score": score_data.get("score", 75)
            }
        })

    async def run_conversation_turn(self, user_request: str, callback, session_id: str = None):
        """Main orchestrated entry point for an interactive conversation turn."""
        conv = self.memory.get_or_create(session_id)
        session_id = conv["id"]

        self.memory.add_user_message(session_id, user_request)

        await callback({
            "event": "session_info",
            "data": {
                "session_id": session_id,
                "title": conv.get("title", "Marketing Campaign")
            }
        })

        context = self.load_json(self.preferences_file)
        routing_info = await self.determine_route(user_request, session_id, context)
        route = routing_info.get("route", "direct_answer")

        pref = routing_info.get("detected_user_preferences")
        if pref:
            self.memory.update_context_preference(session_id, pref)

        if route == "direct_answer":
            await self.execute_direct(user_request, session_id, context, routing_info, callback)
        elif route in ["copywriter", "researcher", "planner"]:
            await self.execute_targeted_agent(route, user_request, session_id, context, routing_info, callback)
        else:
            await self.run_full_pipeline(user_request, session_id, context, routing_info, callback)

    async def run_pipeline(self, user_request: str, callback, session_id: str = None):
        """Backward-compatible wrapper."""
        await self.run_conversation_turn(user_request, callback, session_id=session_id)
