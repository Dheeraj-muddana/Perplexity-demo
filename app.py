import os
import asyncio
import sqlite3
import uuid
import subprocess
import re
from datetime import datetime, timedelta

# Fix for OSError: [Errno 22] on Windows with asyncio
if os.name == 'nt':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import threading
from flask import Flask, request, jsonify, render_template, redirect, url_for
from flask_cors import CORS
import google.generativeai as genai
from PyPDF2 import PdfReader
import io
import requests
from bs4 import BeautifulSoup
from ddgs import DDGS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

DB_PATH = 'perplexity.db'

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def db_init():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Searches table: Stores queries and answers
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS searches (
            id TEXT PRIMARY KEY,
            query TEXT NOT NULL,
            answer TEXT NOT NULL,
            user_id TEXT NOT NULL,
            is_public INTEGER DEFAULT 0,
            upvotes INTEGER DEFAULT 0,
            downvotes INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Bookmarks table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS bookmarks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            search_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (search_id) REFERENCES searches (id)
        )
    ''')
    
    # Notifications table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Business reports table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS business_reports (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            query TEXT NOT NULL,
            answer TEXT NOT NULL,
            field TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Business searches table (for stats)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS business_searches (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            query TEXT NOT NULL,
            field TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

db_init()

@app.errorhandler(Exception)
def handle_exception(e):
    """Global error handler that returns JSON instead of HTML for all crashes."""
    import traceback
    traceback.print_exc()
    response = {
        "error": str(e),
        "status": "failed",
        "type": type(e).__name__
    }
    return jsonify(response), 500

# Route to serve the frontend
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/saved')
def saved_page():
    return render_template('saved.html')

@app.route('/trending')
def trending_page():
    return render_template('trending.html')

@app.route('/business')
def business_page():
    return render_template('business.html')

@app.route('/share/<search_id>')
def share_page(search_id):
    conn = get_db_connection()
    search = conn.execute('SELECT * FROM searches WHERE id = ?', (search_id,)).fetchone()
    conn.close()
    if search:
        return render_template('share_view.html', search=search)
    return "Search not found", 404

# Configure the Gemini API
API_KEY = os.getenv("GEMINI_API_KEY")
if API_KEY:
    genai.configure(api_key=API_KEY)
genai.configure(api_key=API_KEY)

# Global store for RAG context (simple in-memory storage)
uploaded_context = ""

def get_model(context=""):
    system_instr = "Act as Perplexity 3, a highly intelligent and minimal AI search agent. Provide clear, concise, and structured answers."
    if context:
        system_instr += f"\n\nCONTEXT FROM UPLOADED DOCUMENT:\n{context}\n\nINSTRUCTION: Using the provided context above, answer the user query accurately. If the answer is not in the context, use your general knowledge but prioritize the context."
    
    return genai.GenerativeModel(
        model_name='models/gemini-2.5-flash',
        system_instruction=system_instr
    )

# ─── Data Persistence Helper ──────────────────────────────────────
def save_search_result(query, answer, user_id, is_public=0):
    search_id = str(uuid.uuid4())
    conn = get_db_connection()
    conn.execute(
        'INSERT INTO searches (id, query, answer, user_id, is_public) VALUES (?, ?, ?, ?, ?)',
        (search_id, query, answer, user_id, is_public)
    )
    conn.commit()
    conn.close()
    return search_id

# ─── PDF Upload Endpoint ───────────────────────────────────────────
@app.route('/api/upload', methods=['POST'])
def upload_file():
    global uploaded_context
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    if file and file.filename.endswith('.pdf'):
        try:
            pdf_file = io.BytesIO(file.read())
            reader = PdfReader(pdf_file)
            text = ""
            for page in reader.pages:
                extracted_text = page.extract_text()
                if extracted_text:
                    text += extracted_text + "\n"
            
            uploaded_context = text
            return jsonify({"status": "success", "message": f"Successfully processed {len(reader.pages)} pages."})
        except Exception as e:
            return jsonify({"error": f"Failed to parse PDF: {str(e)}"}), 500
    else:
        return jsonify({"error": "Only PDF files are supported"}), 400

# ─── Regular Chat Endpoint ─────────────────────────────────────────
@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.json
        user_message = data.get('message')
        history = data.get('history', [])
        user_id = data.get('user_id', 'anonymous')
        is_public = 1 if data.get('is_public') else 0
        
        if not user_message:
            return jsonify({"error": "No message provided"}), 400
            
        model = get_model(uploaded_context)
        
        # Build conversation for Gemini
        chat_session = model.start_chat(history=history)
        response = chat_session.send_message(user_message)
        
        search_id = save_search_result(user_message, response.text, user_id, is_public)
        
        return jsonify({
            "response": response.text,
            "search_id": search_id,
            "status": "success"
        })
        
    except Exception as e:
        return jsonify({
            "error": str(e),
            "status": "failed"
        }), 500

# ─── DuckDuckGo Search Helper ──────────────────────────────────────
def search_duckduckgo(query, max_results=6):
    """Search DuckDuckGo and return results with title, url, snippet."""
    try:
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", "")
                })
        return results
    except Exception as e:
        print(f"DuckDuckGo search error: {e}")
        return []

# ─── Web Content Crawler ───────────────────────────────────────────
def crawl_url_simple(url, timeout=10):
    """Fetch and extract clean text from a URL using requests + BeautifulSoup."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        resp = requests.get(url, headers=headers, timeout=timeout)
        resp.raise_for_status()
        
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe"]):
            tag.decompose()
        
        main_content = soup.find("main") or soup.find("article") or soup.find("div", {"role": "main"})
        if main_content:
            text = main_content.get_text(separator="\n", strip=True)
        else:
            text = soup.get_text(separator="\n", strip=True)
        
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        clean_text = "\n".join(lines)
        return clean_text[:4000]
    except Exception as e:
        print(f"Crawl error for {url}: {e}")
        return ""

def crawl_urls(urls, use_crawl4ai=False):
    """Crawl multiple URLs and return their content."""
    results = {}
    for url in urls:
        results[url] = crawl_url_simple(url)
    return results

# ─── Web Search Endpoint ───────────────────────────────────────────
@app.route('/api/search', methods=['POST'])
def web_search():
    try:
        data = request.json
        user_query = data.get('query', '')
        user_id = data.get('user_id', 'anonymous')
        is_public = 1 if data.get('is_public') else 0
        
        if not user_query:
            return jsonify({"error": "No query provided"}), 400
        
        search_results = search_duckduckgo(user_query, max_results=6)
        
        if not search_results:
            model = get_model()
            response = model.generate_content(user_query)
            search_id = save_search_result(user_query, response.text, user_id, is_public)
            return jsonify({
                "response": response.text,
                "sources": [],
                "search_id": search_id,
                "status": "success"
            })
        
        urls_to_crawl = [r["url"] for r in search_results if r.get("url")][:5]
        crawled_content = crawl_urls(urls_to_crawl)
        
        context_parts = []
        valid_sources = []
        for i, result in enumerate(search_results):
            url = result.get("url", "")
            content = crawled_content.get(url, "")
            snippet = result.get("snippet", "")
            source_text = content if content else snippet
            if source_text:
                source_num = len(valid_sources) + 1
                context_parts.append(f"[Source {source_num}] {result['title']}\nURL: {url}\nContent:\n{source_text}\n")
                valid_sources.append({
                    "num": source_num,
                    "title": result.get("title", "Untitled"),
                    "url": url,
                    "snippet": snippet[:200],
                    "domain": url.split("/")[2] if len(url.split("/")) > 2 else url
                })
        
        full_context = "\n---\n".join(context_parts)
        system_prompt = """You are Perplexity 3, an AI search engine. Provide clear citations [1], [2], etc."""
        model = genai.GenerativeModel(model_name='models/gemini-2.5-flash', system_instruction=system_prompt)
        prompt = f"WEB SOURCES:\n{full_context}\n\nUSER QUESTION: {user_query}"
        response = model.generate_content(prompt)
        
        search_id = save_search_result(user_query, response.text, user_id, is_public)
        
        return jsonify({
            "response": response.text,
            "sources": valid_sources,
            "search_id": search_id,
            "status": "success"
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "status": "failed"}), 500

# ─── Social & Persistence Endpoints ─────────────────────────────────

@app.route('/api/bookmark', methods=['POST', 'DELETE'])
def handle_bookmark():
    data = request.json
    user_id = data.get('user_id')
    search_id = data.get('search_id')
    
    if not user_id or not search_id:
        return jsonify({"error": "Missing user_id or search_id"}), 400
    
    conn = get_db_connection()
    if request.method == 'POST':
        bookmark_id = str(uuid.uuid4())
        try:
            conn.execute('INSERT INTO bookmarks (id, user_id, search_id) VALUES (?, ?, ?)', (bookmark_id, user_id, search_id))
            conn.commit()
            status = "bookmarked"
        except sqlite3.IntegrityError:
            status = "already_bookmarked"
    else:
        conn.execute('DELETE FROM bookmarks WHERE user_id = ? AND search_id = ?', (user_id, search_id))
        conn.commit()
        status = "unbookmarked"
    
    conn.close()
    return jsonify({"status": "success", "action": status})

@app.route('/api/vote', methods=['POST'])
def handle_vote():
    data = request.json
    search_id = data.get('search_id')
    vote_type = data.get('type') # 'up' or 'down'
    
    if not search_id or vote_type not in ['up', 'down']:
        return jsonify({"error": "Invalid vote data"}), 400
    
    conn = get_db_connection()
    if vote_type == 'up':
        conn.execute('UPDATE searches SET upvotes = upvotes + 1 WHERE id = ?', (search_id,))
    else:
        conn.execute('UPDATE searches SET downvotes = downvotes + 1 WHERE id = ?', (search_id,))
    conn.commit()
    
    # Check if we should notify the owner
    search = conn.execute('SELECT user_id, query FROM searches WHERE id = ?', (search_id,)).fetchone()
    if search:
        msg = f"Your search '{search['query'][:20]}...' received a new {vote_type}vote!"
        conn.execute('INSERT INTO notifications (id, user_id, message) VALUES (?, ?, ?)', (str(uuid.uuid4()), search['user_id'], msg))
        conn.commit()
    
    conn.close()
    return jsonify({"status": "success"})

@app.route('/api/trending', methods=['GET'])
def get_trending():
    conn = get_db_connection()
    # Most searches in last 24h
    day_ago = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S')
    trending = conn.execute('''
        SELECT query, COUNT(*) as count, upvotes - downvotes as score 
        FROM searches 
        WHERE created_at >= ? AND is_public = 1
        GROUP BY query 
        ORDER BY count DESC, score DESC 
        LIMIT 10
    ''', (day_ago,)).fetchall()
    conn.close()
    return jsonify([dict(row) for row in trending])

@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    conn = get_db_connection()
    notifs = conn.execute('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', (user_id,)).fetchall()
    conn.close()
    return jsonify([dict(row) for row in notifs])

@app.route('/api/bookmarks', methods=['GET'])
def get_bookmarks():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    conn = get_db_connection()
    bookmarks = conn.execute('''
        SELECT s.* FROM searches s 
        JOIN bookmarks b ON s.id = b.search_id 
        WHERE b.user_id = ? 
        ORDER BY b.created_at DESC
    ''', (user_id,)).fetchall()
    conn.close()
    return jsonify([dict(row) for row in bookmarks])

# ─── Business Mode Endpoints ─────────────────────────────────────

BUSINESS_SYSTEM_PROMPT = """You are a professional business analyst. Answer with data, statistics, real-world examples, and actionable steps. Format with clear sections and bullet points. Focus on the selected business field: {field_name}.

Structure your response in exactly this format:
## Summary
[2-3 sentence overview]

## Key Facts
- [fact 1]
- [fact 2]
- [fact 3]
- [fact 4]

## Actionable Steps
1. [step 1]
2. [step 2]
3. [step 3]
4. [step 4]

## Related Topics
[topic1], [topic2], [topic3], [topic4], [topic5]"""

@app.route('/api/business/search', methods=['POST'])
def business_search():
    try:
        data = request.json
        user_query = data.get('query', '')
        field = data.get('field', 'General')
        user_id = data.get('user_id', 'anonymous')
        
        if not user_query:
            return jsonify({"error": "No query provided"}), 400
        
        # Save to business_searches for stats
        conn = get_db_connection()
        conn.execute(
            'INSERT INTO business_searches (id, user_id, query, field) VALUES (?, ?, ?, ?)',
            (str(uuid.uuid4()), user_id, user_query, field)
        )
        conn.commit()
        conn.close()
        
        # Web search for grounded results
        search_results = search_duckduckgo(f"{field} {user_query}", max_results=5)
        
        context_parts = []
        valid_sources = []
        if search_results:
            urls_to_crawl = [r["url"] for r in search_results if r.get("url")][:4]
            crawled_content = crawl_urls(urls_to_crawl)
            
            for i, result in enumerate(search_results):
                url = result.get("url", "")
                content = crawled_content.get(url, "")
                snippet = result.get("snippet", "")
                source_text = content if content else snippet
                if source_text:
                    source_num = len(valid_sources) + 1
                    context_parts.append(f"[Source {source_num}] {result['title']}\nURL: {url}\nContent:\n{source_text}\n")
                    valid_sources.append({
                        "num": source_num,
                        "title": result.get("title", "Untitled"),
                        "url": url,
                        "snippet": snippet[:200],
                        "domain": url.split("/")[2] if len(url.split("/")) > 2 else url
                    })
        
        full_context = "\n---\n".join(context_parts) if context_parts else ""
        system_prompt = BUSINESS_SYSTEM_PROMPT.replace('{field_name}', field)
        model = genai.GenerativeModel(model_name='models/gemini-2.5-flash', system_instruction=system_prompt)
        
        prompt = f"WEB SOURCES:\n{full_context}\n\nBUSINESS QUERY ({field}): {user_query}" if full_context else f"BUSINESS QUERY ({field}): {user_query}"
        response = model.generate_content(prompt)
        
        # Also save to main searches table
        search_id = save_search_result(user_query, response.text, user_id, 1)
        
        return jsonify({
            "response": response.text,
            "sources": valid_sources,
            "search_id": search_id,
            "field": field,
            "status": "success"
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "status": "failed"}), 500

@app.route('/api/business/report', methods=['POST'])
def save_business_report():
    data = request.json
    report_id = str(uuid.uuid4())
    conn = get_db_connection()
    conn.execute(
        'INSERT INTO business_reports (id, user_id, query, answer, field) VALUES (?, ?, ?, ?, ?)',
        (report_id, data.get('user_id', 'anonymous'), data.get('query', ''), data.get('answer', ''), data.get('field', 'General'))
    )
    conn.commit()
    conn.close()
    return jsonify({"status": "success", "report_id": report_id})

@app.route('/api/business/reports', methods=['GET'])
def get_business_reports():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    conn = get_db_connection()
    reports = conn.execute('SELECT * FROM business_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', (user_id,)).fetchall()
    conn.close()
    return jsonify([dict(row) for row in reports])

@app.route('/api/business/report/<report_id>', methods=['DELETE'])
def delete_business_report(report_id):
    conn = get_db_connection()
    conn.execute('DELETE FROM business_reports WHERE id = ?', (report_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "deleted"})

@app.route('/api/business/stats', methods=['GET'])
def get_business_stats():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({})
    conn = get_db_connection()
    total = conn.execute('SELECT COUNT(*) as c FROM business_searches WHERE user_id = ?', (user_id,)).fetchone()['c']
    top_field = conn.execute('SELECT field, COUNT(*) as c FROM business_searches WHERE user_id = ? GROUP BY field ORDER BY c DESC LIMIT 1', (user_id,)).fetchone()
    reports_count = conn.execute('SELECT COUNT(*) as c FROM business_reports WHERE user_id = ?', (user_id,)).fetchone()['c']
    top_topics = conn.execute('SELECT query, COUNT(*) as c FROM business_searches WHERE user_id = ? GROUP BY query ORDER BY c DESC LIMIT 3', (user_id,)).fetchall()
    conn.close()
    return jsonify({
        "total_searches": total,
        "most_used_field": dict(top_field) if top_field else None,
        "reports_saved": reports_count,
        "top_topics": [dict(t) for t in top_topics]
    })

@app.route('/api/business/news', methods=['GET'])
def get_business_news():
    try:
        results = []
        with DDGS() as ddgs:
            for r in ddgs.news('business news today', max_results=5):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "source": r.get("source", ""),
                    "date": r.get("date", ""),
                    "body": r.get("body", "")[:150]
                })
        return jsonify(results)
    except Exception as e:
        print(f"Business news error: {e}")
        return jsonify([])

PUBLIC_URL = None

def start_tunnel():
    global PUBLIC_URL
    base_dir = os.path.dirname(os.path.abspath(__file__))
    cloudflared_exe = os.path.join(base_dir, 'cloudflared.exe')
    
    if os.path.exists(cloudflared_exe):
        cmd = [cloudflared_exe, 'tunnel', '--url', 'http://localhost:5000']
    else:
        cmd = ['ssh', '-o', 'StrictHostKeyChecking=no', '-R', '80:localhost:5000', 'nokey@pinggy.online']
        
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        for line in iter(process.stdout.readline, ''):
            if not line:
                break
            match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
            if not match:
                match = re.search(r'https://[a-zA-Z0-9-]+\.pinggy\.online', line)
            if match:
                PUBLIC_URL = match.group(0)
                try:
                    with open(os.path.join(base_dir, 'url.txt'), 'w', encoding='utf-8') as f:
                        f.write(PUBLIC_URL)
                    with open(os.path.join(base_dir, 'public_url.txt'), 'w', encoding='utf-8') as f:
                        f.write(PUBLIC_URL)
                except Exception:
                    pass
                    
                banner = (
                    "\n" + "="*66 + "\n"
                    " PERPLEXITY CLONE IS LIVE & PUBLICLY ACCESSIBLE!\n"
                    "\n"
                    " Local URL:  http://localhost:5000\n"
                    f" Public URL: {PUBLIC_URL}\n"
                    + "="*66 + "\n"
                )
                try:
                    print(banner, flush=True)
                except Exception:
                    print(f"Local URL: http://localhost:5000 | Public URL: {PUBLIC_URL}", flush=True)
                break
    except Exception as e:
        print(f"Tunnel launch error: {e}", flush=True)

def init_tunnel():
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        t = threading.Thread(target=start_tunnel, daemon=True)
        t.start()

@app.route('/api/public_url', methods=['GET'])
def get_public_url_endpoint():
    return jsonify({
        "local_url": "http://localhost:5000",
        "public_url": PUBLIC_URL
    })

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
