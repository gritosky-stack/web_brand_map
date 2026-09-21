// ── Firebase config ────────────────────────────────────────────────────────────
// 1. Create a project at console.firebase.google.com
// 2. Add a Web App, copy the config object here
// 3. In Firestore → Rules, set:
//      allow read: if true;
//      allow create: if request.auth != null;
//      allow update, delete: if request.auth != null && request.auth.uid == resource.data.userId;
// 4. Enable Anonymous Authentication in Firebase Console → Auth → Sign-in providers
const FIREBASE_CONFIG = {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT.firebaseapp.com",
    projectId:         "YOUR_PROJECT_ID",
    storageBucket:     "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId:             "YOUR_APP_ID"
};

let _db = null, _auth = null, _fbUser = null;

// SDK (~510 КБ) грузим только если Firebase реально настроен — раньше три
// скрипта качались и разбирались на каждой загрузке страницы вхолостую.
const FIREBASE_SDK = [
    'libs/firebase-app-compat.js',
    'libs/firebase-firestore-compat.js',
    'libs/firebase-auth-compat.js'
];

function _loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function _initFirebase() {
    if (FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') return; // not yet configured
    try {
        for (const src of FIREBASE_SDK) await _loadScript(src);   // порядок важен: app → firestore/auth
        if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
        _db   = firebase.firestore();
        _auth = firebase.auth();
        _auth.signInAnonymously().then(c => { _fbUser = c.user; }).catch(() => {});
    } catch(e) { console.warn('Firebase init failed:', e); }
}

// ── Configuration ─────────────────────────────────────────────────────────────
const MAPBOX_TOKEN = 'pk.eyJ1IjoidG9jemtpamciLCJhIjoiY21uYWE1dnY0MGdjMTJwcDYwMW9hN3IzbyJ9.z8vVKr9lNliGDfC5Kd8Ttg';
mapboxgl.accessToken = MAPBOX_TOKEN;

// ── Хитмап троп ───────────────────────────────────────────────────────────────
// Публичные GPS-треки OpenStreetMap: видно, где люди реально ходят, даже там,
// где тропа не нарисована. Открытые данные OSM, ключей и прокси не требуют.
const HEATMAP_SOURCE = {
    hint:    'публичные GPS-треки OpenStreetMap',
    maxzoom: 20,
    tiles:   ['https://gps.tile.openstreetmap.org/lines/{z}/{x}/{y}.png']
};

let _heatmapOn = false;

// Рамка Сербии вместе с Косово: [запад, юг, восток, север]
const SERBIA_BOUNDS = [18.81, 41.85, 23.01, 46.19];

/**
 * Куда класть линии и растры поверх рельефа: под первый слой подписей стиля.
 *
 * ⚠️ С рельефом Mapbox «натягивает» линии, заливки и растры на поверхность
 * пачкой — одной текстурой на тайл, которую пересобирает, только когда тайлы
 * меняются. Но пачка — это слои, лежащие **подряд внизу**, до первых
 * подписей (они на рельеф не натягиваются). Слой, добавленный поверх подписей,
 * из пачки выпадает, и его приходится натягивать отдельно на **каждом кадре**.
 * Хитмап и «маршруты линиями» лежали именно так: включил их — и вращение
 * вокруг маршрута, где видно полсотни тайлов, пошло рывками, а со временем
 * всё хуже (фидбэк 2026-09-19).
 */
window.drapeBeforeId = function() {
    if (!window.map || !map.getStyle()) return undefined;
    const layer = map.getStyle().layers.find(l => l.type === 'symbol');
    return layer ? layer.id : undefined;
};

function toggleHeatmap(on) {
    _heatmapOn = on;
    // Хитмап можно воткнуть в слот «Сравнения карт» — погасили тумблером,
    // слот опустел (map_slots.js)
    if (window.MapSlots) MapSlots.onLayerToggled('heat', on);
    // Слой кладём под линии маршрутов, а они появляются в обработчике map.on('load').
    // isStyleLoaded() бывает true ещё до него, поэтому ждём именно линии — иначе
    // хитмап встанет поверх треков.
    if (!window.map || !map.getLayer('overview-lines-done')) return;
    if (map.getLayer('heatmap-layer')) map.removeLayer('heatmap-layer');
    if (map.getSource('heatmap-source')) map.removeSource('heatmap-source');
    if (!on) return;

    // ⚠️ Только Сербия (вместе с Косово): за рамкой `bounds` тайлы вообще не
    // запрашиваются. Вокруг карта затемнена маской, и грузить туда хитмап —
    // лишний трафик и работа (фидбэк 2026-09-19).
    map.addSource('heatmap-source', {
        type: 'raster', tiles: HEATMAP_SOURCE.tiles, tileSize: 256,
        minzoom: 3, maxzoom: HEATMAP_SOURCE.maxzoom,
        bounds: SERBIA_BOUNDS,
        attribution: '© OpenStreetMap contributors'
    });
    // Под маской вокруг Сербии — край рамки, попавший за границу, затемнён
    // вместе с остальной картой; и под линиями маршрутов, чтобы красные
    // треки не терялись в оранжевом.
    const below = map.getLayer('world-mask-layer') ? 'world-mask-layer' : 'overview-lines-done';
    map.addLayer({
        id: 'heatmap-layer', type: 'raster', source: 'heatmap-source',
        paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 }
    }, below);
    // Над гравюрой и крутизной, под тропами — общий порядок в extra_layers.js
    if (window.ExtraLayers) ExtraLayers.restack();
}

