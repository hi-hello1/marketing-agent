import json
import uuid
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional


def find_conversations_dir() -> Path:
    """Find or create the conversations storage directory."""
    # Check parent/data/conversations (local dev standard)
    d = Path(__file__).resolve().parent.parent / "data" / "conversations"
    if d.parent.exists():
        d.mkdir(parents=True, exist_ok=True)
        return d

    # Flat or container environment check
    candidate = Path(__file__).resolve().parent / "data" / "conversations"
    candidate.mkdir(parents=True, exist_ok=True)
    return candidate


class ConversationMemory:
    """Manages persistent conversation history and campaign context for marketing agents."""

    def __init__(self):
        self.conv_dir = find_conversations_dir()

    def _file_path(self, session_id: str) -> Path:
        safe_id = "".join(c for c in session_id if c.isalnum() or c in ("-", "_"))
        return self.conv_dir / f"{safe_id}.json"

    def create_conversation(self, title: Optional[str] = None, session_id: Optional[str] = None) -> Dict[str, Any]:
        sid = session_id or f"conv_{uuid.uuid4().hex[:10]}"
        now = datetime.now(timezone.utc).isoformat()
        conv = {
            "id": sid,
            "title": title or "New Marketing Campaign",
            "created_at": now,
            "updated_at": now,
            "messages": [],
            "campaign_context": {
                "active_campaign_title": None,
                "target_channels": [],
                "user_preferences_noted": [],
                "last_research_summary": None,
                "last_copy_summary": None,
                "last_plan_summary": None,
                "latest_score": None
            }
        }
        self.save_conversation(conv)
        return conv

    def save_conversation(self, conv: Dict[str, Any]) -> None:
        sid = conv.get("id")
        if not sid:
            raise ValueError("Conversation must have an 'id'")
        conv["updated_at"] = datetime.now(timezone.utc).isoformat()
        path = self._file_path(sid)
        temp_path = path.with_suffix(".tmp")
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(conv, f, indent=2, ensure_ascii=False)
        temp_path.replace(path)

    def get_conversation(self, session_id: str) -> Optional[Dict[str, Any]]:
        path = self._file_path(session_id)
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[ConversationMemory] Error loading conversation {session_id}: {e}")
            return None

    def get_or_create(self, session_id: Optional[str]) -> Dict[str, Any]:
        if session_id:
            conv = self.get_conversation(session_id)
            if conv:
                return conv
        return self.create_conversation(session_id=session_id)

    def list_conversations(self) -> List[Dict[str, Any]]:
        results = []
        if not self.conv_dir.exists():
            return results
        for f in self.conv_dir.glob("*.json"):
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                    results.append({
                        "id": data.get("id", f.stem),
                        "title": data.get("title", "Marketing Campaign"),
                        "created_at": data.get("created_at"),
                        "updated_at": data.get("updated_at"),
                        "message_count": len(data.get("messages", [])),
                        "latest_score": data.get("campaign_context", {}).get("latest_score")
                    })
            except Exception as e:
                print(f"[ConversationMemory] Error reading {f}: {e}")
        # Sort by updated_at descending
        results.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
        return results

    def delete_conversation(self, session_id: str) -> bool:
        path = self._file_path(session_id)
        if path.exists():
            try:
                path.unlink()
                return True
            except Exception as e:
                print(f"[ConversationMemory] Error deleting {session_id}: {e}")
                return False
        return False

    def add_user_message(self, session_id: str, content: str) -> Dict[str, Any]:
        conv = self.get_or_create(session_id)
        msg_id = f"msg_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        
        # Auto-generate a clean title from the first message if still default or blank
        if (conv.get("title") in (None, "", "New Marketing Campaign")) and content.strip():
            cleaned = content.strip().split("\n")[0]
            title = cleaned[:45] + ("..." if len(cleaned) > 45 else "")
            conv["title"] = title

        msg = {
            "id": msg_id,
            "role": "user",
            "sender": "user",
            "content": content,
            "timestamp": now
        }
        conv["messages"].append(msg)
        self.save_conversation(conv)
        return conv

    def add_assistant_message(
        self,
        session_id: str,
        content: str,
        sender: str = "manager",
        route: str = "direct_answer",
        reasoning: Optional[str] = None,
        agent_outputs: Optional[Dict[str, str]] = None,
        score_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        conv = self.get_or_create(session_id)
        msg_id = f"msg_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()

        msg = {
            "id": msg_id,
            "role": "assistant",
            "sender": sender,
            "content": content,
            "timestamp": now,
            "route": route,
            "reasoning": reasoning,
            "agent_outputs": agent_outputs or {},
            "score_data": score_data
        }
        conv["messages"].append(msg)

        # Update campaign context if we have outputs or scores
        ctx = conv.setdefault("campaign_context", {})
        if score_data and score_data.get("score") is not None:
            ctx["latest_score"] = score_data.get("score")

        if agent_outputs:
            if "researcher" in agent_outputs and agent_outputs["researcher"]:
                ctx["last_research_summary"] = agent_outputs["researcher"][:400]
            if "copywriter" in agent_outputs and agent_outputs["copywriter"]:
                ctx["last_copy_summary"] = agent_outputs["copywriter"][:400]
            if "planner" in agent_outputs and agent_outputs["planner"]:
                ctx["last_plan_summary"] = agent_outputs["planner"][:400]

        self.save_conversation(conv)
        return conv

    def update_context_preference(self, session_id: str, note: str) -> None:
        conv = self.get_or_create(session_id)
        ctx = conv.setdefault("campaign_context", {})
        prefs = ctx.setdefault("user_preferences_noted", [])
        if note not in prefs:
            prefs.append(note)
        self.save_conversation(conv)

    def get_history_summary(self, session_id: str, max_messages: int = 8) -> str:
        """Format recent conversation messages into a clean summary for prompts."""
        conv = self.get_conversation(session_id)
        if not conv or not conv.get("messages"):
            return "No prior conversation history in this session."
        
        recent = conv["messages"][-max_messages:]
        lines = []
        for m in recent:
            role = "Marketer (User)" if m.get("role") == "user" else f"Agent ({m.get('sender', 'manager')})"
            txt = m.get("content", "").strip()
            # If text is very long (like a whole campaign output), summarize briefly
            if len(txt) > 600:
                snippet = txt[:500] + f"\n... [clipped {len(txt) - 500} chars]"
            else:
                snippet = txt
            lines.append(f"[{role}]:\n{snippet}")
        return "\n\n".join(lines)


# Singleton instance for simple import
memory_store = ConversationMemory()
