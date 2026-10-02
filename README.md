# Millibro Marketing Agent - Render Deployment

The marketing pipeline generates coordinated campaign ideas for X (Twitter), Substack, YouTube, Instagram, and SEO.

## Quick Deploy to Render

### Option 1: One-Click Deploy (after pushing to GitHub)
1. Push this repo to GitHub
2. Go to https://dashboard.render.com
3. Click **New** → **Web Service**
4. Connect your GitHub repo
5. Render will auto-detect the `render.yaml` config
6. Add the environment variable `GEMINI_API_KEY` with your actual API key
7. Click **Deploy**

### Option 2: Manual Setup on Render
1. Go to https://dashboard.render.com
2. Click **New** → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Runtime**: Python
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn server:app --host 0.0.0.0 --port $PORT`
5. Add Environment Variable:
   - Key: `GEMINI_API_KEY`
   - Value: `your_actual_api_key`
6. Click **Deploy**

### Getting a Gemini API Key
1. Go to https://aistudio.google.com/apikey
2. Click **Create API Key**
3. Copy the key and paste it into the `GEMINI_API_KEY` environment variable on Render

### Local Development
```bash
# Install dependencies
pip install -r requirements.txt

# Set your API key in .env
echo "GEMINI_API_KEY=your_key_here" > .env

# Run locally
python run.py
```

Then open http://localhost:8000