// ── Route data ─────────────────────────────────────────────────────────────────
// date: 'YYYY-MM-DD' | description: string | instagramUrl: string|null
const routesList = [
    {
        file: 'Samari - Lastra.gpx',
        overrideAscent: 718, overrideDescent: 829, overrideTime: '6h 24m',
        date: '2026-03-01',
        description: 'Мы проделали еще один классный маршрут - от Самари до Ластры и вышло офигенно!)🔥\nПогода была просто супер: чистое небо и солнышко, снег почти весь растаял, только выше 1000 метров еще лежит.\nБыло очень красиво, видели четырех оленей 🦌, горы на горизонте - оба Повлена и много других.\nПо итогу:\n• Прошли 22.6 км вместо 21.5 (погрешность на красивые места и пару ошибок с тропой)\n• Общее время с паузами: 6:27 ⏱️\n• Чистой ходьбы: 5:18 🥾\nВсе держались просто супер, темп был классный! Спасибо за ваш позитив) Немного волновался, что идем впритык к поезду, но все оказалось не так страшно - добрались до станции за 30-35 минут до отправления. 🚂\n Спасибо за доверие и что присоединились!! ❤️',
        instagramUrl: null,
        photos: ['photos/Samari - Lastra/IMG_6806.JPG', 'photos/Samari - Lastra/IMG_6817.JPG']
    },
    {
        file: 'Gvozdacke Stene.gpx',
        overrideAscent: 726, overrideDescent: 730, overrideTime: '6h 07m',
        date: '2026-03-08',
        description: 'Классно сходили, виды со скал были просто нереальные!!',
        instagramUrl: null,
        photos: [
            'photos/Gvozdacke Stene/IMG_7332.JPG', 'photos/Gvozdacke Stene/IMG_7382.JPG',
            'photos/Gvozdacke Stene/IMG_7387.JPG', 'photos/Gvozdacke Stene/IMG_7425.JPG',
            'photos/Gvozdacke Stene/IMG_7466.JPG'
        ]
    },
    {
        file: 'Lastra - Divcibare.gpx',
        overrideAscent: 604, overrideDescent: 587, overrideTime: '5h 43m',
        date: '2026-03-15',
        description: 'Маршрут от ЖД станции Ластра с резким набором и хвойными лесами Дивчибаре. \n Было классно 🔥',
        instagramUrl: null,
        photos: [
            'photos/Lastra - Divcibare/IMG_7564.JPG', 'photos/Lastra - Divcibare/IMG_7572.JPG',
            'photos/Lastra - Divcibare/IMG_7580.JPG'
        ]
    },
    {
        file: 'Samari - Magles - Pali.gpx', name: 'Samari - Magleš (Pali)',
        overrideAscent: 805, overrideDescent: 805, overrideTime: '7h',
        date: '2026-02-14',
        description: '🏔️ Маглеш (1036м): 21 км снежного безумия! ❄️ Мы не ожидали такой глубины — снег \n таял прямо в ботинках, но темп задали такой, что горы горели! 🔥 Главным героем \n дня стал 69-летний Зоран: легенда хайкинга, который знает каждую \nтропу и заброшенную хижину в районе Вальево как свои пять пальцев. 👴🥾 \nВместе форсировали полноводную реку Забаву и пробирались через сказочные\n заснеженные леса. На пути встретили местную жительницу: она пугала\n нас медведями 🐻 и настойчиво пыталась напоить ракией 🥃 \n(сербское гостеприимство — оно такое!). В итоге спускались в густом тумане 🌫️,\nно совершили невозможное и успели запрыгнуть в уходящий поезд. 🚂💨\n Настоящее приключение, где ноги промокли насквозь, \nно сердце согрето историями и горами! ❤️🏔️',
        instagramUrl: 'https://www.instagram.com/reel/DVZryC5CLZp/',
        photos: [
            'photos/Samari - Magles - Pali/IMG_6278.JPG', 'photos/Samari - Magles - Pali/IMG_6312.JPG',
            'photos/Samari - Magles - Pali/IMG_6317.JPG', 'photos/Samari - Magles - Pali/IMG_6360.JPG',
            'photos/Samari - Magles - Pali/IMG_6408.JPG', 'photos/Samari - Magles - Pali/IMG_6427.JPG',
            'photos/Samari - Magles - Pali/IMG_6435.JPG', 'photos/Samari - Magles - Pali/IMG_6448.JPG',
            'photos/Samari - Magles - Pali/IMG_6451.JPG', 'photos/Samari - Magles - Pali/IMG_6495.JPG',
            'photos/Samari - Magles - Pali/IMG_6502.JPG'
        ]
    },
    {
        file: 'Medednik - Bucurska pecina.gpx',
        overrideAscent: 1267, overrideDescent: 1272, overrideTime: '8h 25m',
        date: '2026-03-07',
        description: 'Живописный маршрут, посетили пещеру, залезли на крутой склон Медведника, \nнаделали кучу фоток, прошли по гребню и спустились \n через красивый лес. Увидели закат, в конце спускались \n в темноте с фонариками',
        instagramUrl: null,
        photos: [
            'photos/Medednik - Bucurska pecina/IMG_7045.JPG', 'photos/Medednik - Bucurska pecina/IMG_7146.JPG',
            'photos/Medednik - Bucurska pecina/IMG_7257.JPG', 'photos/Medednik - Bucurska pecina/IMG_7281.JPG',
            'photos/Medednik - Bucurska pecina/IMG_7287.JPG', 'photos/Medednik - Bucurska pecina/IMG_7299.JPG',
            'photos/Medednik - Bucurska pecina/IMG_7306.JPG'
        ]
    },
    {
        file: 'Valjevo - Gradac River Canyon.gpx',
        overrideAscent: 301, overrideDescent: 382, overrideTime: '4h', overrideMinEle: 171,
        date: '', description: 'Один из первых маршрутов, поезд до Вальево, \n прошли через город к реке Градац. Шли вдоль реки, \n видели оленя, зашли на тропу со значком опасности \n По итогу путь оказался узким с крутым склоном справа. \n Успешно его пройдя оказались рядом с этно - деревней. Пройдя дальше мы повернули \n и опошли в обратную сторону. Встретили очень красивый монастырь Челие. Прошли \n уже легким путем обратно в Вальево.', instagramUrl: 'https://www.instagram.com/reel/DUUDzPiCBbM/'
    },
    {
        file: 'Istocni Maljen - Mokra Pecina.gpx', name: 'Istoćni Maljen - Mokra Pecina',
        overrideAscent: 931, overrideDescent: 935, overrideTime: '7h 57m',
        date: '2026-02-15',
        description: '🏔 Массив Мальен: 24 км дикой Сербии, олени и ночной финиш - небольшой отчет\nВ эти выходные зафиналили мощнейший круговой маршрут вокруг горного массива Мальен. Если кратко: это было эпично, мокро и местами очень загадочно.\n📊 Цифры для статистики:\n• Дистанция: 24 км\n• Набор высоты: 931 м (столько же спуска — настоящие «качели»)\n• Время в пути: 8 часов (из них 6.5 ч чистого движения)\n• Средняя скорость: 3.4 км/ч\n• Локация: Равна Гора, старт от церкви Св. Георгия.\nЧто было на маршруте:\n1. Дикая природа: Сразу на старте из-под носа у собаки Тиши сорвались два оленя. Чуть позже на склонах удалось заснять убегающую лисицу. Живности тут полно.\n2. Пещера Мокра Печина: Невероятное место! Из неё вытекает ледяной ручей, а внутри слышен гул водопадов. Пройти до конца не дали глубина воды и отсутствие подходящей обуви и снаряжения, но атмосфера — 10/10.\n3. Виды на 100+ км: С хребта при ясной погоде разглядели даже Авалу (Белград) и Космай. Пейзажи наверху пустынные: сухая трава, редкие хвойные и абсолютный простор.\n4. Загадочные воронки: Наткнулись на целые ряды странных кратеров в земле (по 5-10 м в диаметре). Похоже на карстовые воронки, но выглядят как следы от бомбардировки.\n5. Сербский колорит: В лесу встретили молодых охотников на «Ниве» с мигалками. Поспрашивали, как дела, и предупредили, что в этих краях водятся волки (но они нас боятся больше, чем мы их).\n🔦 Финиш в темноте:\nПоследние километры дорезали уже в сумерках и полной темноте под свет фонариков. Был крутой финальный подъем на 100 метров, который окончательно «добил» ноги.\n🏆 Главный герой:\nСобака Тиша. Пока мы прошли 24 км, её GPS-ошейник насчитал 39.4 км. К концу дня в машине спали все: и девчонки, и собака.\nБыло офигенно) спасибо Наде, Хавин и Оле что присоединились и за доверие 🤞',
        instagramUrl: 'https://www.instagram.com/reel/DUy8LHWiO0d/?igsh=ODAzczY4ZngyMjV1',
        photos: [
            'photos/Maljen/IMG_5753.JPG', 'photos/Maljen/IMG_5819.JPG', 'photos/Maljen/IMG_5837.JPG',
            'photos/Maljen/IMG_5852.JPG', 'photos/Maljen/IMG_5888.JPG', 'photos/Maljen/IMG_5975.JPG',
            'photos/Maljen/IMG_5999.JPG', 'photos/Maljen/IMG_6033.JPG'
        ]
    },
    {
        file: 'Бељаница - Богојављенски успон.gpx',
        overrideAscent: 1105, overrideDescent: 1119, overrideTime: '5h 51m',
        date: '2026-03-22',
        description: 'Очень красивый и одновременно сложный маршрут. Оставили машину недалеко от реки, \nпрошли до деревни к водопаду Велики Бук, а затем начали подьем. \n Подъем средней сложности, прошли по лесистой местности, постоянно набирая высоту. \nНаверху было холодно и дул сильный ветер, кусты и ветки деревьев были в \nгоризонтальных сосульках от ветра. Мы быстро прошли до вершины, оказались выше \nнекоторых облаков, наделали фоток и сразу начали спуск в тепло по весеннему лесу. \nСпуск был очень крутой, но красивый. Почти в самом конце мы зашли на видиковац\n невероятной красоты, с видом на каньон. \n ',
        instagramUrl: null,
        photos: [
            'photos/Бељаница - Богојављенски успон/IMG_7799.JPG', 'photos/Бељаница - Богојављенски успон/IMG_7805.JPG',
            'photos/Бељаница - Богојављенски успон/IMG_7828.JPG', 'photos/Бељаница - Богојављенски успон/IMG_7891.JPG'
        ]
    },
    {
        file: 'Ovcar.gpx', name: 'Ovčar',
        date: '2026-04-19',
        description: 'Круговой маршрут по горе Овчар — одной из жемчужин Западной Сербии. Стартовали от Овчар Бани и начали подъём через густые леса. По пути прошли мимо монастыря Свети Тројице, одного из многочисленных монастырей Овчарско-Кабларского ущелья, иногда называемого "Сербским Афоном". Дальше поднялись к монастырю Сретење — там нас угостили кофе и сладостями. Добрались до вершины с обзорной площадкой, откуда открывались виды на ущелье реки Западная Морава и окрестные горы. Перекусили и спустились обратно тем же путём.',
        instagramUrl: null,
        photos: [
            'photos/Ovcar/IMG_8743.JPG', 'photos/Ovcar/IMG_8768.JPG',
            'photos/Ovcar/IMG_8772.JPG', 'photos/Ovcar/IMG_8782.JPG',
            'photos/Ovcar/IMG_8846.JPG', 'photos/Ovcar/IMG_8870.JPG',
            'photos/Ovcar/IMG_8878.JPG'
        ]
    },
    {
        file: 'Debelo Brdo - Jablanik.gpx', name: 'Debelo Brdo - Jablanik',
        date: '',
        description: 'Интересный маршрут. Было довольно людно, встречали группы от 2 до 15 человек.\n\nОт Дебело Брдо до верха Ябланика дорога не сложная, уклон небольшой и не постоянный. По дороге к вершине проходим через красивый лес, сквозь деревья видно Гвождачке Стене — внушительные скалы с обрывом на 400+ метров к реке Дрина и границе Сербии.\n\nНа вершине Ябланика может задувать ветерок, так что рекомендую взять с собой ветровку. Вид с вершины открывается впечатляющий: видно зелёные холмистые равнины на горизонте, гору Медведник, Велики Повлен, Гвождачке Стене и много других горных вершин неподалёку.\n\nСпуск с вершины иногда крутой, но тоже очень красивый. Иногда встречаются сосны, но в основном лиственные деревья. Спустившись попадаем к речушке Ябланица — с чистой водой и небольшим течением.\n\nМаршрут предполагает переход реки как минимум 2–3 раза, будьте готовы. В сухую погоду непромокаемой обуви будет достаточно.\n\nОт реки Ябланица необходимо подняться обратно к Дебело Брдо — есть 2 варианта: короткий но крутой, или более длинный но пологий. В идеале этот маршрут идти наоборот: сначала спуск вниз к реке от Дебело Брдо, а затем подъём на Ябланик — так будет комфортнее.',
        instagramUrl: null,
        photos: [
            'photos/Debelo Brdo - Jablanik/jablanik1.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik2.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik3.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik4.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik5.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik6.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik7.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik8.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik9.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik10.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik11.JPG',
            'photos/Debelo Brdo - Jablanik/jablanik12.JPG',
        ]
    },
    {
        file: 'Lastra - Magles - Kusakovici.gpx', name: 'Lastra - Magleš - Kušakovići',
        overrideAscent: 987, overrideDescent: 986, overrideTime: '5h', overrideMinEle: 365,
        date: '', description: 'Один из первых походов, доехал до ЖД станции Ластра, прошел чуть вдоль реки \n и начал подъем в гору. Моментами тропа терялась и приходилось проходить через ветки \n и кустарник. Встречалось много заброшенных хижин. На последних 200 метрах набора высоты \n тропа совсем потерялась и я шел по дикому по заросшим мхом камням. \nПосле вершины вышел на открытый участок с классным видос, начал спуск \n обратно, к станции ластра и по пути наткнулся на деревню Кушаковичи\n', instagramUrl: 'https://www.instagram.com/reel/DUjkxYiiBu-/',
        photos: [
            'photos/Lastra - Magles - Kusakovici/IMG_5170.JPG', 'photos/Lastra - Magles - Kusakovici/IMG_5216.JPG',
            'photos/Lastra - Magles - Kusakovici/IMG_5238.JPG', 'photos/Lastra - Magles - Kusakovici/IMG_5265.JPG',
            'photos/Lastra - Magles - Kusakovici/IMG_5320.JPG', 'photos/Lastra - Magles - Kusakovici/IMG_5334.JPG',
            'photos/Lastra - Magles - Kusakovici/IMG_5339.JPG', 'photos/Lastra - Magles - Kusakovici/IMG_5358.JPG',
            'photos/Lastra - Magles - Kusakovici/IMG_5396.JPG', 'photos/Lastra - Magles - Kusakovici/IMG_5408.JPG',
            'photos/Lastra - Magles - Kusakovici/IMG_5441.JPG', 'photos/Lastra - Magles - Kusakovici/IMG_5478.JPG',
            'photos/Lastra - Magles - Kusakovici/IMG_5489.JPG', 'photos/Lastra - Magles - Kusakovici/IMG_5498.JPG',
            'photos/Lastra - Magles - Kusakovici/IMG_5506.JPG'
        ]
    },
    {
        file: 'Ostrvica.gpx', name: 'Ostrvica',
        date: '',
        description: 'Острвица — приметная коническая вершина (760 м) в районе горы Рудник в Шумадии, увенчанная руинами средневековой крепости.\n\nМаршрут короткий, но крутой: почти весь набор высоты (≈390 м) укладывается в пару километров — вверх по склону конуса практически без передышки. На вершине сохранились остатки крепостных стен, а вокруг открывается круговая панорама на холмы Шумадии и массив Рудника.\n\n📊 Маршрут: ~2 км, набор ≈390 м, вершина 760 м.',
        instagramUrl: null,
        photos: [
            'photos/Ostrvica/ostrvica1.JPG', 'photos/Ostrvica/ostrvica2.JPG',
            'photos/Ostrvica/ostrvica3.JPG', 'photos/Ostrvica/ostrvica4.JPG',
            'photos/Ostrvica/ostrvica5.JPG', 'photos/Ostrvica/ostrvica6.JPG',
            'photos/Ostrvica/ostrvica7.JPG', 'photos/Ostrvica/ostrvica8.JPG',
            'photos/Ostrvica/ostrvica9.JPG', 'photos/Ostrvica/ostrvica10.JPG'
        ]
    },
    {
        file: 'Maglic - Stolovi.gpx', name: 'Maglić - Stolovi',
        date: '',
        description: 'Кольцевой маршрут по массиву Столови недалеко от Кралево — горному хребту над долиной реки Ибар.\n\nСнизу почти весь набор (≈960 м) накручивается по лесистым склонам, выводя к скальным выходам и открытым гребням, которыми славятся Столови. С верхней части маршрута открываются широкие виды на окрестные хребты Западной Сербии.\n\n📊 Маршрут кольцевой: ~9 км, набор ≈960 м, верх ≈900 м.',
        instagramUrl: null,
        photos: [
            'photos/Maglic - Stolovi/maglic1.JPG', 'photos/Maglic - Stolovi/maglic2.JPG',
            'photos/Maglic - Stolovi/maglic3.JPG', 'photos/Maglic - Stolovi/maglic4.JPG',
            'photos/Maglic - Stolovi/maglic5.JPG', 'photos/Maglic - Stolovi/maglic6.JPG',
            'photos/Maglic - Stolovi/maglic7.JPG', 'photos/Maglic - Stolovi/maglic8.JPG',
            'photos/Maglic - Stolovi/maglic9.JPG', 'photos/Maglic - Stolovi/maglic10.JPG',
            'photos/Maglic - Stolovi/maglic11.JPG'
        ]
    },
    {
        file: 'Dzherdzhap - Ploce - Veliki Strabac.gpx', name: 'Đerdap - Ploče - Veliki Štrbac',
        date: '2026-05-30',
        description: 'Стартовали от парковки у дороги. Приехали в национальный парк Джердап с организацией «Srbija za Mlade».\n\nПодъём начали рано утром, почти весь маршрут проходит через лес — что очень классно в жаркие дни. Для групп обязательно сопровождение рейнджеров, которые также могут довезти до основных обзорных точек на Дастерах. Нас сопровождало двое)\n\nГруппа была большая, но мы довольно быстро поднимались и делали привалы каждые час-полтора. Видели много интересных жуков по дороге, лес был очень красивый)\n\nНа вершине и обзорной площадке «Велики Штрбац» открывается безумно красивый вид на Дунай, национальный парк Джердап и Румынию, которая прямо за Дунаем. Дул сильный ветер, пришлось накинуть ветровку.\n\nПосле спустились до ниже расположенного, но не менее красивого обзорного пункта «Плоче». Там соорудили площадку, с которой открывается вид на реку и массивную скалу прямо в ней, а также видно высочайшую точку, с которой мы спустились.\n\nЗатем благополучно спустились обратно и уехали кушать в ресторан 🤤',
        instagramUrl: null,
        photos: [
            'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0149.JPG', 'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0159.JPG',
            'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0210.JPG', 'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0213.JPG',
            'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0219.JPG', 'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0228.JPG',
            'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0231.JPG', 'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0238.JPG',
            'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0252.JPG', 'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0253.JPG',
            'photos/Dzherdzhap - Ploce - V-Strbac/IMG_0481.JPG'
        ]
    },
    {
        file: 'Vrutci Camping V2.gpx', name: 'Vrutci Camping',
        date: '2026-06-06',
        description: 'Эпичный двухдневный маршрут, сочетающий прогулку по старинной узкоколейке, исследование диких пещер и ночёвку на берегу горного озера. Идеальный выбор для тех, кто хочет сбежать от городской суеты в настоящую сербскую глушь.\n\n🗺️ Ключевые точки:\n• Каньон Джетинья: живописная тропа через 5 скальных туннелей (до 190 м в длину) и освежающие заводи.\n• Пещера Мегара: исследовательская точка с уникальной экосистемой — внутри колонии летучих мышей и сталактиты (нужен фонарь и сменная одежда).\n• Римские руины: возможность прикоснуться к истории прямо на маршруте.\n• Озеро Врутци: масштабная дамба и живописные берега, окружённые холмистым лесом. Лучшее место для атмосферного кемпинга и ночного купания.\n\n✨ Почему стоит выбрать этот маршрут:\n• Разнообразие: смена локаций от археологических объектов до диких пещер и озёрных стоянок.\n• Доступность: старт и финиш доступны на поезде из Белграда (ст. Стапари).\n• Атмосфера: настоящий «дикий» сербский опыт — тишина, лесные звуки, ночные купания и общение с местными жителями.\n\n⚠️ Советы участникам:\n• Безопасность: в регионе обитают медведи (неагрессивные, предпочитают растительную пищу) — соблюдайте базовые правила хранения еды в лагере.\n• Снаряжение: берите фонари для пещеры и удобную трекинговую обувь (маршрут сочетает ровные участки и лесные тропы).\n• Локальное комьюнити: на плотине можно встретить местных охранников (Радэ), которые подскажут актуальную информацию по рыбалке и ситуации на озере.\n\n🚂 Транспорт: поезд «Белград — Стапари» (~4.5 часа в пути).\n💰 Бюджет: ~2 000 RSD со своим снаряжением.',
        instagramUrl: null,
        photos: [
            'photos/Vrutci Camping/IMG_0495.JPG', 'photos/Vrutci Camping/IMG_0557.JPG',
            'photos/Vrutci Camping/IMG_0579.JPG', 'photos/Vrutci Camping/IMG_0598.JPG',
            'photos/Vrutci Camping/IMG_0603.JPG', 'photos/Vrutci Camping/IMG_0607.JPG',
            'photos/Vrutci Camping/IMG_0616.JPG', 'photos/Vrutci Camping/IMG_0633.JPG',
            'photos/Vrutci Camping/IMG_0665.JPG', 'photos/Vrutci Camping/IMG_0694.JPG',
            'photos/Vrutci Camping/IMG_0710.JPG'
        ]
    },
    // ── Двухдневные маршруты с ночёвкой ────────────────────────────────────────
    // GPX склеен из дневных треков (www/multiday/) скриптом tools/merge_gpx_days.py:
    // внутри файла по одному <trk> на день, парсер читает их как единый маршрут.
    {
        file: 'Samari - Dren. Kik Camp.gpx', name: 'Samari - Dren. Kik Camp',
        overrideAscent: 483, overrideDescent: 481,
        date: '2026-07-19',
        description: 'Короткий двухдневный выход с ночёвкой на Дрен. Кик — отличный вариант, когда хочется настоящего кемпинга, но без больших километров.\n\n🥾 День 1 (19.07): от станции Самари вверх, 5.4 км и +452 м набора до места ночёвки на высоте ~800 м. Подъём почти без передышки, зато лагерь встаёт на открытой поляне с видом на лесистые холмы Вальевского края.\n\n🌙 Ночёвка: костёр и закат над долиной.\n\n🥾 День 2 (20.07): спуск обратно к Самари другой тропой — 3.1 км и −350 м. Быстрый выход к станции.\n\n📊 Итого за два дня: 8.5 км, набор ≈483 м, верхняя точка 862 м.\n\n💡 Маршрут отлично подходит для первого кемпинга: короткие переходы, вода и станция рядом, всё снаряжение несётся всего 5 км.',
        instagramUrl: null,
        photos: [
            'photos/Samari - Dren. Kik Camp/dren_kik_camp1.JPG', 'photos/Samari - Dren. Kik Camp/dren_kik_camp2.JPG',
            'photos/Samari - Dren. Kik Camp/dren_kik_camp3.JPG', 'photos/Samari - Dren. Kik Camp/dren_kik_camp4.JPG',
            'photos/Samari - Dren. Kik Camp/dren_kik_camp5.JPG', 'photos/Samari - Dren. Kik Camp/dren_kik_camp6.JPG',
            'photos/Samari - Dren. Kik Camp/dren_kik_camp7.JPG', 'photos/Samari - Dren. Kik Camp/dren_kik_camp8.JPG',
            'photos/Samari - Dren. Kik Camp/dren_kik_camp9.JPG', 'photos/Samari - Dren. Kik Camp/dren_kik_camp10.JPG',
            'photos/Samari - Dren. Kik Camp/dren_kik_camp11.JPG', 'photos/Samari - Dren. Kik Camp/dren_kik_camp12.JPG',
            'photos/Samari - Dren. Kik Camp/dren_kik_camp13.JPG'
        ]
    },
    {
        file: 'Vrutci Camping 2.gpx', name: 'Vrutci Camping 2',
        overrideAscent: 1078, overrideDescent: 1089,
        date: '2026-07-25',
        description: 'Второй заход на кемпинг у озера Врутци — тот же любимый маршрут через каньон Джетиње, но уже летом и в полную жару.\n\n🥾 День 1 (25.07): от Стапари вдоль старой узкоколейки и через скальные тоннели каньона, дальше подъём лесными тропами к озеру Врутци. 11.7 км, +682 м. Лагерь на берегу озера.\n\n🌙 Ночёвка: костёр и дикие берега Врутци.\n\n🥾 День 2 (26.07): возвращение к Стапари другим вариантом тропы — 11.9 км, +396 м, с длинными открытыми участками и видами на холмы вокруг озера.\n\n📊 Итого за два дня: 23.5 км, набор ≈1078 м, верхняя точка 843 м.\n\n⚠️ Летом на маршруте мало тени на верхних участках — берите запас воды; в районе водятся медведи, еду на ночь убирайте.\n\n🚂 Транспорт: поезд «Белград — Стапари».',
        instagramUrl: null,
        photos: [
            'photos/Vrutci Camping 2/vrutci_camping_21.JPG', 'photos/Vrutci Camping 2/vrutci_camping_22.JPG',
            'photos/Vrutci Camping 2/vrutci_camping_23.JPG', 'photos/Vrutci Camping 2/vrutci_camping_24.JPG',
            'photos/Vrutci Camping 2/vrutci_camping_25.JPG', 'photos/Vrutci Camping 2/vrutci_camping_26.JPG',
            'photos/Vrutci Camping 2/vrutci_camping_27.JPG', 'photos/Vrutci Camping 2/vrutci_camping_28.JPG'
        ]
    },
    {
        file: 'Samari - Taorske Stene Camp.gpx', name: 'Samari - Taorske Stene Camp',
        overrideAscent: 841, overrideDescent: 842,
        date: '2026-08-09',
        description: 'Двухдневный маршрут от станции Самари к Таорским стенам с ночёвкой на гребне — самый «высокий» кемпинг из наших: лагерь стоит выше 1000 м.\n\n🥾 День 1 (09.08): от Самари (480 м) долгий ровный набор через лес и открытые луга — 11.5 км и +713 м до места ночёвки на 1013 м. Вечером с гребня открывается панорама на десятки километров и очень красивый закат.\n\n🌙 Ночёвка: лагерь на верхней поляне, костёр, утром — заросли ежевики прямо у тропы.\n\n🥾 День 2 (10.08): спуск обратно к Самари — 8.2 км, −656 м, короче и быстрее первого дня.\n\n📊 Итого за два дня: 19.7 км, набор ≈841 м, верхняя точка 1013 м.\n\n💡 Воды наверху нет — весь запас на ночёвку нужно поднимать с собой снизу.',
        instagramUrl: null,
        photos: [
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp1.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp2.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp3.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp4.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp5.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp6.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp7.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp8.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp9.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp10.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp11.JPG',
            'photos/Samari - Taorske Stene Camp/samari_taorske_stene_camp12.JPG'
        ]
    }
];

/**
 * Три статуса — три цвета, одни и те же у авторских маршрутов и у своих.
 *
 *   done    красный     пройден
 *   planned оранжевый   планируется: скоро идём (у автора таких 1–2)
 *   idle    фиолетовый  в запасе / просто сохранён
 *
 * ⚠️ Цвет значит **статус**, а не владельца. Авторский маршрут от своего
 * отличает **форма** метки: у авторского диск, у своего кольцо (см.
 * `makePulsingDot`). Раньше цвет нёс и то и другое, и свой пройденный
 * маршрут оставался фиолетовым, хотя пройден (фидбэк 2026-09-21).
 */
const STATUS_COLOR = { done: '#ff4d4d', planned: '#FF8C00', idle: '#7A5EA6' };
// ⚠️ Этот кусок script.js исполняется и в Node — `tools/build_route_index.js`
// берёт из него настоящий `routes`, чтобы цифры индекса не разъехались с
// сайтом. Там нет `window`, и обращение к нему валит сборку индекса.
if (typeof window !== 'undefined') window.STATUS_COLOR = STATUS_COLOR;

/** `future` остался производным от статуса — на него смотрит weather.js. */
function _isPlanned(status) { return status === 'planned'; }

const routes = {};
routesList.forEach((data, index) => {
    routes[`route_${index}`] = {
        id: `route_${index}`,
        file: data.file,
        name: data.name || data.file.replace('.gpx', ''),
        status: 'done',
        color: STATUS_COLOR.done,
        future: false,
        overrideAscent: data.overrideAscent,
        overrideDescent: data.overrideDescent,
        overrideTime: data.overrideTime,
        overrideMinEle: data.overrideMinEle !== undefined ? data.overrideMinEle : null,
        date: data.date || null,
        description: data.description || null,
        instagramUrl: data.instagramUrl || null,
        photos: data.photos || [],
        videos: data.videos || []
    };
});

