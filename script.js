// Configuration
const MAPBOX_TOKEN = '';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Route files with explicit manual stat overrides
// Fill in the exact data from your App here to bypass GPX raw noise!
const routesList = [
    { file: 'Дебело Брдо - Ябланик.gpx', overrideAscent: 818, overrideDescent: 819, overrideTime: '~6h' },
    {
        file: 'Samari - Lastra.gpx', overrideAscent: 718, overrideDescent: 829, overrideTime: '6h 24m', photos: [
            'photos/Samari - Lastra/IMG_6806.JPG', 'photos/Samari - Lastra/IMG_6817.JPG'
        ]
    },
    {
        file: 'Gvozdacke Stene.gpx', overrideAscent: 726, overrideDescent: 730, overrideTime: '6h 07m', photos: [
            'photos/Gvozdacke Stene/IMG_7332.JPG', 'photos/Gvozdacke Stene/IMG_7382.JPG', 'photos/Gvozdacke Stene/IMG_7387.JPG',
            'photos/Gvozdacke Stene/IMG_7425.JPG', 'photos/Gvozdacke Stene/IMG_7466.JPG'
        ]
    },
    {
        file: 'Lastra - Divcibare.gpx', overrideAscent: 604, overrideDescent: 587, overrideTime: '5h 43m', photos: [
            'photos/Lastra - Divcibare/IMG_7564.JPG', 'photos/Lastra - Divcibare/IMG_7572.JPG', 'photos/Lastra - Divcibare/IMG_7580.JPG'
        ]
    },
    {
        file: 'Samari - Magleš (Pali).gpx', overrideAscent: 805, overrideDescent: 805, overrideTime: '7h', photos: [
            'photos/Samari - Magleš (Pali)/IMG_6278.JPG', 'photos/Samari - Magleš (Pali)/IMG_6312.JPG', 'photos/Samari - Magleš (Pali)/IMG_6317.JPG',
            'photos/Samari - Magleš (Pali)/IMG_6360.JPG', 'photos/Samari - Magleš (Pali)/IMG_6408.JPG', 'photos/Samari - Magleš (Pali)/IMG_6427.JPG',
            'photos/Samari - Magleš (Pali)/IMG_6435.JPG', 'photos/Samari - Magleš (Pali)/IMG_6448.JPG', 'photos/Samari - Magleš (Pali)/IMG_6451.JPG',
            'photos/Samari - Magleš (Pali)/IMG_6495.JPG', 'photos/Samari - Magleš (Pali)/IMG_6502.JPG'
        ]
    },
    {
        file: 'Medednik - Bucurska pecina.gpx', overrideAscent: 1267, overrideDescent: 1272, overrideTime: '8h 25m', photos: [
            'photos/Medednik - Bucurska pecina/IMG_7045.JPG', 'photos/Medednik - Bucurska pecina/IMG_7146.JPG', 'photos/Medednik - Bucurska pecina/IMG_7257.JPG',
            'photos/Medednik - Bucurska pecina/IMG_7281.JPG', 'photos/Medednik - Bucurska pecina/IMG_7287.JPG', 'photos/Medednik - Bucurska pecina/IMG_7299.JPG',
            'photos/Medednik - Bucurska pecina/IMG_7306.JPG'
        ]
    },
    { file: 'Valjevo - Gradac River Canyon.gpx', overrideAscent: 301, overrideDescent: 382, overrideTime: '4h', overrideMinEle: 171 },
    {
        file: 'Istoćni Maljen - Mokra Pecina.gpx', overrideAscent: 931, overrideDescent: 935, overrideTime: '7h 57m', photos: [
            'photos/Maljen/IMG_5753.JPG', 'photos/Maljen/IMG_5819.JPG', 'photos/Maljen/IMG_5837.JPG', 'photos/Maljen/IMG_5852.JPG',
            'photos/Maljen/IMG_5888.JPG', 'photos/Maljen/IMG_5975.JPG', 'photos/Maljen/IMG_5999.JPG', 'photos/Maljen/IMG_6033.JPG'
        ]
    },
    {
        file: 'Бељаница - Богојављенски успон.gpx', overrideAscent: 1105, overrideDescent: 1119, overrideTime: '5h 51m', photos: [
            'photos/Бељаница - Богојављенски успон/IMG_7799.JPG', 'photos/Бељаница - Богојављенски успон/IMG_7805.JPG',
            'photos/Бељаница - Богојављенски успон/IMG_7828.JPG', 'photos/Бељаница - Богојављенски успон/IMG_7891.JPG'
        ]
    },
    {
        file: 'Lastra - Magleš - Kušakovići.gpx', overrideAscent: 987, overrideDescent: 986, overrideTime: '5h', overrideMinEle: 365, photos: [
            'photos/Lastra - Magleš - Kušakovići/IMG_5170.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5216.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5238.JPG',
            'photos/Lastra - Magleš - Kušakovići/IMG_5265.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5320.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5334.JPG',
            'photos/Lastra - Magleš - Kušakovići/IMG_5339.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5358.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5396.JPG',
            'photos/Lastra - Magleš - Kušakovići/IMG_5408.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5441.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5478.JPG',
            'photos/Lastra - Magleš - Kušakovići/IMG_5489.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5498.JPG', 'photos/Lastra - Magleš - Kušakovići/IMG_5506.JPG'
        ]
    }
];

