# Perplexity Demo

A Flask-based AI search demo with a browser interface, saved searches, and business search tools.

## Setup

1. Install Python and the dependencies:

   ```powershell
   py -m pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to your own Gemini API key. Keep `.env` private; it is excluded from Git.

3. Start the app locally:

   ```powershell
   py -m flask --app app run --host 127.0.0.1 --port 5000
   ```

   Open `http://127.0.0.1:5000`.

## Temporary public access

Install Cloudflare Tunnel separately, start the Flask app, then run:

```powershell
cloudflared tunnel --url http://127.0.0.1:5000
```

The generated URL is temporary. Anyone who can access it can reach the app while both processes are running.