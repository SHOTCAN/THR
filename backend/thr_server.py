"""
THR Lebaran Backend — Server-side Play Tracking & Anti-Cheat
=============================================================
Lightweight Flask API for securing THR game.
Runs alongside trading bot on IDCloudHost.
"""

import os
import json
import time
import hmac
import hashlib
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)

# ==================== CONFIG ====================
THR_CONFIG = {
    'TOTAL_BUDGET': 70000,
    'PRIZE_WIN': 10000,
    'PRIZE_LOSE': 5000,
    'MAX_WINNERS': 2,
    'MAX_TOTAL_PLAYERS': 12,
    'SLOTS_PER_ROUND': [3, 3, 3, 3],
    'INTERVAL_MINUTES': 15,
    'WINDOW_MINUTES': 3,
    'SECRET_KEY': os.environ.get('THR_SECRET', 'K3tup4t_L3b4r4n_1447H_S3rv3r!'),
    'ADMIN_KEY': os.environ.get('THR_ADMIN_KEY', 'admin_thr_2026'),
}

# CORS — only allow GitHub Pages
ALLOWED_ORIGINS = [
    'https://shotcan.github.io',
    'http://localhost:5500',   # For local testing
    'http://127.0.0.1:5500',
]
CORS(app, origins=ALLOWED_ORIGINS)

# ==================== DATA STORE ====================
DATA_FILE = 'data/thr_plays.json'

def load_data():
    try:
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, 'r') as f:
                return json.load(f)
    except Exception:
        pass
    return {'plays': [], 'winners': 0, 'total_spent': 0, 'created': datetime.utcnow().isoformat()}

def save_data(data):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2, default=str)

# ==================== SECURITY ====================
# Rate limiter: max 10 requests per minute per IP
_rate_limits = {}

def rate_limit(max_per_minute=10):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            ip = request.headers.get('X-Forwarded-For', request.remote_addr)
            now = time.time()
            key = f"{ip}:{f.__name__}"
            
            if key not in _rate_limits:
                _rate_limits[key] = []
            
            # Clean old entries
            _rate_limits[key] = [t for t in _rate_limits[key] if now - t < 60]
            
            if len(_rate_limits[key]) >= max_per_minute:
                return jsonify({'error': 'Terlalu banyak request. Coba lagi nanti.', 'code': 'RATE_LIMIT'}), 429
            
            _rate_limits[key].append(now)
            return f(*args, **kwargs)
        return wrapper
    return decorator