const routes = {};
routesList.forEach((data, index) => {
    routes[`route_${index}`] = {
        id: `route_${index}`,
        file: data.file,
        name: data.file.replace('.gpx', ''),
        color: '#ff4d4d',
        future: false,
        overrideAscent: data.overrideAscent,
        overrideDescent: data.overrideDescent,
        overrideTime: data.overrideTime,
        overrideMinEle: data.overrideMinEle !== undefined ? data.overrideMinEle : null,
        photos: data.photos || [],
        videos: data.videos || []
    };
});

// Planned future trips
const futureRoutesList = [
    { file: 'future_trips/Dom_Vis-Javoracki-vrh.gpx' },
    { file: 'future_trips/ПД_Грза_Велики_Козји_Рог_Вис_Црни_врх_Јаворак_ПД_Грза.gpx' },
    { file: 'future_trips/Рудник - Благовештење.gpx' },
    { file: 'future_trips/Дебело Брдо - Ябланик.gpx' },
    { file: 'future_trips/Каблар.gpx' },
    { file: 'future_trips/Дивчибаре - Козомор - Црни Врх.gpx' },
];
futureRoutesList.forEach((data, index) => {
    const key = `future_${index}`;
    routes[key] = {
        id: key,
        file: data.file,
        name: data.file.split('/').pop().replace('.gpx', ''),
        color: '#FF8C00',
        future: true,
        overrideAscent: null,
        overrideDescent: null,
        overrideTime: null,
        overrideMinEle: null,
        photos: [],
        videos: []
    };
});

// Cache for storing parsed track data natively
const parsedRouteDataCache = {};
const routeFeatures = []; // GeoJSON Array for WebGL Points

// WebGL Animated Pattern for Pulsing Dot
const size = 90; // Smaller dot for cleaner visuals
const pulsingDot = {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),

    onAdd: function () {
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        this.context = canvas.getContext('2d', { willReadFrequently: true });
    },

    render: function () {
        const now = performance.now();
        // Limit texture updates to ~25fps to reduce GPU load
        if (now - (this._lastFrame || 0) < 40) return false;
        this._lastFrame = now;

        const duration = 2000;
        const t = (now % duration) / duration;
        const radius = (size / 2) * 0.25;
        const outerRadius = (size / 2) * 0.75 * t + radius;
        const context = this.context;

        context.clearRect(0, 0, this.width, this.height);

        const gradient = context.createRadialGradient(
            this.width / 2, this.height / 2, radius,
            this.width / 2, this.height / 2, outerRadius
        );
        gradient.addColorStop(0, `rgba(255, 77, 77, ${0.7 * (1 - t)})`);
        gradient.addColorStop(1, `rgba(255, 77, 77, 0)`);
        context.beginPath();
        context.arc(this.width / 2, this.height / 2, outerRadius, 0, Math.PI * 2);
        context.fillStyle = gradient;
        context.fill();

        context.beginPath();
        context.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
        context.shadowColor = 'rgba(255, 77, 77, 0.9)';
        context.shadowBlur = 15;
        context.fillStyle = '#ff4d4d';
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        context.lineWidth = 2.5;
        context.stroke();

        this.data = context.getImageData(0, 0, this.width, this.height).data;
        return true;
    }
};

// Yellow pulsing dot for planned future routes
const futurePulsingDot = {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),
    onAdd: function () {
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        this.context = canvas.getContext('2d', { willReadFrequently: true });
    },
    render: function () {
        const duration = 2400;
        const t = (performance.now() % duration) / duration;
        const radius = (size / 2) * 0.25;
        const outerRadius = (size / 2) * 0.75 * t + radius;
        const context = this.context;
        context.clearRect(0, 0, this.width, this.height);

        const gradient = context.createRadialGradient(
            this.width / 2, this.height / 2, radius,
            this.width / 2, this.height / 2, outerRadius
        );
        gradient.addColorStop(0, `rgba(255, 200, 0, ${0.7 * (1 - t)})`);
        gradient.addColorStop(1, `rgba(255, 200, 0, 0)`);
        context.beginPath();
        context.arc(this.width / 2, this.height / 2, outerRadius, 0, Math.PI * 2);
        context.fillStyle = gradient;
        context.fill();

        context.beginPath();
        context.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
        context.shadowColor = 'rgba(255, 180, 0, 0.9)';
        context.shadowBlur = 15;
        context.fillStyle = '#FFD700';
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        context.lineWidth = 2.5;
        context.stroke();

        this.data = context.getImageData(0, 0, this.width, this.height).data;
        return false; // setInterval drives repaints at controlled rate
    }
};

