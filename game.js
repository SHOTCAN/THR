// ==================== GAME ENGINE ====================

class KetupatGame {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.items = [];
        this.score = 0;
        this.timeLeft = 15; // Reduced from 20 to 15 seconds
        this.targetScore = 20; // Increased from 15 to 20
        this.isRunning = false;
        this.gameTimer = null;
        this.spawnTimer = null;
        this.animFrame = null;
        this.onScoreChange = null;
        this.onTimeChange = null;
        this.onGameEnd = null;
        this.difficulty = 1.3; // Start harder
        this.lastTime = 0;

        // Item types - more negative items, harder to win
        this.itemTypes = [
            { emoji: '🟫', label: 'ketupat', points: 1, weight: 35 },
            { emoji: '🟫', label: 'ketupat2', points: 1, weight: 20 },
            { emoji: '⭐', label: 'star', points: 3, weight: 5 },    // Rarer
            { emoji: '🧧', label: 'angpao', points: 2, weight: 8 },  // Rarer
            { emoji: '🧨', label: 'petasan', points: -2, weight: 25 }, // More common
            { emoji: '💣', label: 'bomb', points: -3, weight: 15 },   // More common
            { emoji: '🔥', label: 'fire', points: -1, weight: 12 },   // New distraction
        ];

        this.resize();
        this.bindEvents();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.ctx.scale(dpr, dpr);
        this.width = window.innerWidth;
        this.height = window.innerHeight;
    }

    bindEvents() {
        // Touch events
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            for (let touch of e.changedTouches) {
                this.handleTap(touch.clientX, touch.clientY);
            }
        }, { passive: false });

        // Mouse events
        this.canvas.addEventListener('click', (e) => {
            this.handleTap(e.clientX, e.clientY);
        });

        // Resize
        window.addEventListener('resize', () => this.resize());
    }

    handleTap(x, y) {
        if (!this.isRunning) return;

        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            if (item.caught) continue;

            const dist = Math.hypot(x - item.x, y - item.y);
            // Smaller hit area = harder (0.55 instead of 0.7)
            if (dist < item.size * 0.55) {
                item.caught = true;
                item.catchAnim = 1;
                this.score += item.points;
                if (this.score < 0) this.score = 0;

                this.showScorePopup(item.x, item.y, item.points);

                if (this.onScoreChange) this.onScoreChange(this.score);
                break;
            }
        }
    }

    showScorePopup(x, y, points) {
        const popup = document.createElement('div');
        popup.className = `score-popup ${points > 0 ? 'positive' : 'negative'}`;
        popup.textContent = points > 0 ? `+${points}` : `${points}`;
        popup.style.left = `${x}px`;
        popup.style.top = `${y}px`;
        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 800);
    }

    getRandomItem() {
        const totalWeight = this.itemTypes.reduce((sum, t) => sum + t.weight, 0);
        let rand = Math.random() * totalWeight;
        for (const type of this.itemTypes) {
            rand -= type.weight;
            if (rand <= 0) return type;
        }
        return this.itemTypes[0];
    }

    spawnItem() {
        const type = this.getRandomItem();
        const size = 28 + Math.random() * 14; // Smaller items = harder to tap
        const item = {
            x: Math.random() * (this.width - 60) + 30,
            y: -size,
            size: size,
            speed: (2.0 + Math.random() * 2.0) * this.difficulty, // Faster falling
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.03 + Math.random() * 0.04, // More wobble
            wobbleAmount: 20 + Math.random() * 30,     // More wobble
            rotation: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.08,    // Faster rotation
            type: type,
            points: type.points,
            emoji: type.emoji,
            label: type.label,
            caught: false,
            catchAnim: 0,
            opacity: 1,
        };
        this.items.push(item);
    }

    start() {
        this.score = 0;
        this.timeLeft = 15;
        this.items = [];
        this.isRunning = true;
        this.difficulty = 1.3;

        if (this.onScoreChange) this.onScoreChange(0);
        if (this.onTimeChange) this.onTimeChange(this.timeLeft);

        // Timer countdown
        this.gameTimer = setInterval(() => {
            this.timeLeft--;
            if (this.onTimeChange) this.onTimeChange(this.timeLeft);

            // Difficulty ramps up faster
            this.difficulty = 1.3 + (15 - this.timeLeft) * 0.08;

            if (this.timeLeft <= 0) {
                this.end();
            }
        }, 1000);

        // Spawn items faster
        this.spawnTimer = setInterval(() => {
            // More items at once as time goes on
            const spawnCount = this.timeLeft < 7 ? 3 : 2;
            for (let i = 0; i < spawnCount; i++) {
                this.spawnItem();
            }
        }, 450); // Faster spawning (was 600)

        this.lastTime = performance.now();
        this.render();
    }

    end() {
        this.isRunning = false;
        clearInterval(this.gameTimer);
        clearInterval(this.spawnTimer);
        if (this.animFrame) cancelAnimationFrame(this.animFrame);

        const won = this.score >= this.targetScore;
        if (this.onGameEnd) this.onGameEnd(won, this.score);
    }

    render() {
        if (!this.isRunning) return;

        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 16.67, 3);
        this.lastTime = now;

        this.ctx.clearRect(0, 0, this.width, this.height);

        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];

            if (item.caught) {
                item.catchAnim -= 0.05 * dt;
                item.opacity = item.catchAnim;
                item.size *= 1 + 0.03 * dt;

                if (item.catchAnim <= 0) {
                    this.items.splice(i, 1);
                    continue;
                }
            } else {
                item.y += item.speed * dt;
                item.wobble += item.wobbleSpeed * dt;
                item.rotation += item.rotSpeed * dt;

                if (item.y > this.height + item.size) {
                    this.items.splice(i, 1);
                    continue;
                }
            }

            const wobbleX = Math.sin(item.wobble) * item.wobbleAmount;
            this.ctx.save();
            this.ctx.globalAlpha = item.opacity;
            this.ctx.translate(item.x + wobbleX, item.y);
            this.ctx.rotate(item.rotation);
            this.ctx.font = `${item.size}px serif`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';

            if (item.label === 'ketupat' || item.label === 'ketupat2') {
                this.drawKetupat(0, 0, item.size * 0.5);
            } else {
                this.ctx.fillText(item.type.emoji, 0, 0);
            }

            this.ctx.restore();
        }

        this.animFrame = requestAnimationFrame(() => this.render());
    }

    drawKetupat(x, y, size) {
        const ctx = this.ctx;
        ctx.save();

        // Diamond shape
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size * 0.7, y);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x - size * 0.7, y);
        ctx.closePath();

        const grad = ctx.createLinearGradient(x - size, y - size, x + size, y + size);
        grad.addColorStop(0, '#2d8f3e');
        grad.addColorStop(0.5, '#1a6b2a');
        grad.addColorStop(1, '#0a3d15');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Woven pattern
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x - size * 0.5, y); ctx.lineTo(x + size * 0.5, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y - size * 0.6); ctx.lineTo(x, y + size * 0.6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - size * 0.3, y - size * 0.5); ctx.lineTo(x + size * 0.3, y + size * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + size * 0.3, y - size * 0.5); ctx.lineTo(x - size * 0.3, y + size * 0.5); ctx.stroke();

        ctx.restore();
    }

    destroy() {
        this.isRunning = false;
        clearInterval(this.gameTimer);
        clearInterval(this.spawnTimer);
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
    }
}
