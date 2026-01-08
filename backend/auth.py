import requests
import os
from dotenv import load_dotenv

load_dotenv()

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

ALLOWED_EXTENSION_IDS = [
    "jdidlnlcanjlbabpcgkcdkpfigfemhjd"
]

def verify_google_token(token: str, extension_id: str = None):
    # Security: Verify Extension ID if provided
    if extension_id:
        extension_id = extension_id.strip()
        if extension_id not in ALLOWED_EXTENSION_IDS:
            print(f"DEBUG: Unauthorized extension attempted: {extension_id}")
            return None

    try:
        # Verify Access Token via Google Endpoint
        response = requests.get(
            "https://www.googleapis.com/oauth2/v3/tokeninfo",
            params={"access_token": token},
            timeout=5
        )
        
        if response.status_code != 200:
            print(f"DEBUG: Token check failed. Status: {response.status_code}, Body: {response.text}")
            return None
            
        info = response.json()
        
        # Security checks
        # 1. Check if token belongs to our client
        if info.get('aud') != CLIENT_ID:
            print(f"DEBUG: Token Audience mismatch. Expected {CLIENT_ID}, got {info.get('aud')}")
            return None
        
        # 2. Check if email is verified
        if not info.get('email_verified', False):
            print(f"DEBUG: Email not verified for user {info.get('email')}")
            return None
        
        # 3. Check token hasn't expired (expires_in is in seconds)
        expires_in = info.get('expires_in', 0)
        try:
            expires_in = int(expires_in)
            if expires_in < 60:  # Less than 1 minute remaining
                print(f"DEBUG: Token expiring soon ({expires_in}s remaining)")
                return None
        except (ValueError, TypeError):
            print(f"DEBUG: Invalid expires_in format: {expires_in}")
            # Continue anyway, other checks are more important

        # Return the unique user ID ('sub') and email
        return {
            'id': info['sub'],
            'email': info.get('email')
        }

    except requests.exceptions.Timeout:
        print("DEBUG: Token verification timeout")
        return None
    except Exception as e:
        print(f"DEBUG: Auth Exception: {e}")
        return None