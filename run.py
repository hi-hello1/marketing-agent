import os
import sys
import uvicorn
from pathlib import Path
from dotenv import load_dotenv


def main():
    env_path = Path(__file__).parent / ".env"

    if not env_path.exists():
        print("=" * 60)
        print("ERROR: .env file not found!")
        print(f"Please create {env_path} with your Gemini API key:")
        print("  GEMINI_API_KEY=your_actual_key_here")
        print("=" * 60)
        sys.exit(1)

    load_dotenv(dotenv_path=env_path)

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key or api_key.startswith("your_") or api_key == "placeholder":
        print("=" * 60)
        print("⚠️  GEMINI_API_KEY is not configured!")
        print(f"Please set your valid Gemini API key in: {env_path}")
        print("")
        print("Steps:")
        print("  1. Go to https://aistudio.google.com/apikey")
        print("  2. Create or copy your API key")
        print(f"  3. Open {env_path}")
        print("  4. Replace 'your_gemini_api_key_here' with your actual key")
        print("=" * 60)
        sys.exit(1)

    print("")
    print("  ╔══════════════════════════════════════════════╗")
    print("  ║   🚀 Millibro Marketing Agent System        ║")
    print("  ║   Multi-Agent Marketing Content Generator    ║")
    print("  ╚══════════════════════════════════════════════╝")
    print("")
    print("  🌐 Open in your browser:")
    print("     http://localhost:8000")
    print("")
    print("  Press Ctrl+C to stop the server.")
    print("")

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )


if __name__ == "__main__":
    main()