const futureRoutesList = [
    { file: 'future_trips/Dom_Vis-Javoracki-vrh.gpx' },
    { file: 'future_trips/Рудник - Благовештење.gpx' },
    { file: 'future_trips/Каблар.gpx' },
    { file: 'future_trips/Дивчибаре - Козомор - Црни Врх.gpx' },
    {
        file: 'future_trips/Veliki Krs.gpx',
        name: 'Велики Крш',
        description: 'Велики Крш — легендарный карстовый хребет на востоке Сербии, известный как "Альпы восточной Сербии". Известняковые скалы хребта сформировались 277 миллионов лет назад как доисторический морской риф. С гребня открываются панорамы на горы Стол, Дели Йован, Хомольские горы и Борское озеро. Хребет известен непредсказуемыми ветрами и капризной погодой — пилоты предпочитают его облетать. Маршрут: 24.2 км, набор высоты 978 м, вершина 1135 м.',
        photos: ['future_trips/photos/20210214_143517.jpg', 'future_trips/photos/Veliki-krs-2-scaled.jpg', 'future_trips/photos/Veliki-krs-1148-Goran-Stamenkovic-scaled.jpg'],
    },
    {
        file: 'future_trips/Велики Вукан.gpx',
        name: 'Велики Вукан',
        description: 'Велики Вукан — самая популярная вершина Хомольских гор на востоке Сербии. Круговой маршрут через буковые и сосновые леса выводит на вершину с панорамным видом 360° на окружающие горы. Маршрут несложный и подходит даже для начинающих. После похода можно расслабиться в термальном источнике в деревне Ждрело (вода 40°C) в 150 км от Белграда. Маршрут: 19.5 км, набор высоты 1272 м, вершина 743 м.',
        photos: ['future_trips/photos/Homolje-Veliki-i-Mali-Vukan-1.jpg', 'future_trips/photos/VELIKI VUKAN_5.jpg', 'future_trips/photos/Veliki_Vukan_mapa.jpeg'],
    },
    {
        file: 'future_trips/Хайдучка, Погана, Миjуциđa caves.gpx',
        name: 'Пещеры: Хайдучка, Погана, Мийучица',
        description: 'Три дикие карстовые пещеры Хомольских гор — настоящее подземное приключение. Хайдучка пещера прячет ледяную подземную реку в тёмных залах. Погана пещера удивляет "световым колодцем" — отверстием в потолке. Мийучица — жемчужина маршрута: подземное озеро, мощный карстовый источник у входа, где берёт начало река Комненска, и живописный водопад рядом. Пещеры дикие, необустроенные — всё в первозданном виде. Маршрут: 17.4 км, набор высоты 827 м.',
        photos: ['future_trips/photos/20240406_143023.jpg', 'future_trips/photos/135226923.400x300.jpg', 'future_trips/photos/hajducka-pecina-homolje-gajduckaja-pesshera.jpg', 'future_trips/photos/pogana-pecina-vnutri-pesshera.jpg'],
    },
    {
        file: 'future_trips/Tornicka_Bobija.gpx',
        name: 'Tornička Bobija',
        description: 'Tornička Bobija (1268 м) — лесистая вершина в самом сердце западной Сербии, в горном массиве Подринья. Маршрут петляет через густые буковые леса, то и дело пересекая небольшие ручьи и родники — вода здесь буквально везде: бьёт из-под земли, течёт по камням, наполняет лесные балки.\nНа подъёме встречаются несколько мощных карстовых источников с ледяной водой — идеальная остановка в жаркий день. С гребня открываются виды на поросшие лесом холмы Поринья и долину реки Тамнавы. Вершина скромная, но окружение — первозданный лес без единого человека — компенсирует всё сполна.\nМаршрут круговой: ~15 км, набор высоты ~530 м. Хорошо подходит для межсезонья.',
        photos: [
            'future_trips/photos/bobija1.jpg',
            'future_trips/photos/bobija2.jpg',
            'future_trips/photos/bobija3.jpg',
            'future_trips/photos/bobija4.jpg',
        ],
    },
    {
        file: 'future_trips/Maglic-Ciker-Usovica.gpx',
        name: 'Maglić - Čiker - Usovica',
        description: 'Маршрут по горному массиву Столови вблизи Кралево: три вершины — Маглич (1375 м), Чикер и Усовица — одним кольцом.\nПлато Столови известен своими скальными выходами, лесами и широкими панорамами на долину Ибра и Кралево. Маршрут разнообразный: крутые подъёмы, открытые гребни, живописные спуски через лес.\n📊 Маршрут круговой, ~7 ч в пути, вершина 1375 м.',
        photos: [
            'future_trips/photos/stolovi1.JPG',
            'future_trips/photos/stolovi2.JPG',
            'future_trips/photos/stolovi3.JPG',
            'future_trips/photos/stolovi4.JPG',
        ],
    },
];
// ⚠️ Эти маршруты теперь **в запасе** (`idle`, фиолетовые), а не «планы».
// Планируемый — это поход, на который скоро идёт группа; таких в моменте
// один-два, и назначает их админ через `catalog_status` (route_status.js).
futureRoutesList.forEach((data, index) => {
    const key = `future_${index}`;
    routes[key] = {
        id: key, file: data.file,
        name: data.name || data.file.split('/').pop().replace('.gpx', ''),
        status: 'idle', color: STATUS_COLOR.idle, future: false,
        overrideAscent: null, overrideDescent: null, overrideTime: null, overrideMinEle: null,
        date: null, description: data.description || null, instagramUrl: null,
        photos: data.photos || [], videos: []
    };
});

// ── Caches ─────────────────────────────────────────────────────────────────────
const parsedRouteDataCache = {};
const routeFeatures = [];
const _overviewFeatures = [];  // for background route lines
let _showLines = false;        // lines toggle state
let _carouselHW = 0;           // shared carousel half-width cache
let _drawInterval   = null;    // interval for progressive line drawing
let _dashAnimFrame  = null;    // animation frame for continuous flow after draw
let _selectedRouteId = null;   // route whose pulsing dot is currently hidden
let _activeFilterType = 'all'; // current Все/Отчёты/Планы/Мои filter

// Базовые фильтры линий обзора — по **статусу**: у каждого статуса свой цвет
// линии. Фильтр вкладки к ним добавляется, а не подменяет их.
const _BASE_LINE_FILTER = {
    done:    ['==', ['get', 'status'], 'done'],
    planned: ['==', ['get', 'status'], 'planned'],
    idle:    ['==', ['get', 'status'], 'idle']
};

/**
 * Что показывает вкладка каталога.
 *
 *   Все · Авторские · Планы · Мои · Пройденные
 *
 * «Авторские» — все маршруты каталога сайта: и пройденные, и те, что в
 * запасе, и анонсы. «Планы» — то, куда собираются идти: авторские анонсы
 * (их 1–2) и личные планируемые. «Мои» — всё, что пользователь сохранил.
 * «Пройденные» — то, что он **сам** отметил пройденным: личный статус лежит
 * в свойстве `pstatus` (route_status.js), и он не то же самое, что `status`
 * — статус авторского маршрута в каталоге общий на всех.
 */
function _tabFilter() {
    const t = _activeFilterType;
    if (t === 'author')  return ['==', ['get', 'author'], true];
    if (t === 'planned') return ['==', ['get', 'status'], 'planned'];
    if (t === 'mine')    return ['==', ['get', 'mine'], true];
    if (t === 'done')    return ['==', ['get', 'pstatus'], 'done'];
    return null;
}

// Combined marker filter: applies type filter + always hides the selected route dot
function _applyMarkerFilter() {
    if (!map || !map.getLayer('route-markers-layer')) return;
    const f = _tabFilter();
    let mf = f;
    if (_selectedRouteId) {
        const ex = ['!=', ['get', 'id'], _selectedRouteId];
        mf = f ? ['all', f, ex] : ex;
    }
    map.setFilter('route-markers-layer', mf);
    map.setFilter('route-hitboxes-layer', mf);

    // Mirror filter to overview lines (only relevant when lines are visible)
    Object.keys(_BASE_LINE_FILTER).forEach(kind => {
        const id = 'overview-lines-' + kind;
        if (!map.getLayer(id)) return;
        const base = _BASE_LINE_FILTER[kind];
        map.setFilter(id, f ? ['all', base, f] : base);
        map.setLayoutProperty(id, 'visibility', _showLines ? 'visible' : 'none');
    });
}

/**
 * Свойства метки и линии обзора. Вкладки фильтруют карту по ним
 * (`_tabFilter`), поэтому после смены личного статуса или статуса каталога
 * их надо пересобрать и перезалить источники — `refreshRouteProps`.
 */
function _routeProps(routeInfo) {
    const personal = window.RouteStatus ? RouteStatus.personalStatusOf(routeInfo) : null;
    const author = !routeInfo.mine && !routeInfo.shared;
    const status = routeInfo.status || (routeInfo.mine ? 'idle' : 'done');
    // Авторский анонс — единственная метка, которая обязана бросаться в глаза:
    // на этот маршрут скоро идёт группа. Поэтому у неё своя иконка и подпись
    const featured = author && status === 'planned';
    return {
        id:      routeInfo.id,
        status,
        future:  _isPlanned(status),
        mine:    !!routeInfo.mine,
        author,
        featured,
        label:   featured ? _plannedLabel(routeInfo) : '',
        pstatus: personal || ''
    };
}

/**
 * Значок над названием в карточке маршрута.
 *
 * ⚠️ Отдельной функцией, а не строкой внутри отрисовки карточки: статус
 * меняют кнопкой в той же карточке, и значок обязан меняться сразу. Пока это
 * было частью `_onArrive`, новый статус появлялся только после переоткрытия
 * (фидбэк 2026-09-21).
 */
window.refreshPanelBadge = function(routeInfo) {
    const badge = document.getElementById('panel-status-badge');
    if (!badge) return;
    const info = routeInfo || currentViewedRoute;
    if (!info) { badge.innerHTML = ''; badge.className = 'hidden'; return; }

    // Личная отметка важнее статуса каталога: она отвечает на «а я тут был?»
    const personal = window.RouteStatus ? RouteStatus.personalStatusOf(info) : null;
    const st = info.status || (info.mine ? 'idle' : 'done');
    let text, color;
    if (info.shared) {
        text = 'Поделились'; color = STATUS_COLOR.idle;
    } else if (personal === 'done') {
        text = info.mine ? 'Пройден' : 'Пройден вами'; color = STATUS_COLOR.done;
    } else if (personal === 'planned') {
        text = info.mine ? 'Планируется' : 'В ваших планах'; color = STATUS_COLOR.planned;
    } else if (st === 'planned') {
        text = 'Скоро идём'; color = STATUS_COLOR.planned;
    } else if (st === 'idle') {
        text = info.mine ? 'Мой маршрут' : 'В запасе'; color = STATUS_COLOR.idle;
    } else {
        text = 'Пройден'; color = STATUS_COLOR.done;
    }
    badge.className = 'panel-badge';
    badge.style.cssText = `--pb:${color}`;
    badge.textContent = text;
    badge.classList.remove('hidden');
};

