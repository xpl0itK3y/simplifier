import sqlite3
import os
from datetime import datetime, timedelta
from contextlib import contextmanager
import time

DB_NAME = "users.db"

# Subscription plan configurations
SUBSCRIPTION_PLANS = {
    'free': {
        'id': 'free',
        'name': 'Бесплатный',
        'max_chars': 5000,
        'max_requests': 15,
        'ai_settings_enabled': False,
        'price': 0
    },
    'go': {
        'id': 'go',
        'name': 'GO',
        'max_chars': 10000,
        'max_requests': 25,
        'ai_settings_enabled': True,
        'price': 1.5
    }
}

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = sqlite3.connect(DB_NAME, timeout=10.0)
    conn.row_factory = sqlite3.Row  # Enable dict-like access
    conn.execute("PRAGMA journal_mode=WAL")
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
        
        # Create subscription_plans table
        c.execute('''
            CREATE TABLE IF NOT EXISTS subscription_plans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                max_chars INTEGER DEFAULT 5000,
                max_requests INTEGER DEFAULT 15,
                ai_settings_enabled INTEGER DEFAULT 0,
                price REAL DEFAULT 0
            )
        ''')
        
        # Insert default plans
        for plan_id, plan in SUBSCRIPTION_PLANS.items():
            c.execute('''
                INSERT OR REPLACE INTO subscription_plans 
                (id, name, max_chars, max_requests, ai_settings_enabled, price)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (plan['id'], plan['name'], plan['max_chars'], 
                  plan['max_requests'], 1 if plan['ai_settings_enabled'] else 0, plan['price']))
        
        # Create users table with subscription fields, email and AI settings
        c.execute('''
            CREATE TABLE IF NOT EXISTS users (
                google_id TEXT PRIMARY KEY,
                email TEXT,
                requests_used INTEGER DEFAULT 0,
                last_reset DATE,
                last_request_time REAL DEFAULT 0,
                subscription_id TEXT DEFAULT 'free',
                subscription_expires DATE,
                setting_simple_level INTEGER DEFAULT 5,
                setting_short_level INTEGER DEFAULT 5,
                setting_points_count INTEGER DEFAULT 5,
                setting_examples_count INTEGER DEFAULT 2
            )
        ''')
        
        # Migrations
        columns = [row['name'] for row in conn.execute(f"PRAGMA table_info(users)").fetchall()]
        
        if 'subscription_id' not in columns:
            print("Migrating: adding subscription columns...")
            c.execute('ALTER TABLE users ADD COLUMN subscription_id TEXT DEFAULT "free"')
            c.execute('ALTER TABLE users ADD COLUMN subscription_expires DATE')

        if 'email' not in columns:
            print("Migrating: adding email column...")
            c.execute('ALTER TABLE users ADD COLUMN email TEXT')

        if 'requests_used' not in columns:
            print("Migrating: converting credits to requests_used...")
            c.execute('ALTER TABLE users ADD COLUMN requests_used INTEGER DEFAULT 0')
            if 'credits' in columns:
                c.execute('UPDATE users SET requests_used = MAX(0, 15 - credits)')
            print("Migration to requests_used complete!")

        # Migration for AI settings
        ai_settings_cols = {
            'setting_simple_level': 'INTEGER DEFAULT 5',
            'setting_short_level': 'INTEGER DEFAULT 5',
            'setting_points_count': 'INTEGER DEFAULT 5',
            'setting_examples_count': 'INTEGER DEFAULT 2'
        }
        for col, definition in ai_settings_cols.items():
            if col not in columns:
                print(f"Migrating: adding {col} column...")
                c.execute(f'ALTER TABLE users ADD COLUMN {col} {definition}')

def get_all_plans():
    """Get all available subscription plans"""
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM subscription_plans ORDER BY price ASC')
        rows = c.fetchall()
        return [dict(row) for row in rows]

def get_plan(plan_id: str):
    """Get a specific plan by ID"""
    with get_db() as conn:
        c = conn.cursor()
        c.execute('SELECT * FROM subscription_plans WHERE id = ?', (plan_id,))
        row = c.fetchone()
        return dict(row) if row else None

def get_user_subscription(google_id: str, email: str = None) -> dict:
    """Get user's subscription info and settings. Syncs email and creates user if missing."""
    with get_db() as conn:
        c = conn.cursor()
        c.execute('''
            SELECT u.*, 
                   p.name as plan_name, p.max_chars, p.max_requests, p.ai_settings_enabled, p.price
            FROM users u
            LEFT JOIN subscription_plans p ON u.subscription_id = p.id
            WHERE u.google_id = ?
        ''', (google_id,))
        row = c.fetchone()
        
        current_date = datetime.now().date()
        
        if row is None:
            # New user
            c.execute('''
                INSERT INTO users (google_id, email, requests_used, last_reset, subscription_id) 
                VALUES (?, ?, 0, ?, 'free')
            ''', (google_id, email, current_date))
            
            plan = get_plan('free')
            return {
                'google_id': google_id,
                'email': email,
                'plan_id': 'free',
                'plan_name': plan['name'],
                'requests_used': 0,
                'max_requests': plan['max_requests'],
                'max_chars': plan['max_chars'],
                'ai_settings_enabled': bool(plan['ai_settings_enabled']),
                'expires': None,
                'settings': {
                    'simple_level': 5,
                    'short_level': 5,
                    'points_count': 5,
                    'examples_count': 2
                }
            }
        
        # Sync email
        if email and row['email'] != email:
            c.execute('UPDATE users SET email = ? WHERE google_id = ?', (email, google_id))

        # Check subscription expiry
        subscription_id = row['subscription_id'] or 'free'
        expires = row['subscription_expires']
        
        if expires and subscription_id != 'free':
            expire_date = datetime.strptime(expires, '%Y-%m-%d').date()
            if current_date > expire_date:
                subscription_id = 'free'
                c.execute('''
                    UPDATE users SET subscription_id = 'free', subscription_expires = NULL 
                    WHERE google_id = ?
                ''', (google_id,))
        
        # Check if month reset needed
        requests_used = row['requests_used']
        last_reset_str = row['last_reset']
        plan = get_plan(subscription_id)
        
        if last_reset_str:
            last_reset = datetime.strptime(last_reset_str, '%Y-%m-%d').date()
            if current_date.month != last_reset.month or current_date.year > last_reset.year:
                requests_used = 0
                c.execute('UPDATE users SET requests_used = 0, last_reset = ? WHERE google_id = ?', 
                          (current_date, google_id))
        
        return {
            'google_id': google_id,
            'email': email or row['email'],
            'plan_id': subscription_id,
            'plan_name': plan['name'],
            'requests_used': requests_used,
            'max_requests': plan['max_requests'],
            'max_chars': plan['max_chars'],
            'ai_settings_enabled': bool(plan['ai_settings_enabled']),
            'expires': expires,
            'settings': {
                'simple_level': row['setting_simple_level'],
                'short_level': row['setting_short_level'],
                'points_count': row['setting_points_count'],
                'examples_count': row['setting_examples_count']
            }
        }

def update_user_settings(google_id: str, settings: dict) -> bool:
    """Update user's AI settings"""
    with get_db() as conn:
        c = conn.cursor()
        c.execute('''
            UPDATE users SET 
                setting_simple_level = ?,
                setting_short_level = ?,
                setting_points_count = ?,
                setting_examples_count = ?
            WHERE google_id = ?
        ''', (
            settings.get('simple_level', 5),
            settings.get('short_level', 5),
            settings.get('points_count', 5),
            settings.get('examples_count', 2),
            google_id
        ))
        return c.rowcount > 0

def upgrade_user(google_id: str, plan_id: str) -> bool:
    """Upgrade user to a different plan"""
    plan = get_plan(plan_id)
    if not plan:
        return False
    
    with get_db() as conn:
        c = conn.cursor()
        current_date = datetime.now().date()
        
        expires = None
        if plan['price'] > 0:
            expires = (datetime.now() + timedelta(days=30)).date()
        
        c.execute('SELECT google_id FROM users WHERE google_id = ?', (google_id,))
        if c.fetchone() is None:
            c.execute('''
                INSERT INTO users (google_id, requests_used, last_reset, subscription_id, subscription_expires)
                VALUES (?, 0, ?, ?, ?)
            ''', (google_id, current_date, plan_id, expires))
        else:
            c.execute('''
                UPDATE users 
                SET subscription_id = ?, subscription_expires = ?
                WHERE google_id = ?
            ''', (plan_id, expires, google_id))
        
        return True

def increment_usage(google_id: str, limit: int) -> bool:
    """Increment requests_used if within limit. Returns True if successful."""
    with get_db() as conn:
        c = conn.cursor()
        current_time = time.time()
        
        # Check last request time
        c.execute('SELECT last_request_time, requests_used FROM users WHERE google_id = ?', (google_id,))
        row = c.fetchone()
        
        if row and row['last_request_time']:
            time_since_last = current_time - row['last_request_time']
            if time_since_last < 2.0:
                print(f"DEBUG: Duplicate request blocked for {google_id}")
                return False
        
        # Increment and update timestamp atomically
        c.execute('''
            UPDATE users 
            SET requests_used = requests_used + 1, last_request_time = ? 
            WHERE google_id = ? AND requests_used < ?
        ''', (current_time, google_id, limit))
        
        return c.rowcount > 0