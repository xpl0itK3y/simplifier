import sqlite3
import os
from datetime import datetime, timedelta
from contextlib import contextmanager

DB_NAME = "users.db"

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DB_NAME, timeout=10.0)
    conn.execute("PRAGMA journal_mode=WAL")  # Better concurrency
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        c = conn.cursor()
        # Create table with credits and reset date
        c.execute('''
            CREATE TABLE IF NOT EXISTS users (
                google_id TEXT PRIMARY KEY,
                credits INTEGER DEFAULT 15,
                last_reset DATE,
                last_request_time REAL DEFAULT 0
            )
        ''')
        
        # Migration: Add last_request_time column if it doesn't exist
        try:
            c.execute('SELECT last_request_time FROM users LIMIT 1')
        except sqlite3.OperationalError:
            print("Migrating database: adding last_request_time column...")
            c.execute('ALTER TABLE users ADD COLUMN last_request_time REAL DEFAULT 0')
            print("Migration complete!")

def get_user_credits(google_id: str) -> int:
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT credits, last_reset FROM users WHERE google_id = ?', (google_id,))
        row = c.fetchone()
        
        current_date = datetime.now().date()
        
        if row is None:
            # New user
            c.execute('INSERT INTO users (google_id, credits, last_reset) VALUES (?, ?, ?)', 
                      (google_id, 15, current_date))
            credits = 15
        else:
            credits, last_reset_str = row
            # Check if reset is needed
            if last_reset_str:
                last_reset = datetime.strptime(last_reset_str, '%Y-%m-%d').date()
                if current_date.month != last_reset.month or current_date.year > last_reset.year:
                    # New month! Reset.
                    credits = 15
                    c.execute('UPDATE users SET credits = ?, last_reset = ? WHERE google_id = ?', 
                              (15, current_date, google_id))
            else:
                # Migration for existing users without date
                c.execute('UPDATE users SET last_reset = ? WHERE google_id = ?', (current_date, google_id))
        
        return credits

def decrement_credits(google_id: str) -> bool:
    """
    Decrement credits with duplicate request protection.
    Returns True if successful, False if request was too recent (duplicate).
    """
    import time
    
    with get_db() as conn:
        c = conn.cursor()
        
        # Check last request time (prevent duplicates within 2 seconds)
        current_time = time.time()
        c.execute('SELECT last_request_time FROM users WHERE google_id = ?', (google_id,))
        row = c.fetchone()
        
        if row and row[0]:
            time_since_last = current_time - row[0]
            if time_since_last < 2.0:  # Less than 2 seconds
                print(f"DEBUG: Duplicate request blocked for {google_id} (gap: {time_since_last:.2f}s)")
                return False
        
        # Decrement and update timestamp atomically
        c.execute('''
            UPDATE users 
            SET credits = credits - 1, 
                last_request_time = ? 
            WHERE google_id = ? AND credits > 0
        ''', (current_time, google_id))
        
        return c.rowcount > 0