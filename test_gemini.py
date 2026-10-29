import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise SystemExit("Set GEMINI_API_KEY before running this script.")
genai.configure(api_key=API_KEY)

try:
    model = genai.GenerativeModel('gemini-2.5-flash')
    response = model.generate_content("hello")
    print(response.text)
except Exception as e:
    print(f"Error with gemini-2.5-flash: {e}")

try:
    model = genai.GenerativeModel('gemini-1.5-flash')
    response = model.generate_content("hello")
    print("Success with gemini-1.5-flash")
except Exception as e:
    print(f"Error with gemini-1.5-flash: {e}")
