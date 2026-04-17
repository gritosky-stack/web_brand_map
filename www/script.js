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

function _initFirebase() {
    if (FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') return; // not yet configured
    try {
        if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
        _db   = firebase.firestore();
        _auth = firebase.auth();
        _auth.signInAnonymously().then(c => { _fbUser = c.user; }).catch(() => {});
    } catch(e) { console.warn('Firebase init failed:', e); }
}

// ── Configuration ─────────────────────────────────────────────────────────────
const MAPBOX_TOKEN = 'pk.eyJ1IjoidG9jemtpamciLCJhIjoiY21uYWE1dnY0MGdjMTJwcDYwMW9hN3IzbyJ9.z8vVKr9lNliGDfC5Kd8Ttg';
mapboxgl.accessToken = MAPBOX_TOKEN;

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
    }
];

const routes = {};
routesList.forEach((data, index) => {
    routes[`route_${index}`] = {
        id: `route_${index}`,
        file: data.file,
        name: data.name || data.file.replace('.gpx', ''),
        color: '#ff4d4d',
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
    { file: 'future_trips/Дебело Брдо - Ябланик.gpx' },
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
];
futureRoutesList.forEach((data, index) => {
    const key = `future_${index}`;
    routes[key] = {
        id: key, file: data.file,
        name: data.name || data.file.split('/').pop().replace('.gpx', ''),
        color: '#FF8C00', future: true,
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
let _peakMapMarker = null;     // active peak-summit marker on the map
let _startMarker = null;       // start flag marker
let _finishMarker = null;      // finish flag marker
let _drawInterval   = null;    // interval for progressive line drawing
let _dashAnimFrame  = null;    // animation frame for continuous flow after draw
let _selectedRouteId = null;   // route whose pulsing dot is currently hidden
let _activeFilterType = 'all'; // current Все/Отчёты/Планы filter

// Combined marker filter: applies type filter + always hides the selected route dot
function _applyMarkerFilter() {
    if (!map || !map.getLayer('route-markers-layer')) return;
    let f = null;
    if (_activeFilterType === 'completed') f = ['==', ['get', 'future'], false];
    else if (_activeFilterType === 'planned') f = ['==', ['get', 'future'], true];
    if (_selectedRouteId) {
        const ex = ['!=', ['get', 'id'], _selectedRouteId];
        f = f ? ['all', f, ex] : ex;
    }
    map.setFilter('route-markers-layer', f);
    map.setFilter('route-hitboxes-layer', f);

    // Mirror filter to overview lines (only relevant when lines are visible)
    if (map.getLayer('overview-lines-completed')) {
        const showCompleted = _showLines && _activeFilterType !== 'planned';
        const showPlanned   = _showLines && _activeFilterType !== 'completed';
        map.setLayoutProperty('overview-lines-completed', 'visibility', showCompleted ? 'visible' : 'none');
        map.setLayoutProperty('overview-lines-planned',   'visibility', showPlanned   ? 'visible' : 'none');
    }
}

// ── Total km counter ──────────────────────────────────────────────────────────
let _totalKm = 0;
let _kmAnimFrame = null;

function addToKmCounter(km) {
    const from = _totalKm;
    _totalKm += km;
    const to = _totalKm;
    const ids = [
        { val: 'total-km-value', display: 'total-km-display' },
        { val: 'total-km-value-mobile', display: 'total-km-display-mobile' }
    ];
    ids.forEach(({ display }) => {
        const el = document.getElementById(display);
        if (el) el.style.opacity = '1';
    });
    if (_kmAnimFrame) cancelAnimationFrame(_kmAnimFrame);
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

const pulsingDot = {
    width: size, height: size, data: new Uint8Array(size * size * 4),
    onAdd() {
        const c = document.createElement('canvas');
        c.width = this.width; c.height = this.height;
        this.context = c.getContext('2d', { willReadFrequently: true });
    },
    render() {
        const now = performance.now();
        if (now - (this._lastFrame || 0) >= 80) {
            this._lastFrame = now;
            const t = (now % 2000) / 2000;
            const r = (size / 2) * 0.25;
            const or = (size / 2) * 0.75 * t + r;
            const ctx = this.context;
            ctx.clearRect(0, 0, size, size);
            const g = ctx.createRadialGradient(size/2,size/2,r, size/2,size/2,or);
            g.addColorStop(0, `rgba(255,77,77,${0.7*(1-t)})`);
            g.addColorStop(1, 'rgba(255,77,77,0)');
            ctx.beginPath(); ctx.arc(size/2,size/2,or,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
            ctx.beginPath(); ctx.arc(size/2,size/2,r,0,Math.PI*2);
            ctx.shadowColor='rgba(255,77,77,0.9)'; ctx.shadowBlur=15;
            ctx.fillStyle='#ff4d4d'; ctx.fill(); ctx.shadowBlur=0;
            ctx.strokeStyle='rgba(255,255,255,.95)'; ctx.lineWidth=2.5; ctx.stroke();
            this.data = ctx.getImageData(0,0,size,size).data;
        }
        return true;
    }
};

const futurePulsingDot = {
    width: size, height: size, data: new Uint8Array(size * size * 4),
    onAdd() {
        const c = document.createElement('canvas');
        c.width = this.width; c.height = this.height;
        this.context = c.getContext('2d', { willReadFrequently: true });
    },
    render() {
        const now = performance.now();
        if (now - (this._lastFrame || 0) >= 80) {
            this._lastFrame = now;
            const t = (now % 2400) / 2400;
            const r = (size / 2) * 0.25;
            const or = (size / 2) * 0.75 * t + r;
            const ctx = this.context;
            ctx.clearRect(0, 0, size, size);
            const g = ctx.createRadialGradient(size/2,size/2,r, size/2,size/2,or);
            g.addColorStop(0, `rgba(255,200,0,${0.7*(1-t)})`);
            g.addColorStop(1, 'rgba(255,200,0,0)');
            ctx.beginPath(); ctx.arc(size/2,size/2,or,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
            ctx.beginPath(); ctx.arc(size/2,size/2,r,0,Math.PI*2);
            ctx.shadowColor='rgba(255,180,0,0.9)'; ctx.shadowBlur=15;
            ctx.fillStyle='#FFD700'; ctx.fill(); ctx.shadowBlur=0;
            ctx.strokeStyle='rgba(255,255,255,.95)'; ctx.lineWidth=2.5; ctx.stroke();
            this.data = ctx.getImageData(0,0,size,size).data;
        }
        return true;
    }
};

// ── Map init ───────────────────────────────────────────────────────────────────
let map;
if (MAPBOX_TOKEN !== 'YOUR_MAPBOX_ACCESS_TOKEN') {
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [20.9029, 44.2107],
        zoom: 6.5, pitch: 0,
        interactive: true,
        antialias: false,
        fadeDuration: 0,
        maxBounds: [[17.2, 41.0], [24.4, 47.4]],
        renderWorldCopies: false
    });

    {
        const canvas = map.getCanvas();
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

        map.addImage('pulsing-dot', pulsingDot, { pixelRatio: 1.5 });
        map.addImage('future-pulsing-dot', futurePulsingDot, { pixelRatio: 1.5 });

        // ── Overview lines (toggleable background, added below markers) ──
        // Initialise with whatever routes have already finished loading (race-safe)
        map.addSource('overview-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: _overviewFeatures } });
        map.addLayer({
            id: 'overview-lines-completed', type: 'line', source: 'overview-lines',
            filter: ['==', ['get', 'future'], false],
            layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
            paint: { 'line-color': '#ff4d4d', 'line-width': 3, 'line-opacity': 0.85 }
        });
        map.addLayer({
            id: 'overview-lines-planned', type: 'line', source: 'overview-lines',
            filter: ['==', ['get', 'future'], true],
            layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
            paint: { 'line-color': '#FF8C00', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [2, 2.5] }
        });

        map.addSource('route-markers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        map.addLayer({
            id: 'route-markers-layer', type: 'symbol', source: 'route-markers',
            layout: {
                'icon-image': ['case', ['==', ['get', 'future'], true], 'future-pulsing-dot', 'pulsing-dot'],
                'icon-pitch-alignment': 'map', 'icon-allow-overlap': true
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
                    .setHTML(`<div class="text-xs font-semibold tracking-wide">${routes[id].name}</div>`)
                    .addTo(map);
            }
        });
        map.on('mouseleave', 'route-hitboxes-layer', () => {
            map.getCanvas().style.cursor = ''; hoveredId = null; hoverPopup.remove();
        });
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
        filter: ['all', ['!=', 'iso_3166_1_alpha_3', 'SRB'], ['!=', 'iso_3166_1', 'RS']]
    }, firstLabelId);

    map.getStyle().layers.forEach(layer => {
        if (layer.type === 'line') {
            const id = layer.id.toLowerCase();
            // Hide hiking paths from base style
            if (id.includes('path') || id.includes('trail') || id.includes('track') || id.includes('footway') || id.includes('steps')) {
                map.setLayoutProperty(layer.id, 'visibility', 'none');
            }
            // Hide sub-national admin borders (keep admin-0 = country borders)
            if ((id.includes('admin') || id.includes('boundary')) &&
                !id.includes('admin-0') && !id.includes('admin_0') && !id.includes('disputed')) {
                try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch(e) {}
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

    // Update URL so this route can be shared / bookmarked
    history.replaceState(null, '', '#' + routeId);

    if (window.hoverPopup) window.hoverPopup.remove();

    // Remove previous peak marker and start/finish markers whenever we switch routes
    if (_peakMapMarker) { _peakMapMarker.remove(); _peakMapMarker = null; }
    _removeStartFinishMarkers();

    if (currentViewedRoute && currentViewedRoute.id !== routeInfo.id) {
        if (map.getLayer(`layer-${currentViewedRoute.id}`)) {
            map.setPaintProperty(`layer-${currentViewedRoute.id}`, 'line-opacity', 0);
        }
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
    document.getElementById('route-panel').classList.add('panel-loading');
    document.getElementById('hero-text').classList.add('hero-hidden');
    const _heroDesc = document.getElementById('hero-desc');
    if (_heroDesc) _heroDesc.classList.add('hero-hidden');

    // Hide carousel
    const carousel = document.getElementById('route-carousel-outer');
    if (carousel) carousel.style.display = 'none';

    // fitBounds auto-calculates zoom so the full route is visible.
    // Padding compensates for the sidebar (desktop left) or bottom drawer (mobile).
    const _mob = window.innerWidth < 768;
    const _fitPad = _mob
        ? { top: 40, bottom: Math.round(window.innerHeight * 0.58) + 50, left: 20, right: 20 }
        : { top: 80, bottom: 80, left: 400, right: 80 }; // 400px left = sidebar width + margin

    map.fitBounds(routeData.bounds, {
        padding: _fitPad,
        pitch: 45,
        bearing: -20,
        speed: 0.8,
        essential: true,
        maxZoom: 14
    });

    map.once('moveend', () => {
        if (currentViewedRoute.id !== routeInfo.id) return;

        addRouteToMap(routeInfo.id, routeData.coordinates, routeInfo.color);

        // ── Peak summit marker on the map ─────────────────────
        if (routeData.peakCoords) {
            const peakEl = document.createElement('div');
            peakEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;';
            peakEl.innerHTML =
                '<div id="peak-badge" style="background:rgba(9,9,11,0.88);border:1px solid rgba(255,140,0,0.65);border-radius:7px;padding:5px 7px;display:flex;flex-direction:column;align-items:center;gap:2px;box-shadow:0 2px 18px rgba(0,0,0,0.9);pointer-events:auto;cursor:pointer;">' +
                '<svg width="16" height="13" viewBox="0 0 16 13" fill="none">' +
                '<path d="M8 1.5L14.5 12H1.5Z" stroke="#FF8C00" stroke-width="1.5" stroke-linejoin="round" fill="rgba(255,140,0,0.15)"/>' +
                '<path d="M5.5 7.5L8 5L10.5 7.5" stroke="rgba(255,255,255,0.55)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
                '</svg>' +
                '<span style="color:#FF8C00;font-size:7px;font-weight:700;letter-spacing:.12em;font-family:system-ui,sans-serif;line-height:1;text-transform:uppercase;">MAX</span>' +
                '</div>' +
                '<div style="width:1.5px;height:26px;background:linear-gradient(to bottom,rgba(255,140,0,0.7),rgba(255,140,0,0.04));"></div>' +
                '<div style="width:10px;height:10px;border-radius:50%;background:#FF8C00;border:2px solid rgba(255,255,255,0.95);box-shadow:0 0 14px rgba(255,140,0,0.9),0 0 5px rgba(255,140,0,0.6);margin-top:-1px;"></div>';
            _peakMapMarker = new mapboxgl.Marker({ element: peakEl, anchor: 'bottom' })
                .setLngLat(routeData.peakCoords)
                .addTo(map);
            // Fly to peak on badge click / tap
            const _badge = peakEl.querySelector('#peak-badge');
            const _flyToPeak = () => {
                map.flyTo({ center: routeData.peakCoords, zoom: 16, pitch: 75,
                    bearing: map.getBearing() + 45, speed: 1.5 });
            };
            _badge.addEventListener('click', _flyToPeak);
            let _bTapSX = 0, _bTapSY = 0, _bTapST = 0;
            _badge.addEventListener('touchstart', (e) => { _bTapSX = e.touches[0].clientX; _bTapSY = e.touches[0].clientY; _bTapST = Date.now(); }, { passive: true });
            _badge.addEventListener('touchend', (e) => {
                const t = e.changedTouches[0];
                if (Math.abs(t.clientX - _bTapSX) < 12 && Math.abs(t.clientY - _bTapSY) < 12 && Date.now() - _bTapST < 450) _flyToPeak();
            }, { passive: true });
        }

        // ── Fill panel ────────────────────────────────────────
        // Status badge
        const badge = document.getElementById('panel-status-badge');
        if (routeInfo.future) {
            badge.className = 'inline-flex items-center gap-1.5 mb-2 px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider';
            badge.style.cssText = 'background:rgba(255,140,0,.2);border:1px solid rgba(255,140,0,.5);color:#FFB347;';
            badge.textContent = 'ПЛАН';
            badge.classList.remove('hidden');
        } else {
            badge.innerHTML = '';
            badge.className = 'hidden';
        }

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
        document.getElementById('panel-dist').textContent    = `${routeData.distance} km`;
        document.getElementById('panel-ascent').textContent  = `${routeInfo.overrideAscent  ?? routeData.ascent} m`;
        document.getElementById('panel-descent').textContent = `${routeInfo.overrideDescent ?? routeData.descent} m`;
        document.getElementById('panel-min-ele').textContent = `${routeInfo.overrideMinEle  ?? routeData.minEle} m`;
        document.getElementById('panel-max-ele').textContent = `${routeData.maxEle} m`;
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

        // Elevation chart
        renderElevationChart(routeData.elevationProfile, routeData.minEle, routeData.maxEle);

        // Instagram
        const igWrap = document.getElementById('panel-instagram-wrapper');
        const igLink = document.getElementById('panel-instagram-link');
        if (routeInfo.instagramUrl) {
            igLink.href = routeInfo.instagramUrl;
            igWrap.classList.remove('hidden');
        } else {
            igWrap.classList.add('hidden');
        }

        // Photos
        renderPhotosInPanel(routeInfo);
        renderPhotoMapMarkers(routeInfo);

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
    });
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
        img.src = p.src;
        if (play) play.classList.add('hidden');
    }

    if (counter) counter.textContent = `${_panelPhotoIdx + 1} / ${_panelPhotos.length}`;

    // Highlight active photo point on map
    if (p.coords && map.getSource('photo-active-source')) {
        map.getSource('photo-active-source').setData({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: p.coords }, properties: {} }]
        });
    }

    document.querySelectorAll('#panel-photos-container .photo-thumb').forEach((t, i) => {
        const active = i === _panelPhotoIdx;
        t.classList.toggle('ring-2', active);
        t.classList.toggle('ring-red-500', active);
        t.style.opacity = active ? '1' : '0.45';
    });
}

function renderPhotosInPanel(routeInfo) {
    const routeData = parsedRouteDataCache[routeInfo.id];
    const section = document.getElementById('panel-photos-section');
    const container = document.getElementById('panel-photos-container');

    section.classList.add('hidden');
    container.innerHTML = '';
    _panelPhotos = [];

    if (!routeData || !routeData.photoGeoms || !routeData.photoGeoms.length) return;

    _panelPhotos = routeData.photoGeoms;
    section.classList.remove('hidden');

    _panelPhotos.forEach((p, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'photo-thumb shrink-0 w-12 h-12 rounded-lg overflow-hidden cursor-pointer transition-all';
        thumb.innerHTML = p.isVideo
            ? `<video src="${p.src}#t=0.001" class="w-full h-full object-cover" muted playsinline></video>`
            : `<img src="${p.src}" class="w-full h-full object-cover" loading="lazy" alt="">`;
        thumb.onclick = () => showPanelPhoto(i);
        container.appendChild(thumb);
    });

    showPanelPhoto(0);
}

// ── Elevation chart ───────────────────────────────────────────────────────────
function renderElevationChart(elevationProfile, minEle, maxEle) {
    const wrapper = document.getElementById('panel-elevation-wrapper');
    const canvas  = document.getElementById('elevation-chart');
    if (!canvas) return;

    if (window._elevChart) { window._elevChart.destroy(); window._elevChart = null; }

    if (!elevationProfile || elevationProfile.length < 3) {
        if (wrapper) wrapper.classList.add('hidden');
        return;
    }

    if (wrapper) wrapper.classList.remove('hidden');

    const yMin = Math.max(0, (minEle || 0) - 60);
    const yMax = (maxEle || 2000) + 90;
    const range = yMax - yMin;

    // Adaptive band step: every 50 / 100 / 200 m depending on elevation range
    const bandStep = range > 800 ? 200 : range > 400 ? 100 : 50;

    // Peak position in the profile array
    const peakEle  = maxEle || 0;
    const peakIdx  = elevationProfile.reduce((best, v, i) => v > elevationProfile[best] ? i : best, 0);

    // ── Inline Chart.js plugins ───────────────────────────────────────────────
    const altitudeBandsPlugin = {
        id: 'altitudeBands',
        beforeDraw(chart) {
            const { ctx, scales, chartArea } = chart;
            if (!chartArea) return;
            const { top, bottom, left, right } = chartArea;
            const yScale = scales.y;
            ctx.save();
            ctx.font = 'bold 8px system-ui,sans-serif';
            const firstBand = Math.ceil(yMin / bandStep) * bandStep;
            for (let alt = firstBand; alt <= yMax; alt += bandStep) {
                const y = yScale.getPixelForValue(alt);
                if (y < top - 2 || y > bottom + 2) continue;
                // Horizontal reference line
                ctx.strokeStyle = 'rgba(255,255,255,0.09)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(left, y);
                ctx.lineTo(right, y);
                ctx.stroke();
                // Label pill background
                const labelText = `${alt}м`;
                const tw = ctx.measureText(labelText).width;
                const px2 = left + 4, py2 = y - 11, pw = tw + 8, ph = 12, pr = 3;
                ctx.fillStyle = 'rgba(9,9,11,0.72)';
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(px2, py2, pw, ph, pr);
                } else {
                    ctx.rect(px2, py2, pw, ph);
                }
                ctx.fill();
                // Label text
                ctx.fillStyle = 'rgba(255,255,255,0.72)';
                ctx.textAlign = 'left';
                ctx.fillText(labelText, px2 + 4, py2 + ph - 2);
            }
            ctx.restore();
        }
    };

    const peakMarkerPlugin = {
        id: 'peakMarker',
        afterDraw(chart) {
            if (!peakEle) return;
            const { ctx, scales, chartArea } = chart;
            if (!chartArea) return;
            const px = scales.x.getPixelForValue(peakIdx);
            const py = scales.y.getPixelForValue(peakEle);

            ctx.save();
            // Dashed vertical line from peak down to base
            ctx.strokeStyle = 'rgba(255,215,0,0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(px, chartArea.bottom);
            ctx.lineTo(px, py + 7);
            ctx.stroke();
            ctx.setLineDash([]);

            // Orange dot (same colour as the map peak pin)
            ctx.beginPath();
            ctx.arc(px, py, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = '#FF8C00';
            ctx.shadowColor = 'rgba(255,140,0,0.8)';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Label: flip below the dot if near the top edge, keep within left/right bounds
            ctx.font = 'bold 9px system-ui,sans-serif';
            const labelText = `${peakEle}м`;
            const tw = ctx.measureText(labelText).width;
            const clampedX = Math.max(chartArea.left + tw / 2 + 4, Math.min(chartArea.right - tw / 2 - 4, px));
            // If dot is within 18px of chart top, put label below; else above
            const labelY = py - 10 < chartArea.top + 14 ? py + 18 : py - 10;

            // Dark pill behind label
            ctx.fillStyle = 'rgba(9,9,11,0.85)';
            const pillW = tw + 10, pillH = 14, pillX = clampedX - pillW / 2, pillY = labelY - 11;
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(pillX, pillY, pillW, pillH, 4); ctx.fill(); }
            else { ctx.fillRect(pillX, pillY, pillW, pillH); }

            // Label text
            ctx.fillStyle = '#FF8C00';
            ctx.textAlign = 'center';
            ctx.shadowColor = 'rgba(0,0,0,0.9)';
            ctx.shadowBlur = 3;
            ctx.fillText(labelText, clampedX, labelY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }
    };

    window._elevChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: elevationProfile.map((_, i) => i),
            datasets: [{
                data: elevationProfile,
                borderColor: '#ff4d4d',
                borderWidth: 1.5,
                backgroundColor: 'rgba(255,77,77,0.12)',
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: { display: false, min: yMin, max: yMax }
            },
            animation: { duration: 500 }
        },
        plugins: [altitudeBandsPlugin, peakMarkerPlugin]
    });

    // ── Canvas interaction: hover + click/tap near peak dot → fly to peak ──
    // Property assignment (not addEventListener) so re-renders overwrite cleanly.
    const PEAK_HIT_PX = 28; // generous hit radius for touch

    function _peakScreenX() {
        if (!window._elevChart) return -9999;
        const data = window._elevChart.data.datasets[0].data;
        const idx = data.reduce((b, v, i) => v > data[b] ? i : b, 0);
        return window._elevChart.scales.x.getPixelForValue(idx);
    }
    function _clientXToCanvas(clientX) {
        const r = canvas.getBoundingClientRect();
        return (clientX - r.left) * (canvas.width / r.width);
    }
    function _flyToPeakFromChart() {
        if (!map || !currentViewedRoute) return;
        const rd = parsedRouteDataCache[currentViewedRoute.id];
        if (rd && rd.peakCoords) {
            const _mob = window.innerWidth < 768;
            map.flyTo({ center: rd.peakCoords, zoom: 16, pitch: 75,
                bearing: map.getBearing() + 45, speed: 1.5 });
        }
    }

    canvas.onmousemove = (e) => {
        canvas.style.cursor = Math.abs(_clientXToCanvas(e.clientX) - _peakScreenX()) < PEAK_HIT_PX ? 'pointer' : 'default';
    };
    canvas.onmouseleave = () => { canvas.style.cursor = 'default'; };
    canvas.onclick = (e) => {
        if (Math.abs(_clientXToCanvas(e.clientX) - _peakScreenX()) < PEAK_HIT_PX) _flyToPeakFromChart();
    };
    // Mobile tap detection: record touchstart, check on touchend.
    // No preventDefault anywhere so the parent panel scroll is never blocked.
    // Distinguish tap from scroll via movement + duration thresholds.
    let _tapSX = 0, _tapSY = 0, _tapST = 0;
    canvas.ontouchstart = (e) => {
        if (!e.touches.length) return;
        _tapSX = e.touches[0].clientX;
        _tapSY = e.touches[0].clientY;
        _tapST = Date.now();
    };
    canvas.ontouchend = (e) => {
        if (!e.changedTouches.length) return;
        const t = e.changedTouches[0];
        if (Math.abs(t.clientX - _tapSX) > 12 || Math.abs(t.clientY - _tapSY) > 12 || Date.now() - _tapST > 450) return;
        if (Math.abs(_clientXToCanvas(t.clientX) - _peakScreenX()) < PEAK_HIT_PX) _flyToPeakFromChart();
    };
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

// ── Photo map markers ──────────────────────────────────────────────────────────
function renderPhotoMapMarkers(routeInfo) {
    const routeData = parsedRouteDataCache[routeInfo.id];
    const features = (routeData && routeData.photoGeoms)
        ? routeData.photoGeoms.map((p, i) => ({
            type: 'Feature',
            properties: { id: i, src: p.src, routeId: routeInfo.id, isVideo: p.isVideo || false },
            geometry: { type: 'Point', coordinates: p.coords }
          }))
        : [];

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

        map.on('mouseenter', 'photo-markers-hitbox', (e) => {
            map.getCanvas().style.cursor = 'pointer';
            const props = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates.slice();
            const media = props.isVideo
                ? `<video src="${props.src}#t=0.001" class="max-w-full max-h-full object-cover rounded-lg" muted playsinline></video><div class="absolute inset-0 flex items-center justify-center bg-black/30"><svg class="w-8 h-8 text-white opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>`
                : `<img src="${props.src}" class="max-w-full max-h-full object-cover rounded-lg">`;
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
const _exifPromises = {};
function loadExifForRoute(routeInfo) {
    if (_exifPromises[routeInfo.id]) return _exifPromises[routeInfo.id];
    const routeData = parsedRouteDataCache[routeInfo.id];
    if (!routeData || routeData._exifDone) return Promise.resolve();

    _exifPromises[routeInfo.id] = (async () => {
        routeData.photoGeoms = [];
        if (routeInfo.videos) routeInfo.videos.forEach(v => routeData.photoGeoms.push({ src: v.src, coords: v.coords, isVideo: true }));
        if (routeInfo.photos && routeInfo.photos.length) {
            await Promise.all(routeInfo.photos.map(async (src) => {
                try {
                    const blob = await (await fetch(src)).blob();
                    const gps = await exifr.gps(blob);
                    routeData.photoGeoms.push({ src, coords: gps ? [gps.longitude, gps.latitude] : null });
                } catch(e) {
                    routeData.photoGeoms.push({ src, coords: null });
                }
            }));
        }
        routeData._exifDone = true;
    })();
    return _exifPromises[routeInfo.id];
}

// ── Lightbox ───────────────────────────────────────────────────────────────────
function _lightboxShowPhoto(src, coords, isVideo) {
    currentPhotoCoords = coords;
    const img      = document.getElementById('gallery-image');
    const vid      = document.getElementById('gallery-video');
    const coordTxt = document.getElementById('gallery-coord-text');
    const btnFly   = document.getElementById('btn-gallery-fly');

    coordTxt.textContent = coords ? `GPS: ${coords[1].toFixed(5)}N, ${coords[0].toFixed(5)}E` : 'No GPS Data';

    if (isVideo) {
        img.classList.add('hidden'); img.src = '';
        vid.classList.remove('hidden'); vid.src = src;
    } else {
        vid.classList.add('hidden'); vid.pause(); vid.src = '';
        img.classList.remove('hidden'); img.src = src;
    }
    btnFly.classList.toggle('hidden', !coords);

    // Sync panel index + highlight active strip thumb
    const idx = _panelPhotos.findIndex(p => p.src === src);
    if (idx !== -1) { _panelPhotoIdx = idx; showPanelPhoto(idx); }
    _lightboxHighlightThumb(idx);
}

function _lightboxHighlightThumb(activeIdx) {
    document.getElementById('gallery-strip').querySelectorAll('.lb-thumb').forEach((el, i) => {
        const on = i === activeIdx;
        el.style.opacity      = on ? '1' : '0.4';
        el.style.outlineColor = on ? 'rgba(255,77,77,.9)' : 'transparent';
        if (on) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
}

window.openLightbox = function(src, coords, isVideo) {
    const modal      = document.getElementById('gallery-lightbox');
    const strip      = document.getElementById('gallery-strip');
    const stripWrap  = document.getElementById('gallery-strip-wrap');

    // Build strip from current panel photos
    strip.innerHTML = '';
    if (_panelPhotos.length > 1) {
        _panelPhotos.forEach((p, i) => {
            const thumb = document.createElement('div');
            thumb.className = 'lb-thumb shrink-0 rounded-lg overflow-hidden cursor-pointer';
            thumb.style.cssText = 'width:56px;height:56px;outline:2px solid transparent;outline-offset:2px;border-radius:8px;transition:opacity .15s,outline-color .15s;';
            thumb.innerHTML = p.isVideo
                ? `<video src="${p.src}#t=0.001" class="w-full h-full object-cover" muted playsinline></video>`
                : `<img src="${p.src}" class="w-full h-full object-cover" loading="lazy" alt="">`;
            thumb.addEventListener('click', () => _lightboxShowPhoto(p.src, p.coords || null, p.isVideo || false));
            strip.appendChild(thumb);
        });
        stripWrap.style.display = '';
    } else {
        stripWrap.style.display = 'none';
    }

    _lightboxShowPhoto(src, coords, isVideo);

    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
    setTimeout(() => {
        const el = document.getElementById(isVideo ? 'gallery-video' : 'gallery-image');
        el.classList.remove('scale-95'); el.classList.add('scale-100');
    }, 50);
};

window.closeLightbox = function() {
    const modal = document.getElementById('gallery-lightbox');
    const img   = document.getElementById('gallery-image');
    const vid   = document.getElementById('gallery-video');
    modal.classList.remove('opacity-100', 'pointer-events-auto');
    modal.classList.add('opacity-0', 'pointer-events-none');
    vid.pause();
    [img, vid].forEach(el => { el.classList.remove('scale-100'); el.classList.add('scale-95'); });
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

    if (_peakMapMarker) { _peakMapMarker.remove(); _peakMapMarker = null; }
    _removeStartFinishMarkers();
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
    if (map.getLayer(`layer-${currentViewedRoute.id}`)) {
        map.setPaintProperty(`layer-${currentViewedRoute.id}`, 'line-opacity', 0);
    }
    map.flyTo({
        center: [20.9029, 44.2107], zoom: 6.5, pitch: 0, bearing: 0, speed: 1.2,
        padding: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    currentViewedRoute = null;

    const carousel = document.getElementById('route-carousel-outer');
    if (carousel) carousel.style.display = '';

    if (window._elevChart) { window._elevChart.destroy(); window._elevChart = null; }
});

// ── Filter ────────────────────────────────────────────────────────────────────
window.setFilter = function(type) {
    _activeFilterType = type;
    ['all', 'completed', 'planned'].forEach(t => {
        [document.getElementById(`filter-${t}`), document.getElementById(`filter-${t}-mob`)].forEach(el => {
            if (el) el.classList.toggle('active', t === type);
        });
    });
    _applyMarkerFilter();

    document.querySelectorAll('.carousel-card').forEach(card => {
        const route = routes[card.dataset.routeId];
        if (!route) return;
        const show = type === 'all' || (type === 'completed' && !route.future) || (type === 'planned' && route.future);
        card.style.display = show ? '' : 'none';
    });
    _carouselHW = 0; // invalidate cached scrollWidth after card visibility changes
};

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
    }

    // Elevation profile (≤150 samples for chart)
    const step = Math.max(1, Math.floor(raw.length / 150));
    const elevationProfile = [];
    for (let i = 0; i < raw.length; i += step) elevationProfile.push(Math.round(raw[i].smoothedEle));

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
        elevationProfile
    };
}

// ── Load route data ────────────────────────────────────────────────────────────
async function loadRouteData(routeInfo) {
    try {
        const res = await fetch(routeInfo.file);
        if (!res.ok) throw new Error(`Failed to load ${routeInfo.file}`);
        const routeData = parseGPX(await res.text());

        routeData.photoGeoms = [];
        routeData._exifDone = false;
        parsedRouteDataCache[routeInfo.id] = routeData;

        if (!routeInfo.future) addToKmCounter(routeData.distance);

        const feature = {
            type: 'Feature',
            properties: { id: routeInfo.id, future: routeInfo.future || false },
            geometry: { type: 'Point', coordinates: routeData.peakCoords }
        };
        routeFeatures.push(feature);

        // Add to overview lines source (same retry pattern as route-markers)
        _overviewFeatures.push({
            type: 'Feature',
            properties: { id: routeInfo.id, future: routeInfo.future || false },
            geometry: { type: 'LineString', coordinates: routeData.coordinates }
        });
        const _updateOverview = () => {
            const src = map.getSource('overview-lines');
            if (src) src.setData({ type: 'FeatureCollection', features: _overviewFeatures });
            else setTimeout(_updateOverview, 50);
        };
        _updateOverview();

        const update = () => {
            const src = map.getSource('route-markers');
            if (src) src.setData({ type: 'FeatureCollection', features: routeFeatures });
            else setTimeout(update, 50);
        };
        update();
    } catch(err) {
        console.error('Error loading GPX:', err);
    }
}

function _removeStartFinishMarkers() {
    if (_startMarker)   { _startMarker.remove();  _startMarker  = null; }
    if (_finishMarker)  { _finishMarker.remove(); _finishMarker = null; }
    if (_drawInterval)  { clearInterval(_drawInterval);           _drawInterval  = null; }
    if (_dashAnimFrame) { cancelAnimationFrame(_dashAnimFrame);   _dashAnimFrame = null; }
}

function _addStartFinishMarkers(coordinates) {
    _removeStartFinishMarkers();
    const startCoord  = coordinates[0];
    const finishCoord = coordinates[coordinates.length - 1];

    function makeMarker(label, color, flagSvg) {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;';
        el.innerHTML =
            `<div style="background:rgba(9,9,11,0.9);border:1px solid ${color}99;border-radius:6px;padding:4px 8px;display:flex;align-items:center;gap:5px;box-shadow:0 2px 16px rgba(0,0,0,0.9),0 0 14px ${color}33;">` +
            flagSvg +
            `<span style="color:${color};font-size:9px;font-weight:700;letter-spacing:.1em;font-family:system-ui,sans-serif;text-transform:uppercase;">${label}</span>` +
            `</div>` +
            `<div style="width:1.5px;height:22px;background:linear-gradient(to bottom,${color}bb,${color}05);"></div>` +
            `<div style="width:9px;height:9px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.95);box-shadow:0 0 12px ${color}cc;margin-top:-1px;"></div>`;
        return el;
    }

    const startSvg =
        '<svg width="13" height="14" viewBox="0 0 13 14" fill="none">' +
        '<rect x="0.5" y="0.5" width="1.5" height="13" rx="0.5" fill="#22c55e"/>' +
        '<path d="M2 1H11L8.5 4.5L11 8H2V1Z" fill="#22c55e" opacity="0.9"/>' +
        '</svg>';

    const finishSvg =
        '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
        '<rect x="0.5" y="0.5" width="1.5" height="13" rx="0.5" fill="#ef4444"/>' +
        '<rect x="2" y="1" width="3" height="3" fill="#ef4444"/>' +
        '<rect x="5" y="1" width="3" height="3" fill="rgba(255,255,255,.85)"/>' +
        '<rect x="8" y="1" width="3" height="3" fill="#ef4444"/>' +
        '<rect x="2" y="4" width="3" height="3" fill="rgba(255,255,255,.85)"/>' +
        '<rect x="5" y="4" width="3" height="3" fill="#ef4444"/>' +
        '<rect x="8" y="4" width="3" height="3" fill="rgba(255,255,255,.85)"/>' +
        '</svg>';

    // If start and finish are within ~400m — circular route, show combined marker
    const dLat = (finishCoord[1] - startCoord[1]) * 111000;
    const dLon = (finishCoord[0] - startCoord[0]) * 111000 * Math.cos(startCoord[1] * Math.PI / 180);
    const distM = Math.sqrt(dLat * dLat + dLon * dLon);

    if (distM < 400) {
        // Combined Start / Finish marker
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;';
        el.innerHTML =
            '<div style="background:rgba(9,9,11,0.9);border:1px solid rgba(255,255,255,0.25);border-radius:6px;padding:4px 8px;display:flex;align-items:center;gap:5px;box-shadow:0 2px 16px rgba(0,0,0,0.9);">' +
            startSvg + finishSvg +
            '<span style="color:#fff;font-size:9px;font-weight:700;letter-spacing:.08em;font-family:system-ui,sans-serif;text-transform:uppercase;">Start / Finish</span>' +
            '</div>' +
            '<div style="width:1.5px;height:22px;background:linear-gradient(to bottom,rgba(255,255,255,0.4),rgba(255,255,255,0.02));"></div>' +
            '<div style="width:9px;height:9px;border-radius:50%;background:#fff;border:2px solid rgba(255,255,255,.95);box-shadow:0 0 12px rgba(255,255,255,0.6);margin-top:-1px;"></div>';
        _startMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat(startCoord).addTo(map);
    } else {
        _startMarker  = new mapboxgl.Marker({ element: makeMarker('СТАРТ',  '#22c55e', startSvg),  anchor: 'bottom' }).setLngLat(startCoord).addTo(map);
        _finishMarker = new mapboxgl.Marker({ element: makeMarker('ФИНИШ', '#ef4444', finishSvg), anchor: 'bottom' }).setLngLat(finishCoord).addTo(map);
    }
}

function addRouteToMap(id, coordinates, color) {
    if (_drawInterval)  { clearInterval(_drawInterval);  _drawInterval  = null; }
    if (_dashAnimFrame) { cancelAnimationFrame(_dashAnimFrame); _dashAnimFrame = null; }

    const startPt = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [coordinates[0], coordinates[0]] } };

    if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: startPt });
        map.addLayer({
            id: `layer-${id}`, type: 'line', source: id,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': color, 'line-width': 4, 'line-opacity': 0,
                     'line-opacity-transition': { duration: 1200, delay: 0 } }
        });
    } else {
        map.getSource(id).setData(startPt);
        map.setPaintProperty(`layer-${id}`, 'line-opacity', 0);
    }

    // Fade in via built-in Mapbox transition (one call only)
    setTimeout(() => {
        if (map.getLayer(`layer-${id}`)) map.setPaintProperty(`layer-${id}`, 'line-opacity', 1);
    }, 30);

    _addStartFinishMarkers(coordinates);

    // Progressive draw at 10fps — setData is expensive, don't run at 60fps
    const total   = coordinates.length;
    const DRAW_MS = 5000;
    const t0      = Date.now();

    _drawInterval = setInterval(() => {
        const p     = Math.min((Date.now() - t0) / DRAW_MS, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const count = Math.max(2, Math.round(eased * total));
        const src   = map.getSource(id);
        if (src) src.setData({
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: coordinates.slice(0, count) }
        });
        if (p >= 1) { clearInterval(_drawInterval); _drawInterval = null; }
    }, 100);
}

// ── DOMContentLoaded ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const desktopList  = document.getElementById('desktop-tours-dropdown');
    const mobileList   = document.getElementById('mobile-tours-list');
    const marqueeTrack = document.getElementById('marquee-track');
    const marqueeOuter = document.getElementById('route-carousel-outer');
    const carouselCards = [];

    const completedRoutes = Object.values(routes).filter(r => !r.future);
    const futureRoutes    = Object.values(routes).filter(r => r.future);

    // Load GPX in batches of 3, then open route from URL hash if present
    (async () => {
        const all = Object.values(routes);
        for (let i = 0; i < all.length; i += 3) await Promise.all(all.slice(i, i+3).map(loadRouteData));

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
    function menuBtn(route, isMobile) {
        const color = route.future ? '#FF8C00' : '#ff4d4d';
        const icon = route.future
            ? `<svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="${color}" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6H11.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"/></svg>`
            : `<svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="${color}" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;
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

    // Desktop dropdown
    if (desktopList) {
        desktopList.innerHTML =
            sectionHeader('Пройденные', false) + completedRoutes.map(r => menuBtn(r, false)).join('') +
            `<div class="mx-4 my-1 border-t border-white/10"></div>` +
            sectionHeader('Планируется', false) + futureRoutes.map(r => menuBtn(r, false)).join('');
    }
    // Mobile list
    if (mobileList) {
        mobileList.innerHTML =
            sectionHeader('Пройденные', true) + completedRoutes.map(r => menuBtn(r, true)).join('') +
            sectionHeader('Планируется', true) + futureRoutes.map(r => menuBtn(r, true)).join('');
    }

    // ── Carousel
    if (marqueeTrack) {
        [...completedRoutes, ...futureRoutes].forEach(route => {
            const cover = route.photos && route.photos.length > 0
                ? route.photos[Math.floor(Math.random() * route.photos.length)] : null;
            const card = document.createElement('div');
            card.className = 'carousel-card relative shrink-0 rounded-2xl overflow-hidden cursor-pointer border border-white/10 shadow-xl';
            card.style.cssText = 'width:176px;height:116px;';
            card.dataset.routeId = route.id;
            if (cover) { card.style.backgroundImage = `url('${cover}')`; card.style.backgroundSize = 'cover'; card.style.backgroundPosition = 'center'; }
            else { card.style.background = route.future ? 'linear-gradient(140deg,#1a1500,#2d2000,#1a1000)' : 'linear-gradient(140deg,#1c1c2e,#2a1a3e,#111122)'; }

            const futureBadge = route.future ? `<div style="position:absolute;top:7px;right:7px;background:rgba(255,140,0,.88);border-radius:5px;padding:2px 7px;display:flex;align-items:center;gap:3px;"><svg style="width:8px;height:8px" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6H11.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"/></svg><span style="color:#fff;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Plan</span></div>` : '';
            const tc = route.future ? '#FFD700' : '#ff4d4d';
            card.innerHTML = `<div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.88),rgba(0,0,0,.2) 55%,transparent)"></div>${futureBadge}<div style="position:absolute;bottom:0;left:0;right:0;padding:10px 12px;"><div style="color:#fff;font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 4px rgba(0,0,0,.8)">${route.name}</div><div style="display:flex;align-items:center;gap:4px;margin-top:4px;"><svg style="width:10px;height:10px;flex-shrink:0" fill="none" stroke="${tc}" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span style="color:#e4e4e7;font-size:10px;font-weight:500;">${route.overrideTime || '—'}</span></div></div>`;

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

    // ── Layers toggle button
    document.getElementById('btn-layers-toggle').addEventListener('click', () => {
        _showLines = !_showLines;
        _applyMarkerFilter(); // applies lines visibility respecting active filter
        document.getElementById('btn-layers-toggle').classList.toggle('lines-active', _showLines);
        document.getElementById('lines-legend').classList.toggle('visible', _showLines);
    });

    // ── Panel collapse/expand toggle
    document.getElementById('panel-toggle-btn').addEventListener('click', () => {
        document.getElementById('route-panel-group').classList.toggle('panel-collapsed');
    });

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