let map;
if (MAPBOX_TOKEN !== 'YOUR_MAPBOX_ACCESS_TOKEN') {
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [20.9029, 44.2107],
        zoom: 6.5,
        pitch: 0,
        interactive: true
    });

    map.on('load', async () => {
        // Add 3D terrain
        map.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
            'tileSize': 512,
            'maxzoom': 14
        });
        map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });

        // Apply dark mask + disable labels outside Serbia
        await applySerbiaMask();

        // Register animated dots
        map.addImage('pulsing-dot', pulsingDot, { pixelRatio: 1.5 });
        map.addImage('future-pulsing-dot', futurePulsingDot, { pixelRatio: 1.5 });

        // Drive both dot animations at ~25fps — render() returns false so only this controls repaint rate
        setInterval(() => { if (map) map.triggerRepaint(); }, 40);

        // Create main container for all Points
        map.addSource('route-markers', {
            'type': 'geojson',
            'data': {
                'type': 'FeatureCollection',
                'features': []
            }
        });

        // Add the single layer plotting our Native 3D attached markers
        map.addLayer({
            'id': 'route-markers-layer',
            'type': 'symbol',
            'source': 'route-markers',
            'layout': {
                'icon-image': ['case', ['==', ['get', 'future'], true], 'future-pulsing-dot', 'pulsing-dot'],
                'icon-pitch-alignment': 'map',
                'icon-allow-overlap': true
            }
        });

        // Add a perfectly invisible rigid layer JUST for pixel-precise click/hover hitboxes
        map.addLayer({
            'id': 'route-hitboxes-layer',
            'type': 'circle',
            'source': 'route-markers',
            'paint': {
                'circle-radius': 12,        // generous 12px interaction radius at the center
                'circle-color': 'transparent',
                'circle-stroke-width': 0
            }
        });

        let hoverPopup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'custom-hover-popup',
            offset: 15
        });

        let photoHoverPopup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'custom-hover-popup',
            offset: 10
        });

        window.hoverPopup = hoverPopup; // Expose globally for triggerRouteSelection
        window.photoHoverPopup = photoHoverPopup;

        // -- Interaction Handlers for Native WebGL Icons mapped via invisible Hitbox --
        map.on('click', 'route-hitboxes-layer', (e) => {
            if (!e.features.length) return;
            const routeId = e.features[0].properties.id;
            triggerRouteSelection(routeId);
        });

        let hoveredFeatureId = null;

        map.on('mousemove', 'route-hitboxes-layer', (e) => {
            if (e.features.length > 0) {
                map.getCanvas().style.cursor = 'pointer';
                const feature = e.features[0];
                const routeId = feature.properties.id;

                // Only update the popup if we actually moved over a DIFFERENT point!
                if (hoveredFeatureId !== routeId) {
                    hoveredFeatureId = routeId;
                    const routeInfo = routes[routeId];
                    hoverPopup.setLngLat(feature.geometry.coordinates)
                        .setHTML(`<div class="text-xs font-semibold tracking-wide">${routeInfo.name}</div>`)
                        .addTo(map);
                }
            }
        });
        map.on('mouseleave', 'route-hitboxes-layer', () => {
            map.getCanvas().style.cursor = '';
            hoveredFeatureId = null;
            hoverPopup.remove();
        });
    });
} else {
    console.warn("Mapbox token is missing.");
}

async function applySerbiaMask() {
    map.addSource('country-boundaries', {
        type: 'vector',
        url: 'mapbox://mapbox.country-boundaries-v1'
    });

    let firstLabelId = null;
    for (const layer of map.getStyle().layers) {
        if (layer.type === 'symbol') {
            firstLabelId = layer.id;
            break;
        }
    }

    map.addLayer({
        'id': 'world-mask-layer',
        'type': 'fill',
        'source': 'country-boundaries',
        'source-layer': 'country_boundaries',
        'paint': {
            'fill-color': '#000000',
            'fill-opacity': 0.75
        },
        'filter': [
            'all',
            ['!=', 'iso_3166_1_alpha_3', 'SRB'],
            ['!=', 'iso_3166_1', 'RS']
        ]
    }, firstLabelId);

    try {
        const response = await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/SRB.geo.json');
        if (!response.ok) return;
        const srbData = await response.json();
        const serbiaFeature = srbData.features ? srbData.features[0] : null;

        if (serbiaFeature) {
            map.getStyle().layers.forEach(layer => {
                // Delete all extraneous physical trails mapping to clean the view
                if (layer.type === 'line') {
                    const id = layer.id.toLowerCase();
                    if (id.includes('path') || id.includes('trail') || id.includes('track') || id.includes('footway') || id.includes('steps')) {
                        map.setLayoutProperty(layer.id, 'visibility', 'none');
                    }
                }

                // Catch ALL symbols which includes text labels, highway shields, and POI icons!
                if (layer.type === 'symbol') {
                    if (layer.id.includes('natural-point') || layer.id.includes('natural-line')) {
                        // Keep pristine Mountains & Nature inside Serbia
                        const currentFilter = map.getFilter(layer.id);
                        if (currentFilter) {
                            map.setFilter(layer.id, ['all', currentFilter, ['within', serbiaFeature]]);
                        } else {
                            map.setFilter(layer.id, ['within', serbiaFeature]);
                        }

                        // 🔥 DESIGN EXPERT FIX:
                        // Protect text legibility against wild camera pitches and satellite imagery!
                        try {
                            // Heavy dark halo behind bright white text makes it universally readable
                            map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(0, 0, 0, 0.95)');
                            map.setPaintProperty(layer.id, 'text-halo-width', 2);
                            map.setPaintProperty(layer.id, 'text-color', '#ffffff');

                            // Prevent text from lying flat on the ground and getting squished when tilted
                            map.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport');
                        } catch (e) { } // Safely ignore if layer structure resists layout rewrites

                    } else {
                        // Delete cities, settlements, states, roads, HIGHWAY SHIELDS, and POIs everywhere
                        map.setLayoutProperty(layer.id, 'visibility', 'none');
                    }
                }
            });
        }
    } catch (err) {
        console.warn('Could not load Serbia GeoJSON for label filtering:', err);
    }
}

let currentViewedRoute = null;
let currentPhotoCoords = null; // for fly-to in gallery

window.flyToRoute = function (routeId) {
    triggerRouteSelection(routeId);
};

