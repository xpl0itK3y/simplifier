from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import openai
import os
from dotenv import load_dotenv
import asyncio
from typing import Optional

# Local modules
from database import init_db, get_user_credits, decrement_credits
from auth import verify_google_token

# Load environment variables
load_dotenv()

# Initialize Database
init_db()

# Initialize FastAPI
app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    print("Warning: OPENAI_API_KEY not found in .env file")

client = openai.OpenAI(api_key=api_key)

class SimplifyRequest(BaseModel):
    text: str
    mode: str

def get_system_prompt(mode: str) -> str:
    base_prompt = "You are a helpful assistant that simplifies complex text. ALWAYS answer in RUSSIAN language."
    
    if mode == 'simple':
        return f"{base_prompt} Объясни следующий текст простым языком, понятным для 8-классника. Избегай жаргона. Если термин необходим, объясни его. Тон полезный и нейтральный."
    elif mode == 'short':
        return f"{base_prompt} Сократи следующий текст до одного предложения. Передай самую суть. Будь максимально краток."
    elif mode == 'key_points':
        return f"{base_prompt} Выделі главные мысли из текста и оформи их в виде маркированного списка. Убери всё лишнее, оставь только суть."
    elif mode == 'examples':
        return f"{base_prompt} Объясни текст просто, а затем приведи конкретный пример из реальной жизни. Используй формат: 'Объяснение: [текст]\\n\\nПример: [пример]'"
    else:
        return f"{base_prompt} Упрости этот текст."

async def stream_generator(text: str, mode: str):
    try:
        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": get_system_prompt(mode)},
                {"role": "user", "content": text}
            ],
            max_tokens=800,
            stream=True
        )

        for chunk in stream:
            if chunk.choices[0].delta.content is not None:
                yield chunk.choices[0].delta.content

    except Exception as e:
        yield f"Error: {str(e)}"

@app.post("/simplify")
async def simplify_text(request: SimplifyRequest, authorization: Optional[str] = Header(None)):
    if not api_key:
        raise HTTPException(status_code=500, detail="Server misconfiguration: API Key missing")
    
    # 1. Check Text Length (Security)
    if len(request.text) > 10000:
        raise HTTPException(status_code=400, detail="Text is too long (Max 10,000 chars).")

    # 2. Authenticate User (Security)
    if not authorization:
         raise HTTPException(status_code=401, detail="Missing Authentication Header")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization format")

    token = authorization.split(" ")[1]
    google_id = verify_google_token(token)

    if not google_id:
        raise HTTPException(status_code=401, detail="Invalid Google Token")

    # 3. Check Credits (Business Logic)
    credits = get_user_credits(google_id)
    if credits <= 0:
        raise HTTPException(status_code=402, detail="No credits remaining. Please upgrade.")

    # 4. Decrement & Serve (with duplicate protection)
    decrement_success = decrement_credits(google_id)
    if not decrement_success:
        raise HTTPException(status_code=429, detail="Request too frequent. Please wait.")
    
    return StreamingResponse(stream_generator(request.text, request.mode), media_type="text/plain")

@app.get("/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)