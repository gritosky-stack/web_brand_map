/**
 * Адрес и публичный ключ проекта Supabase — на двоих с account.js.
 *
 * Отдельным файлом потому, что до входа и до загрузки SDK (220 КБ) сайту
 * нужны **публичные** данные: статусы авторских маршрутов каталога
 * (`catalog_status`) решают, какого цвета метка на карте, и нужны гостю
 * так же, как вошедшему. Ради одного GET тянуть SDK незачем — PostgREST
 * отвечает обычному `fetch` с двумя заголовками.
 *
 * Ключ публичный по замыслу: тот же уезжает в бандле приложения. Данные
 * одного пользователя от другого отделяет RLS (`hikingmap/supabase/schema.sql`).
 */
(function () {
    'use strict';

    const URL_ = 'https://fehspolrnlslzrvjieba.supabase.co';
    const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlaHNwb2xybmxzbHpydmppZWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4Mjg2MjQsImV4cCI6MjEwMjQwNDYyNH0.rk2nNm22oBZ2wot3dM6oI5e6j-WVN0ArWBoSM3nWdW0';

    /**
     * Анонимный GET в PostgREST. `path` — как в SDK, но строкой запроса:
     *   rest('catalog_status?select=*')
     * Ошибку не глотаем молча, но и не роняем вызывающего: `null` значит
     * «не получилось», и сайт работает дальше без этих данных.
     */
    async function rest(path) {
        try {
            const res = await fetch(`${URL_}/rest/v1/${path}`, {
                headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.warn('[supa] ' + path + ':', e);
            return null;
        }
    }

    window.SUPA = { URL: URL_, ANON_KEY: ANON, rest };
})();