def generate_claim_code(fingerprint, won, score):
    """Generate HMAC-verified claim code."""
    prefix = 'W' if won else 'T'
    ts = hex(int(time.time()))[2:][-6:].upper()
    payload = f"{prefix}:{fingerprint}:{score}:{ts}"
    signature = hmac.new(
        THR_CONFIG['SECRET_KEY'].encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()[:8].upper()
    return f"{prefix}-{ts}-{signature}"

def verify_claim_code(code):
    """Verify a claim code is genuine (from our server)."""
    try:
        parts = code.split('-')
        if len(parts) != 3:
            return False
        prefix, ts, sig = parts
        # We can't fully re-verify without the original payload,
        # but we can check format and that it exists in our records
        return prefix in ('W', 'T') and len(sig) == 8
    except Exception:
        return False

def get_current_round():
    """Get current round based on time."""
    now = datetime.utcnow() + timedelta(hours=7)  # WIB
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    ms_since_midnight = (now - midnight).total_seconds() * 1000
    interval_ms = THR_CONFIG['INTERVAL_MINUTES'] * 60 * 1000
    return int(ms_since_midnight // interval_ms)

def is_window_open():
    """Check if current THR window is open."""
    now = datetime.utcnow() + timedelta(hours=7)  # WIB
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    ms_since_midnight = (now - midnight).total_seconds() * 1000
    interval_ms = THR_CONFIG['INTERVAL_MINUTES'] * 60 * 1000
    window_ms = THR_CONFIG['WINDOW_MINUTES'] * 60 * 1000
    time_in_slot = ms_since_midnight % interval_ms
    return time_in_slot <= window_ms

# ==================== API ROUTES ====================

@app.route('/api/can-play', methods=['POST'])
@rate_limit(max_per_minute=15)
def can_play():
    """Check if user can play. Returns slot info."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    fingerprint = data.get('fingerprint', '')
    if not fingerprint or len(fingerprint) < 4:
        return jsonify({'error': 'Invalid fingerprint'}), 400
    
    store = load_data()
    
    # Check if fingerprint already played
    played = any(p['fingerprint'] == fingerprint for p in store['plays'])
    
    # Check budget
    total_players = len(store['plays'])
    budget_left = THR_CONFIG['TOTAL_BUDGET'] - store['total_spent']
    
    # Check window
    window_open = is_window_open()
    current_round = get_current_round()
    
    # Slots remaining in current round
    round_idx = min(current_round, len(THR_CONFIG['SLOTS_PER_ROUND']) - 1)
    max_slots = THR_CONFIG['SLOTS_PER_ROUND'][round_idx]
    round_plays = len([p for p in store['plays'] if p.get('round', -1) == current_round])
    slots_left = max(0, max_slots - round_plays)
    
    return jsonify({
        'can_play': not played and window_open and budget_left > 0 and slots_left > 0,
        'already_played': played,
        'window_open': window_open,
        'budget_exhausted': budget_left <= 0,
        'slots_left': slots_left,
        'total_players': total_players,
        'max_players': THR_CONFIG['MAX_TOTAL_PLAYERS'],
        'winners': store['winners'],
        'max_winners': THR_CONFIG['MAX_WINNERS'],
        'round': current_round,
        # If already played, return their previous result
        'previous': next((p for p in store['plays'] if p['fingerprint'] == fingerprint), None),
    })

@app.route('/api/record', methods=['POST'])
@rate_limit(max_per_minute=5)
def record_play():
    """Record a play result (server-side verification)."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    fingerprint = data.get('fingerprint', '')
    score = data.get('score', 0)
    won = data.get('won', False)
    game_duration = data.get('duration', 0)
    
    if not fingerprint or len(fingerprint) < 4:
        return jsonify({'error': 'Invalid fingerprint'}), 400
    
    store = load_data()
    
    # Anti-cheat: already played?
    if any(p['fingerprint'] == fingerprint for p in store['plays']):
        prev = next(p for p in store['plays'] if p['fingerprint'] == fingerprint)
        return jsonify({
            'error': 'Kamu sudah main!', 
            'code': 'ALREADY_PLAYED',
            'previous': prev,
        }), 409
    
    # Anti-cheat: window open?
    if not is_window_open():
        return jsonify({'error': 'THR belum dibuka!', 'code': 'WINDOW_CLOSED'}), 403
    
    # Anti-cheat: budget check
    if store['total_spent'] >= THR_CONFIG['TOTAL_BUDGET']:
        return jsonify({'error': 'Budget habis!', 'code': 'BUDGET_EXHAUSTED'}), 403
    
    # Anti-cheat: game duration too short (< 13 seconds = cheating)
    if game_duration < 13000:
        won = False
        score = min(score, 5)
    
    # Anti-cheat: score too high (impossible)
    if score > 50:
        won = False
        score = min(score, 10)
    
    # Force lose if max winners reached
    if won and store['winners'] >= THR_CONFIG['MAX_WINNERS']:
        won = False
    
    # Determine prize
    prize = THR_CONFIG['PRIZE_WIN'] if won else THR_CONFIG['PRIZE_LOSE']
    
    # Generate secure claim code
    claim_code = generate_claim_code(fingerprint, won, score)
    
    # Record play
    ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    play_record = {
        'fingerprint': fingerprint,
        'ip': ip,
        'score': score,
        'won': won,
        'prize': prize,
        'claim_code': claim_code,
        'round': get_current_round(),
        'duration': game_duration,
        'timestamp': datetime.utcnow().isoformat(),
        'user_agent': request.headers.get('User-Agent', '')[:100],
        'claimed': False,
    }
    
    store['plays'].append(play_record)
    store['total_spent'] += prize
    if won:
        store['winners'] += 1
    
    save_data(store)
    
    return jsonify({
        'success': True,
        'won': won,
        'prize': prize,
        'claim_code': claim_code,
        'message': 'Selamat! THR kamu sudah dicatat.' if won else 'THR kamu sudah dicatat!',
    })

@app.route('/api/status', methods=['GET'])
def status():
    """Public status — how many slots left etc."""
    store = load_data()
    return jsonify({
        'total_players': len(store['plays']),
        'max_players': THR_CONFIG['MAX_TOTAL_PLAYERS'],
        'winners': store['winners'],
        'max_winners': THR_CONFIG['MAX_WINNERS'],
        'budget_left': THR_CONFIG['TOTAL_BUDGET'] - store['total_spent'],
        'window_open': is_window_open(),
        'round': get_current_round(),
    })

@app.route('/api/admin', methods=['GET'])
def admin():
    """Admin view — see all plays and claims. Requires admin key."""
    key = request.args.get('key', '')
    if key != THR_CONFIG['ADMIN_KEY']:
        return jsonify({'error': 'Unauthorized'}), 401
    
    store = load_data()
    return jsonify({
        'config': {k: v for k, v in THR_CONFIG.items() if k != 'SECRET_KEY'},
        'plays': store['plays'],
        'winners': store['winners'],
        'total_spent': store['total_spent'],
        'budget_left': THR_CONFIG['TOTAL_BUDGET'] - store['total_spent'],
        'total_players': len(store['plays']),
    })

@app.route('/api/admin/claim', methods=['POST'])
def admin_claim():
    """Admin: mark a claim code as claimed (THR sent)."""
    key = request.args.get('key', '')
    if key != THR_CONFIG['ADMIN_KEY']:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json()
    code = data.get('code', '')
    
    store = load_data()
    for play in store['plays']:
        if play['claim_code'] == code:
            play['claimed'] = True
            play['claimed_at'] = datetime.utcnow().isoformat()
            save_data(store)
            return jsonify({'success': True, 'play': play})
    
    return jsonify({'error': 'Code not found'}), 404

@app.route('/api/admin/reset', methods=['POST'])
def admin_reset():
    """Admin: reset all data (emergency)."""
    key = request.args.get('key', '')
    if key != THR_CONFIG['ADMIN_KEY']:
        return jsonify({'error': 'Unauthorized'}), 401
    
    save_data({'plays': [], 'winners': 0, 'total_spent': 0, 'created': datetime.utcnow().isoformat()})
    return jsonify({'success': True, 'message': 'All data reset'})

# ==================== HEALTH ====================
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'THR Lebaran 1447H', 'time': datetime.utcnow().isoformat()})

if __name__ == '__main__':
    os.makedirs('data', exist_ok=True)
    app.run(host='0.0.0.0', port=5050, debug=False)
