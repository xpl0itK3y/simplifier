# Simplifier - Intelligent Web Text Transformation

<div align="center">
  <img src="assets/lv_0_20260115141610.gif" alt="Simplifier Generation Demo" width="100%" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
  
  <br><br>

  [![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)](https://python.org)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
  [![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
  [![OpenAI](https://img.shields.io/badge/LLM-OpenAI_GPT--4o-412991?logo=openai&logoColor=white)](https://openai.com)
  [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
</div>

## Overview

**Simplifier** is a high-performance Chrome Extension designed to reduce cognitive load by transforming complex web content into concise, digestible formats in real-time. Built on **Manifest V3**, it leverages advanced Large Language Models (LLMs) via a **FastAPI** backend to stream simplified text directly into the browser DOM without disrupting the original page layout.

The architecture prioritizes low latency, style isolation (Shadow DOM), and secure, stateless communication.

---

## Tech Stack & Architecture

### Frontend (Chrome Extension)
*   **Core**: Manifest V3 compliant, enforcing high security and performance standards.
*   **Runtime**: Vanilla JavaScript (ES6+) for maximum lightweight execution (no framework overhead).
*   **UI Isolation**: uses **Shadow DOM API** to fully encapsulate extension styles, preventing CSS conflicts with host pages.
*   **Communication**:
    *   **Server-Sent Events (SSE)**: Implements `fetch` with readable streams for real-time token streaming from the LLM, reducing perceived latency (TTFB).
    *   **Service Workers**: Background scripts manage authentication state (Google OAuth2 via `chrome.identity`) and context menu events.
*   **Localization**: Custom implementation of i18n support (`locales.js`) synchronized with `translations.json` for seamless dynamic language switching (EN/RU).

### Backend (API Service)
*   **Framework**: **FastAPI** (Python 3.12) - chosen for its asynchronous capabilities and high throughput.
*   **AI Integration**: OpenAI API (GPT-4o) with streaming enabled.
*   **Validation**: **Pydantic** models ensure strict type checking and data validation for all requests/responses.
*   **Security**: JWT-based stateless authentication flow verifying Google OAuth tokens.
*   **CORS**: Configured for strict origin control to only allow requests from the specific extension ID.

### Infrastructure
*   **Docker** (Optional): Containerized deployment support.
*   **UV**: Used for lightning-fast Python package management.

---

## Key Features

*   **Real-time Streaming**: Text is simplified and rendered token-by-token, providing immediate feedback to the user.
*   **Style Encapsulation**: The modal UI injects into a Shadow Root, ensuring it looks consistent on 100% of websites regardless of their CSS frameworks.
*   **Multiple Modes**:
    *   **Simple**: Plain language explanation.
    *   **Brief**: Maximum compression (TL;DR).
    *   **Key Points**: Extraction of main logic bullets.
    *   **With Examples**: Contextual analogy generation.
*   **Internationalization**: Full interface translation support.
*   **Enterprise-Grade Auth**: Secure login via Google Account with backend verification.

---

## Installation & Setup

### 1. Backend Setup

```bash
# Clone the repository
git clone https://github.com/your-repo/simplifier.git
cd simplifier/backend

# Install dependencies (using pip or uv)
pip install -r requirements.txt

# Configure Environment
# Create a .env file with your credentials:
# OPENAI_API_KEY=sk-...
# GOOGLE_CLIENT_ID=75...

# Run the server
uvicorn main:app --reload --port 8000
```

### 2. Extension Load

1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer mode** (top right toggle).
3.  Click **Load unpacked**.
4.  Select the `extension` directory from the project folder.

---

## Full Demonstration

A complete walkthrough of the application's capabilities, including authentication, settings configuration, and multi-mode text simplification.

<div align="center">
  <video src="https://github.com/user-attachments/assets/37a773c7-c811-44fa-8c50-30d9f04e1432" controls width="100%" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"></video>
</div>
