import google.generativeai as genai
import time
import os
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise SystemExit("Set GEMINI_API_KEY before running this script.")
genai.configure(api_key=API_KEY)

models_to_try = [
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro'
]

for model_name in models_to_try:
    print(f"Testing {model_name}...")
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content("hi")
        print(f"  [SUCCESS] {model_name}: {response.text[:20].strip()}...")
        break # Stop at first working model
    except Exception as e:
        print(f"  [FAILED] {model_name}: {str(e)[:100]}")
        time.sleep(1)
