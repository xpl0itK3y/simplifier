from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import openai
import os
from dotenv import load_dotenv
import asyncio
from typing import Optional

# Local modules
from database import (
    init_db, 
    get_user_subscription, 
    increment_usage, 
    get_all_plans, 
    upgrade_user
)
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
    allow_origins=["chrome-extension://jdidlnlcanjlbabpcgkcdkpfigfemhjd"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Extension-ID"],
)

# Initialize OpenAI
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    print("Warning: OPENAI_API_KEY not found in .env file")

client = openai.OpenAI(api_key=api_key)

class SimplifyRequest(BaseModel):
    text: str
    mode: str

class UpgradeRequest(BaseModel):
    plan_id: str

class AISettings(BaseModel):
    simple_level: int
    short_level: int
    points_count: int
    examples_count: int

def get_system_prompt(mode: str, settings: dict) -> str:
    base_prompt = "You are a helpful assistant that simplifies complex text. ALWAYS answer in RUSSIAN language."
    
    if mode == 'simple':
        level = settings.get('simple_level', 5)
        if level <= 3:
            intensity = "Слегка упрости текст, сохранив профессиональный тон. Сделай его чуть более доступным."
        elif level <= 7:
            intensity = "Объясни текст простым языком, понятным для 8-классника. Избегай жаргона."
        else:
            intensity = "Объясни как для 5-летнего ребенка. Используй самые простые слова и детские метафоры. Максимальное упрощение."
        return f"{base_prompt} {intensity} Тон полезный и нейтральный."
        
    elif mode == 'short':
        level = settings.get('short_level', 5)
        if level <= 3:
            intensity = "Немного сократи текст, оставив основные детали."
        elif level <= 7:
            intensity = "Сократи текст до одного емкого предложения."
        else:
            intensity = "Максимальное сжатие. Оставь только 3-5 самых важных слов. Ультра-краткость."
        return f"{base_prompt} {intensity} Передай самую суть."
        
    elif mode == 'key_points':
        count = settings.get('points_count', 5)
        return f"{base_prompt} Выдели ровно {count} главных мыслей из текста и оформи их в виде маркированного списка. Убери всё лишнее."
        
    elif mode == 'examples':
        count = settings.get('examples_count', 2)
        return f"{base_prompt} Объясни текст просто, а затем приведи {count} конкретных примера из реальной жизни. Используй формат: 'Объяснение: [текст]\\n\\nПримеры:\\n- [пример 1]\\n- [пример 2]'"
    else:
        return f"{base_prompt} Упрости этот текст."

async def stream_generator(text: str, mode: str, settings: dict):
    try:
        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": get_system_prompt(mode, settings)},
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
async def simplify_text(
    request: Request,
    simplify_request: SimplifyRequest, 
    authorization: Optional[str] = Header(None),
    x_extension_id: Optional[str] = Header(None)
):
    if not api_key:
        raise HTTPException(status_code=500, detail="Server misconfiguration: API Key missing")
    
    # 1. Authenticate User
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = authorization.split(" ")[1]
    user_info = verify_google_token(token, x_extension_id)

    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid session")

    # 2. Check Subscription & Limits
    sub = get_user_subscription(user_info['id'], user_info['email'])
    
    # Check text length against plan limit
    if len(simplify_request.text) > sub['max_chars']:
        raise HTTPException(
            status_code=400, 
            detail=f"Текст слишком длинный для вашего плана (макс. {sub['max_chars']} симв.)"
        )

    # Check requests limit
    if sub['requests_used'] >= sub['max_requests']:
        raise HTTPException(
            status_code=402, 
            detail="Лимит запросов исчерпан. Пожалуйста, обновите подписку."
        )

    # 3. Increment Usage & Stream
    increment_success = increment_usage(user_info['id'], sub['max_requests'])
    if not increment_success:
        raise HTTPException(status_code=429, detail="Слишком много запросов. Подождите немного.")
    
    return StreamingResponse(
        stream_generator(simplify_request.text, simplify_request.mode, sub['settings']), 
        media_type="text/plain"
    )

@app.get("/me")
async def get_me(
    authorization: Optional[str] = Header(None),
    x_extension_id: Optional[str] = Header(None)
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = authorization.split(" ")[1]
    user_info = verify_google_token(token, x_extension_id)

    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid session")

    return get_user_subscription(user_info['id'], user_info['email'])

@app.get("/settings")
async def get_user_settings_route(
    authorization: Optional[str] = Header(None),
    x_extension_id: Optional[str] = Header(None)
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = authorization.split(" ")[1]
    user_info = verify_google_token(token, x_extension_id)
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid session")

    sub = get_user_subscription(user_info['id'], user_info['email'])
    return sub['settings']

@app.post("/settings")
async def update_user_settings_route(
    settings: AISettings,
    authorization: Optional[str] = Header(None),
    x_extension_id: Optional[str] = Header(None)
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = authorization.split(" ")[1]
    user_info = verify_google_token(token, x_extension_id)
    if not user_info:
        raise HTTPException(status_code=401, detail="Invalid session")

    sub = get_user_subscription(user_info['id'], user_info['email'])
    if not sub['ai_settings_enabled']:
        raise HTTPException(status_code=403, detail="Настройки AI доступны только в плане GO")

    from database import update_user_settings
    success = update_user_settings(user_info['id'], settings.dict())
    if not success:
        raise HTTPException(status_code=500, detail="Ошибка при сохранении настроек")
    
    return {"status": "success"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)