/** Подпись под меткой анонса: «Идём 12 октября» или просто «Скоро идём». */
function _plannedLabel(routeInfo) {
    if (!routeInfo.date) return 'Скоро идём';
    const d = new Date(String(routeInfo.date).length <= 10 ? routeInfo.date + 'T12:00:00' : routeInfo.date);
    if (isNaN(d)) return 'Скоро идём';
    return 'Идём ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

window.refreshRouteProps = function() {
    [routeFeatures, _overviewFeatures].forEach(arr => arr.forEach(f => {
        const r = routes[f.properties.id];
        if (r) f.properties = _routeProps(r);
    }));
    _flushRouteSources();
    _applyMarkerFilter();
};

// ── Total km counter ──────────────────────────────────────────────────────────
// Пока не вошли — сколько прошла команда по авторским маршрутам каталога.
// Вошли — счётчик становится **личным**: километры маршрутов, которые
// пользователь сам отметил пройденными (`route_status.js` → `setPersonalKm`).
// Подпись меняется вместе с числом, иначе «Пройдено лично: 0 км» у гостя.
let _authorKm   = 0;
let _personalKm = null;      // null — счётчик в режиме «команда»
let _shownKm    = 0;
let _kmAnimFrame = null;

/** Километры авторских маршрутов. Пересчёт целиком: статус маршрута может
 *  поменяться уже после загрузки (`catalog_status`), и слагаемых станет меньше. */
window.recomputeAuthorKm = function() {
    let km = 0;
    Object.values(routes).forEach(r => {
        if (r.mine || r.shared || r.status !== 'done') return;
        const d = parsedRouteDataCache[r.id];
        if (d) km += d.distance;
    });
    _authorKm = km;
    _renderKmCounter();
};

/** Личные километры. `null` — вышли, счётчик возвращается к авторским. */
window.setPersonalKm = function(km) {
    _personalKm = (km == null) ? null : km;
    _renderKmCounter();
};

function _renderKmCounter() {
    const personal = _personalKm != null;
    const to = personal ? _personalKm : _authorKm;
    const ids = [
        { val: 'total-km-value', display: 'total-km-display', label: 'total-km-label' },
        { val: 'total-km-value-mobile', display: 'total-km-display-mobile', label: 'total-km-label-mobile' }
    ];
    ids.forEach(({ display, label }) => {
        const el = document.getElementById(display);
        // Ноль у гостя не показываем: маршруты ещё грузятся
        if (el && (personal || to > 0)) el.style.opacity = '1';
        const lab = document.getElementById(label);
        if (lab) lab.textContent = personal ? 'Пройдено лично' : 'Пройдено командой';
    });
    if (_kmAnimFrame) cancelAnimationFrame(_kmAnimFrame);
    const from = _shownKm;
    _shownKm = to;
    const startTime = performance.now();
    const duration = 900;
    function tick(now) {
        const p = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = (from + (to - from) * eased).toFixed(1);
        ids.forEach(({ val: id }) => { const el = document.getElementById(id); if (el) el.textContent = val; });
        if (p < 1) { _kmAnimFrame = requestAnimationFrame(tick); }
        else { ids.forEach(({ val: id }) => { const el = document.getElementById(id); if (el) el.textContent = to.toFixed(1); }); }
    }
    _kmAnimFrame = requestAnimationFrame(tick);
}

// ── Pulsing dots ───────────────────────────────────────────────────────────────
const size = 64;

/**
 * Кадр пульсации: перерисовывать чаще двенадцати раз в секунду незачем.
 *
 * ⚠️ Возвращать `true` на **каждом** кадре нельзя: этим иконка говорит карте
 * «я изменилась», и карта перезаливает её текстуру и рисует новый кадр —
 * шестьдесят раз в секунду, бесконечно, даже когда камера стоит. На спутнике
 * с рельефом это постоянная нагрузка на видеокарту: у неё кончались ресурсы,
 * подписи на карте рассыпались в цветные полоски, а браузер утаскивал за
 * собой машину (фидбэк 2026-09-18). Между перерисовками просим следующий
 * кадр таймером — иначе, вернув `false`, анимация на неподвижной карте
 * заснула бы навсегда.
 */
function pulseDue(image, periodMs) {
    const now = performance.now();
    if (now - (image._lastFrame || 0) >= periodMs) {
        image._lastFrame = now;
        return true;
    }
    if (!image._wake) {
        image._wake = setTimeout(() => {
            image._wake = null;
            if (window.map) map.triggerRepaint();
        }, periodMs);
    }
    return false;
}

/**
 * Пульсирующая метка маршрута.
 *
 * Цвет — это **статус** (красный пройден, оранжевый планируется, фиолетовый
 * в запасе), а `shape` — **чей маршрут**: `disc` у авторских, `ring` у своих.
 * Разделять форме, а не цвету, приходится потому, что цвет уже занят
 * статусом, а знать «моё или из каталога» всё равно надо.
 *
 * ⚠️ У кольца середина **прозрачная**, а обводка двойная — белая снаружи и
 * тёмная внутри. Тёмное ядро на тёмном лесу спутника просто исчезает: в
 * приложении такие метки уже приходилось откатывать (hikingmap/CLAUDE.md,
 * «Ярусы карты»). Прозрачная середина показывает сам снимок, а форму держат
 * две обводки — они читаются и на скале, и на зелени.
 */
function makePulsingDot(rgb, fill, periodMs, shape) {
    const ring = shape === 'ring';
    return {
        width: size, height: size, data: new Uint8Array(size * size * 4),
        onAdd() {
            const c = document.createElement('canvas');
            c.width = this.width; c.height = this.height;
            this.context = c.getContext('2d', { willReadFrequently: true });
        },
        render() {
            if (!pulseDue(this, 80)) return false;
            const now = performance.now();
            const t = (now % periodMs) / periodMs;
            const r = (size / 2) * 0.25;
            const base = ring ? r * 1.45 + 4 : r;
            const or = (size / 2 - base) * t + base;
            const ctx = this.context;
            ctx.clearRect(0, 0, size, size);
            const g = ctx.createRadialGradient(size/2,size/2,base, size/2,size/2,or);
            g.addColorStop(0, `rgba(${rgb},${0.7*(1-t)})`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            ctx.beginPath(); ctx.arc(size/2,size/2,or,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
            if (ring) {
                // ⚠️ Кольцо шире диска (×1.45): при равном радиусе отверстие
                // выходило в несколько пикселей, и на карте кольцо было не
                // отличить от диска — а вся его работа в том, чтобы отличаться
                const R = r * 1.45;
                ctx.beginPath(); ctx.arc(size/2,size/2,R,0,Math.PI*2);
                ctx.strokeStyle='rgba(10,10,10,.8)'; ctx.lineWidth=7.5; ctx.stroke();
                ctx.beginPath(); ctx.arc(size/2,size/2,R,0,Math.PI*2);
                ctx.shadowColor=`rgba(${rgb},0.9)`; ctx.shadowBlur=12;
                ctx.strokeStyle=fill; ctx.lineWidth=4.6; ctx.stroke(); ctx.shadowBlur=0;
                // Две тонкие белые обводки, по краям цветной: держат форму и
                // на тёмном лесу, и на скале
                [R + 3.1, R - 3.1].forEach(rr => {
                    ctx.beginPath(); ctx.arc(size/2,size/2,rr,0,Math.PI*2);
                    ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.lineWidth=1.3; ctx.stroke();
                });
            } else {
                ctx.beginPath(); ctx.arc(size/2,size/2,r,0,Math.PI*2);
                ctx.shadowColor=`rgba(${rgb},0.9)`; ctx.shadowBlur=15;
                ctx.fillStyle=fill; ctx.fill(); ctx.shadowBlur=0;
                ctx.strokeStyle='rgba(255,255,255,.95)'; ctx.lineWidth=2.5; ctx.stroke();
            }
            this.data = ctx.getImageData(0,0,size,size).data;
            return true;
        }
    };
}

/**
 * Метка авторского анонса — маршрута, на который скоро идёт группа. Таких на
 * карте один-два, и они должны находиться первыми: ядро крупнее, вокруг
 * **два** расходящихся кольца в противофазе и вращающаяся штриховая рамка.
 * Обычная пульсация рядом с десятками других меток не выделяется ничем.
 */
function makeFeaturedDot(rgb, fill, periodMs) {
    return {
        width: size, height: size, data: new Uint8Array(size * size * 4),
        onAdd() {
            const c = document.createElement('canvas');
            c.width = this.width; c.height = this.height;
            this.context = c.getContext('2d', { willReadFrequently: true });
        },
        render() {
            if (!pulseDue(this, 60)) return false;
            const ctx = this.context;
            const half = size / 2;
            const t = (performance.now() % periodMs) / periodMs;
            const r = half * 0.3;
            ctx.clearRect(0, 0, size, size);
            // Два кольца в противофазе: одно уходит, второе только пошло
            [t, (t + 0.5) % 1].forEach(ph => {
                const rr = r + (half - r - 2) * ph;
                ctx.beginPath(); ctx.arc(half, half, rr, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${rgb},${0.55 * (1 - ph)})`;
                ctx.lineWidth = 2.4 * (1 - ph) + 0.6;
                ctx.stroke();
            });
            const g = ctx.createRadialGradient(half, half, r, half, half, half);
            g.addColorStop(0, `rgba(${rgb},0.35)`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            ctx.beginPath(); ctx.arc(half, half, half, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
            // Штриховая рамка, медленно вращается: «готовимся»
            ctx.save();
            ctx.translate(half, half); ctx.rotate(t * Math.PI * 2);
            ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
            ctx.setLineDash([4, 5]); ctx.strokeStyle = `rgba(${rgb},0.8)`; ctx.lineWidth = 1.8;
            ctx.stroke(); ctx.restore();
            ctx.beginPath(); ctx.arc(half, half, r, 0, Math.PI * 2);
            ctx.shadowColor = `rgba(${rgb},1)`; ctx.shadowBlur = 18;
            ctx.fillStyle = fill; ctx.fill(); ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 2.5; ctx.stroke();
            this.data = ctx.getImageData(0, 0, size, size).data;
            return true;
        }
    };
}

const MINE_COLOR = STATUS_COLOR.idle;
// Диск — авторский маршрут, кольцо — свой; цвет у обоих по статусу
const ROUTE_ICONS = {
    'route-disc-done':    makePulsingDot('255,77,77',   STATUS_COLOR.done,    2000, 'disc'),
    'route-disc-planned': makePulsingDot('255,140,0',   STATUS_COLOR.planned, 2400, 'disc'),
    'route-disc-idle':    makePulsingDot('150,120,200', STATUS_COLOR.idle,    2200, 'disc'),
    'route-ring-done':    makePulsingDot('255,77,77',   STATUS_COLOR.done,    2000, 'ring'),
    'route-ring-planned': makePulsingDot('255,140,0',   STATUS_COLOR.planned, 2400, 'ring'),
    'route-ring-idle':    makePulsingDot('150,120,200', STATUS_COLOR.idle,    2200, 'ring'),
    'route-featured':     makeFeaturedDot('255,140,0',  STATUS_COLOR.planned, 1800)
};

// ── Map init ───────────────────────────────────────────────────────────────────
let map;
if (MAPBOX_TOKEN !== 'YOUR_MAPBOX_ACCESS_TOKEN') {
    // Одновременных запросов картинок (спутник, рельеф, хитмап) — 32 вместо
    // 16. Очередь у Mapbox одна на всю карту и строго по порядку, а в облёте
    // камера за секунду уходит на полэкрана: при 16 новые тайлы не успевали
    // выйти из очереди, и под камерой зияли дыры (замер 2026-09-19). Тайлы
    // идут по HTTP/2, лишние параллельные запросы почти ничего не стоят.
    mapboxgl.maxParallelImageRequests = 32;
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [20.9029, 44.2107],
        zoom: 6.5, pitch: 0,
        interactive: true,
        antialias: false,
        fadeDuration: 0,
        // Потолок на кэш тайлов: спутник с рельефом набирает текстуры быстро,
        // а держать их все в памяти видеокарты незачем — при долгом движении
        // камеры она уходила в отказ вместе с атласом подписей. Значение
        // выше обычного размера кадра, чтобы при вращении не появлялись
        // дыры вместо только что показанных тайлов.
        maxTileCacheSize: 200,
        maxBounds: [[17.2, 41.0], [24.4, 47.4]],
        renderWorldCopies: false
    });
    window.map = map; // expose for pss_layer.js (PSS routes on map)

    {
        const canvas = map.getCanvas();

        // ⚠️ Потеря контекста WebGL — это не «немного подтормаживает»: карта
        // остаётся на экране, но её текстуры уже мусор, и подписи городов
        // рассыпаются в цветные полоски. Восстановить это на месте Mapbox не
        // умеет, поэтому пересобираем страницу — но только по-настоящему
        // потеряв контекст, а не при каждой просадке.
        canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault();
            console.warn('[map] потерян контекст WebGL — перезагружаю страницу');
            setTimeout(() => location.reload(), 300);
        });

        canvas.style.filter = 'blur(14px) brightness(0.5)';
        map.once('idle', () => {
            canvas.style.transition = 'filter 1.4s ease';
            canvas.style.filter = '';
        });
    }

    map.on('load', () => {
        map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 256, maxzoom: 14
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.1 });

        applyMapStyle();

        map.getStyle().layers.forEach(layer => {
            if (layer.type === 'raster') {
                map.setPaintProperty(layer.id, 'raster-fade-duration', 0);
            }
        });

        Object.keys(ROUTE_ICONS).forEach(id => map.addImage(id, ROUTE_ICONS[id], { pixelRatio: 1.5 }));

        // ── Overview lines (toggleable background, added below markers) ──
        // Initialise with whatever routes have already finished loading (race-safe)
        map.addSource('overview-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: _overviewFeatures } });
        // Под подписями — см. drapeBeforeId
        // Линия — по статусу, как и метка. Своя от авторской здесь не
        // отличается: разделять их линиям нечем, а цвет занят статусом
        map.addLayer({
            id: 'overview-lines-done', type: 'line', source: 'overview-lines',
            filter: _BASE_LINE_FILTER.done,
            layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
            paint: { 'line-color': STATUS_COLOR.done, 'line-width': 3, 'line-opacity': 0.85 }
        }, drapeBeforeId());
        map.addLayer({
            id: 'overview-lines-idle', type: 'line', source: 'overview-lines',
            filter: _BASE_LINE_FILTER.idle,
            layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
            paint: { 'line-color': STATUS_COLOR.idle, 'line-width': 3, 'line-opacity': 0.85 }
        }, drapeBeforeId());
        map.addLayer({
            id: 'overview-lines-planned', type: 'line', source: 'overview-lines',
            filter: _BASE_LINE_FILTER.planned,
            layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
            paint: { 'line-color': STATUS_COLOR.planned, 'line-width': 3, 'line-opacity': 0.9, 'line-dasharray': [2, 2.5] }
        }, drapeBeforeId());

        map.addSource('route-markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        map.addLayer({
            id: 'route-markers-layer', type: 'symbol', source: 'route-markers',
            layout: {
                // Анонс — своя иконка; остальным: цвет по статусу, форма по
                // тому, авторский маршрут или свой
                'icon-image': ['case',
                    ['==', ['get', 'featured'], true], 'route-featured',
                    ['concat', 'route-',
                        ['case', ['==', ['get', 'author'], true], 'disc', 'ring'],
                        '-', ['get', 'status']]],
                'icon-size': ['case', ['==', ['get', 'featured'], true], 1.18, 1],
                'icon-pitch-alignment': 'map', 'icon-allow-overlap': true,
                // Подпись только у анонса: «Идём 12 октября». Остальным она
                // не нужна — названия читаются в каталоге и в карточке
                'text-field': ['case', ['==', ['get', 'featured'], true], ['get', 'label'], ''],
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                'text-size': 11, 'text-offset': [0, 1.6], 'text-anchor': 'top',
                'text-allow-overlap': true, 'text-optional': true,
                'text-letter-spacing': 0.06
            },
            paint: {
                'text-color': '#FFD9A8',
                'text-halo-color': 'rgba(10,8,4,.9)', 'text-halo-width': 1.6
            }
        });

        map.addLayer({
            id: 'route-hitboxes-layer', type: 'circle', source: 'route-markers',
            paint: { 'circle-radius': 12, 'circle-color': 'transparent', 'circle-stroke-width': 0 }
        });

        const hoverPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'custom-hover-popup', offset: 15 });
        const photoHoverPopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'custom-hover-popup', offset: 10 });
        window.hoverPopup = hoverPopup;
        window.photoHoverPopup = photoHoverPopup;

        map.on('click', 'route-hitboxes-layer', (e) => {
            if (!e.features.length) return;
            // Пока расставляют фото, клик по карте ставит точку — открывать
            // этим же нажатием другой маршрут нельзя (photo_place.js)
            if (window.PhotoPlace && PhotoPlace.isActive()) return;
            triggerRouteSelection(e.features[0].properties.id);
        });

        let hoveredId = null;
        map.on('mousemove', 'route-hitboxes-layer', (e) => {
            if (!e.features.length) return;
            map.getCanvas().style.cursor = 'pointer';
            const id = e.features[0].properties.id;
            if (hoveredId !== id) {
                hoveredId = id;
                hoverPopup.setLngLat(e.features[0].geometry.coordinates)
                    .setHTML(`<div class="text-xs font-semibold tracking-wide">${_esc(routes[id].name)}</div>`)
                    .addTo(map);
            }
        });
        map.on('mouseleave', 'route-hitboxes-layer', () => {
            map.getCanvas().style.cursor = ''; hoveredId = null; hoverPopup.remove();
        });

        RouteMarks.map = map;

        // Если хитмап успели включить до готовности карты — добавляем сейчас
        if (_heatmapOn) toggleHeatmap(true);
    });
} else {
    console.warn('Mapbox token is missing.');
}

// ── Map style: labels + admin boundaries ──────────────────────────────────────
function applyMapStyle() {
    // Dark mask over non-Serbia (Mapbox built-in tileset, no external fetch)
    map.addSource('country-boundaries', { type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' });

    let firstLabelId = null;
    for (const layer of map.getStyle().layers) {
        if (layer.type === 'symbol') { firstLabelId = layer.id; break; }
    }

    map.addLayer({
        id: 'world-mask-layer', type: 'fill',
        source: 'country-boundaries', 'source-layer': 'country_boundaries',
        paint: { 'fill-color': '#000000', 'fill-opacity': 0.75 },
        // Use the Serbian ("RS") worldview, where Kosovo is rendered as part of
        // Serbia. The tileset stores overlapping polygons per worldview, so we
        // keep only the "all" features plus those valid for the RS worldview,
        // then darken everything that is not Serbia (SRB).
        filter: ['all',
            ['any',
                ['==', ['get', 'worldview'], 'all'],
                ['in', 'RS', ['get', 'worldview']]
            ],
            ['!=', ['get', 'iso_3166_1_alpha_3'], 'SRB']
        ]
    }, firstLabelId);

    map.getStyle().layers.forEach(layer => {
        if (layer.type === 'line') {
            const id = layer.id.toLowerCase();
            // Hide hiking paths from base style
            if (id.includes('path') || id.includes('trail') || id.includes('track') || id.includes('footway') || id.includes('steps')) {
                map.setLayoutProperty(layer.id, 'visibility', 'none');
            }
            // Hide sub-national admin borders (keep admin-0 = country borders),
            // and hide disputed boundary lines so the Serbia–Kosovo border is not
            // drawn — matching the RS worldview used for the dark mask above.
            if (id.includes('admin') || id.includes('boundary')) {
                const isCountryBorder = id.includes('admin-0') || id.includes('admin_0');
                const isDisputed = id.includes('disputed');
                if (!isCountryBorder || isDisputed) {
                    try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch(e) {}
                }
            }
        }
        if (layer.type === 'symbol') {
            const id = layer.id;
            const keep = id.includes('natural-point') || id.includes('natural-line') ||
                         id.includes('settlement-major') || id.includes('settlement-label');
            if (keep) {
                try {
                    map.setPaintProperty(id, 'text-halo-color', 'rgba(0,0,0,0.95)');
                    map.setPaintProperty(id, 'text-halo-width', 2);
                    map.setPaintProperty(id, 'text-color', '#ffffff');
                    map.setLayoutProperty(id, 'text-pitch-alignment', 'viewport');
                } catch(e) {}
            } else {
                map.setLayoutProperty(id, 'visibility', 'none');
            }
        }
    });
}

// ── Route selection ────────────────────────────────────────────────────────────
let currentViewedRoute = null;
let currentPhotoCoords = null;

window.flyToRoute = (routeId) => triggerRouteSelection(routeId);

function triggerRouteSelection(routeId) {
    const routeInfo = routes[routeId];
    const routeData = parsedRouteDataCache[routeId];
    if (!routeInfo || !routeData) return;
    // Пока рисуют маршрут, клик по карте ставит точку, а не открывает чужой
    if (window.RouteBuilder && RouteBuilder.active) return;
    if (window.MapPoints) MapPoints.hideCard();

    // Update URL so this route can be shared / bookmarked
    history.replaceState(null, '', '#' + routeId);

    if (window.hoverPopup) window.hoverPopup.remove();

    // Облёт или вращение прошлого маршрута останавливаем сразу: их кадры
    // перебивали бы перелёт к новому
    if (window.RouteProfile) RouteProfile.stopCinematic(true);

    // Remove previous peak marker and start/finish markers whenever we switch routes
    _removeStartFinishMarkers();

    if (currentViewedRoute && currentViewedRoute.id !== routeInfo.id) {
        removeRouteLine(currentViewedRoute.id);
        if (map.getLayer('photo-markers-glow')) {
            map.setFilter('photo-markers-glow', ['==', 'routeId', 'none']);
            map.setFilter('photo-markers-hitbox', ['==', 'routeId', 'none']);
        }
        if (map.getSource('photo-active-source')) {
            map.getSource('photo-active-source').setData({ type: 'FeatureCollection', features: [] });
        }
    }

    currentViewedRoute = routeInfo;
    _selectedRouteId = routeInfo.id;
    _applyMarkerFilter(); // immediately hide pulsing dot; peak marker added after moveend
    loadExifForRoute(routeInfo);

    // Force-expand and show sidebar, hide hero + description block
    const _pg = document.getElementById('route-panel-group');
    _pg.classList.remove('panel-collapsed');
    _pg.classList.add('sidebar-open');
    // Контекст и фон уходят во второй и третий ярус, пока маршрут открыт
    if (window.MapTiers) MapTiers.refresh();
    document.getElementById('route-panel').classList.add('panel-loading');
    document.getElementById('hero-text').classList.add('hero-hidden');
    const _heroDesc = document.getElementById('hero-desc');
    if (_heroDesc) _heroDesc.classList.add('hero-hidden');

    // Hide carousel
    const carousel = document.getElementById('route-carousel-outer');
    if (carousel) carousel.style.display = 'none';
    document.body.classList.add('route-open');   // прячет ленту «Мои»

    // fitBounds auto-calculates zoom so the full route is visible.
    // Padding compensates for the sidebar (desktop left) or bottom drawer (mobile).
    const _mob = window.innerWidth < 768;
    const _fitPad = _mob
        ? { top: 40, bottom: Math.round(window.innerHeight * 0.58) + 50, left: 20, right: 20 }
        : { top: 80, bottom: 80, left: 400, right: 80 }; // 400px left = sidebar width + margin

    // Кадр считаем при нулевых отступах карты и летим в него, сбрасывая их:
    // после облёта или вращения у карты остаётся отступ под карточку, Mapbox
    // складывает его с `_fitPad`, и на телефоне маршрут переставал
    // помещаться — перелёт молча не случался (см. RouteProfile.fitCoordinates)
    const _zeroPad = { top: 0, right: 0, bottom: 0, left: 0 };
    const _savedPad = map.getPadding();
    map.transform.padding = _zeroPad;
    let _cam = null;
    try { _cam = map.cameraForBounds(routeData.bounds, { padding: _fitPad, pitch: 45, bearing: -20, maxZoom: 14 }); } catch (e) {}
    map.transform.padding = _savedPad;
    if (_cam) {
        map.flyTo(Object.assign({}, _cam, { padding: _zeroPad, speed: 0.8, essential: true }));
    } else {
        map.flyTo({ center: [(routeData.bounds[0][0] + routeData.bounds[1][0]) / 2,
                             (routeData.bounds[0][1] + routeData.bounds[1][1]) / 2],
                    zoom: 12, pitch: 45, bearing: -20, padding: _zeroPad, speed: 0.8, essential: true });
    }

    // Маршрут дорисовываем, когда камера долетела. ⚠️ С подстраховкой по
    // времени: если перелёт перебили (новым касанием, другим маршрутом, камерой)
    // и `moveend` не пришёл, карточка навсегда оставалась пустой, в блюре и со
    // старым названием (фидбэк 2026-09-19)
    let _arrived = false;
    const _onArrive = () => {
        if (_arrived) return;
        _arrived = true;
        // Маршрут успели закрыть или открыть другой, пока летели
        if (!currentViewedRoute || currentViewedRoute.id !== routeInfo.id) return;

        addRouteToMap(routeInfo.id, routeData.coordinates, routeInfo.color, routeData.gradeStops, routeData.coordKm);

        // ── Высшая точка на карте (см. route_marks.js) ────────
        RouteMarks.setPeak(routeData.peakCoords || null);

        // ── Fill panel ────────────────────────────────────────
        // Status badge
        refreshPanelBadge(routeInfo);

        // Name
        document.getElementById('panel-name').textContent = routeInfo.name;

        // Date
        const dateEl = document.getElementById('panel-date');
        if (routeInfo.date) {
            const d = new Date(routeInfo.date);
            dateEl.textContent = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
            dateEl.classList.remove('hidden');
        } else {
            dateEl.classList.add('hidden');
        }

        // Stats
        // У своего маршрута высот может не быть (нарисован без рельефа) —
        // тогда прочерк, а не «0 m»
        const _m = v => v == null ? '—' : `${v} m`;
        document.getElementById('panel-dist').textContent    = `${routeData.distance} km`;
        document.getElementById('panel-ascent').textContent  = _m(routeInfo.overrideAscent  ?? routeData.ascent);
        document.getElementById('panel-descent').textContent = _m(routeInfo.overrideDescent ?? routeData.descent);
        document.getElementById('panel-min-ele').textContent = _m(routeInfo.overrideMinEle  ?? routeData.minEle);
        document.getElementById('panel-max-ele').textContent = _m(routeData.maxEle);
        document.getElementById('panel-time').textContent    = routeInfo.overrideTime ?? routeData.formattedTime;

        // Description with collapse
        const descWrap = document.getElementById('panel-description-wrapper');
        const descEl   = document.getElementById('panel-description');
        const descBody = document.getElementById('panel-desc-body');
        const descFade = document.getElementById('panel-desc-fade');
        const descBtn  = document.getElementById('panel-desc-toggle');
        if (routeInfo.description) {
            descEl.textContent = routeInfo.description;
            descWrap.classList.remove('hidden');
            // Start collapsed; show expand button only if text is actually long
            descBody.classList.remove('expanded');
            descBody.classList.add('collapsed');
            descFade.style.display = '';
            document.getElementById('panel-desc-toggle-label').textContent = 'Развернуть';
            document.getElementById('panel-desc-toggle-icon').style.transform = 'rotate(0deg)';
            // Check after render if text actually overflows
            requestAnimationFrame(() => {
                if (descEl.scrollHeight <= 66) {
                    // Short enough — no need for collapse UI
                    descBody.classList.remove('collapsed');
                    descBody.classList.add('expanded');
                    descFade.style.display = 'none';
                    descBtn.style.display  = 'none';
                } else {
                    descBtn.style.display = '';
                }
            });
        } else {
            descWrap.classList.add('hidden');
        }

        // Профиль высот, планирование времени и кнопки камеры — всё в
        // RouteProfile: график ведёт бегунок по карте, а выделенный на нём
        // участок подсвечивается на линии маршрута
        RouteProfile.show(routeInfo, routeData, routeInfo.id);
        if (window.RouteWeather) RouteWeather.show(routeInfo, routeData);

        // Фото, их метки на карте и кнопка авторских рилсов
        refreshPanelReport(routeInfo);

        // Difficulty bar
        const _diff = calcDifficulty(
            routeData.distance,
            routeInfo.overrideAscent  ?? routeData.ascent,
            routeInfo.overrideDescent ?? routeData.descent
        );
        const _diffEl = document.getElementById('panel-difficulty');
        _diffEl.classList.remove('hidden');
        document.getElementById('panel-difficulty-label').textContent = _diff.label;
        document.getElementById('panel-difficulty-label').style.color = _diff.color;
        document.getElementById('panel-difficulty-fill').style.width  = _diff.pct + '%';
        document.getElementById('panel-difficulty-fill').style.background = _diff.color;

        // Отзывы — только у маршрутов каталога; у своего вместо них действия
        // (переименовать, скачать, удалить) — см. account.js
        document.getElementById('tab-btn-reviews').style.display = routeInfo.mine ? 'none' : '';
        if (window.MyRoutes) MyRoutes.renderPanelActions(routeInfo);
        // Статус маршрута: личный («прошёл», «планирую») и, у авторских,
        // статус каталога для админа — route_status.js
        if (window.RouteStatus) RouteStatus.renderPanel(routeInfo);

        // Rating bar — reset for new route; reviews load lazily when tab opened
        _reviewsRouteId = null;
        document.getElementById('panel-rating-bar').style.display = 'none';
        document.getElementById('tab-reviews-count').classList.add('hidden');

        // Reset to info tab
        _switchPanelTab('info');

        // Remove loading blur now that panel is fully populated
        document.getElementById('route-panel').classList.remove('panel-loading');

        // Re-render photos once EXIF finishes
        loadExifForRoute(routeInfo).then(() => {
            if (currentViewedRoute && currentViewedRoute.id === routeInfo.id) {
                renderPhotosInPanel(routeInfo);
                renderPhotoMapMarkers(routeInfo);
            }
        });
    };
    map.once('moveend', _onArrive);
    setTimeout(_onArrive, 4000);
}

// ── Photo navigation in sidebar ───────────────────────────────────────────────
let _panelPhotos = [];
let _panelPhotoIdx = 0;

function showPanelPhoto(idx) {
    if (!_panelPhotos.length) return;
    _panelPhotoIdx = ((idx % _panelPhotos.length) + _panelPhotos.length) % _panelPhotos.length;
    const p = _panelPhotos[_panelPhotoIdx];

    const img = document.getElementById('panel-photo-img');
    const vid = document.getElementById('panel-photo-vid');
    const play = document.getElementById('panel-photo-play');
    const counter = document.getElementById('panel-photo-counter');

    if (p.isVideo) {
        img.classList.add('hidden');
        vid.classList.remove('hidden');
        vid.src = p.src;
        if (play) play.classList.remove('hidden');
    } else {
        vid.classList.add('hidden');
        if (vid.src) { vid.pause(); vid.src = ''; }
        img.classList.remove('hidden');
        // Не доехала крупная из R2 — остаёмся на мелкой копии из деплоя
        img.onerror = () => { img.onerror = null; img.src = photoThumb(p.src); };
        img.src = photoMed(p.src);
        if (play) play.classList.add('hidden');
    }

    if (counter) counter.textContent = `${_panelPhotoIdx + 1} / ${_panelPhotos.length}`;

    // Highlight active photo point on map (у фото без GPS — просто гасим подсветку,
    // остальные маркеры маршрута при этом остаются на карте)
    if (map.getSource('photo-active-source')) {
        const active = (p.coords && isFinite(p.coords[0]) && isFinite(p.coords[1]))
            ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: p.coords }, properties: {} }]
            : [];
        map.getSource('photo-active-source').setData({ type: 'FeatureCollection', features: active });
    }

    document.querySelectorAll('#panel-photos-container .photo-thumb').forEach((t, i) => {
        const active = i === _panelPhotoIdx;
        t.classList.toggle('ring-2', active);
        t.classList.toggle('ring-red-500', active);
        t.style.opacity = active ? '1' : '0.45';
    });
}

/**
 * Всё в карточке, что зависит от личного отчёта: фотографии, их метки на
 * карте и кнопка авторских рилсов.
 *
 * ⚠️ Отдельной функцией и зовётся после **любой** правки отчёта
 * (`RouteStatus.afterChange`). Пока это лежало внутри отрисовки карточки,
 * добавленные фото и поставленные руками точки появлялись только после
 * перезагрузки страницы (фидбэк 2026-09-21).
 *
 * ⚠️ У маршрута, который пользователь отметил пройденным и наполнил своими
 * фото и заметкой, авторских рилсов быть не должно: это уже его отчёт о
 * походе, а не наш.
 */
window.refreshPanelReport = function(routeInfo) {
    const info = routeInfo || currentViewedRoute;
    if (!info || !currentViewedRoute || currentViewedRoute.id !== info.id) return;

    const igWrap = document.getElementById('panel-instagram-wrapper');
    const igLink = document.getElementById('panel-instagram-link');
    const personalized = window.RouteStatus && RouteStatus.isPersonalized(info);
    if (igWrap && igLink) {
        if (info.instagramUrl && !personalized) {
            igLink.href = info.instagramUrl;
            igWrap.classList.remove('hidden');
        } else {
            igWrap.classList.add('hidden');
        }
    }
    renderPhotosInPanel(info);
    renderPhotoMapMarkers(info);
};

function renderPhotosInPanel(routeInfo) {
    const routeData = parsedRouteDataCache[routeInfo.id];
    const section = document.getElementById('panel-photos-section');
    const container = document.getElementById('panel-photos-container');
    const title = document.getElementById('panel-photos-title');

    section.classList.add('hidden');
    container.innerHTML = '';
    _panelPhotos = [];

    // Свои фото **заменяют** авторские: человек прошёл маршрут сам, и в его
    // карточке должен быть его поход (route_status.js)
    const own = window.RouteStatus ? RouteStatus.photosFor(routeInfo) : null;
    const geoms = own || (routeData && routeData.photoGeoms) || [];
    if (!geoms.length) return;

    if (title) title.textContent = own ? 'Мои фотографии' : 'Фотографии';
    _panelPhotos = geoms;
    section.classList.remove('hidden');

    _panelPhotos.forEach((p, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'photo-thumb shrink-0 w-12 h-12 rounded-lg overflow-hidden cursor-pointer transition-all';
        thumb.innerHTML = p.isVideo
            ? `<video src="${p.src}#t=0.001" class="w-full h-full object-cover" muted playsinline preload="metadata"></video>`
            : `<img src="${photoThumb(p.src)}" ${_imgFallback(p.src)} class="w-full h-full object-cover" loading="lazy" decoding="async" alt="">`;
        thumb.onclick = () => showPanelPhoto(i);
        container.appendChild(thumb);
    });

    showPanelPhoto(0);
}

// ── Difficulty ────────────────────────────────────────────────────────────────
function calcDifficulty(distance, ascent, descent) {
    const score = distance + ascent / 100 + descent / 200;
    if (score < 15) return { score, label: 'Лёгкий',     color: '#22c55e', pct: Math.round(score / 15 * 22) };
    if (score < 25) return { score, label: 'Средний',    color: '#eab308', pct: Math.round(22 + (score - 15) / 10 * 26) };
    if (score < 35) return { score, label: 'Сложный',    color: '#f97316', pct: Math.round(48 + (score - 25) / 10 * 26) };
    return             { score, label: 'Экспертный', color: '#ef4444', pct: Math.min(100, Math.round(74 + (score - 35) / 25 * 26)) };
}

// ── Stars renderer ────────────────────────────────────────────────────────────
function renderStars(rating, sizePx = 12) {
    let html = '';
    const s = sizePx;
    for (let i = 1; i <= 5; i++) {
        const id = `sg${Math.random().toString(36).slice(2,6)}`;
        if (rating >= i) {
            html += `<svg class="star-svg" width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#FF8C00"/></svg>`;
        } else if (rating >= i - 0.5) {
            html += `<svg class="star-svg" width="${s}" height="${s}" viewBox="0 0 24 24"><defs><linearGradient id="${id}"><stop offset="50%" stop-color="#FF8C00"/><stop offset="50%" stop-color="rgba(255,255,255,.12)"/></linearGradient></defs><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="url(#${id})"/></svg>`;
        } else {
            html += `<svg class="star-svg" width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="rgba(255,255,255,.12)"/></svg>`;
        }
    }
    return html;
}

// ── Avatar color ──────────────────────────────────────────────────────────────
const _AVATAR_COLORS = ['#e74c3c','#e67e22','#f39c12','#27ae60','#16a085','#2980b9','#8e44ad','#d35400'];
function _avatarColor(uid) {
    let s = 0; for (const c of uid) s += c.charCodeAt(0);
    return _AVATAR_COLORS[s % _AVATAR_COLORS.length];
}

// ── Tab switching ─────────────────────────────────────────────────────────────
window._switchPanelTab = function(tab) {
    const isInfo = tab === 'info';
    document.getElementById('panel-tab-info').style.display   = isInfo ? '' : 'none';
    document.getElementById('panel-tab-reviews').style.display = isInfo ? 'none' : '';
    document.getElementById('tab-btn-info').classList.toggle('active', isInfo);
    document.getElementById('tab-btn-reviews').classList.toggle('active', !isInfo);
    if (!isInfo && currentViewedRoute) _loadAndRenderReviews(currentViewedRoute.id);
};

// ── Firebase reviews ──────────────────────────────────────────────────────────
let _reviewsRouteId = null; // which route's reviews are currently loaded

async function _loadAndRenderReviews(routeId) {
    if (_reviewsRouteId === routeId) return; // already loaded
    _reviewsRouteId = routeId;

    const list   = document.getElementById('reviews-list');
    const empty  = document.getElementById('reviews-empty');
    const avgBig = document.getElementById('reviews-avg-big');
    const hStars = document.getElementById('reviews-header-stars');
    const hCount = document.getElementById('reviews-header-count');

    list.innerHTML = '<div id="reviews-empty" class="text-zinc-500 text-xs text-center py-8">Загрузка...</div>';

    if (!_db) {
        list.innerHTML = '<div class="text-zinc-600 text-xs text-center py-8">Firebase не настроен.<br>Заполните FIREBASE_CONFIG в script.js</div>';
        return;
    }

    try {
        const snap = await _db.collection('reviews')
            .where('routeId', '==', routeId)
            .orderBy('createdAt', 'desc')
            .get();

        const reviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Update header stats
        if (reviews.length) {
            const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
            const rounded = Math.round(avg * 10) / 10;
            avgBig.textContent = rounded.toFixed(1);
            hStars.innerHTML   = renderStars(avg, 13);
            hCount.textContent = `${reviews.length} ${_pluralReview(reviews.length)}`;
            _updateRatingBar(avg, reviews.length);
        } else {
            avgBig.textContent = '—';
            hStars.innerHTML   = '';
            hCount.textContent = 'Ещё нет отзывов';
            _updateRatingBar(null, 0);
        }

        // Update tab badge
        const badge = document.getElementById('tab-reviews-count');
        if (reviews.length) { badge.textContent = reviews.length; badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');

        // Render list
        if (!reviews.length) {
            list.innerHTML = '<div id="reviews-empty" class="text-zinc-500 text-xs text-center py-8">Будьте первым! Поделитесь впечатлениями.</div>';
            return;
        }
        list.innerHTML = reviews.map(r => _reviewCardHTML(r)).join('');

    } catch(e) {
        list.innerHTML = '<div class="text-zinc-600 text-xs text-center py-8">Ошибка загрузки отзывов.</div>';
        console.error(e);
    }
}

function _reviewCardHTML(r) {
    const color  = _avatarColor(r.userId || r.name || 'x');
    const initials = (r.name || '?').trim().split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const date   = r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' }) : '';
    return `<div class="review-card">
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:${r.text ? '10px' : '0'}">
            <div class="review-avatar" style="background:${color}">${initials}</div>
            <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:3px">
                    <span style="color:#fff;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(r.name)}</span>
                    <span style="color:rgba(255,255,255,.25);font-size:9px;white-space:nowrap">${date}</span>
                </div>
                <div style="display:flex;gap:2px">${renderStars(r.rating, 11)}</div>
            </div>
        </div>
        ${r.text ? `<p style="color:rgba(255,255,255,.65);font-size:12px;line-height:1.55;margin:0">${_esc(r.text)}</p>` : ''}
    </div>`;
}

function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _pluralReview(n) {
    if (n % 10 === 1 && n % 100 !== 11) return 'отзыв';
    if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'отзыва';
    return 'отзывов';
}

function _updateRatingBar(avg, count) {
    const bar = document.getElementById('panel-rating-bar');
    if (!bar) return;
    if (!count) {
        bar.style.display = 'none'; return;
    }
    bar.style.display = '';
    document.getElementById('panel-rating-score').textContent = (Math.round(avg * 10) / 10).toFixed(1);
    document.getElementById('panel-rating-stars').innerHTML   = renderStars(avg, 11);
    document.getElementById('panel-rating-count').textContent = `${count} ${_pluralReview(count)}`;
}

// ── Review form star picker ───────────────────────────────────────────────────
let _pickedRating = 0;

function _initStarPicker() {
    const picker = document.getElementById('star-picker');
    if (!picker || picker.dataset.init) return;
    picker.dataset.init = '1';
    picker.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'star-pick-btn';
        btn.dataset.v = i;
        btn.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/></svg>`;
        btn.addEventListener('click', () => {
            _pickedRating = i;
            picker.querySelectorAll('.star-pick-btn').forEach(b => b.classList.toggle('lit', +b.dataset.v <= i));
        });
        picker.appendChild(btn);
    }
}

// ── Варианты фотографий по размеру ────────────────────────────────────────────
//
// Мелкие копии (400 px, 5 МБ на весь сайт) едут в деплой и отдаются вместе с
// кодом. Крупные (1280 px) лежат в R2 — **том же бакете**, откуда их берёт
// приложение (`Services/PhotoStore.swift`), а оригиналы не нужны сайту вовсе:
// он их никогда не показывает.
//
// ⚠️ Из-за этого `www/photos` и `www/photos_med` в деплой не входят
// (`.vercelignore`): 450 МБ на каждую сборку — это и был счёт за хранилище
// Vercel. Оригиналы остаются в гите для бандла iOS и для пересборки копий.
// Поэтому же в `www/photos` нельзя класть видео: на сайте их не будет.
const PHOTO_CDN = 'https://pub-46dba1bca6754d2499a2a5aa9d5c879f.r2.dev';

/**
 * ⚠️ Готовый адрес оставляем как есть. Фото пользователя лежат в Supabase
 * Storage и приходят абсолютной ссылкой (`user_photos.js`); копий `_small` и
 * `_med` у них нет вовсе — они и загружены уже в нужном размере. Без этой
 * проверки `photoMed` заворачивал ссылку в адрес R2
 * (`pub-…r2.dev/https%3A%2F%2F…`), и просмотр своих фото ломался.
 */
const _isURL = src => typeof src === 'string' && /^(https?:|blob:|data:)/.test(src);

function _photoVariant(src, suffix) {
    if (!src || typeof src !== 'string' || _isURL(src)) return src;
    return src.replace(/(^|\/)photos\//, `$1photos${suffix}/`);
}

/** Путь в адрес R2: имена папок с пробелами и кириллицей — как в приложении */
function _cdnURL(path) {
    if (_isURL(path)) return path;
    return PHOTO_CDN + '/' + String(path).split('/').map(encodeURIComponent).join('/');
}

const photoThumb = src => _photoVariant(src, '_small');           // 400 px, из деплоя
const photoMed   = src => _cdnURL(_photoVariant(src, '_med'));    // 1280 px, из R2

// Подстраховка в разметке: нет мелкой копии — берём крупную из R2
function _imgFallback(orig) {
    if (_isURL(orig)) return '';
    return `onerror="this.onerror=null;this.src='${photoMed(orig).replace(/'/g, "\\'")}'"`;
}

// ── Photo map markers ──────────────────────────────────────────────────────────
function renderPhotoMapMarkers(routeInfo) {
    const routeData = parsedRouteDataCache[routeInfo.id];
    // Свои фото — как и в карточке — заменяют авторские. Координаты у них
    // либо из EXIF, либо поставлены руками (photo_place.js)
    const own = window.RouteStatus ? RouteStatus.photosFor(routeInfo) : null;
    // Фото без GPS в EXIF пропускаем: Point с coordinates:null — невалидный GeoJSON,
    // на нём падает разбор всего источника, и тогда на карте не видно НИ ОДНОГО
    // маркера (кроме активного — он в отдельном источнике photo-active-source).
    const features = (own || (routeData && routeData.photoGeoms) || [])
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => Array.isArray(p.coords) && isFinite(p.coords[0]) && isFinite(p.coords[1]))
        .map(({ p, i }) => ({
            type: 'Feature',
            properties: { id: i, src: p.src, routeId: routeInfo.id, isVideo: p.isVideo || false },
            geometry: { type: 'Point', coordinates: p.coords }
        }));

    if (!map.getSource('photo-markers-source')) {
        map.addSource('photo-markers-source', { type: 'geojson', data: { type: 'FeatureCollection', features } });
        map.addSource('photo-active-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        map.addLayer({
            id: 'photo-markers-glow', type: 'circle', source: 'photo-markers-source',
            paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-opacity': 0.9, 'circle-stroke-width': 2, 'circle-stroke-color': '#34AADF' },
            filter: ['==', 'routeId', routeInfo.id]
        });
        map.addLayer({
            id: 'photo-active-layer', type: 'circle', source: 'photo-active-source',
            paint: { 'circle-radius': 9, 'circle-color': '#fff', 'circle-opacity': 1, 'circle-stroke-width': 3, 'circle-stroke-color': '#00E5FF' }
        });
        map.addLayer({
            id: 'photo-markers-hitbox', type: 'circle', source: 'photo-markers-source',
            paint: { 'circle-radius': 24, 'circle-color': 'transparent' },
            filter: ['==', 'routeId', routeInfo.id]
        });
        // Бейджи старта/финиша/вершины должны остаться поверх меток фото
        RouteMarks.raise();

        map.on('mouseenter', 'photo-markers-hitbox', (e) => {
            map.getCanvas().style.cursor = 'pointer';
            const props = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates.slice();
            const media = props.isVideo
                ? `<video src="${props.src}#t=0.001" class="max-w-full max-h-full object-cover rounded-lg" muted playsinline></video><div class="absolute inset-0 flex items-center justify-center bg-black/30"><svg class="w-8 h-8 text-white opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>`
                : `<img src="${photoThumb(props.src)}" ${_imgFallback(props.src)} class="max-w-full max-h-full object-cover rounded-lg">`;
            window.photoHoverPopup.setLngLat(coords)
                .setHTML(`<div class="p-1 bg-black/80 rounded-xl border border-white/20 overflow-hidden w-32 h-32 flex items-center justify-center relative">${media}</div>`)
                .addTo(map);
        });
        map.on('mouseleave', 'photo-markers-hitbox', () => {
            map.getCanvas().style.cursor = '';
            window.photoHoverPopup.remove();
        });
        map.on('click', 'photo-markers-hitbox', (e) => {
            window.photoHoverPopup.remove();
            if (window.hoverPopup) window.hoverPopup.remove();
            const props = e.features[0].properties;
            openLightbox(props.src, e.features[0].geometry.coordinates, props.isVideo);
        });
    } else {
        map.getSource('photo-markers-source').setData({ type: 'FeatureCollection', features });
        map.setFilter('photo-markers-glow', ['==', 'routeId', routeInfo.id]);
        map.setFilter('photo-markers-hitbox', ['==', 'routeId', routeInfo.id]);
    }
}

// ── Lazy EXIF loader ──────────────────────────────────────────────────────────
// exifr нужен только как запасной путь (когда фото нет в routes_geom.json),
// поэтому грузим библиотеку по требованию, а не на каждой загрузке страницы.
let _exifrPromise = null;
function _ensureExifr() {
    if (window.exifr) return Promise.resolve(window.exifr);
    if (!_exifrPromise) {
        _exifrPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/exifr/dist/full.umd.js';
            s.onload  = () => resolve(window.exifr);
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    return _exifrPromise;
}

const _exifPromises = {};
function loadExifForRoute(routeInfo) {
    if (_exifPromises[routeInfo.id]) return _exifPromises[routeInfo.id];
    const routeData = parsedRouteDataCache[routeInfo.id];
    if (!routeData || routeData._exifDone) return Promise.resolve();

    _exifPromises[routeInfo.id] = (async () => {
        const geoms = [];
        if (routeInfo.videos) routeInfo.videos.forEach(v => geoms.push({ src: v.src, coords: v.coords, isVideo: true }));

        const photos = routeInfo.photos || [];
        const known  = routeData.photoGps || null;   // из routes_geom.json
        const missing = photos.filter(src => !known || !(src in known));

        let fallback = {};
        if (missing.length) {
            // Раньше здесь качалось КАЖДОЕ фото целиком (в среднем 2.6 МБ) только
            // ради GPS. exifr, получив URL вместо blob, читает Range-запросом
            // лишь начало файла, где лежит EXIF.
            try {
                const exifr = await _ensureExifr();
                const found = await Promise.all(missing.map(async (src) => {
                    try {
                        const gps = await exifr.gps(src);
                        return gps ? [gps.longitude, gps.latitude] : null;
                    } catch(e) { return null; }
                }));
                missing.forEach((src, i) => { fallback[src] = found[i]; });
            } catch(e) {
                console.warn('exifr не загрузился, фото останутся без маркеров', e);
            }
        }

        // Порядок = порядок в routesList (раньше зависел от того, что скачалось быстрее)
        photos.forEach(src => {
            const coords = (known && src in known) ? known[src] : (fallback[src] || null);
            geoms.push({ src, coords });
        });

        routeData.photoGeoms = geoms;
        routeData._exifDone = true;
    })();
    return _exifPromises[routeInfo.id];
}

// ── Lightbox ───────────────────────────────────────────────────────────────────
// Сам просмотр (карусель, зум, жесты) — в photo_viewer.js; здесь — связка с
// панелью маршрута, лентой миниатюр и кнопкой «Переместиться на трек».
let _lightboxList = [];

function _lightboxOnChange(item, index) {
    currentPhotoCoords = item.coords || null;
    const coords = currentPhotoCoords;
    document.getElementById('gallery-coord-text').textContent =
        coords ? `GPS: ${coords[1].toFixed(5)}N, ${coords[0].toFixed(5)}E` : 'No GPS Data';
    document.getElementById('btn-gallery-fly').classList.toggle('hidden', !coords);

    // Панель маршрута листается вместе с просмотром
    if (_lightboxList === _panelPhotos && index !== _panelPhotoIdx) showPanelPhoto(index);
    _lightboxHighlightThumb(_lightboxList === _panelPhotos ? index : -1);
}

function _lightboxHighlightThumb(activeIdx) {
    document.getElementById('gallery-strip').querySelectorAll('.lb-thumb').forEach((el, i) => {
        const on = i === activeIdx;
        el.style.opacity      = on ? '1' : '0.4';
        el.style.outlineColor = on ? 'rgba(255,77,77,.9)' : 'transparent';
        // Прокручиваем только саму ленту: `scrollIntoView` двигал заодно
        // всю страницу по вертикали, и шапка уезжала под статус-бар
        if (on) {
            const strip = document.getElementById('gallery-strip');
            const shift = el.getBoundingClientRect().left - strip.getBoundingClientRect().left;
            strip.scrollTo({ left: strip.scrollLeft + shift - (strip.clientWidth - el.offsetWidth) / 2,
                             behavior: 'smooth' });
        }
    });
}

window.openLightbox = function(src, coords, isVideo) {
    const modal      = document.getElementById('gallery-lightbox');
    const strip      = document.getElementById('gallery-strip');
    const stripWrap  = document.getElementById('gallery-strip-wrap');

    if (!PhotoViewer.stage) {
        PhotoViewer.init(document.getElementById('gallery-stage'), {
            thumb: photoThumb, med: photoMed,
            onChange: _lightboxOnChange,
            onClose: () => closeLightbox(),
            onZoomChange: zoomed => modal.classList.toggle('pv-zoomed', zoomed)
        });
    }

    // Листаем фото маршрута; одиночное фото не из панели — само по себе
    let index = _panelPhotos.findIndex(p => p.src === src);
    _lightboxList = index !== -1 ? _panelPhotos : [{ src, coords, isVideo }];
    if (index === -1) index = 0;

    strip.innerHTML = '';
    if (_lightboxList.length > 1) {
        _lightboxList.forEach((p, i) => {
            const thumb = document.createElement('div');
            thumb.className = 'lb-thumb shrink-0 rounded-lg overflow-hidden cursor-pointer';
            thumb.style.cssText = 'width:56px;height:56px;outline:2px solid transparent;outline-offset:2px;border-radius:8px;transition:opacity .15s,outline-color .15s;';
            thumb.innerHTML = p.isVideo
                ? `<video src="${p.src}#t=0.001" class="w-full h-full object-cover" muted playsinline preload="metadata"></video>`
                : `<img src="${photoThumb(p.src)}" ${_imgFallback(p.src)} class="w-full h-full object-cover" loading="lazy" decoding="async" alt="">`;
            thumb.addEventListener('click', () => PhotoViewer.show(i));
            strip.appendChild(thumb);
        });
        stripWrap.style.display = '';
    } else {
        stripWrap.style.display = 'none';
    }

    modal.classList.remove('opacity-0', 'pointer-events-none', 'pv-zoomed');
    modal.classList.add('opacity-100', 'pointer-events-auto');
    // Сцена получает размеры только когда модалка видна
    requestAnimationFrame(() => PhotoViewer.open(_lightboxList, index));
};

window.closeLightbox = function() {
    const modal = document.getElementById('gallery-lightbox');
    modal.classList.remove('opacity-100', 'pointer-events-auto', 'pv-zoomed');
    modal.classList.add('opacity-0', 'pointer-events-none');
    PhotoViewer.close();
};

document.getElementById('btn-gallery-fly').addEventListener('click', () => {
    if (currentPhotoCoords) {
        closeLightbox();
        map.flyTo({ center: currentPhotoCoords, zoom: 16, pitch: 75, bearing: map.getBearing() + 45, speed: 1.5 });
    }
});

// ── Back button ────────────────────────────────────────────────────────────────
document.getElementById('btn-back').addEventListener('click', () => {
    if (!currentViewedRoute) return;

    const _panelGroup = document.getElementById('route-panel-group');
    _panelGroup.classList.remove('sidebar-open', 'panel-collapsed');
    document.getElementById('hero-text').classList.remove('hero-hidden');
    const _heroDescBack = document.getElementById('hero-desc');
    if (_heroDescBack) _heroDescBack.classList.remove('hero-hidden');

    _removeStartFinishMarkers();
    // ⚠️ Обнуляем **до** перелёта к обзору. Новый перелёт обрывает прежний, и
    // Mapbox тут же, синхронно, шлёт `moveend` — тот самый, по которому ждёт
    // отрисовки маршрут, который только летели показать. Пока маршрут
    // считался открытым, эта отложенная отрисовка успевала положить на карту
    // линию, старт, финиш и MAX уже закрытого маршрута (фидбэк 2026-09-19).
    const _closing = currentViewedRoute;
    currentViewedRoute = null;
    if (window.MapTiers) MapTiers.refresh();   // карта возвращается в полную силу
    _selectedRouteId = null;
    _reviewsRouteId  = null;
    history.replaceState(null, '', location.pathname + location.search);
    _switchPanelTab('info');
    _applyMarkerFilter(); // restore pulsing dot

    if (map.getLayer('photo-markers-glow')) {
        map.setFilter('photo-markers-glow', ['==', 'routeId', 'none']);
        map.setFilter('photo-markers-hitbox', ['==', 'routeId', 'none']);
    }
    if (map.getSource('photo-active-source')) {
        map.getSource('photo-active-source').setData({ type: 'FeatureCollection', features: [] });
    }
    // Камеру (вращение/облёт) останавливаем **до** перелёта к обзору: иначе
    // её последний кадр успевал вернуть карте отступ под карточку
    RouteProfile.hide();
    removeRouteLine(_closing.id);
    // «Нарисовать» закрывает маршрут этой же кнопкой, но рисовать собираются
    // там, куда смотрят, — облёт к обзору всей Сербии пропускаем
    if (!(window.RouteBuilder && RouteBuilder.active)) {
        map.flyTo({
            center: [20.9029, 44.2107], zoom: 6.5, pitch: 0, bearing: 0, speed: 1.2,
            padding: { top: 0, bottom: 0, left: 0, right: 0 }
        });
    }

    const carousel = document.getElementById('route-carousel-outer');
    if (carousel) carousel.style.display = '';
    document.body.classList.remove('route-open');

    RouteProfile.hide();
    document.getElementById('panel-elevation-wrapper').classList.add('hidden');
    document.getElementById('panel-time-planner-wrapper').classList.add('hidden');
    if (window.RouteWeather) RouteWeather.hide();
});

// ── Filter ────────────────────────────────────────────────────────────────────
/** Список в мобильном меню — по тому же фильтру, что и метки на карте */
function _applyMenuFilter() {
    const show = (id, on) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !on);
    };
    // «Мои» и «Пройденные» списка каталога не касаются: личные маршруты живут
    // отдельным блоком (его показывает account.js). «Планы» оставляют от
    // каталога только анонсы, остальные вкладки показывают всё авторское
    const rest = _activeFilterType !== 'planned';
    ['mobile', 'desktop'].forEach(p => {
        show(`${p}-tours-planned`, true);
        show(`${p}-tours-done`, rest);
        show(`${p}-tours-idle`, rest);
    });
}

/**
 * Свернуть карточку открытого маршрута.
 *
 * Нужна тем, кто показывает что-то своё на карте поверх открытого маршрута
 * (точку сбора похода, например): карточка занимает треть экрана, и её
 * содержимое к этому моменту уже не при чём.
 */
window.collapseRoutePanel = function() {
    const g = document.getElementById('route-panel-group');
    if (g && g.classList.contains('sidebar-open')) g.classList.add('panel-collapsed');
};

/** Активная вкладка каталога — нужна тем, кто её переприменяет. */
window.activeFilter = function() { return _activeFilterType; };

window.setFilter = function(type) {
    _activeFilterType = type;
    _applyMenuFilter();
    ['all', 'author', 'planned', 'mine', 'done'].forEach(t => {
        [document.getElementById(`filter-${t}`), document.getElementById(`filter-${t}-mob`)].forEach(el => {
            if (el) el.classList.toggle('active', t === type);
        });
    });
    _applyMarkerFilter();
    // В «Мои» и «Пройденные» вместо карусели каталога — своя лента (account.js)
    document.body.classList.toggle('filter-strip', type === 'mine' || type === 'done');
    if (window.MyRoutes) MyRoutes.onFilterChange(type);

    let visible = 0;
    document.querySelectorAll('.carousel-card').forEach(card => {
        const route = routes[card.dataset.routeId];
        if (!route) return;
        const show = type === 'all' || type === 'author' ||
                     (type === 'planned' && route.status === 'planned');
        card.style.display = show ? '' : 'none';
        if (show) visible++;
    });
    _applyCatalogEmpty(type, visible);
    _carouselHW = 0; // invalidate cached scrollWidth after card visibility changes
};

/**
 * Пустая вкладка обязана объяснять себя.
 *
 * ⚠️ «Планы» пусты, пока не назначен ни один анонс, — и это нормальное
 * состояние, а не поломка. Но выглядит оно ровно как «маршруты пропали»:
 * девять бывших «планов» переехали в запас, и человек, открыв привычную
 * вкладку, увидел пустоту (фидбэк 2026-09-21).
 */
function _applyCatalogEmpty(type, visible) {
    const box = document.getElementById('catalog-empty');
    if (!box) return;
    const admin = window.RouteStatus && RouteStatus.isAdmin && RouteStatus.isAdmin();
    let text = '';
    if (!visible && type === 'planned') {
        text = admin
            ? 'Анонсов пока нет. Откройте маршрут, поставьте авторский статус «Скоро идём» — он появится здесь и выделится на карте.'
            : 'Анонсов пока нет. Пройденные и отложенные маршруты — во вкладке «Авторские».';
    } else if (!visible && type === 'author') {
        text = 'Маршруты каталога ещё загружаются…';
    }
    box.textContent = text;
    box.classList.toggle('hidden', !text);
}

// ── GPX helpers ───────────────────────────────────────────────────────────────
function haversineDistance(c1, c2) {
    const R = 6371, toR = x => x * Math.PI / 180;
    const dLat = toR(c2[1] - c1[1]), dLon = toR(c2[0] - c1[0]);
    const a = Math.sin(dLat/2)**2 + Math.cos(toR(c1[1]))*Math.cos(toR(c2[1]))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function _rdpDist(pt, a, b) {
    const dx = b[0]-a[0], dy = b[1]-a[1];
    if (!dx && !dy) return Math.hypot(pt[0]-a[0], pt[1]-a[1]);
    const t = ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / (dx*dx+dy*dy);
    return Math.hypot(pt[0]-a[0]-t*dx, pt[1]-a[1]-t*dy);
}

function simplifyRDP(pts, tol) {
    if (pts.length <= 2) return pts;
    let max = 0, idx = 0;
    const last = pts.length - 1;
    for (let i = 1; i < last; i++) {
        const d = _rdpDist(pts[i], pts[0], pts[last]);
        if (d > max) { max = d; idx = i; }
    }
    if (max > tol) {
        const L = simplifyRDP(pts.slice(0, idx+1), tol);
        const R = simplifyRDP(pts.slice(idx), tol);
        return [...L.slice(0,-1), ...R];
    }
    return [pts[0], pts[last]];
}

function parseGPX(gpxString) {
    const xml = new DOMParser().parseFromString(gpxString, 'text/xml');
    const trkpts = xml.getElementsByTagName('trkpt');

    const raw = [];
    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        const eleNodes = pt.getElementsByTagName('ele');
        const hasEle   = eleNodes.length > 0;
        const ele      = hasEle ? parseFloat(eleNodes[0].textContent) : null;
        let time = null;
        const timeNodes = pt.getElementsByTagName('time');
        if (timeNodes.length) time = new Date(timeNodes[0].textContent);
        raw.push({ lon, lat, ele, hasEle, time });
    }
    if (!raw.length) return null;

    // ── Interpolate missing elevation points (trkpt without <ele> tag) ────────
    for (let i = 0; i < raw.length; i++) {
        if (raw[i].hasEle) continue;
        let prev = -1, next = -1;
        for (let j = i - 1; j >= 0; j--)            { if (raw[j].hasEle) { prev = j; break; } }
        for (let j = i + 1; j < raw.length; j++)    { if (raw[j].hasEle) { next = j; break; } }
        if (prev >= 0 && next >= 0) {
            const r = (i - prev) / (next - prev);
            raw[i].ele = raw[prev].ele + r * (raw[next].ele - raw[prev].ele);
        } else if (prev >= 0) { raw[i].ele = raw[prev].ele; }
          else if (next >= 0) { raw[i].ele = raw[next].ele; }
          else                { raw[i].ele = 0; }
        raw[i].hasEle = true;
    }

    // ── Multi-pass spike filter — covers ALL points including boundaries
    // For each point, averages up to 2 available neighbors on each side.
    for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < raw.length; i++) {
            const neighbors = [];
            for (let d = 1; d <= 2; d++) {
                if (i - d >= 0)             neighbors.push(raw[i - d].ele);
                if (i + d < raw.length)     neighbors.push(raw[i + d].ele);
            }
            if (!neighbors.length) continue;
            const ref = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
            if (Math.abs(raw[i].ele - ref) > 80) raw[i].ele = ref;
        }
    }

    // Smooth elevations (15-pt moving average)
    const W = 15, half = Math.floor(W/2);
    for (let i = 0; i < raw.length; i++) {
        let sum = 0, count = 0;
        for (let j = Math.max(0,i-half); j <= Math.min(raw.length-1,i+half); j++) { sum += raw[j].ele; count++; }
        raw[i].smoothedEle = sum / count;
    }

    // Build coordinates + stats
    const coordinates = [];
    let totalDist = 0, totalAscent = 0, totalDescent = 0;
    let minEle = Infinity, maxEle = -Infinity;
    let peakCoords = [raw[0].lon, raw[0].lat];
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    let startTime = raw[0].time, endTime = raw[0].time;

    // Пройденные километры в каждой точке полной геометрии: по ним считается
    // ось X графика и километр под пальцем
    const cumulativeKm = [];

    for (let i = 0; i < raw.length; i++) {
        const pt = raw[i];
        coordinates.push([pt.lon, pt.lat]);
        if (pt.lon < minLon) minLon = pt.lon; if (pt.lon > maxLon) maxLon = pt.lon;
        if (pt.lat < minLat) minLat = pt.lat; if (pt.lat > maxLat) maxLat = pt.lat;
        if (pt.smoothedEle < minEle) minEle = pt.smoothedEle;
        if (pt.smoothedEle > maxEle) { maxEle = pt.smoothedEle; peakCoords = [pt.lon, pt.lat]; }
        if (pt.time) endTime = pt.time;
        if (i > 0) {
            totalDist += haversineDistance([raw[i-1].lon, raw[i-1].lat], [pt.lon, pt.lat]);
            const d = pt.smoothedEle - raw[i-1].smoothedEle;
            if (d > 0.3) totalAscent += d;
            else if (d < -0.3) totalDescent += Math.abs(d);
        }
        cumulativeKm.push(totalDist);
    }

    // Elevation profile (≤150 samples for chart) — остаётся ради старых
    // записей в routes_geom.json; сам график рисуется по `profile` ниже
    const step = Math.max(1, Math.floor(raw.length / 150));
    const elevationProfile = [];
    for (let i = 0; i < raw.length; i += step) elevationProfile.push(Math.round(raw[i].smoothedEle));

    // ── Профиль высот и раскраска по уклону ───────────────────────────────────
    //
    // Профиль прореживается до 200 точек (столько же, сколько в приложении:
    // график перерисовывается на каждом кадре ведения пальцем, тысячи точек он
    // не тянет), НО километры и уклон в этих точках считаются по **полной**
    // геометрии.
    //
    // ⚠️ И то, и другое — по полной. Дистанция по самой прореженной ломаной
    // сходится только в сумме: ломаная срезает повороты неравномерно, и на
    // серпантинах «10 км» на графике оказывались 10.9 км на самом деле.
    // А уклон на прореженных точках (шаг ~90 м) не успевает сгладиться окном
    // в 60 м, и график с картой расходятся по цвету.
    //
    // ⚠️ Последняя точка — обязательно финиш маршрута: при шаге `count / 200`
    // последней оказывалась `199·step`, график обрывался чуть раньше финиша, а
    // правый край оси X выходил короче полной дистанции из шапки карточки.
    const smoothedEle = raw.map(pt => pt.smoothedEle);
    const PROFILE_POINTS = 200;
    let sampleIdx;
    if (raw.length > PROFILE_POINTS) {
        const s = (raw.length - 1) / (PROFILE_POINTS - 1);
        sampleIdx = Array.from({ length: PROFILE_POINTS }, (_, i) => Math.round(i * s));
        sampleIdx[PROFILE_POINTS - 1] = raw.length - 1;
    } else {
        sampleIdx = Array.from({ length: raw.length }, (_, i) => i);
    }
    const profile = {
        km:  sampleIdx.map(i => cumulativeKm[i]),
        ele: sampleIdx.map(i => smoothedEle[i]),
        lon: sampleIdx.map(i => raw[i].lon),
        lat: sampleIdx.map(i => raw[i].lat)
    };
    profile.grade = (typeof GradeColor !== 'undefined')
        ? GradeColor.gradesAtDistances(coordinates, smoothedEle, profile.km)
        : [];
    // Узлы раскраски по уклону — те же, что лягут на линию маршрута на карте
    const gradeStops = (typeof GradeColor !== 'undefined')
        ? GradeColor.gradeStops(coordinates, smoothedEle)
        : [];

    // Time estimate
    let estimatedTimeStr = '—';
    if (startTime && endTime && startTime.getTime() !== endTime.getTime()) {
        const mins = (endTime - startTime) / 60000;
        estimatedTimeStr = `${Math.floor(mins/60)}h ${Math.round(mins%60)}m`;
    } else {
        const h = totalDist/5 + totalAscent/600;
        estimatedTimeStr = `~ ${Math.floor(h)}h ${Math.round((h%1)*60)}m`;
    }

    const simplified = simplifyRDP(coordinates, 0.00012);

    // Километры вершин упрощённой линии, посчитанные по **полной** геометрии.
    //
    // ⚠️ Без этого облёт и график расходятся. Камера идёт по той же ломаной,
    // что нарисована на карте, а она срезает повороты и короче настоящего
    // маршрута на 5–8 % (до 1.8 км на дневном переходе). Пройденные камерой
    // метры — это метры ломаной, и если разметить ими график, посчитанный по
    // полной геометрии, бегунок на нём отстаёт от метки на тропе. RDP
    // оставляет подмножество исходных точек, поэтому соответствие точное:
    // идём по обеим ломаным одним курсором.
    const coordKm = [];
    {
        let cursor = 0;
        for (const pt of simplified) {
            while (cursor < coordinates.length - 1 &&
                   (coordinates[cursor][0] !== pt[0] || coordinates[cursor][1] !== pt[1])) cursor++;
            coordKm.push(cumulativeKm[cursor]);
        }
    }

    return {
        coordinates: simplified,
        peakCoords,
        center: [(minLon+maxLon)/2, (minLat+maxLat)/2],
        bounds: [[minLon, minLat], [maxLon, maxLat]],
        distance: Number(totalDist.toFixed(2)),
        ascent: Math.round(totalAscent),
        descent: Math.round(totalDescent),
        minEle: minEle === Infinity ? 0 : Math.round(minEle),
        maxEle: maxEle === -Infinity ? 0 : Math.round(maxEle),
        formattedTime: estimatedTimeStr,
        elevationProfile,
        profile,
        gradeStops,
        coordKm
    };
}

// ── Предпосчитанный индекс маршрутов ──────────────────────────────────────────
// routes_geom.json (собирается `node tools/build_route_index.js`) содержит уже
// упрощённую геометрию, статистику и GPS фотографий. Без него страница тянула
// на старте все GPX (~11 МБ) и разбирала их в главном потоке.
let _geomIndex = null;
let _geomIndexPromise = null;
function loadGeomIndex() {
    if (!_geomIndexPromise) {
        _geomIndexPromise = fetch('routes_geom.json')
            .then(r => r.ok ? r.json() : null)
            .then(j => (_geomIndex = (j && j.routes) ? j : null))
            .catch(() => null);
    }
    return _geomIndexPromise;
}

// Источники обновляем одним пакетом, а не по разу на каждый маршрут
let _sourcesFlushQueued = false;
function _flushRouteSources() {
    if (_sourcesFlushQueued) return;
    _sourcesFlushQueued = true;
    const flush = () => {
        const markers  = map.getSource('route-markers');
        const overview = map.getSource('overview-lines');
        if (!markers || !overview) { setTimeout(flush, 50); return; }
        markers.setData({ type: 'FeatureCollection', features: routeFeatures });
        overview.setData({ type: 'FeatureCollection', features: _overviewFeatures });
        _sourcesFlushQueued = false;
    };
    requestAnimationFrame(flush);
}

function _decodeGradeStops(stops) {
    if (!stops || !stops.length) return [];
    if (Array.isArray(stops[0])) {
        return stops.map(s => ({ position: s[0], rgb: [s[1], s[2], s[3]] }));
    }
    return stops;
}

// ── Load route data ────────────────────────────────────────────────────────────
async function loadRouteData(routeInfo) {
    try {
        let routeData;
        const pre = _geomIndex && _geomIndex.routes[routeInfo.id];
        if (pre && pre.file === routeInfo.file) {
            routeData = Object.assign({}, pre);
        } else {
            // Маршрут добавили, а индекс не пересобрали — разбираем GPX как раньше
            console.warn(`[routes_geom] ${routeInfo.id} нет в индексе, читаю ${routeInfo.file}. ` +
                         `Пересобери: node tools/build_route_index.js`);
            const res = await fetch(routeInfo.file);
            if (!res.ok) throw new Error(`Failed to load ${routeInfo.file}`);
            routeData = parseGPX(await res.text());
        }

        // В индексе узлы раскраски лежат плоскими массивами [доля, r, g, b] —
        // так он втрое компактнее; разбор GPX в браузере отдаёт их объектами
        routeData.gradeStops = _decodeGradeStops(routeData.gradeStops);

        routeData.photoGeoms = [];
        routeData._exifDone = false;
        parsedRouteDataCache[routeInfo.id] = routeData;

        window.recomputeAuthorKm();

        routeFeatures.push({
            type: 'Feature',
            properties: _routeProps(routeInfo),
            geometry: { type: 'Point', coordinates: routeData.peakCoords }
        });
        _overviewFeatures.push({
            type: 'Feature',
            properties: _routeProps(routeInfo),
            geometry: { type: 'LineString', coordinates: routeData.coordinates }
        });
        _flushRouteSources();
    } catch(err) {
        console.error('Error loading GPX:', err);
    }
}

/**
 * Свой маршрут из облака (account.js) — в ту же модель, что и каталог:
 * `routes`, кэш геометрии, метка и линия обзора. Повторный вызов с тем же
 * id заменяет маршрут (переименовали, пришла свежая версия из приложения).
 */
window.registerUserRoute = function(routeInfo, routeData) {
    window.unregisterUserRoute(routeInfo.id, true);
    routes[routeInfo.id] = routeInfo;
    // ⚠️ Объект маршрута здесь **заменяется** новым. Открытая карточка держит
    // ссылку на прежний, и без этой строки после смены статуса она читала бы
    // старые `status` и `color` — значок над названием оставался бы прежним
    if (currentViewedRoute && currentViewedRoute.id === routeInfo.id) currentViewedRoute = routeInfo;
    parsedRouteDataCache[routeInfo.id] = routeData;
    // Без высот вершины нет — метка в середине трека, как в приложении
    const c = routeData.coordinates;
    routeFeatures.push({ type: 'Feature', properties: _routeProps(routeInfo),
                         geometry: { type: 'Point', coordinates: routeData.peakCoords || c[Math.floor(c.length / 2)] } });
    _overviewFeatures.push({ type: 'Feature', properties: _routeProps(routeInfo),
                             geometry: { type: 'LineString', coordinates: routeData.coordinates } });
    _flushRouteSources();
};

window.unregisterUserRoute = function(id, keepOpen) {
    if (!routes[id]) return;
    if (!keepOpen && currentViewedRoute && currentViewedRoute.id === id) {
        document.getElementById('btn-back').click();
    }
    delete routes[id];
    delete parsedRouteDataCache[id];
    const drop = arr => { const i = arr.findIndex(f => f.properties.id === id); if (i >= 0) arr.splice(i, 1); };
    drop(routeFeatures);
    drop(_overviewFeatures);
    _flushRouteSources();
};

function _removeStartFinishMarkers() {
    RouteMarks.clear();
    if (_drawInterval)  { clearInterval(_drawInterval);           _drawInterval  = null; }
    if (_dashAnimFrame) { cancelAnimationFrame(_dashAnimFrame);   _dashAnimFrame = null; }
}

/**
 * Линия открытого маршрута: обводка снизу, цветное ядро сверху.
 *
 * `gradeStops` — узлы раскраски по уклону (см. grade_color.js). Те же, что
 * красят график высот: пока у карты и графика были свои расчёты, один и тот же
 * участок выходил на карте ровным подъёмом, а на графике чересполосицей.
 * Нет узлов (высот в треке не было) — линия остаётся сплошной, цвета типа
 * маршрута.
 */
function addRouteToMap(id, coordinates, color, gradeStops, coordKm) {
    if (_drawInterval)  { clearInterval(_drawInterval);  _drawInterval  = null; }
    if (_dashAnimFrame) { cancelAnimationFrame(_dashAnimFrame); _dashAnimFrame = null; }

    const casingId = `layer-${id}-casing`;
    const haloId   = `layer-${id}-halo`;
    const line = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
    // Узлы заданы долями полной геометрии, а линия упрощена — переводим в
    // её `line-progress` (см. GradeColor.progressMapper)
    const toLine = GradeColor.progressMapper(coordinates, coordKm);
    const stops = (gradeStops && gradeStops.length > 1)
        ? gradeStops.map(s => ({ position: toLine(s.position), rgb: s.rgb }))
        : null;
    const gradient = stops ? GradeColor.mapGradient(stops, 1) : null;
    // Под подписями стиля, в одной пачке с рельефом (см. drapeBeforeId);
    // метки старта/финиша/вершины — символьный слой, они и так выше
    const beforeId = drapeBeforeId();

    // На карте живёт линия ровно одного маршрута — показываемого
    Object.keys(routes).forEach(other => { if (other !== id) removeRouteLine(other); });

    // ⚠️ Линия кладётся на карту **целиком и сразу с раскраской**, а
    // «прорисовка» от старта к финишу — это `line-trim-offset`, который
    // прячет ещё не нарисованный хвост.
    //
    // Раньше линия нарастала через `setData` с кусками координат, а градиент
    // вешался только в конце: `line-progress` считается от нарисованной части,
    // и растягивать раскраску на огрызок пришлось бы на каждом кадре. В итоге
    // маршрут пять секунд рисовался сплошным цветом типа (красным) и только
    // потом перекрашивался по уклонам (фидбэк 2026-09-19). Обрезка — это
    // одно число в шейдере: ни пересборки геометрии, ни перезаливки буфера.
    const hidden = [0, 1];
    if (!map.getSource(id)) {
        // lineMetrics нужны и раскраске по уклону, и обрезке, и подсветке
        // выделенного на графике участка: все они считаются по `line-progress`
        map.addSource(id, { type: 'geojson', data: line, lineMetrics: true });
        // Первый ярус: ореол → обводка → ядро (`map_tiers.js`). Ореол белый и
        // широкий, но слабый — им открытый маршрут и отличается от контекста.
        // ⚠️ Белым был весь трек, и это оказалось перебором: линия теряла
        // смысл, который несла цветом сложности (фидбэк 2026-08-31).
        map.addLayer({
            id: haloId, type: 'line', source: id,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#FFFFFF', 'line-width': 11, 'line-opacity': 0.22,
                     'line-blur': 4, 'line-trim-offset': hidden }
        }, beforeId);
        map.addLayer({
            id: casingId, type: 'line', source: id,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#0A0A0A', 'line-width': 7.6, 'line-opacity': 0.8,
                     'line-trim-offset': hidden }
        }, beforeId);
        const paint = { 'line-color': color, 'line-width': 4.2, 'line-trim-offset': hidden };
        if (gradient) paint['line-gradient'] = gradient;
        map.addLayer({
            id: `layer-${id}`, type: 'line', source: id,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint
        }, beforeId);
    } else {
        map.getSource(id).setData(line);
        map.setPaintProperty(`layer-${id}`, 'line-gradient', gradient);
        map.setPaintProperty(`layer-${id}`, 'line-trim-offset', hidden);
        [casingId, haloId].forEach(l => {
            if (map.getLayer(l)) map.setPaintProperty(l, 'line-trim-offset', hidden);
        });
    }

    RouteMarks.setEnds(coordinates);

    const DRAW_MS = 4000;
    const t0 = performance.now();
    const step = now => {
        _dashAnimFrame = null;
        if (!map.getLayer(`layer-${id}`)) return;
        // Время кадра rAF бывает раньше t0 (это начало кадра, а t0 взят позже):
        // отрицательная доля — ошибка валидации line-trim-offset
        const p = Math.min(Math.max((now - t0) / DRAW_MS, 0), 1);
        const eased = 1 - Math.pow(1 - p, 3);
        // Прячем участок [нарисовано, 1]; когда нарисовано всё — не прячем ничего
        const trim = p >= 1 ? [0, 0] : [eased, 1];
        map.setPaintProperty(`layer-${id}`, 'line-trim-offset', trim);
        [casingId, haloId].forEach(l => {
            if (map.getLayer(l)) map.setPaintProperty(l, 'line-trim-offset', trim);
        });
        if (p < 1) _dashAnimFrame = requestAnimationFrame(step);
    };
    _dashAnimFrame = requestAnimationFrame(step);
}

