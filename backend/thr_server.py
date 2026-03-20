"""
THR Lebaran Backend — Server-side Play Tracking & Anti-Cheat + Telegram Bot
==============================================================================
Lightweight Flask API + Telegram Bot for securing THR game.
Runs alongside trading bot on IDCloudHost.
"""

import os
import json
import time
import hmac
import hashlib
import threading
import requests
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
    'TELEGRAM_TOKEN': '8592265221:AAExujIGznvA-d4rFjnJKrQL2HdDuC8gLzw',
    'TELEGRAM_ADMIN_IDS': [],  # Will be auto-set on first /start_thr
}

# CORS — only allow GitHub Pages
ALLOWED_ORIGINS = [
    'https://shotcan.github.io',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
]
CORS(app, origins=ALLOWED_ORIGINS)

# ==================== ACTIVATION STATE ====================
THR_STATE = {
    'active': False,
    'start_time': None,
    'stopped': False,
}

# ==================== DATA STORE ====================
DATA_FILE = 'data/thr_plays.json'
STATE_FILE = 'data/thr_state.json'

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

def load_state():
    global THR_STATE
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r') as f:
                THR_STATE.update(json.load(f))
    except Exception:
        pass

def save_state():
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        json.dump(THR_STATE, f, indent=2, default=str)

# ==================== SECURITY ====================
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
            _rate_limits[key] = [t for t in _rate_limits[key] if now - t < 60]
            if len(_rate_limits[key]) >= max_per_minute:
                return jsonify({'error': 'Terlalu banyak request.', 'code': 'RATE_LIMIT'}), 429
            _rate_limits[key].append(now)
            return f(*args, **kwargs)
        return wrapper
    return decorator