function triggerRouteSelection(routeId) {
    const routeInfo = routes[routeId];
    const routeData = parsedRouteDataCache[routeId];
    if (!routeInfo || !routeData) return;

    if (window.hoverPopup) window.hoverPopup.remove();

    if (currentViewedRoute && currentViewedRoute.id !== routeInfo.id) {
        if (map.getLayer(`layer-${currentViewedRoute.id}`)) {
            map.setPaintProperty(`layer-${currentViewedRoute.id}`, 'line-opacity', 0);

            // Cleanup current photo markers if any
            if (map.getLayer('photo-markers-glow')) {
                map.setFilter('photo-markers-glow', ['==', 'routeId', 'none']);
                map.setFilter('photo-markers-hitbox', ['==', 'routeId', 'none']);
            }
        }
    }

    currentViewedRoute = routeInfo;

    // Hide carousel when viewing a route
    const carousel = document.getElementById('route-carousel-outer');
    if (carousel) carousel.style.display = 'none';

    document.getElementById('map').classList.remove('opacity-50');
    document.getElementById('map').classList.add('opacity-100', 'transition-opacity', 'duration-1000');

    map.flyTo({
        center: routeData.center,
        zoom: 13,
        pitch: 65,
        bearing: -20,
        speed: 1.2
    });

    // We can draw line instantly
    addRouteToMap(routeInfo.id, routeData.coordinates, routeInfo.color);

    map.once('moveend', () => {
        if (currentViewedRoute.id !== routeInfo.id) return;

        // Update Panel
        const nameEl = document.getElementById('panel-name');
        if (routeInfo.future) {
            nameEl.innerHTML = `${routeInfo.name} <span style="display:inline-block;vertical-align:middle;background:rgba(255,140,0,0.2);border:1px solid rgba(255,140,0,0.5);color:#FFB347;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:1px 6px;border-radius:4px;margin-left:4px;">ПЛАН</span>`;
        } else {
            nameEl.textContent = routeInfo.name;
        }
        document.getElementById('panel-dist').textContent = `${routeData.distance} km`;
        document.getElementById('panel-ascent').textContent = `${routeInfo.overrideAscent !== null ? routeInfo.overrideAscent : routeData.ascent} m`;
        document.getElementById('panel-descent').textContent = `${routeInfo.overrideDescent !== null ? routeInfo.overrideDescent : routeData.descent} m`;
        document.getElementById('panel-min-ele').textContent = `${routeInfo.overrideMinEle !== null ? routeInfo.overrideMinEle : routeData.minEle} m`;
        document.getElementById('panel-max-ele').textContent = `${routeData.maxEle} m`;
        document.getElementById('panel-time').textContent = routeInfo.overrideTime !== null ? routeInfo.overrideTime : routeData.formattedTime;

        const panel = document.getElementById('route-panel-group');
        panel.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-8');
        panel.classList.add('opacity-100', 'pointer-events-auto', 'translate-y-0');

        renderThumbnails(routeInfo);
        renderPhotoMapMarkers(routeInfo);
    });
}

let photosPanelExpanded = false;

function makeThumb(p) {
    const thumb = document.createElement('div');
    thumb.className = 'relative shrink-0 rounded-xl overflow-hidden border border-white/10 shadow-lg cursor-pointer transform hover:scale-105 transition-all opacity-80 hover:opacity-100';
    if (p.isVideo) {
        thumb.innerHTML = `
            <video src="${p.src}#t=0.001" class="w-full h-full object-cover" muted playsinline></video>
            <div class="absolute inset-0 flex items-center justify-center bg-black/30">
                <svg class="w-6 h-6 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </div>`;
    } else {
        thumb.innerHTML = `<img src="${p.src}" class="w-full h-full object-cover">`;
    }
    thumb.onclick = () => openLightbox(p.src, p.coords, p.isVideo);
    return thumb;
}

let _extraPhotosForPanel = [];

function renderThumbnails(routeInfo) {
    const container = document.getElementById('panel-photos-container');
    const sidePanel = document.getElementById('photos-side-panel');
    const toggleBtn = document.getElementById('btn-photos-toggle');
    const toggleArrow = document.getElementById('photos-toggle-arrow');
    const toggleLabel = document.getElementById('photos-toggle-label');

    container.innerHTML = '';
    // Side panel stays EMPTY until user clicks "Ещё" — prevents height contribution to flex line
    sidePanel.innerHTML = '';
    _extraPhotosForPanel = [];

    // Reset expanded state
    photosPanelExpanded = false;
    sidePanel.classList.remove('expanded');
    toggleBtn.style.display = 'none';
    toggleArrow.style.transform = '';
    toggleLabel.textContent = 'Ещё';

    const routeData = parsedRouteDataCache[routeInfo.id];

    if (routeData && routeData.photoGeoms && routeData.photoGeoms.length > 0) {
        container.classList.remove('hidden');
        const allPhotos = routeData.photoGeoms;
        const isDesktop = window.innerWidth >= 768;
        const useExpand = allPhotos.length >= 5 && isDesktop;

        const mainPhotos = useExpand ? allPhotos.slice(0, 4) : allPhotos;

        const thumbSize = isDesktop ? '80px' : '64px';
        mainPhotos.forEach(p => {
            const thumb = makeThumb(p);
            thumb.style.width = thumbSize;
            thumb.style.height = thumbSize;
            thumb.style.flexShrink = '0';
            container.appendChild(thumb);
        });

        if (useExpand) {
            // Store extra photos — DOM elements created only when panel opens
            _extraPhotosForPanel = allPhotos.slice(4);
            toggleBtn.style.display = 'flex';
        }
    } else {
        container.classList.add('hidden');
    }
}

