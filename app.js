// ==================== ANTI-TAMPER SECURITY ====================
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', function(e) {
    if (e.key === 'F12') { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && ['I','i','J','j','C','c'].includes(e.key)) { e.preventDefault(); return false; }
    if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); return false; }
});

const _dt = { _o: false };
setInterval(() => {
    const w = window.outerWidth - window.innerWidth > 160;
    const h = window.outerHeight - window.innerHeight > 160;
    if (w || h) _dt._o = true;
}, 1000);

// ==================== CONFIG ====================
// EDIT THESE VALUES TO CUSTOMIZE YOUR THR EVENT!
const CONFIG = {
    TOTAL_BUDGET: 70000,
    PRIZE_WIN: 10000,
    PRIZE_LOSE: 5000,
    MAX_WINNERS: 2,
    MAX_TOTAL_PLAYERS: 12,
    SLOTS_PER_ROUND: [3, 3, 3, 3],
    INTERVAL_MINUTES: 15,
    WINDOW_MINUTES: 3,
    // Backend API
    API_URL: 'https://jokoisml.my.id/thr',
    // DANA data is SERVER-SIDE ONLY for security
};

// ==================== SECURITY MODULE ====================
const Security = (() => {
    const STORAGE_KEY = 'thr_leb_1447h';
    const COOKIE_KEY = 'thr_played';
    const SECRET = 'K3tup4t_L3b4r4n_1447H!';

    function secureHash(str) {
        let h1 = 0, h2 = 5381;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            h1 = ((h1 << 5) - h1 + c) | 0;
            h2 = ((h2 << 5) + h2 + c) | 0;
        }
        return (Math.abs(h1) ^ Math.abs(h2)).toString(36).toUpperCase();
    }

    function setCookie(name, value, days) {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/;SameSite=Strict`;
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    function getFingerprint() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('THR-FP', 2, 2);
        const dataUrl = canvas.toDataURL();
        const components = [
            navigator.userAgent, navigator.language,
            screen.width + 'x' + screen.height, screen.colorDepth,
            new Date().getTimezoneOffset(), dataUrl.slice(-50)
        ];
        return secureHash(components.join('|'));
    }

    function hasPlayed() {
        try {
            const ls = localStorage.getItem(STORAGE_KEY);
            if (ls) { const d = JSON.parse(ls); if (d && d.p) return true; }
            if (sessionStorage.getItem(STORAGE_KEY)) return true;
            if (getCookie(COOKIE_KEY)) return true;
            return false;
        } catch { return false; }
    }

    function recordPlay(won, score, code, danaLink) {
        const fp = getFingerprint();
        const data = { p: true, w: won, s: score, c: code, dana_link: danaLink || null, f: fp, t: Date.now() };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            sessionStorage.setItem(STORAGE_KEY, '1');
            setCookie(COOKIE_KEY, fp, 30);
            storeInIDB(data);
        } catch {}
    }

    function storeInIDB(data) {
        try {
            const req = indexedDB.open('thr_db', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('plays')) db.createObjectStore('plays', { keyPath: 'id' });
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                const tx = db.transaction('plays', 'readwrite');
                tx.objectStore('plays').put({ id: 'current', ...data });
            };
        } catch {}
    }

    function checkIDB(callback) {
        try {
            const req = indexedDB.open('thr_db', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('plays')) db.createObjectStore('plays', { keyPath: 'id' });
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                try {
                    const tx = db.transaction('plays', 'readonly');
                    const r = tx.objectStore('plays').get('current');
                    r.onsuccess = () => callback(r.result);
                    r.onerror = () => callback(null);
                } catch { callback(null); }
            };
            req.onerror = () => callback(null);
        } catch { callback(null); }
    }

    function getPreviousResult() {
        try {
            const ls = localStorage.getItem(STORAGE_KEY);
            if (ls) return JSON.parse(ls);
            return null;
        } catch { return null; }
    }

    function generateSecureCode(won, score) {
        const fp = getFingerprint().slice(0, 4);
        const prefix = won ? 'W' : 'T';
        const ts = Date.now().toString(36).slice(-4).toUpperCase();
        const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
        const payload = `${prefix}${ts}${rand}${fp}`;
        const checksum = secureHash(payload + SECRET).slice(0, 4);
        return `${prefix}-${ts}${rand}-${checksum}`;
    }

    const _log = [];
    let _startTs = 0;

    function logEvent(a, v) { _log.push({ a, v, t: Date.now() - _startTs }); }
    function startTracking() { _log.length = 0; _startTs = Date.now(); }

    function verifyIntegrity(finalScore) {
        let exp = 0;
        for (const e of _log) { if (e.a === 'c') exp += e.v; }
        if (exp < 0) exp = 0;
        if (Math.abs(exp - finalScore) > 2) return false;
        const elapsed = Date.now() - _startTs;
        if (elapsed < 13000) return false;
        if (_log.length > 200) return false;
        return true;
    }

    function protect() {
        const fns = {};
        ['startGame', 'showResult', 'resetGame'].forEach(n => { if (window[n]) fns[n] = window[n]; });
        setInterval(() => {
            Object.keys(fns).forEach(n => { if (window[n] !== fns[n]) window[n] = fns[n]; });
        }, 500);
        Object.freeze(Security);
    }

    return {
        hasPlayed, recordPlay, getPreviousResult, generateSecureCode,
        logEvent, startTracking, verifyIntegrity, protect, checkIDB, getFingerprint
    };
})();

// ==================== BUDGET & SLOT SYSTEM ====================
const Budget = (() => {
    const BUDGET_KEY = 'thr_budget_tracker';

    // Calculate total people: sum of all slots
    function getTotalSlots() {
        return CONFIG.SLOTS_PER_ROUND.reduce((a, b) => a + b, 0);
    }

    // Get current round index based on elapsed time since event start
    function getCurrentRound(startTime) {
        if (!startTime) return 0;
        const elapsed = Date.now() - startTime;
        const intervalMs = CONFIG.INTERVAL_MINUTES * 60 * 1000;
        return Math.floor(elapsed / intervalMs);
    }

    // Get slots for current round
    function getCurrentSlots(startTime) {
        const roundIdx = getCurrentRound(startTime);
        if (roundIdx < CONFIG.SLOTS_PER_ROUND.length) {
            return CONFIG.SLOTS_PER_ROUND[roundIdx];
        }
        return CONFIG.SLOTS_PER_ROUND[CONFIG.SLOTS_PER_ROUND.length - 1];
    }

    // Get round number (1-indexed, for display)
    function getRoundNumber(startTime) {
        const roundIdx = getCurrentRound(startTime);
        return Math.min(roundIdx + 1, CONFIG.SLOTS_PER_ROUND.length);
    }

    // Dynamic win threshold — easier each round if no winner
    function getWinThreshold(startTime, winnersCount) {
        if (winnersCount >= CONFIG.MAX_WINNERS) return 999; // impossible
        const round = getCurrentRound(startTime);
        if (round >= 2) return 10;  // Ronde 3+: 10 poin
        if (round >= 1) return 15;  // Ronde 2: 15 poin
        return 20;                   // Ronde 1: 20 poin
    }

    // Calculate remaining budget based on rounds passed
    function getRemainingBudget() {
        const round = getCurrentRound();
        let spent = 0;
        for (let i = 0; i < Math.min(round, CONFIG.SLOTS_PER_ROUND.length); i++) {
            spent += CONFIG.SLOTS_PER_ROUND[i] * CONFIG.PRIZE_LOSE;
        }
        return Math.max(CONFIG.TOTAL_BUDGET - spent, 0);
    }

    // Check if budget is exhausted
    function isBudgetExhausted() {
        return getRemainingBudget() <= 0;
    }

    // Track local winner count (for display purposes)
    // Actual verification is manual via claim codes
    function getWinnerCount() {
        try {
            const data = localStorage.getItem(BUDGET_KEY);
            if (data) return JSON.parse(data).winners || 0;
            return 0;
        } catch { return 0; }
    }

    function recordWinner() {
        try {
            const count = getWinnerCount() + 1;
            localStorage.setItem(BUDGET_KEY, JSON.stringify({ winners: count }));
        } catch {}
    }

    // Check if 10k winners are maxed out
    function isWinnerMaxed() {
        return getWinnerCount() >= CONFIG.MAX_WINNERS;
    }

    function formatRupiah(num) {
        return 'Rp ' + num.toLocaleString('id-ID');
    }

    return {
        getTotalSlots, getCurrentSlots, getCurrentRound, getRoundNumber,
        getRemainingBudget, isBudgetExhausted, getWinnerCount,
        recordWinner, isWinnerMaxed, formatRupiah, getWinThreshold
    };
})();

// ==================== 15-MINUTE REBUTAN SYSTEM ====================
const Rebutan = (() => {
    const INTERVAL_MS = CONFIG.INTERVAL_MINUTES * 60 * 1000;
    const WINDOW_MS = CONFIG.WINDOW_MINUTES * 60 * 1000;
    let countdownInterval = null;
    let isAvailable = false;

    function getWindowState() {
        if (!thrStartTime) return { available: false, remainingMs: 0 };
        const now = Date.now();
        const elapsed = now - thrStartTime;
        const timeInSlot = elapsed % INTERVAL_MS;

        if (timeInSlot <= WINDOW_MS) {
            return { available: true, remainingMs: WINDOW_MS - timeInSlot };
        } else {
            const nextOpen = INTERVAL_MS - timeInSlot;
            return { available: false, remainingMs: nextOpen };
        }
    }

    function startCountdown() {
        // Check server activation state first
        checkServerActive();
        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);
        // Poll server every 5 seconds for activation
        setInterval(checkServerActive, 5000);
    }

    let thrActive = false;
    let thrStartTime = null;
    let thrWinThreshold = 20;

    async function checkServerActive() {
        const status = await API.getStatus();
        const wasActive = thrActive;
        if (status && status.active) {
            thrActive = true;
            // Always sync start_time from server (handles stop+restart)
            if (status.start_time) {
                thrStartTime = new Date(status.start_time).getTime();
            }
            if (status.win_threshold) {
                thrWinThreshold = status.win_threshold;
            }
            // Auto-refresh UI when admin just activated
            if (!wasActive) {
                updateCountdown();
            }
        } else {
            thrActive = false;
            thrStartTime = null;
        }
    }

    function updateCountdown() {
        const btn = document.getElementById('btn-start');
        const btnText = btn.querySelector('.btn-text');
        const cdLabel = document.getElementById('countdown-label');
        const cdCard = document.getElementById('countdown-card');
        const cdMinutes = document.getElementById('cd-minutes');
        const cdSeconds = document.getElementById('cd-seconds');
        const slotsEl = document.getElementById('slots-remaining');
        const budgetEl = document.getElementById('budget-remaining');
        const prizeAlert = document.getElementById('prize-alert');

        // If THR not activated by admin yet
        if (!thrActive) {
            cdLabel.textContent = '⏳ Menunggu THR Dibuka oleh Admin...';
            cdCard.classList.remove('available');
            cdMinutes.textContent = '--';
            cdSeconds.textContent = '--';
            btn.disabled = true;
            btnText.textContent = '⏳ THR Belum Dibuka';
            slotsEl.textContent = '-';
            return;
        }

        // THR is active — use timer relative to start time
        const state = getWindowState();

        // Update slots & round
        slotsEl.textContent = Budget.getCurrentSlots(thrStartTime);
        const roundEl = document.getElementById('current-round');
        if (roundEl) {
            roundEl.textContent = `${Budget.getRoundNumber(thrStartTime)} / ${CONFIG.SLOTS_PER_ROUND.length}`;
        }

        // Show prize alert if 10k is gone
        if (Budget.isWinnerMaxed()) {
            prizeAlert.style.display = 'flex';
        }

        // Check if budget is exhausted
        if (Budget.isBudgetExhausted()) {
            cdLabel.textContent = '❌ THR Sudah Habis!';
            cdCard.classList.remove('available');
            cdMinutes.textContent = '--';
            cdSeconds.textContent = '--';
            btn.disabled = true;
            btnText.textContent = '😢 THR Sudah Habis';
            return;
        }

        if (state.available) {
            isAvailable = true;
            const remaining = Math.ceil(state.remainingMs / 1000);
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;

            cdLabel.textContent = `🟢 RONDE ${Budget.getRoundNumber()} TERBUKA! Sisa waktu:`;
            cdCard.classList.add('available');
            cdMinutes.textContent = String(mins).padStart(2, '0');
            cdSeconds.textContent = String(secs).padStart(2, '0');

            if (!Security.hasPlayed()) {
                btn.disabled = false;
                btnText.textContent = '🎮 Mulai Main Sekarang!';
            } else {
                btn.disabled = true;
                btnText.textContent = '🔒 Kamu Sudah Main';
            }
        } else {
            isAvailable = false;
            const remaining = Math.ceil(state.remainingMs / 1000);
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;

            cdLabel.textContent = `⏳ Ronde ${Budget.getRoundNumber() + 1} Dibuka Dalam:`;
            cdCard.classList.remove('available');
            cdMinutes.textContent = String(mins).padStart(2, '0');
            cdSeconds.textContent = String(secs).padStart(2, '0');

            btn.disabled = true;
            btnText.textContent = '⏳ Tunggu THR Dibuka...';
        }
    }

    function stopCountdown() {
        if (countdownInterval) clearInterval(countdownInterval);
    }

    return { startCountdown, stopCountdown, getWindowState, isAvailable: () => isAvailable, getWinThreshold: () => thrWinThreshold };
})();

// ==================== STATE ====================
let game = null;
let currentScreen = 'landing';
let gameStartTime = 0;
let isReplayMode = false;
let playerName = '';

// ==================== SCREEN MANAGEMENT ====================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`${screenId}-screen`).classList.add('active');
    currentScreen = screenId;
}

// ==================== FLOATING DECORATIONS ====================
function createDecorations() {
    const container = document.getElementById('decorations');
    const stars = ['✦', '✧', '⭐', '🌟', '✨', '⋆'];
    for (let i = 0; i < 20; i++) {
        const star = document.createElement('div');
        star.className = 'floating-star';
        star.textContent = stars[Math.floor(Math.random() * stars.length)];
        star.style.left = Math.random() * 100 + '%';
        star.style.fontSize = (0.5 + Math.random() * 1) + 'rem';
        star.style.animationDuration = (8 + Math.random() * 12) + 's';
        star.style.animationDelay = Math.random() * 10 + 's';
        star.style.opacity = 0.1 + Math.random() * 0.3;
        container.appendChild(star);
    }
}

// ==================== COUNTDOWN ====================
function showCountdown(callback) {
    let count = 3;
    const overlay = document.createElement('div');
    overlay.className = 'countdown-overlay';
    overlay.innerHTML = `<div class="countdown-number">${count}</div>`;
    document.body.appendChild(overlay);

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerHTML = `<div class="countdown-number">${count}</div>`;
        } else if (count === 0) {
            overlay.innerHTML = `<div class="countdown-number">🎮</div>`;
        } else {
            clearInterval(interval);
            overlay.remove();
            if (callback) callback();
        }
    }, 800);
}

// ==================== BACKEND API ====================
const API = {
    async canPlay() {
        try {
            const fp = Security.getFingerprint();
            const res = await fetch(`${CONFIG.API_URL}/api/can-play`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fingerprint: fp }),
            });
            return await res.json();
        } catch (e) {
            console.warn('[API] can-play failed, using client-only mode:', e);
            return null; // Fallback to client-only
        }
    },

    async recordPlay(won, score, duration) {
        try {
            const fp = Security.getFingerprint();
            const res = await fetch(`${CONFIG.API_URL}/api/record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fingerprint: fp, won, score, duration, name: playerName }),
            });
            return await res.json();
        } catch (e) {
            console.warn('[API] record failed, using client-only mode:', e);
            return null;
        }
    },

    async getStatus() {
        try {
            const res = await fetch(`${CONFIG.API_URL}/api/status`);
            return await res.json();
        } catch {
            return null;
        }
    },
};