def generate_claim_code(fingerprint, won, score):
    prefix = 'W' if won else 'T'
    ts = hex(int(time.time()))[-6:].upper()
    payload = f"{prefix}:{fingerprint}:{score}:{ts}"
    signature = hmac.new(
        THR_CONFIG['SECRET_KEY'].encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()[:8].upper()
    return f"{prefix}-{ts}-{signature}"

def get_current_round():
    if not THR_STATE['active'] or not THR_STATE['start_time']:
        return 0
    start = datetime.fromisoformat(THR_STATE['start_time'])
    now = datetime.utcnow() + timedelta(hours=7)
    elapsed_ms = (now - start).total_seconds() * 1000
    interval_ms = THR_CONFIG['INTERVAL_MINUTES'] * 60 * 1000
    return int(elapsed_ms // interval_ms)

def is_window_open():
    if not THR_STATE['active']:
        return False
    if not THR_STATE['start_time']:
        return False
    start = datetime.fromisoformat(THR_STATE['start_time'])
    now = datetime.utcnow() + timedelta(hours=7)
    elapsed_ms = (now - start).total_seconds() * 1000
    interval_ms = THR_CONFIG['INTERVAL_MINUTES'] * 60 * 1000
    window_ms = THR_CONFIG['WINDOW_MINUTES'] * 60 * 1000
    time_in_slot = elapsed_ms % interval_ms
    return time_in_slot <= window_ms

# ==================== API ROUTES ====================

@app.route('/api/status', methods=['GET'])
def status():
    store = load_data()
    current_round = get_current_round()
    round_idx = min(current_round, len(THR_CONFIG['SLOTS_PER_ROUND']) - 1)
    max_slots = THR_CONFIG['SLOTS_PER_ROUND'][round_idx]
    round_plays = len([p for p in store['plays'] if p.get('round', -1) == current_round])
    
    return jsonify({
        'active': THR_STATE['active'],
        'start_time': THR_STATE['start_time'],
        'total_players': len(store['plays']),
        'max_players': THR_CONFIG['MAX_TOTAL_PLAYERS'],
        'winners': store['winners'],
        'max_winners': THR_CONFIG['MAX_WINNERS'],
        'budget_left': THR_CONFIG['TOTAL_BUDGET'] - store['total_spent'],
        'window_open': is_window_open(),
        'round': current_round,
        'slots_left': max(0, max_slots - round_plays),
    })

@app.route('/api/can-play', methods=['POST'])
@rate_limit(max_per_minute=15)
def can_play():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    fingerprint = data.get('fingerprint', '')
    if not fingerprint or len(fingerprint) < 4:
        return jsonify({'error': 'Invalid fingerprint'}), 400
    
    store = load_data()
    played = any(p['fingerprint'] == fingerprint for p in store['plays'])
    total_players = len(store['plays'])
    budget_left = THR_CONFIG['TOTAL_BUDGET'] - store['total_spent']
    window_open = is_window_open()
    current_round = get_current_round()
    
    round_idx = min(current_round, len(THR_CONFIG['SLOTS_PER_ROUND']) - 1)
    max_slots = THR_CONFIG['SLOTS_PER_ROUND'][round_idx]
    round_plays = len([p for p in store['plays'] if p.get('round', -1) == current_round])
    slots_left = max(0, max_slots - round_plays)
    
    can = (not played and THR_STATE['active'] and window_open 
           and budget_left > 0 and slots_left > 0)
    
    return jsonify({
        'can_play': can,
        'already_played': played,
        'active': THR_STATE['active'],
        'window_open': window_open,
        'budget_exhausted': budget_left <= 0,
        'slots_left': slots_left,
        'total_players': total_players,
        'max_players': THR_CONFIG['MAX_TOTAL_PLAYERS'],
        'winners': store['winners'],
        'max_winners': THR_CONFIG['MAX_WINNERS'],
        'round': current_round,
        'previous': next((p for p in store['plays'] if p['fingerprint'] == fingerprint), None),
    })

@app.route('/api/record', methods=['POST'])
@rate_limit(max_per_minute=5)
def record_play():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request'}), 400
    
    fingerprint = data.get('fingerprint', '')
    score = data.get('score', 0)
    won = data.get('won', False)
    game_duration = data.get('duration', 0)
    name = data.get('name', 'Anonim')[:20]  # Max 20 chars
    
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
    
    # Anti-cheat: THR active?
    if not THR_STATE['active']:
        return jsonify({'error': 'THR belum dibuka!', 'code': 'NOT_ACTIVE'}), 403
    
    # Anti-cheat: window open?
    if not is_window_open():
        return jsonify({'error': 'Ronde belum dibuka!', 'code': 'WINDOW_CLOSED'}), 403
    
    # Anti-cheat: budget
    if store['total_spent'] >= THR_CONFIG['TOTAL_BUDGET']:
        return jsonify({'error': 'Budget habis!', 'code': 'BUDGET_EXHAUSTED'}), 403
    
    # Anti-cheat: game too short
    if game_duration < 13000:
        won = False
        score = min(score, 5)
    
    # Anti-cheat: impossible score
    if score > 50:
        won = False
        score = min(score, 10)
    
    # Force lose if max winners reached
    if won and store['winners'] >= THR_CONFIG['MAX_WINNERS']:
        won = False
    
    prize = THR_CONFIG['PRIZE_WIN'] if won else THR_CONFIG['PRIZE_LOSE']
    claim_code = generate_claim_code(fingerprint, won, score)
    
    ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    play_record = {
        'fingerprint': fingerprint,
        'name': name,
        'ip': ip,
        'score': score,
        'won': won,
        'prize': prize,
        'claim_code': claim_code,
        'round': get_current_round(),
        'duration': game_duration,
        'timestamp': datetime.utcnow().isoformat(),
        'user_agent': request.headers.get('User-Agent', '')[:100],
    }
    
    store['plays'].append(play_record)
    store['total_spent'] += prize
    if won:
        store['winners'] += 1
    save_data(store)
    
    # Notify admin via Telegram
    notify_admin_play(play_record)
    
    return jsonify({
        'success': True,
        'won': won,
        'prize': prize,
        'claim_code': claim_code,
        'message': 'Selamat! THR kamu sudah dicatat.' if won else 'THR kamu sudah dicatat!',
    })

@app.route('/api/leaderboard', methods=['GET'])
def leaderboard():
    """Public leaderboard — top scores."""
    store = load_data()
    plays = store.get('plays', [])
    # Sort by score descending, take top 12
    sorted_plays = sorted(plays, key=lambda p: p.get('score', 0), reverse=True)
    board = []
    for i, p in enumerate(sorted_plays[:12], 1):
        board.append({
            'rank': i,
            'name': p.get('name', 'Anonim'),
            'score': p.get('score', 0),
            'won': p.get('won', False),
            'round': p.get('round', 0) + 1,
        })
    return jsonify({'leaderboard': board, 'total': len(plays)})

# ==================== ADMIN API ====================

@app.route('/api/admin', methods=['GET'])
def admin():
    key = request.args.get('key', '')
    if key != THR_CONFIG['ADMIN_KEY']:
        return jsonify({'error': 'Unauthorized'}), 401
    store = load_data()
    return jsonify({
        'state': THR_STATE,
        'plays': store['plays'],
        'winners': store['winners'],
        'total_spent': store['total_spent'],
        'budget_left': THR_CONFIG['TOTAL_BUDGET'] - store['total_spent'],
        'total_players': len(store['plays']),
    })

@app.route('/api/admin/reset', methods=['POST'])
def admin_reset():
    key = request.args.get('key', '')
    if key != THR_CONFIG['ADMIN_KEY']:
        return jsonify({'error': 'Unauthorized'}), 401
    save_data({'plays': [], 'winners': 0, 'total_spent': 0, 'created': datetime.utcnow().isoformat()})
    THR_STATE['active'] = False
    THR_STATE['start_time'] = None
    THR_STATE['stopped'] = False
    save_state()
    return jsonify({'success': True, 'message': 'All data reset'})

# ==================== TELEGRAM BOT ====================
TELEGRAM_API = f"https://api.telegram.org/bot{THR_CONFIG['TELEGRAM_TOKEN']}"

def tg_send(chat_id, text, parse_mode='HTML'):
    try:
        requests.post(f"{TELEGRAM_API}/sendMessage", json={
            'chat_id': chat_id,
            'text': text,
            'parse_mode': parse_mode,
        }, timeout=5)
    except Exception as e:
        print(f"[TG] Send error: {e}")

def notify_admin_play(play):
    """Notify admin when someone plays."""
    icon = '🏆' if play['won'] else '🎁'
    prize = f"Rp {play['prize']:,}".replace(',', '.')
    store = load_data()
    msg = (
        f"{icon} <b>THR Dimainkan!</b>\n\n"
        f"Nama: {play.get('name', 'Anonim')}\n"
        f"Skor: {play['score']} poin\n"
        f"Hadiah: {prize}\n"
        f"Ronde: {play['round'] + 1}\n"
        f"Total pemain: {len(store['plays'])}/{THR_CONFIG['MAX_TOTAL_PLAYERS']}\n"
        f"Sisa budget: Rp {THR_CONFIG['TOTAL_BUDGET'] - store['total_spent']:,}".replace(',', '.')
    )
    for admin_id in THR_CONFIG['TELEGRAM_ADMIN_IDS']:
        tg_send(admin_id, msg)

def handle_telegram_update(update):
    """Process incoming Telegram message."""
    try:
        msg = update.get('message', {})
        text = msg.get('text', '').strip()
        chat_id = msg.get('chat', {}).get('id')
        user_id = msg.get('from', {}).get('id')
        
        if not text or not chat_id:
            return
        
        # Auto-register first user as admin
        if user_id and user_id not in THR_CONFIG['TELEGRAM_ADMIN_IDS']:
            if text.startswith('/start_thr') or text.startswith('/stop_thr'):
                THR_CONFIG['TELEGRAM_ADMIN_IDS'].append(user_id)
        
        # Check admin
        if user_id not in THR_CONFIG['TELEGRAM_ADMIN_IDS']:
            tg_send(chat_id, "⛔ Kamu bukan admin THR.")
            return
        
        if text == '/start_thr':
            if THR_STATE['active']:
                tg_send(chat_id, "⚠️ THR sudah aktif sejak " + (THR_STATE['start_time'] or '?'))
                return
            
            now_wib = datetime.utcnow() + timedelta(hours=7)
            THR_STATE['active'] = True
            THR_STATE['start_time'] = now_wib.isoformat()
            THR_STATE['stopped'] = False
            save_state()
            
            store = load_data()
            msg = (
                "🎉 <b>THR LEBARAN DIBUKA!</b> 🎉\n\n"
                f"⏰ Mulai: {now_wib.strftime('%H:%M WIB')}\n"
                f"📋 Total ronde: {len(THR_CONFIG['SLOTS_PER_ROUND'])}\n"
                f"⏱ Interval: {THR_CONFIG['INTERVAL_MINUTES']} menit\n"
                f"💰 Budget: Rp {THR_CONFIG['TOTAL_BUDGET']:,}\n".replace(',', '.') +
                f"👥 Max pemain: {THR_CONFIG['MAX_TOTAL_PLAYERS']}\n\n"
                "Timer sudah jalan! Ronde 1 dimulai sekarang."
            )
            tg_send(chat_id, msg)
        
        elif text == '/stop_thr':
            THR_STATE['active'] = False
            THR_STATE['stopped'] = True
            save_state()
            
            store = load_data()
            msg = (
                "🛑 <b>THR DIHENTIKAN</b>\n\n"
                f"Total pemain: {len(store['plays'])}\n"
                f"Budget terpakai: Rp {store['total_spent']:,}\n".replace(',', '.') +
                f"Sisa: Rp {THR_CONFIG['TOTAL_BUDGET'] - store['total_spent']:,}".replace(',', '.')
            )
            tg_send(chat_id, msg)
        
        elif text == '/status_thr':
            store = load_data()
            state = "✅ AKTIF" if THR_STATE['active'] else "⏸ NONAKTIF"
            msg = (
                f"📊 <b>Status THR</b>\n\n"
                f"Status: {state}\n"
                f"Mulai: {THR_STATE.get('start_time', '-')}\n"
                f"Ronde: {get_current_round() + 1}\n"
                f"Window: {'🟢 Terbuka' if is_window_open() else '🔴 Tertutup'}\n"
                f"Pemain: {len(store['plays'])}/{THR_CONFIG['MAX_TOTAL_PLAYERS']}\n"
                f"Pemenang 10k: {store['winners']}/{THR_CONFIG['MAX_WINNERS']}\n"
                f"Budget sisa: Rp {THR_CONFIG['TOTAL_BUDGET'] - store['total_spent']:,}\n".replace(',', '.') +
                "\nDaftar pemain:\n"
            )
            for i, p in enumerate(store['plays'], 1):
                icon = '🏆' if p['won'] else '🎁'
                msg += f"{i}. {icon} Skor:{p['score']} Rp{p['prize']:,} R{p['round']+1}\n"
            
            if not store['plays']:
                msg += "(Belum ada pemain)"
            
            tg_send(chat_id, msg)
        
        elif text == '/help_thr':
            msg = (
                "🎮 <b>THR Bot Commands</b>\n\n"
                "/start_thr — Mulai THR (timer jalan)\n"
                "/stop_thr — Hentikan THR\n"
                "/status_thr — Lihat status & pemain\n"
                "/help_thr — Bantuan"
            )
            tg_send(chat_id, msg)
        
        elif text == '/start':
            msg = (
                "🕌 <b>THR Lebaran Bot</b>\n\n"
                "Selamat datang! Bot ini untuk kontrol THR Lebaran.\n\n"
                "/start_thr — Mulai THR\n"
                "/status_thr — Lihat status\n"
                "/help_thr — Bantuan"
            )
            tg_send(chat_id, msg)
    
    except Exception as e:
        print(f"[TG] Error handling update: {e}")

def telegram_polling():
    """Long-polling for Telegram updates."""
    print("[TG] Starting Telegram bot polling...")
    offset = 0
    while True:
        try:
            resp = requests.get(f"{TELEGRAM_API}/getUpdates", params={
                'offset': offset,
                'timeout': 30,
            }, timeout=35)
            
            if resp.status_code == 200:
                data = resp.json()
                for update in data.get('result', []):
                    offset = update['update_id'] + 1
                    handle_telegram_update(update)
        except Exception as e:
            print(f"[TG] Polling error: {e}")
            time.sleep(5)

# ==================== HEALTH ====================
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'service': 'THR Lebaran 1447H',
        'active': THR_STATE['active'],
        'time': datetime.utcnow().isoformat(),
    })

if __name__ == '__main__':
    os.makedirs('data', exist_ok=True)
    load_state()
    
    # Start Telegram bot in background thread
    tg_thread = threading.Thread(target=telegram_polling, daemon=True)
    tg_thread.start()
    print("[THR] Server starting on port 5050...")
    
    app.run(host='0.0.0.0', port=5050, debug=False)