window.togglePhotosPanel = function () {
    const sidePanel = document.getElementById('photos-side-panel');
    const toggleArrow = document.getElementById('photos-toggle-arrow');
    const toggleLabel = document.getElementById('photos-toggle-label');

    photosPanelExpanded = !photosPanelExpanded;

    if (photosPanelExpanded) {
        // Populate side panel only now — no premature height in flex layout
        sidePanel.innerHTML = '';
        _extraPhotosForPanel.forEach(p => {
            const thumb = makeThumb(p);
            thumb.style.width = '80px';
            thumb.style.height = '80px';
            thumb.style.flexShrink = '0';
            sidePanel.appendChild(thumb);
        });
        sidePanel.classList.add('expanded');
        toggleArrow.style.transform = 'rotate(180deg)';
        toggleLabel.textContent = 'Меньше';
    } else {
        sidePanel.classList.remove('expanded');
        // Clear DOM so side panel has 0 height in collapsed state
        setTimeout(() => { sidePanel.innerHTML = ''; }, 460);
        toggleArrow.style.transform = '';
        toggleLabel.textContent = 'Ещё';
    }
};

function renderPhotoMapMarkers(routeInfo) {
    const routeData = parsedRouteDataCache[routeInfo.id];
    let features = [];
    if (routeData && routeData.photoGeoms) {
        features = routeData.photoGeoms.map((p, i) => ({
            type: 'Feature',
            properties: { id: i, src: p.src, routeId: routeInfo.id, isVideo: p.isVideo ? true : false },
            geometry: { type: 'Point', coordinates: p.coords }
        }));
    }

    if (!map.getSource('photo-markers-source')) {
        map.addSource('photo-markers-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: features }
        });

        map.addLayer({
            id: 'photo-markers-glow',
            type: 'circle',
            source: 'photo-markers-source',
            paint: {
                'circle-radius': 6,
                'circle-color': '#fff',
                'circle-opacity': 0.9,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#34AADF' // Electric Blue
            },
            filter: ['==', 'routeId', routeInfo.id]
        });

        map.addLayer({
            id: 'photo-markers-hitbox',
            type: 'circle',
            source: 'photo-markers-source',
            paint: {
                'circle-radius': 24, // VERY generous hitbox for phone tapping
                'circle-color': 'transparent'
            },
            filter: ['==', 'routeId', routeInfo.id]
        });

        // Use custom popup defined earlier
        map.on('mouseenter', 'photo-markers-hitbox', (e) => {
            map.getCanvas().style.cursor = 'pointer';
            const props = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates.slice();

            const mediaTag = props.isVideo
                ? `<video src="${props.src}#t=0.001" class="max-w-full max-h-full object-cover rounded-lg" muted playsinline></video><div class="absolute inset-0 flex items-center justify-center bg-black/30"><svg class="w-8 h-8 text-white opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>`
                : `<img src="${props.src}" class="max-w-full max-h-full object-cover rounded-lg">`;

            const html = `<div class="p-1 bg-black/80 rounded-xl backdrop-blur-md border border-white/20 shadow-[0_0_20px_rgba(0,0,0,0.8)] overflow-hidden w-32 h-32 flex items-center justify-center relative">
                            ${mediaTag}
                          </div>`;
            window.photoHoverPopup.setLngLat(coords).setHTML(html).addTo(map);
        });

        map.on('mouseleave', 'photo-markers-hitbox', () => {
            map.getCanvas().style.cursor = '';
            window.photoHoverPopup.remove();
        });

        map.on('click', 'photo-markers-hitbox', (e) => {
            window.photoHoverPopup.remove();
            if (window.hoverPopup) window.hoverPopup.remove();
            const props = e.features[0].properties;
            const coords = e.features[0].geometry.coordinates;
            openLightbox(props.src, coords, props.isVideo);
        });

    } else {
        map.getSource('photo-markers-source').setData({
            type: 'FeatureCollection',
            features: features
        });
        map.setFilter('photo-markers-glow', ['==', 'routeId', routeInfo.id]);
        map.setFilter('photo-markers-hitbox', ['==', 'routeId', routeInfo.id]);
    }
}

window.openLightbox = function (src, coords, isVideo) {
    currentPhotoCoords = coords;
    const modal = document.getElementById('gallery-lightbox');
    const img = document.getElementById('gallery-image');
    const vid = document.getElementById('gallery-video');
    const coordText = document.getElementById('gallery-coord-text');
    const btnFly = document.getElementById('btn-gallery-fly');

    coordText.textContent = coords ? `GPS: ${coords[1].toFixed(5)}N, ${coords[0].toFixed(5)}E` : 'No GPS Data';

    if (isVideo) {
        img.classList.add('hidden');
        img.src = ""; // Stop photo
        vid.classList.remove('hidden');
        vid.src = src;
        // The HTML tag has autoplay applied
    } else {
        vid.classList.add('hidden');
        vid.pause();
        vid.src = ""; // Stop stream
        img.classList.remove('hidden');
        img.src = src;
    }

    if (coords) {
        btnFly.classList.remove('hidden');
    } else {
        btnFly.classList.add('hidden');
    }

    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
    setTimeout(() => {
        if (isVideo) {
            vid.classList.remove('scale-95');
            vid.classList.add('scale-100');
        } else {
            img.classList.remove('scale-95');
            img.classList.add('scale-100');
        }
    }, 50);
}