// ==================== DANA KAGET DISPLAY ====================
function displayDanaLink(danaLink, qrUrl) {
    const qrSection = document.getElementById('dana-qr-section');
    const codeSection = document.getElementById('claim-code-section');
    
    if (danaLink) {
        // Show QR + link from server (secure)
        qrSection.style.display = '';
        codeSection.style.display = 'none';
        
        const qrImg = document.getElementById('dana-qr-img');
        const linkBtn = document.getElementById('dana-link-btn');
        
        // QR image served from backend
        qrImg.src = qrUrl || `${CONFIG.API_URL}/api/qr/${danaLink.includes('srmd58jc5') ? '10k' : '5k'}`;
        linkBtn.href = danaLink;
        linkBtn.textContent = '💰 Buka DANA Kaget';
    } else {
        // No link available
        qrSection.style.display = 'none';
        codeSection.style.display = '';
    }
}

// ==================== LEADERBOARD ====================
async function fetchLeaderboard() {
    try {
        const res = await fetch(`${CONFIG.API_URL}/api/leaderboard`);
        const data = await res.json();
        renderLeaderboard(data.leaderboard || []);
    } catch {
        // Silently fail
    }
}

function renderLeaderboard(board) {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    
    if (board.length === 0) {
        list.innerHTML = '<p class="leaderboard-empty">Belum ada pemain</p>';
        return;
    }
    
    const medals = ['🥇', '🥈', '🥉'];
    list.innerHTML = board.map((p, i) => {
        const rank = medals[i] || `${i + 1}`;
        const prizeClass = p.won ? 'win' : 'lose';
        const prizeText = p.won ? '10k' : '5k';
        return `<div class="lb-item">
            <span class="lb-rank">${rank}</span>
            <span class="lb-name">${escapeHtml(p.name)}</span>
            <span class="lb-score">${p.score} ⭐</span>
            <span class="lb-prize ${prizeClass}">${prizeText}</span>
        </div>`;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
function startGame() {
    if (_dt._o) {
        alert('⚠️ Tutup Developer Tools dulu ya biar fair! 😊');
        return;
    }

    // Ask for name if not set yet
    if (!playerName && !Security.hasPlayed()) {
        const name = prompt('✏️ Masukkan nama kamu dulu ya:');
        if (!name || name.trim().length < 2) {
            alert('Nama minimal 2 karakter ya! 😊');
            return;
        }
        playerName = name.trim().substring(0, 20); // Max 20 chars
    }

    if (!Rebutan.isAvailable()) {
        alert('⏳ THR belum dibuka! Tunggu countdown selesai ya.');
        return;
    }

    if (Budget.isBudgetExhausted()) {
        alert('😢 Maaf, budget THR sudah habis!');
        return;
    }

    if (Security.hasPlayed()) {
        const prev = Security.getPreviousResult();
        if (prev) { showPreviousResult(prev); return; }
    }

    Security.checkIDB(async (idbResult) => {
        if (idbResult && idbResult.p) { showPreviousResult(idbResult); return; }

        // Server-side check first
        const serverCheck = await API.canPlay();
        if (serverCheck) {
            if (serverCheck.already_played) {
                if (serverCheck.previous) {
                    showPreviousResult(serverCheck.previous);
                }
                return;
            }
            if (serverCheck.budget_exhausted) {
                alert('😢 Maaf, budget THR sudah habis!');
                return;
            }
            if (!serverCheck.can_play) {
                if (!serverCheck.window_open) {
                    alert('⏳ THR belum dibuka! Tunggu countdown selesai ya.');
                } else if (serverCheck.slots_left <= 0) {
                    alert('😢 Slot ronde ini sudah penuh! Tunggu ronde berikutnya.');
                }
                return;
            }
        }

        Security.startTracking();
        gameStartTime = Date.now();
        Rebutan.stopCountdown();

        showScreen('game');
        const canvas = document.getElementById('game-canvas');
        game = new KetupatGame(canvas);
        // Dynamic win threshold from server (R1=20, R2=15, R3+=10)
        game.targetScore = Rebutan.getWinThreshold();

        game.onScoreChange = (score) => {
            const el = document.getElementById('score');
            el.textContent = score;
            el.style.transform = 'scale(1.3)';
            setTimeout(() => el.style.transform = 'scale(1)', 200);
        };

        const origHandleTap = game.handleTap.bind(game);
        game.handleTap = function(x, y) {
            const prevScore = this.score;
            origHandleTap(x, y);
            if (this.score !== prevScore) Security.logEvent('c', this.score - prevScore);
        };

        game.onTimeChange = (time) => {
            const el = document.getElementById('timer');
            el.textContent = time;
            if (time <= 5) {
                el.style.color = '#E74C3C';
                el.style.animation = 'countdownPop 0.5s';
            }
        };

        game.onGameEnd = (won, finalScore) => {
            const validGame = Security.verifyIntegrity(finalScore);
            if (!validGame) { won = false; finalScore = Math.min(finalScore, 3); }

            if (won && Budget.isWinnerMaxed()) {
                won = false;
            }

            setTimeout(() => showResult(won, finalScore), 500);
        };

        setTimeout(() => {
            document.getElementById('game-instruction').classList.add('hidden');
        }, 3000);

        showCountdown(() => { game.start(); });
    });
}

// ==================== SHOW PREVIOUS RESULT ====================
function showPreviousResult(prev) {
    showScreen('result');
    const didWin = prev.w || prev.won || false;
    document.getElementById('result-icon').textContent = '🔒';
    document.getElementById('result-title').textContent = 'Kamu Sudah Dapat THR!';
    document.getElementById('result-subtitle').textContent = `Skor: ${prev.s || prev.score || 0} poin`;
    document.getElementById('thr-amount').textContent = didWin ? 'Rp 10.000' : 'Rp 5.000';
    
    // Show DANA info from server (if available from previous play)
    displayDanaLink(prev.dana_link || null, prev.qr_url || null);
    
    document.getElementById('thr-envelope').style.display = 'none';
    document.getElementById('thr-reveal').style.display = '';
    // Show replay button for fun
    const replayBtn = document.getElementById('btn-replay');
    replayBtn.style.display = '';
    replayBtn.textContent = '🎮 Main Lagi (For Fun — Tanpa THR)';
    setTimeout(() => launchConfetti(), 300);
}

// ==================== SHOW RESULT ====================
async function showResult(won, score) {
    showScreen('result');

    const icon = document.getElementById('result-icon');
    const title = document.getElementById('result-title');
    const subtitle = document.getElementById('result-subtitle');
    const amount = document.getElementById('thr-amount');
    const claimCode = document.getElementById('claim-code');

    // Record to server first
    const duration = Date.now() - gameStartTime;
    const serverResult = await API.recordPlay(won, score, duration);

    // If server overrides (e.g. already played, budget gone)
    if (serverResult && serverResult.code === 'ALREADY_PLAYED') {
        if (serverResult.previous) {
            showPreviousResult(serverResult.previous);
            return;
        }
    }

    // Use server claim code if available
    let code;
    if (serverResult && serverResult.success) {
        won = serverResult.won;
        code = serverResult.claim_code;
    } else {
        code = Security.generateSecureCode(won, score);
    }

    if (won) {
        icon.textContent = '🏆';
        title.textContent = 'Kamu Menang!';
        subtitle.textContent = `Skor: ${score} poin — Luar biasa! 🎉`;
        amount.textContent = Budget.formatRupiah(CONFIG.PRIZE_WIN);
        Budget.recordWinner();
    } else {
        icon.textContent = '🎁';
        title.textContent = 'Game Selesai!';

        if (Budget.isWinnerMaxed()) {
            subtitle.textContent = `Skor: ${score} poin — THR 10k sudah habis, tapi tetep dapet THR! 😊`;
        } else {
            subtitle.textContent = `Skor: ${score} poin — Gak apa-apa, tetep dapet THR! 😊`;
        }
        amount.textContent = Budget.formatRupiah(CONFIG.PRIZE_LOSE);
    }

    claimCode.textContent = `Kode: ${code}`;
    
    // Display DANA Kaget QR + link from server response
    const danaLink = (serverResult && serverResult.dana_link) || null;
    const qrUrl = (serverResult && serverResult.qr_url) || null;
    displayDanaLink(danaLink, qrUrl);
    
    // Save locally
    Security.recordPlay(won, score, code);

    const envelope = document.getElementById('thr-envelope');
    const reveal = document.getElementById('thr-reveal');
    const replayBtn = document.getElementById('btn-replay');

    envelope.style.display = '';
    reveal.style.display = 'none';
    replayBtn.style.display = 'none';
    envelope.classList.remove('opened');

    envelope.onclick = () => {
        envelope.classList.add('opened');
        setTimeout(() => {
            envelope.style.display = 'none';
            reveal.style.display = '';
            launchConfetti();
        }, 800);
    };

    setTimeout(() => launchConfetti(), 300);
}

// ==================== CONFETTI ====================
function launchConfetti() {
    const container = document.getElementById('confetti-container');
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96E6A1', '#DDA0DD', '#F0E68C', '#FF69B4'];
    const emojis = ['🎉', '✨', '🌟', '⭐', '🧧', '🎊', '💫'];
    for (let i = 0; i < 60; i++) {
        const confetti = document.createElement('div');
        const isEmoji = Math.random() > 0.6;
        if (isEmoji) {
            confetti.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            confetti.style.fontSize = (0.8 + Math.random() * 0.8) + 'rem';
        } else {
            confetti.style.width = (6 + Math.random() * 8) + 'px';
            confetti.style.height = (6 + Math.random() * 8) + 'px';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        }
        confetti.style.position = 'absolute';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.top = '-10px';
        confetti.style.pointerEvents = 'none';
        confetti.style.zIndex = '1000';
        const duration = 2 + Math.random() * 3;
        const delay = Math.random() * 1;
        const xDrift = (Math.random() - 0.5) * 200;
        const rotation = Math.random() * 720 - 360;
        confetti.style.animation = `confettiFall ${duration}s ${delay}s ease-out forwards`;
        confetti.style.setProperty('--x-drift', xDrift + 'px');
        confetti.style.setProperty('--rotation', rotation + 'deg');
        container.appendChild(confetti);
        setTimeout(() => confetti.remove(), (duration + delay) * 1000 + 100);
    }
}

const confettiStyle = document.createElement('style');
confettiStyle.textContent = `
    @keyframes confettiFall {
        0% { transform: translateY(0) translateX(0) rotate(0deg) scale(1); opacity: 1; }
        75% { opacity: 1; }
        100% { transform: translateY(100vh) translateX(var(--x-drift)) rotate(var(--rotation)) scale(0.5); opacity: 0; }
    }
`;
document.head.appendChild(confettiStyle);

// ==================== RESET GAME ====================
function resetGame() {
    if (game) { game.destroy(); game = null; }
    document.getElementById('score').textContent = '0';
    document.getElementById('timer').textContent = '15';
    document.getElementById('timer').style.color = '';
    document.getElementById('timer').style.animation = '';
    document.getElementById('game-instruction').classList.remove('hidden');
    document.getElementById('confetti-container').innerHTML = '';

    // If already played, enter replay mode (for fun, no THR)
    if (Security.hasPlayed()) {
        isReplayMode = true;
        showScreen('game');
        const canvas = document.getElementById('game-canvas');
        game = new KetupatGame(canvas);
        game.onScoreChange = (score) => {
            const el = document.getElementById('score');
            el.textContent = score;
            el.style.transform = 'scale(1.3)';
            setTimeout(() => el.style.transform = 'scale(1)', 200);
        };
        game.onTimeChange = (time) => {
            const el = document.getElementById('timer');
            el.textContent = time;
            if (time <= 5) { el.style.color = '#E74C3C'; }
        };
        game.onGameEnd = (won, finalScore) => {
            // Replay mode: show score but no THR
            showScreen('result');
            document.getElementById('result-icon').textContent = '🎮';
            document.getElementById('result-title').textContent = 'Main Selesai!';
            document.getElementById('result-subtitle').textContent = `Skor: ${finalScore} poin — Main for fun 🎉`;
            document.getElementById('thr-envelope').style.display = 'none';
            document.getElementById('thr-reveal').style.display = '';
            document.getElementById('thr-amount').textContent = '🎮 For Fun';
            document.getElementById('claim-code').textContent = 'THR kamu sudah dicatat sebelumnya ✅';
            const replayBtn = document.getElementById('btn-replay');
            replayBtn.style.display = '';
            replayBtn.textContent = '🔄 Main Lagi';
            setTimeout(() => launchConfetti(), 300);
        };
        setTimeout(() => {
            document.getElementById('game-instruction').classList.add('hidden');
        }, 3000);
        showCountdown(() => { game.start(); });
    } else {
        Rebutan.startCountdown();
        showScreen('landing');
    }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    createDecorations();
    Rebutan.startCountdown();
    fetchLeaderboard();
    setInterval(fetchLeaderboard, 10000); // Update leaderboard every 10s

    Security.checkIDB((result) => {
        if (result && result.p) {
            const btn = document.getElementById('btn-start');
            if (btn) btn.querySelector('.btn-text').textContent = '🔒 Lihat Hasil THR';
        }
    });

    setTimeout(() => Security.protect(), 500);
});