/**
 * Убрать линию маршрута со стиля вместе с её источником.
 *
 * ⚠️ Раньше закрытый маршрут просто получал `line-opacity: 0`, и его слои
 * оставались в стиле навсегда. Прозрачный слой карта всё равно рисует на
 * каждом кадре: открыв десяток маршрутов, вы получали два десятка линий с
 * метриками и градиентами в каждом кадре. На спутнике с рельефом это в итоге
 * и укладывало видеокарту (фидбэк 2026-09-18).
 */
function removeRouteLine(id) {
    if (!id || !map.getStyle) return;
    // Подсветка выделенного участка живёт на том же источнике — без неё
    // источник удалить нельзя
    if (window.RouteProfile) RouteProfile.clearSelection();
    [`layer-${id}`, `layer-${id}-casing`, `layer-${id}-halo`].forEach(layer => {
        if (map.getLayer(layer)) map.removeLayer(layer);
    });
    if (map.getSource(id)) map.removeSource(id);
}

/**
 * Спрятать метки фотографий на время облёта — они густо сидят на тропе и
 * закрывают собой вид. Возвращаются сами, как только камеру отпустили.
 *
 * Бейджи старта, финиша и вершины **не** прячем: по ним в полёте и видно,
 * где начало, где верх и сколько ещё до финиша (фидбэк 2026-09-19).
 */