window.closeLightbox = function () {
    const modal = document.getElementById('gallery-lightbox');
    const img = document.getElementById('gallery-image');
    const vid = document.getElementById('gallery-video');

    modal.classList.remove('opacity-100', 'pointer-events-auto');
    modal.classList.add('opacity-0', 'pointer-events-none');

    vid.pause();
    img.classList.remove('scale-100');
    img.classList.add('scale-95');
    vid.classList.remove('scale-100');
    vid.classList.add('scale-95');
}

// Lightbox flyTo
document.getElementById('btn-gallery-fly').addEventListener('click', () => {
    if (currentPhotoCoords) {
        closeLightbox();
        map.flyTo({
            center: currentPhotoCoords,
            zoom: 16,
            pitch: 75,
            bearing: map.getBearing() + 45, // cinematic turn
            speed: 1.5
        });
    }
});

document.getElementById('btn-back').addEventListener('click', () => {
    if (!currentViewedRoute) return;

    const panel = document.getElementById('route-panel-group');
    panel.classList.add('opacity-0', 'pointer-events-none', 'translate-y-8');
    panel.classList.remove('opacity-100', 'pointer-events-auto', 'translate-y-0');

    // Hide photo markers when going back
    if (map.getLayer('photo-markers-glow')) {
        map.setFilter('photo-markers-glow', ['==', 'routeId', 'none']);
        map.setFilter('photo-markers-hitbox', ['==', 'routeId', 'none']);
    }

    if (map.getLayer(`layer-${currentViewedRoute.id}`)) {
        map.setPaintProperty(`layer-${currentViewedRoute.id}`, 'line-opacity', 0);
    }

    map.flyTo({
        center: [20.9029, 44.2107],
        zoom: 6.5,
        pitch: 0,
        bearing: 0,
        speed: 1.2
    });

    currentViewedRoute = null;

    // Restore carousel
    const carousel = document.getElementById('route-carousel-outer');
    if (carousel) carousel.style.display = '';
});

function haversineDistance(coords1, coords2) {
    const toRad = (x) => (x * Math.PI) / 180;
    const [lon1, lat1] = coords1;
    const [lon2, lat2] = coords2;

    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function parseGPX(gpxString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxString, "text/xml");

    const trkpts = xmlDoc.getElementsByTagName("trkpt");

    // 1. Extract all raw track points
    const rawPoints = [];
    for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = parseFloat(pt.getAttribute("lat"));
        const lon = parseFloat(pt.getAttribute("lon"));

        let ele = 0;
        const eleNodes = pt.getElementsByTagName("ele");
        if (eleNodes.length > 0) ele = parseFloat(eleNodes[0].textContent);

        let time = null;
        const timeNodes = pt.getElementsByTagName("time");
        if (timeNodes.length > 0) time = new Date(timeNodes[0].textContent);

        rawPoints.push({ lon, lat, ele, time });
    }

    if (rawPoints.length === 0) return null;

    // 2. Apply a 15-point Moving Average filter to elevations to heavily suppress GPS noise
    const SMOOTHING_WINDOW = 15;
    for (let i = 0; i < rawPoints.length; i++) {
        let sum = 0;
        let count = 0;
        let start = Math.max(0, i - Math.floor(SMOOTHING_WINDOW / 2));
        let end = Math.min(rawPoints.length - 1, i + Math.floor(SMOOTHING_WINDOW / 2));

        for (let j = start; j <= end; j++) {
            sum += rawPoints[j].ele;
            count++;
        }
        rawPoints[i].smoothedEle = sum / count;
    }

    // 3. Calculate statistics using smoothed elevation and track bounds
    let totalDistance = 0;
    let totalAscent = 0;
    let totalDescent = 0;

    let trackMinEle = Infinity;
    let trackMaxEle = -Infinity;
    let peakCoords = [rawPoints[0].lon, rawPoints[0].lat];

    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    const coordinates = [];
    let startTime = rawPoints[0].time;
    let endTime = rawPoints[0].time;

    for (let i = 0; i < rawPoints.length; i++) {
        const pt = rawPoints[i];
        coordinates.push([pt.lon, pt.lat]);

        if (pt.lon < minLon) minLon = pt.lon;
        if (pt.lon > maxLon) maxLon = pt.lon;
        if (pt.lat < minLat) minLat = pt.lat;
        if (pt.lat > maxLat) maxLat = pt.lat;

        // Use smoothed elevation for finding the realistic peak
        if (pt.smoothedEle < trackMinEle) trackMinEle = pt.smoothedEle;
        if (pt.smoothedEle > trackMaxEle) {
            trackMaxEle = pt.smoothedEle;
            peakCoords = [pt.lon, pt.lat];
        }

        if (pt.time) endTime = pt.time; // Update end time sequentially

        if (i > 0) {
            const prev = rawPoints[i - 1];
            const dist = haversineDistance([prev.lon, prev.lat], [pt.lon, pt.lat]);
            totalDistance += dist;

            const eleDiff = pt.smoothedEle - prev.smoothedEle;
            // Additional strict cutoff filtering (ignore micro variances < 0.3m per step)
            if (eleDiff > 0.3) {
                totalAscent += eleDiff;
            } else if (eleDiff < -0.3) {
                totalDescent += Math.abs(eleDiff);
            }
        }
    }

    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;

    // Time estimate logic fallback
    let estimatedTimeStr = "-";
    if (startTime && endTime && startTime.getTime() !== endTime.getTime()) {
        const diffMs = endTime - startTime;
        const totalMinutes = diffMs / 1000 / 60;
        const hours = Math.floor(totalMinutes / 60);
        const mins = Math.round(totalMinutes % 60);
        estimatedTimeStr = `${hours}h ${mins}m`;
    } else {
        const timeHours = (totalDistance / 5.0) + (totalAscent / 600.0);
        const hours = Math.floor(timeHours);
        const mins = Math.round((timeHours - hours) * 60);
        estimatedTimeStr = `~ ${hours}h ${mins}m`;
    }

    return {
        coordinates,
        peakCoords: peakCoords,
        center: [centerLon, centerLat],
        distance: Number(totalDistance.toFixed(2)),
        ascent: Math.round(totalAscent),
        descent: Math.round(totalDescent),
        minEle: trackMinEle === Infinity ? 0 : Math.round(trackMinEle),
        maxEle: trackMaxEle === -Infinity ? 0 : Math.round(trackMaxEle),
        formattedTime: estimatedTimeStr
    };
}

