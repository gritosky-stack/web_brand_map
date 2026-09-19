/* ── Просмотр фото ───────────────────────────────────────────────────────────
 *
 * Карусель из трёх слотов: фото в фокусе по центру и соседи по бокам —
 * размытые и притушенные (на телефоне от них видно только краешки). Нажатие
 * на соседа или свайп — и он выезжает в центр.
 *
 * Фото в фокусе можно рассматривать: колесо / щипок / двойной тап — зум,
 * протяжка приближенного фото — сдвиг. Пока фото приближено, всё вокруг
 * (соседи, лента миниатюр, подписи) уходит в тень. Без зума протяжка
 * по-прежнему листает, а на телефоне свайп вниз закрывает просмотр.
 *
 * Слоты переиспользуются: при перелистывании ушедший за край слот
 * переезжает на другую сторону без анимации и получает новое фото — в
 * разметке всегда ровно три кадра, сколько бы фото ни было у маршрута.
 */
(function (root) {
    'use strict';

    const MAX_ZOOM = 5;
    const DOUBLE_TAP_MS = 300;
    const SIDE_SCALE = 0.8;

    const PhotoViewer = {
        stage: null,
        list: [],
        index: 0,
        slots: {},          // смещение (-1, 0, 1) → элемент слота
        zoom: { s: 1, tx: 0, ty: 0 },
        opts: {},

        init(stage, opts) {
            this.stage = stage;
            this.opts = opts || {};
            this.track = document.createElement('div');
            this.track.className = 'pv-track';
            stage.insertBefore(this.track, stage.firstChild);
            [-1, 0, 1].forEach(offset => {
                const slot = document.createElement('div');
                slot.className = 'pv-slide';
                this.track.appendChild(slot);
                this.slots[offset] = slot;
            });
            this._bindGestures();
            this._onResize = () => { if (this.isOpen) this.layout(false); };
            window.addEventListener('resize', this._onResize);
            document.addEventListener('keydown', e => {
                if (!this.isOpen) return;
                if (e.key === 'ArrowRight') this.go(1);
                else if (e.key === 'ArrowLeft') this.go(-1);
                else if (e.key === 'Escape' && this.opts.onClose) this.opts.onClose();
            });
        },

        get isOpen() { return !!this._open; },
        get hasSides() { return this.list.length > 1; },

        item(offset) {
            const n = this.list.length;
            if (!n) return null;
            if (offset !== 0 && n < 2) return null;
            return this.list[(((this.index + offset) % n) + n) % n];
        },

        open(list, index) {
            this.list = list || [];
            this.index = Math.max(0, index || 0);
            this._open = true;
            this.resetZoom(false);
            [-1, 0, 1].forEach(offset => this.fill(this.slots[offset], offset));
            this.layout(false);
            this.notify();
        },

        close() {
            this._open = false;
            this.resetZoom(false);
            Object.values(this.slots).forEach(slot => {
                const video = slot.querySelector('video');
                if (video) video.pause();
            });
        },

        /** Показать фото с таким индексом (например, по нажатию на миниатюру) */
        show(index) {
            if (index === this.index || index < 0 || index >= this.list.length) return;
            const n = this.list.length;
            const forward = (index - this.index + n) % n;
            if (forward === 1) { this.go(1); return; }
            if (forward === n - 1) { this.go(-1); return; }
            // Дальний прыжок — без перелистывания через всё подряд
            this.index = index;
            this.resetZoom(false);
            [-1, 0, 1].forEach(offset => this.fill(this.slots[offset], offset));
            this.layout(false);
            this.notify();
        },

        go(delta) {
            if (!this.hasSides || !delta) return;
            this.resetZoom(true);
            const n = this.list.length;
            this.index = (((this.index + delta) % n) + n) % n;
            const s = this.slots;
            // Слот, ушедший за край, переезжает на другую сторону
            const next = delta > 0
                ? { '-1': s[0], '0': s[1], '1': s[-1] }
                : { '-1': s[1], '0': s[-1], '1': s[0] };
            this.slots = { '-1': next[-1], '0': next[0], '1': next[1] };
            const recycled = this.slots[delta > 0 ? 1 : -1];
            // Переезд — мгновенно и из-за края экрана, чтобы он не пролетал
            // через весь кадр у всех на глазах
            recycled.classList.add('pv-noanim');
            this.fill(recycled, delta > 0 ? 1 : -1);
            this.place(recycled, delta > 0 ? 2 : -2);
            void recycled.offsetWidth;
            recycled.classList.remove('pv-noanim');
            this.upgrade(this.slots[0]);
            this.layout(true);
            this.notify();
        },

        notify() {
            const current = this.item(0);
            if (current && this.opts.onChange) this.opts.onChange(current, this.index);
        },

        // MARK: - Содержимое слотов

        fill(slot, offset) {
            const item = this.item(offset);
            slot.dataset.src = item ? item.src : '';
            slot.hidden = !item;
            if (!item) { slot.innerHTML = ''; return; }
            const thumb = this.opts.thumb || (s => s);
            const med = this.opts.med || (s => s);
            slot.aspect = slot.aspect && slot._src === item.src ? slot.aspect : 0.75;
            slot._src = item.src;
            if (item.isVideo) {
                const center = offset === 0;
                slot.innerHTML = center
                    ? `<video class="pv-media" src="${item.src}" controls loop autoplay playsinline></video>`
                    : `<video class="pv-media" src="${item.src}#t=0.001" muted playsinline preload="metadata"></video>`;
                const video = slot.querySelector('video');
                video.addEventListener('loadedmetadata', () => {
                    if (video.videoWidth) this.setAspect(slot, video.videoWidth / video.videoHeight);
                });
            } else {
                // Сначала маленькая копия (она уже в кэше от ленты миниатюр),
                // в фокусе — сразу подменяем на крупную
                slot.innerHTML = '<img class="pv-media" alt="" draggable="false">';
                const img = slot.firstChild;
                img.onload = () => {
                    if (img.naturalWidth) this.setAspect(slot, img.naturalWidth / img.naturalHeight);
                };
                img.onerror = () => { img.onerror = null; img.src = item.src; };
                img.src = offset === 0 ? med(item.src) : thumb(item.src);
            }
        },

        /**
         * Узнали настоящие пропорции кадра — перекладываем. Плавно и только
         * если они правда другие: подмена маленькой копии на крупную тоже
         * вызывает onload, и мгновенная перекладка обрывала бы перелистывание.
         */
        setAspect(slot, aspect) {
            if (!(aspect > 0) || Math.abs(aspect - (slot.aspect || 0)) < 0.01) return;
            slot.aspect = aspect;
            if (!this._gesture) this.layout(true);
        },

        /** Сосед стал фото в фокусе — крупная копия и живое видео */
        upgrade(slot) {
            const item = this.item(0);
            if (!item) return;
            if (item.isVideo) { this.fill(slot, 0); return; }
            const img = slot.querySelector('img');
            if (!img) { this.fill(slot, 0); return; }
            const med = (this.opts.med || (s => s))(item.src);
            if (img.src.endsWith(encodeURI(med)) || img.src.endsWith(med)) return;
            const loader = new Image();
            loader.onload = () => { if (slot._src === item.src) img.src = med; };
            loader.src = med;
        },

        // MARK: - Раскладка

        layout(animate) {
            if (!this.stage) return;
            if (!animate) Object.values(this.slots).forEach(s => s.classList.add('pv-noanim'));
            [-1, 0, 1].forEach(offset => this.place(this.slots[offset], offset));
            if (!animate) {
                void this.track.offsetWidth;
                Object.values(this.slots).forEach(s => s.classList.remove('pv-noanim'));
            }
            this.applyZoom();
        },

        frame() {
            const W = this.stage.clientWidth, H = this.stage.clientHeight;
            const mobile = W < 768;
            return {
                W, H, mobile,
                // На телефоне по краям остаётся полоска под краешки соседей
                maxW: mobile ? W - 64 : Math.min(W - 280, W * 0.62),
                maxH: H - (mobile ? 80 : 110),
                gap: mobile ? 8 : 36
            };
        },

        size(slot, f) {
            const aspect = slot.aspect || 0.75;
            let w = f.maxW, h = w / aspect;
            if (h > f.maxH) { h = f.maxH; w = h * aspect; }
            return { w: Math.round(w), h: Math.round(h) };
        },

        place(slot, offset) {
            const f = this.frame();
            const { w, h } = this.size(slot, f);
            slot.style.width = w + 'px';
            slot.style.height = h + 'px';
            slot.style.marginLeft = -w / 2 + 'px';
            slot.style.marginTop = -(h / 2) - (f.mobile ? 18 : 22) + 'px';
            let dx = 0;
            if (offset !== 0) {
                const center = this.size(this.slots[0], f);
                const side = w * SIDE_SCALE;
                dx = Math.sign(offset) * (center.w / 2 + f.gap + side / 2);
                if (Math.abs(offset) > 1) dx += Math.sign(offset) * (side + f.gap);
            }
            slot.dataset.offset = offset;
            slot.classList.toggle('pv-center', offset === 0);
            slot.classList.toggle('pv-side', Math.abs(offset) === 1);
            slot.classList.toggle('pv-away', Math.abs(offset) > 1);
            slot._dx = dx;
            slot.style.transform = `translate(${dx + (this._drag || 0)}px, 0) scale(${offset === 0 ? 1 : SIDE_SCALE})`;
        },

        // MARK: - Зум

        centerMedia() { return this.slots[0] && this.slots[0].querySelector('img.pv-media'); },

        setZoom(s, tx, ty, animate) {
            const slot = this.slots[0];
            const w = slot.offsetWidth, h = slot.offsetHeight;
            s = Math.min(MAX_ZOOM, Math.max(1, s));
            // Край фото не отходит от края его рамки внутрь
            const mx = (w * s - w) / 2, my = (h * s - h) / 2;
            this.zoom = {
                s,
                tx: Math.min(mx, Math.max(-mx, tx)),
                ty: Math.min(my, Math.max(-my, ty))
            };
            this.applyZoom(animate);
        },

        resetZoom(animate) {
            this.zoom = { s: 1, tx: 0, ty: 0 };
            this.applyZoom(animate);
        },

        applyZoom(animate) {
            const media = this.centerMedia();
            const zoomed = this.zoom.s > 1.01;
            if (this.opts.onZoomChange && zoomed !== this._zoomed) this.opts.onZoomChange(zoomed);
            this._zoomed = zoomed;
            Object.values(this.slots).forEach(slot => {
                const m = slot.querySelector('.pv-media');
                if (m && m !== media) m.style.transform = '';
            });
            if (!media) return;
            media.classList.toggle('pv-instant', animate === false || !!this._gesture);
            media.style.transform = `translate(${this.zoom.tx}px, ${this.zoom.ty}px) scale(${this.zoom.s})`;
        },

        /** Зум вокруг точки экрана: точка под пальцем/курсором остаётся на месте */
        zoomAround(clientX, clientY, s, animate) {
            const slot = this.slots[0];
            const r = slot.getBoundingClientRect();
            const px = clientX - (r.left + r.width / 2);
            const py = clientY - (r.top + r.height / 2);
            const k = Math.min(MAX_ZOOM, Math.max(1, s)) / this.zoom.s;
            this.setZoom(this.zoom.s * k, px - (px - this.zoom.tx) * k, py - (py - this.zoom.ty) * k, animate);
        },

        // MARK: - Жесты

        _bindGestures() {
            const stage = this.stage;
            const pointers = new Map();
            let start = null, pinch = null, lastTap = null;

            const slotOf = target => {
                const slot = target.closest && target.closest('.pv-slide');
                return slot ? Number(slot.dataset.offset) : null;
            };

            stage.addEventListener('wheel', e => {
                if (!this.isOpen || slotOf(e.target) !== 0 || !this.centerMedia()) return;
                e.preventDefault();
                const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
                this.zoomAround(e.clientX, e.clientY, this.zoom.s * factor, false);
            }, { passive: false });

            stage.addEventListener('dblclick', e => {
                if (slotOf(e.target) !== 0 || !this.centerMedia()) return;
                this.toggleZoom(e.clientX, e.clientY);
            });

            stage.addEventListener('pointerdown', e => {
                if (!this.isOpen) return;
                // Управление видео — его собственное
                if (e.target.tagName === 'VIDEO' && e.pointerType === 'mouse') return;
                pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                // Видео — без захвата: его кнопки должны получать нажатия сами
                if (e.target.tagName !== 'VIDEO') {
                    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
                }
                if (pointers.size === 2) {
                    const [a, b] = [...pointers.values()];
                    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), s: this.zoom.s,
                              cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
                    this._drag = 0;
                    this._gesture = 'pinch';
                    stage.classList.add('pv-gesture');
                    return;
                }
                start = { x: e.clientX, y: e.clientY, t: Date.now(), offset: slotOf(e.target),
                          tx: this.zoom.tx, ty: this.zoom.ty, moved: false, type: e.pointerType };
            });

            stage.addEventListener('pointermove', e => {
                if (!pointers.has(e.pointerId)) return;
                pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (pinch && pointers.size >= 2 && this.centerMedia()) {
                    const [a, b] = [...pointers.values()];
                    const dist = Math.hypot(a.x - b.x, a.y - b.y);
                    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
                    this.zoomAround(cx, cy, pinch.s * dist / pinch.dist, false);
                    // Двумя пальцами фото ещё и ведут
                    this.setZoom(this.zoom.s, this.zoom.tx + cx - pinch.cx, this.zoom.ty + cy - pinch.cy, false);
                    pinch.cx = cx; pinch.cy = cy;
                    return;
                }
                if (!start) return;
                const dx = e.clientX - start.x, dy = e.clientY - start.y;
                if (!start.moved && Math.hypot(dx, dy) < 6) return;
                start.moved = true;
                stage.classList.add('pv-gesture');
                if (this.zoom.s > 1.01) {
                    this._gesture = 'pan';
                    this.setZoom(this.zoom.s, start.tx + dx, start.ty + dy, false);
                } else if (this.hasSides && Math.abs(dx) >= Math.abs(dy) && this._gesture !== 'dismiss') {
                    // Листаем: кадры едут за пальцем
                    this._gesture = 'swipe';
                    this._drag = dx;
                    Object.values(this.slots).forEach(slot => {
                        const off = Number(slot.dataset.offset);
                        slot.style.transform = `translate(${slot._dx + dx}px, 0) scale(${off === 0 ? 1 : SIDE_SCALE})`;
                    });
                } else if (start.type !== 'mouse' && dy > 0 && this._gesture !== 'swipe') {
                    // Свайп вниз — закрыть; фото уходит вслед за пальцем
                    this._gesture = 'dismiss';
                    const slot = this.slots[0];
                    slot.style.transform = `translate(0, ${dy}px) scale(${1 - Math.min(0.2, dy / 2000)})`;
                    this.stage.style.setProperty('--pv-dismiss', Math.max(0.3, 1 - dy / 400));
                }
            });

            const end = e => {
                if (!pointers.has(e.pointerId)) return;
                pointers.delete(e.pointerId);
                if (pinch) {
                    if (pointers.size < 2) {
                        pinch = null;
                        // Второй палец убрали — оставшийся ведёт фото дальше
                        const rest = [...pointers.values()][0];
                        start = rest ? { x: rest.x, y: rest.y, t: Date.now(), offset: 0,
                                         tx: this.zoom.tx, ty: this.zoom.ty, moved: true, type: 'touch' } : null;
                        if (!rest) this.finishGesture();
                        if (this.zoom.s < 1.05) this.resetZoom(true);
                    }
                    return;
                }
                if (!start) { this.finishGesture(); return; }
                const dx = e.clientX - start.x, dy = e.clientY - start.y;
                const dt = Math.max(1, Date.now() - start.t);
                const gesture = this._gesture;
                const s = start;
                start = null;
                this.finishGesture();

                if (gesture === 'swipe') {
                    const fast = Math.abs(dx) / dt > 0.45;
                    if (Math.abs(dx) > this.stage.clientWidth * 0.18 || (fast && Math.abs(dx) > 30)) {
                        this.go(dx < 0 ? 1 : -1);
                    } else {
                        this.layout(true);
                    }
                    return;
                }
                if (gesture === 'dismiss') {
                    this.stage.style.removeProperty('--pv-dismiss');
                    if (dy > 110 || dy / dt > 0.6) { if (this.opts.onClose) this.opts.onClose(); }
                    else this.layout(true);
                    return;
                }
                if (s.moved) return;

                // Тап / клик
                if (s.offset === 1 || s.offset === -1) { this.go(s.offset); return; }
                if (s.offset === null) {
                    // Мимо фото — закрыть (только если не приближали)
                    if (this.zoom.s > 1.01) this.resetZoom(true);
                    else if (this.opts.onClose) this.opts.onClose();
                    return;
                }
                if (s.type !== 'mouse') {
                    const now = Date.now();
                    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
                        lastTap = null;
                        this.toggleZoom(e.clientX, e.clientY);
                    } else {
                        lastTap = { t: now, x: e.clientX, y: e.clientY };
                    }
                }
            };
            stage.addEventListener('pointerup', end);
            stage.addEventListener('pointercancel', end);
        },

        finishGesture() {
            this._gesture = null;
            this._drag = 0;
            this.stage.classList.remove('pv-gesture');
            this.applyZoom(true);
        },

        toggleZoom(x, y) {
            if (!this.centerMedia()) return;
            if (this.zoom.s > 1.01) this.resetZoom(true);
            else this.zoomAround(x, y, 2.5, true);
        }
    };

    root.PhotoViewer = PhotoViewer;
})(typeof globalThis !== 'undefined' ? globalThis : window);