window.setRouteDecorationsHidden = function(hidden) {
    ['photo-markers-glow', 'photo-markers-layer', 'photo-active-glow', 'photo-active-layer'].forEach(layer => {
        if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', hidden ? 'none' : 'visible');
    });
};

// ── DOMContentLoaded ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const desktopList  = document.getElementById('desktop-tours-dropdown');
    const mobileList   = document.getElementById('mobile-tours-list');
    const marqueeTrack = document.getElementById('marquee-track');
    const marqueeOuter = document.getElementById('route-carousel-outer');
    const carouselCards = [];

    // ⚠️ Пересчитывается, а не считается один раз: статус авторского маршрута
    // правит админ через `catalog_status`, и переопределения приезжают из базы
    // уже после того, как каталог отрисован (route_status.js)
    const authorRoutes = st => Object.values(routes).filter(r => !r.mine && !r.shared && r.status === st);
    const splitRoutes = () => ({
        planned: authorRoutes('planned'),   // анонсы — всегда первыми
        done:    authorRoutes('done'),
        idle:    authorRoutes('idle')
    });

    // Геометрия берётся из routes_geom.json; GPX читается только если маршрута
    // в индексе нет (тогда — пачками, чтобы не забить сеть)
    (async () => {
        await loadGeomIndex();
        const all = Object.values(routes);
        for (let i = 0; i < all.length; i += 6) await Promise.all(all.slice(i, i+6).map(loadRouteData));

        const hashId = location.hash.slice(1);
        if (hashId && routes[hashId]) {
            const doSelect = () => triggerRouteSelection(hashId);
            if (map.isStyleLoaded()) doSelect();
            else map.once('load', doSelect);
        }
    })();

    // React to hash changes while the page is open (e.g. sharing a link or browser back/forward)
    window.addEventListener('hashchange', () => {
        const hashId = location.hash.slice(1);
        if (hashId && routes[hashId] && parsedRouteDataCache[hashId]) {
            triggerRouteSelection(hashId);
        }
    });

    // ── Menu helpers
    // Значок в списке — тот же язык, что на карте: цвет по статусу, а флажок
    // остался только у анонса («скоро идём»)
    const MENU_ICON = {
        planned: 'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6H11.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9',
        done:    'M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z',
        idle:    'M5 8h14M5 12h14M5 16h9'
    };
    function menuBtn(route, isMobile) {
        const st = route.status || 'done';
        const color = STATUS_COLOR[st] || STATUS_COLOR.done;
        const extra = st === 'done'
            ? `<path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>` : '';
        const icon = `<svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="${color}" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${MENU_ICON[st] || MENU_ICON.done}"/>${extra}</svg>`;
        const onclick = isMobile
            ? `document.getElementById('mobile-info').classList.add('hidden');flyToRoute('${route.id}')`
            : `flyToRoute('${route.id}')`;
        const cls = isMobile
            ? 'flex items-center text-zinc-300 hover:text-white normal-case tracking-normal transition-colors text-left w-full gap-3'
            : 'flex items-center px-5 py-3 hover:bg-white/10 transition-colors text-left w-full text-zinc-300 hover:text-white normal-case tracking-normal border-b border-white/5 last:border-0 outline-none gap-3';
        return `<button onclick="${onclick}" class="${cls}">${icon}<span class="truncate">${route.name}</span></button>`;
    }
    function sectionHeader(label, isMobile) {
        return isMobile
            ? `<div class="text-[9px] text-zinc-500 mt-4 mb-2 tracking-widest uppercase border-b border-white/10 pb-1">${label}</div>`
            : `<div class="px-5 py-1.5 text-[9px] text-zinc-500 uppercase tracking-widest">${label}</div>`;
    }

    /**
     * Списки в меню — тремя разделами, и «Скоро идём» **первым**: на этот
     * маршрут собирается группа, и он не должен искаться в общем списке.
     * Собирается функцией: статус правит админ, и переопределения приезжают
     * уже после первой отрисовки (см. splitRoutes).
     */
    window.refreshCatalogMenus = function() {
        const g = splitRoutes();
        const empty = isMobile => isMobile
            ? '<div class="text-[11px] text-zinc-500 normal-case tracking-normal pl-1 pb-1">Анонса пока нет</div>'
            : '<div class="px-5 pb-2 text-[11px] text-zinc-500 normal-case tracking-normal">Анонса пока нет</div>';
        const section = (id, label, list, isMobile) =>
            `<div id="${id}">${sectionHeader(label, isMobile)}` +
            (list.length ? list.map(r => menuBtn(r, isMobile)).join('') : empty(isMobile)) + `</div>`;
        if (desktopList) {
            desktopList.innerHTML =
                section('desktop-tours-planned', 'Скоро идём', g.planned, false) +
                section('desktop-tours-done',    'Авторские',  g.done,    false) +
                section('desktop-tours-idle',    'В запасе',   g.idle,    false);
        }
        if (mobileList) {
            mobileList.innerHTML =
                section('mobile-tours-planned', 'Скоро идём', g.planned, true) +
                section('mobile-tours-done',    'Авторские',  g.done,    true) +
                section('mobile-tours-idle',    'В запасе',   g.idle,    true);
        }
        _applyMenuFilter();
    };
    window.refreshCatalogMenus();

    // ── Carousel
    if (marqueeTrack) {
        // Анонсы — в начале ленты: карусель листают слева направо
        const g0 = splitRoutes();
        [...g0.planned, ...g0.done, ...g0.idle].forEach(route => {
            const cover = route.photos && route.photos.length > 0
                ? route.photos[Math.floor(Math.random() * route.photos.length)] : null;
            const card = document.createElement('div');
            card.className = 'carousel-card relative shrink-0 rounded-2xl overflow-hidden cursor-pointer border border-white/10 shadow-xl';
            card.style.cssText = 'width:176px;height:116px;';
            card.dataset.routeId = route.id;
            if (cover) {
                // Карточка 176×116 — оригинал на 2-3 МБ здесь ни к чему, берём копию 400 px
                const setBg = url => {
                    card.style.backgroundImage = `url('${url}')`;
                    card.style.backgroundSize = 'cover';
                    card.style.backgroundPosition = 'center';
                };
                const small = photoThumb(cover);
                setBg(small);
                if (small !== cover) {
                    const probe = new Image();
                    probe.onerror = () => setBg(cover);
                    probe.src = small;
                }
            }
            else {
                const bg = { planned: 'linear-gradient(140deg,#1a1500,#2d2000,#1a1000)',
                             idle:    'linear-gradient(140deg,#17142a,#241a3a,#111122)',
                             done:    'linear-gradient(140deg,#1c1c2e,#2a1a3e,#111122)' };
                card.style.background = bg[route.status] || bg.done;
            }

            // Метка статуса на карточке: у анонса «скоро», у запаса — тише
            const BADGE = { planned: 'Скоро', idle: 'В запасе' };
            const bLabel = BADGE[route.status];
            const bColor = STATUS_COLOR[route.status] || STATUS_COLOR.done;
            const statusBadge = bLabel
                ? `<div class="cc-badge${route.status === 'planned' ? ' cc-badge-live' : ''}" style="--cc:${bColor}">${bLabel}</div>` : '';
            const tc = STATUS_COLOR[route.status] || STATUS_COLOR.done;
            card.innerHTML = `<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.88),rgba(0,0,0,.2) 55%,transparent)"></div>${statusBadge}<div style="position:absolute;bottom:0;left:0;right:0;padding:10px 12px;"><div style="color:#fff;font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 4px rgba(0,0,0,.8)">${route.name}</div><div style="display:flex;align-items:center;gap:4px;margin-top:4px;"><svg style="width:10px;height:10px;flex-shrink:0" fill="none" stroke="${tc}" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span style="color:#e4e4e7;font-size:10px;font-weight:500;">${route.overrideTime || '—'}</span></div></div>`;

            carouselCards.push(card);
            marqueeTrack.appendChild(card);
        });

        // Duplicate for seamless loop
        carouselCards.forEach(c => marqueeTrack.appendChild(c.cloneNode(true)));

        // Click delegation
        let didDrag = false;
        marqueeTrack.addEventListener('click', (e) => {
            if (didDrag) { didDrag = false; return; }
            const card = e.target.closest('.carousel-card');
            if (card && card.dataset.routeId) flyToRoute(card.dataset.routeId);
        });

        // Wheel + drag scroll
        let manualOffset = 0, inManual = false;
        const getHW = () => { if (!_carouselHW) _carouselHW = marqueeTrack.scrollWidth / 2; return _carouselHW; };
        window.addEventListener('resize', () => { _carouselHW = 0; }, { passive: true });

        function enterManual() {
            if (inManual) return;
            manualOffset = new DOMMatrix(getComputedStyle(marqueeTrack).transform).m41;
            marqueeTrack.style.animation = 'none'; inManual = true;
        }
        function applyOffset() {
            const hw = getHW();
            while (manualOffset < -hw) manualOffset += hw;
            while (manualOffset > 0) manualOffset -= hw;
            marqueeTrack.style.transform = `translateX(${manualOffset}px)`;
        }

        if (marqueeOuter) {
            marqueeOuter.addEventListener('wheel', (e) => {
                e.preventDefault(); enterManual();
                manualOffset -= (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.9;
                applyOffset();
            }, { passive: false });
        }

        let dragStartX = 0, dragBase = 0, isDragging = false;
        marqueeTrack.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; e.preventDefault();
            isDragging = true; didDrag = false; enterManual();
            dragStartX = e.clientX; dragBase = manualOffset;
            marqueeTrack.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            if (Math.abs(dx) > 4) didDrag = true;
            manualOffset = dragBase + dx;
            // Apply raw offset during drag — no wrapping to prevent mid-drag snap
            marqueeTrack.style.transform = `translateX(${manualOffset}px)`;
        }, { passive: true });
        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            marqueeTrack.style.cursor = '';
            applyOffset(); // normalize offset (wrap) only after drag ends
        });
    }

    // ── Firebase init
    _initFirebase();

    // ── Layers panel (линии маршрутов + хитмап троп)
    {
        const btn     = document.getElementById('btn-layers-toggle');
        const panel   = document.getElementById('layers-panel');
        const linesCb = document.getElementById('layer-lines');
        const heatCb  = document.getElementById('layer-heat');

        document.getElementById('layer-heat-hint').textContent = HEATMAP_SOURCE.hint;

        const syncBtn = () => btn.classList.toggle('lines-active',
            _showLines || _heatmapOn || !!(window.ExtraLayers && ExtraLayers.anyOn()));
        window.syncLayersBtn = syncBtn;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('open');
        });
        panel.addEventListener('click', e => e.stopPropagation());
        document.addEventListener('click', () => panel.classList.remove('open'));

        linesCb.addEventListener('change', () => {
            _showLines = linesCb.checked;
            _applyMarkerFilter(); // applies lines visibility respecting active filter
            document.getElementById('lines-legend').classList.toggle('visible', _showLines);
            syncBtn();
        });

        heatCb.addEventListener('change', () => {
            toggleHeatmap(heatCb.checked);
            syncBtn();
        });
    }

    // ── Panel collapse/expand toggle
    document.getElementById('panel-toggle-btn').addEventListener('click', () => {
        document.getElementById('route-panel-group').classList.toggle('panel-collapsed');
        // Свободная часть карты стала другой — если камера сейчас показывает
        // маршрут, ей надо пересобрать кадр. Саму камеру стрелочка не трогает:
        // свернуть карточку во время вращения — это не «стоп».
        if (window.RouteProfile) RouteProfile.onPanelToggled();
    });

    // ── Свёрнутая панель выглядывает у края экрана ───────────────────────────
    //
    // Свёрнутая карточка оставляла от себя вкладку в двадцать пикселей, и
    // попасть в неё мышью — отдельное упражнение. Теперь достаточно подвести
    // курсор к краю: панель выезжает краем, увели курсор — уезжает обратно,
    // щёлкнули по выехавшему краю — раскрывается целиком.
    //
    // Только мышь: пальцем к краю экрана не «наводят», а на телефоне панель и
    // сворачивается вниз, а не влево.
    (function () {
        const EDGE = 26;        // ближе этого к краю — выглядывает
        const LEAVE = 140;      // дальше этого — прячется (и снова «взводится»)
        let peeking = false;
        let armed = true;       // после сворачивания ждём, пока курсор уйдёт от края

        const group = () => document.getElementById('route-panel-group');
        const fine = () => window.matchMedia &&
            matchMedia('(min-width: 768px) and (pointer: fine)').matches;
        // Во время облёта и вращения карточка свёрнута — как раз тогда
        // выглядывание нужнее всего: иначе вернуть её можно только попав в
        // двадцатипиксельную вкладку (а под облётом её и вовсе не видно на
        // телефоне). Камеру это не останавливает — см. `onPanelToggled`.
        const canPeek = g => g && fine() &&
            g.classList.contains('sidebar-open') && g.classList.contains('panel-collapsed') &&
            !document.body.classList.contains('tw-drawing');

        function setPeek(g, on) {
            if (peeking === on) return;
            peeking = on;
            if (g) g.classList.toggle('panel-peek', on);
        }

        document.addEventListener('mousemove', e => {
            const g = group();
            if (!canPeek(g)) { setPeek(g, false); return; }
            if (e.clientX > LEAVE) { armed = true; setPeek(g, false); }
            else if (e.clientX <= EDGE && armed) setPeek(g, true);
        });

        document.documentElement.addEventListener('mouseleave', () => setPeek(group(), false));

        // Свернули стрелочкой — курсор остаётся ровно на краю, и панель тут же
        // полезла бы обратно. Ждём, пока его уведут.
        document.getElementById('panel-toggle-btn').addEventListener('click', () => { armed = false; });

        // Щелчок по выехавшему краю раскрывает панель
        document.addEventListener('click', e => {
            const g = group();
            if (!peeking || !g || !e.target.closest) return;
            if (!e.target.closest('#route-panel-group')) return;
            if (e.target.closest('#panel-toggle-btn')) return;   // у вкладки своя роль
            setPeek(g, false);
            g.classList.remove('panel-collapsed');
            if (window.RouteProfile) RouteProfile.onPanelToggled();
        }, true);
    })();

    // ── Description expand/collapse
    document.getElementById('panel-desc-toggle').addEventListener('click', () => {
        const body  = document.getElementById('panel-desc-body');
        const fade  = document.getElementById('panel-desc-fade');
        const label = document.getElementById('panel-desc-toggle-label');
        const icon  = document.getElementById('panel-desc-toggle-icon');
        const isCollapsed = body.classList.contains('collapsed');
        body.classList.toggle('collapsed', !isCollapsed);
        body.classList.toggle('expanded',   isCollapsed);
        fade.style.display  = isCollapsed ? 'none' : '';
        label.textContent   = isCollapsed ? 'Свернуть' : 'Развернуть';
        icon.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
    });

    // ── Thumbnail strip horizontal scroll via mouse wheel (desktop)
    const _thumbStrip = document.getElementById('panel-photos-container');
    _thumbStrip.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // already horizontal (trackpad)
        e.preventDefault();
        _thumbStrip.scrollLeft += e.deltaY;
    }, { passive: false });

    // ── Sidebar photo buttons setup
    document.getElementById('panel-photo-prev').addEventListener('click', () => showPanelPhoto(_panelPhotoIdx - 1));
    document.getElementById('panel-photo-next').addEventListener('click', () => showPanelPhoto(_panelPhotoIdx + 1));
    document.getElementById('panel-photo-expand').addEventListener('click', () => {
        if (!_panelPhotos.length) return;
        const p = _panelPhotos[_panelPhotoIdx];
        openLightbox(p.src, p.coords || null, p.isVideo);
    });
    document.getElementById('panel-photo-img').addEventListener('click', () => {
        if (!_panelPhotos.length) return;
        const p = _panelPhotos[_panelPhotoIdx];
        openLightbox(p.src, p.coords || null, p.isVideo);
    });

    // ── Review form open/close
    const _reviewModal = document.getElementById('review-form-modal');

    document.getElementById('btn-open-review-form').addEventListener('click', () => {
        _pickedRating = 0;
        _initStarPicker();
        document.getElementById('review-name-input').value  = '';
        document.getElementById('review-text-input').value  = '';
        document.getElementById('review-form-error').classList.add('hidden');
        _reviewModal.classList.add('open');
    });

    document.getElementById('btn-close-review-form').addEventListener('click', () => {
        _reviewModal.classList.remove('open');
    });

    _reviewModal.addEventListener('click', (e) => {
        if (e.target === _reviewModal) _reviewModal.classList.remove('open');
    });

    // ── Review form submit
    document.getElementById('btn-submit-review').addEventListener('click', async () => {
        const errEl  = document.getElementById('review-form-error');
        const submitBtn = document.getElementById('btn-submit-review');
        const name   = document.getElementById('review-name-input').value.trim();
        const text   = document.getElementById('review-text-input').value.trim();

        errEl.classList.add('hidden');

        if (!name)           { errEl.textContent = 'Введите ваше имя.'; errEl.classList.remove('hidden'); return; }
        if (!_pickedRating)  { errEl.textContent = 'Выберите оценку.';  errEl.classList.remove('hidden'); return; }
        if (!_db)            { errEl.textContent = 'Firebase не настроен.'; errEl.classList.remove('hidden'); return; }
        if (!currentViewedRoute) return;

        // Wait for anonymous auth if not yet ready
        if (!_fbUser) {
            try { const c = await _auth.signInAnonymously(); _fbUser = c.user; } catch(e) {
                errEl.textContent = 'Ошибка авторизации.'; errEl.classList.remove('hidden'); return;
            }
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправка...';

        try {
            await _db.collection('reviews').add({
                routeId:   currentViewedRoute.id,
                userId:    _fbUser.uid,
                name,
                rating:    _pickedRating,
                text,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                avatarColor: _avatarColor(_fbUser.uid)
            });
            _reviewModal.classList.remove('open');
            // Force reload reviews
            _reviewsRouteId = null;
            _loadAndRenderReviews(currentViewedRoute.id);
        } catch(e) {
            errEl.textContent = 'Ошибка отправки. Попробуйте позже.';
            errEl.classList.remove('hidden');
            console.error(e);
        }

        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить отзыв';
    });
});

// ── Expose curated routes for assistant.js (AI route matcher) ──
// `routes` / `parsedRouteDataCache` are top-level `const` (not auto-attached to
// window). Same object references, so the assistant sees GPX stats as they load.
window.routes = routes;
window.parsedRouteDataCache = parsedRouteDataCache;
window.triggerRouteSelection = triggerRouteSelection;