async function loadRouteData(routeInfo) {
    try {
        const response = await fetch(routeInfo.file);
        if (!response.ok) throw new Error(`Failed to load ${routeInfo.file}`);

        const gpxText = await response.text();
        const routeData = parseGPX(gpxText);

        // Process Explicit Media (Videos/Manual overrides) and EXIF metadata aggressively
        routeData.photoGeoms = [];

        // 1. Inject manual coordinates directly
        if (routeInfo.videos && routeInfo.videos.length > 0) {
            routeInfo.videos.forEach(v => {
                routeData.photoGeoms.push({ src: v.src, coords: v.coords, isVideo: true });
            });
        }

        // 2. Resolve dynamic EXIFs...
        if (routeInfo.photos && routeInfo.photos.length > 0) {
            Promise.all(routeInfo.photos.map(async (photoSrc) => {
                try {
                    const pResp = await fetch(photoSrc);
                    const pBlob = await pResp.blob();
                    const gps = await exifr.gps(pBlob);
                    if (gps) {
                        routeData.photoGeoms.push({
                            src: photoSrc,
                            coords: [gps.longitude, gps.latitude]
                        });
                    }
                } catch (e) { console.error("Exif parsing error for " + photoSrc, e); }
            })).then(() => {
                // Bulk render ONLY AFTER ALL photos are parsed to eliminate UI freeze/latency
                if (currentViewedRoute && currentViewedRoute.id === routeInfo.id) {
                    renderThumbnails(routeInfo);
                    renderPhotoMapMarkers(routeInfo);
                }
            });
        }

        parsedRouteDataCache[routeInfo.id] = routeData;

        // Queue GeoJSON Data for the Native Symbol Layer
        const feature = {
            type: 'Feature',
            properties: { id: routeInfo.id, future: routeInfo.future || false },
            geometry: { type: 'Point', coordinates: routeData.peakCoords }
        };

        routeFeatures.push(feature);

        // Robust function to append to source once initialized
        const updateSource = () => {
            const source = map.getSource('route-markers');
            if (source) {
                source.setData({
                    type: 'FeatureCollection',
                    features: routeFeatures
                });
            } else {
                setTimeout(updateSource, 50); // Keep polling until map exposes the source
            }
        };

        updateSource();
    } catch (error) {
        console.error("Error loading or parsing GPX:", error);
    }
}

function addRouteToMap(id, coordinates, color) {
    if (!map.getSource(id)) {
        map.addSource(id, {
            type: 'geojson',
            data: {
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                }
            }
        });

        map.addLayer({
            id: `layer-${id}`,
            type: 'line',
            source: id,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': color,
                'line-width': 3,
                'line-opacity': 0,
                'line-opacity-transition': { duration: 1000 }
            }
        });
    }

    setTimeout(() => {
        map.setPaintProperty(`layer-${id}`, 'line-opacity', 1);
    }, 50);
}

