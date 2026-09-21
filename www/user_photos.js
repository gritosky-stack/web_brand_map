/**
 * Фото пользователя: выбор, пережатие и загрузка в Supabase Storage.
 *
 * Путь всегда `<user_id>/<папка>/<uuid>.jpg` — первым сегментом id
 * владельца, и на этом стоит вся защита: политика в базе сверяет его с
 * `auth.uid()` (`hikingmap/supabase/schema.sql`, бакет `route-photos`).
 *
 * ⚠️ Файл пережимается **до** загрузки: с телефона фотография прилетает на
 * 4–8 МБ, а в карточке она показывается шириной в 380 px. 1600 px по длинной
 * стороне и качество 0.82 дают 200–400 КБ — в двадцать раз меньше при той же
 * картинке на экране.
 *
 * ⚠️ Пережатие в canvas **стирает EXIF**, а вместе с ним GPS. Поэтому
 * координаты читаются из оригинала до пережатия и едут рядом с путём
 * (`{ p, c }`): по ним фото ставится на тропу. Нет их — `c: null`, и точку
 * можно будет указать руками.
 *
 * Зависит от account.js (`Account.client`, `Account.userId`) и supa.js.
 */
(function () {
    'use strict';

    const BUCKET = 'route-photos';
    const MAX_SIDE = 1600;
    const QUALITY = 0.82;
    const MAX_FILES = 12;

    const client = () => (window.Account && Account.client && Account.client()) || null;
    const uid = () => (window.Account && Account.userId && Account.userId()) || null;

    function newName() {
        const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 3 | 8)).toString(16);
            });
        return id + '.jpg';
    }

    /** Публичный адрес фото. Сегменты кодируем — в uuid этого не нужно, но
     *  путь может прийти из базы каким угодно. */
    function urlOf(path) {
        if (!path) return '';
        if (/^https?:/.test(path)) return path;         // уже адрес
        return `${SUPA.URL}/storage/v1/object/public/${BUCKET}/` +
            String(path).split('/').map(encodeURIComponent).join('/');
    }

    /** GPS из EXIF оригинала. `exifr` грузится лениво — он уже есть у сайта. */
    async function gpsOf(file) {
        try {
            if (!window._ensureExifr) return null;
            const exifr = await window._ensureExifr();
            const gps = await exifr.gps(file);
            return (gps && isFinite(gps.longitude) && isFinite(gps.latitude))
                ? [gps.longitude, gps.latitude] : null;
        } catch (e) { return null; }
    }

    /** Пережатие до 1600 px по длинной стороне. Ориентацию EXIF браузер
     *  применяет к `<img>` сам (`image-orientation: from-image`). */
    function shrink(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
                const w = Math.max(1, Math.round(img.naturalWidth * scale));
                const h = Math.max(1, Math.round(img.naturalHeight * scale));
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                cv.toBlob(b => b ? resolve(b) : reject(new Error('canvas.toBlob вернул пусто')),
                          'image/jpeg', QUALITY);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('не читается как картинка')); };
            img.src = url;
        });
    }

    /**
     * Загрузка. `folder` — например `route_3`.
     * @returns {Promise<Array<{p: string, c: number[]|null}>>}
     */
    async function upload(files, folder, onProgress) {
        const c = client();
        if (!c || !uid()) throw new Error('not signed in');
        const list = [...files].slice(0, MAX_FILES);
        const out = [];
        for (let i = 0; i < list.length; i++) {
            if (onProgress) onProgress(i, list.length);
            const file = list[i];
            const coords = await gpsOf(file);
            const blob = await shrink(file);
            const path = `${uid()}/${folder}/${newName()}`;
            const { error } = await c.storage.from(BUCKET)
                .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
            if (error) throw error;
            out.push({ p: path, c: coords });
        }
        if (onProgress) onProgress(list.length, list.length);
        return out;
    }

    /** Удаление из хранилища. Ошибку глотаем: строка уже без этих фото, и
     *  застрявший файл лучше, чем сломанное сохранение. */
    async function remove(paths) {
        const c = client();
        if (!c || !paths || !paths.length) return;
        try {
            await c.storage.from(BUCKET).remove(paths.map(p => (p && p.p) ? p.p : p));
        } catch (e) { console.warn('[photos] удаление:', e); }
    }

    /** Диалог выбора файлов. Свой `input` на каждый вызов — иначе второй
     *  выбор того же файла не даёт события `change`. */
    function pick(multiple) {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg,image/png,image/webp';
            if (multiple !== false) input.multiple = true;
            input.style.display = 'none';
            input.addEventListener('change', () => {
                const files = [...input.files];
                input.remove();
                resolve(files);
            });
            document.body.appendChild(input);
            input.click();
        });
    }

    window.UserPhotos = { BUCKET, MAX_FILES, urlOf, upload, remove, pick, shrink };
})();
