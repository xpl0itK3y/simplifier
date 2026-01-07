# Text Simplifier

Simplify complex text on any website instantly using AI.

## Quick Start

### 1. Run the Backend
You need the AI server running locally (Docker recommended).

```bash
cd backend
# Make sure your OPENAI_API_KEY is in .env
docker-compose up --build
```

### 2. Install Extension
1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` folder from this repo.

## How to Use
1. **Highlight any text** on a webpage.
2. **Right-click** and select **"Simplify..."**.
3. Choose a mode:
   - **Simple**: Plain explanation.
   - **Brief**: One-sentence summary.
   - **With Examples**: Explanation + real-world analogy.

---
*Powered by OpenAI & FastAPI.*