// Loads all listed routes dynamically and builds Menus + Carousel
document.addEventListener('DOMContentLoaded', () => {
    const desktopList = document.getElementById('desktop-tours-dropdown');
    const mobileList = document.getElementById('mobile-tours-list');
    const marqueeTrack = document.getElementById('marquee-track');
    const marqueeOuter = document.getElementById('route-carousel-outer');
    const carouselCards = [];

    const completedRoutes = Object.values(routes).filter(r => !r.future);
    const futureRoutes = Object.values(routes).filter(r => r.future);

    // Load all route data (non-blocking)
    Object.values(routes).forEach(route => loadRouteData(route));

    // ── Helpers ──────────────────────────────────────────────────────────────

    function menuBtn(route, isMobile) {
        const color = route.future ? '#FF8C00' : '#ff4d4d';
        const icon = route.future
            ? `<svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="${color}" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6H11.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"/></svg>`
            : `<svg style="width:14px;height:14px;flex-shrink:0" fill="none" stroke="${color}" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;
        const onclick = isMobile
            ? `document.getElementById('mobile-info').classList.add('hidden'); flyToRoute('${route.id}')`
            : `flyToRoute('${route.id}')`;
        const baseClass = isMobile
            ? 'flex items-center text-zinc-300 hover:text-white normal-case tracking-normal transition-colors text-left w-full gap-3'
            : 'flex items-center px-5 py-3 hover:bg-white/10 transition-colors text-left w-full text-zinc-300 hover:text-white normal-case tracking-normal border-b border-white/5 last:border-0 outline-none gap-3';
        return `<button onclick="${onclick}" class="${baseClass}">${icon}<span class="truncate">${route.name}</span></button>`;
    }

    function sectionHeader(label, isMobile) {
        return isMobile
            ? `<div class="text-[9px] text-zinc-500 mt-4 mb-2 tracking-widest uppercase border-b border-white/10 pb-1">${label}</div>`
            : `<div class="px-5 py-1.5 text-[9px] text-zinc-500 uppercase tracking-widest">${label}</div>`;
    }

    // ── Desktop Dropdown ──────────────────────────────────────────────────────
    if (desktopList) {
        desktopList.innerHTML =
            sectionHeader('Пройденные', false) +
            completedRoutes.map(r => menuBtn(r, false)).join('') +
            `<div class="mx-4 my-1 border-t border-white/10"></div>` +
            sectionHeader('Планируется', false) +
            futureRoutes.map(r => menuBtn(r, false)).join('');
    }

    // ── Mobile List ───────────────────────────────────────────────────────────
    if (mobileList) {
        mobileList.innerHTML =
            sectionHeader('Пройденные', true) +
            completedRoutes.map(r => menuBtn(r, true)).join('') +
            sectionHeader('Планируется', true) +
            futureRoutes.map(r => menuBtn(r, true)).join('');
    }

    // ── Carousel Cards ────────────────────────────────────────────────────────
    if (marqueeTrack) {
        [...completedRoutes, ...futureRoutes].forEach(route => {
            const coverPhoto = route.photos && route.photos.length > 0
                ? route.photos[Math.floor(Math.random() * route.photos.length)]
                : null;

            const card = document.createElement('div');
            card.className = 'carousel-card relative shrink-0 rounded-2xl overflow-hidden cursor-pointer border border-white/10 shadow-xl';
            card.style.cssText = 'width:176px;height:116px;';
            card.dataset.routeId = route.id;

            if (coverPhoto) {
                card.style.backgroundImage = `url('${coverPhoto}')`;
                card.style.backgroundSize = 'cover';
                card.style.backgroundPosition = 'center';
            } else {
                card.style.background = route.future
                    ? 'linear-gradient(140deg,#1a1500 0%,#2d2000 60%,#1a1000 100%)'
                    : 'linear-gradient(140deg,#1c1c2e 0%,#2a1a3e 60%,#111122 100%)';
            }

            const futureBadge = route.future ? `
                <div style="position:absolute;top:7px;right:7px;background:rgba(255,140,0,0.88);backdrop-filter:blur(6px);border-radius:5px;padding:2px 7px;display:flex;align-items:center;gap:3px;">
                    <svg style="width:8px;height:8px;flex-shrink:0" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6H11.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"/></svg>
                    <span style="color:#fff;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Plan</span>
                </div>` : '';

            const timeColor = route.future ? '#FFD700' : '#ff4d4d';
            card.innerHTML = `
                <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.2) 55%,transparent 100%)"></div>
                ${futureBadge}
                <div style="position:absolute;bottom:0;left:0;right:0;padding:10px 12px;">
                    <div style="color:#fff;font-size:11px;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 4px rgba(0,0,0,0.8)">${route.name}</div>
                    <div style="display:flex;align-items:center;gap:4px;margin-top:4px;">
                        <svg style="width:10px;height:10px;flex-shrink:0" fill="none" stroke="${timeColor}" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        <span style="color:#e4e4e7;font-size:10px;font-weight:500;">${route.overrideTime || '—'}</span>
                    </div>
                </div>
            `;

            carouselCards.push(card);
            marqueeTrack.appendChild(card);
        });

        // Duplicate for seamless infinite loop
        carouselCards.forEach(card => marqueeTrack.appendChild(card.cloneNode(true)));

        // ── Carousel: click delegation ────────────────────────────────────────
        let didDrag = false;
        marqueeTrack.addEventListener('click', (e) => {
            if (didDrag) { didDrag = false; return; }
            const card = e.target.closest('.carousel-card');
            if (card && card.dataset.routeId) flyToRoute(card.dataset.routeId);
        });

        // ── Carousel: wheel + drag scroll ─────────────────────────────────────
        let manualOffset = 0;
        let inManual = false;

        function getHalfWidth() { return marqueeTrack.scrollWidth / 2; }

        function enterManual() {
            if (inManual) return;
            const m = new DOMMatrix(getComputedStyle(marqueeTrack).transform);
            manualOffset = m.m41;
            marqueeTrack.style.animation = 'none';
            inManual = true;
        }

        function applyOffset() {
            const hw = getHalfWidth();
            while (manualOffset < -hw) manualOffset += hw;
            while (manualOffset > 0) manualOffset -= hw;
            marqueeTrack.style.transform = `translateX(${manualOffset}px)`;
        }

        if (marqueeOuter) {
            marqueeOuter.addEventListener('wheel', (e) => {
                e.preventDefault();
                enterManual();
                manualOffset -= (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.9;
                applyOffset();
            }, { passive: false });
        }

        let dragStartX = 0, dragBaseOffset = 0, isDragging = false;

        marqueeTrack.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            isDragging = true;
            didDrag = false;
            enterManual();
            dragStartX = e.clientX;
            dragBaseOffset = manualOffset;
            marqueeTrack.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            if (Math.abs(dx) > 4) didDrag = true;
            manualOffset = dragBaseOffset + dx;
            applyOffset();
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            marqueeTrack.style.cursor = '';
        });
    }
});
