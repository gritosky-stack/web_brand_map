/* ────────────────────────────────────────────────────────────────
 * pss_layer.js — draws a selected PSS route on the map (no external links)
 *
 * Lazily loads pss_routes_web.geojson (slim 2D geometry for all 289 PSS
 * routes), and exposes window.showPSSRoute(slug): draws that route on the
 * Mapbox map, fits the view to it, and shows an in-app popup with stats.
 *
 * Depends on: window.map (set in script.js), global mapboxgl.
 * Loaded after script.js, before/after assistant.js (only defines a global).
 * ──────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var DATA_URL = 'pss_routes_web.geojson';
  var loaded = false, loading = null;
  var bySlug = {};
  var popup = null;

  function ensureData() {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    loading = fetch(DATA_URL)
      .then(function (r) { return r.ok ? r.json() : { features: [] }; })
      .then(function (gj) {
        (gj.features || []).forEach(function (f) {
          if (f.properties && f.properties.slug) bySlug[f.properties.slug] = f;
        });
        loaded = true;
      })
      .catch(function () { loaded = true; });
    return loading;
  }

  function flatten(geom) {
    if (geom.type === 'LineString') return geom.coordinates;
    if (geom.type === 'MultiLineString') return [].concat.apply([], geom.coordinates);
    return [];
  }

  function boundsOf(coords) {
    var b = [[180, 90], [-180, -90]];
    coords.forEach(function (c) {
      if (c[0] < b[0][0]) b[0][0] = c[0];
      if (c[1] < b[0][1]) b[0][1] = c[1];
      if (c[0] > b[1][0]) b[1][0] = c[0];
      if (c[1] > b[1][1]) b[1][1] = c[1];
    });
    return b;
  }

  function ensureLayers(map) {
    if (map.getSource('pss-selected')) return;
    map.addSource('pss-selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'pss-selected-casing', type: 'line', source: 'pss-selected',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#06283b', 'line-width': 7, 'line-opacity': 0.55 }
    });
    map.addLayer({
      id: 'pss-selected-line', type: 'line', source: 'pss-selected',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#34AADF', 'line-width': 4, 'line-opacity': 0.95 }
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function popupHTML(p) {
    var stats = [];
    if (p.distance_km) stats.push('↔ ' + p.distance_km + ' км');
    if (p.ascent_m) stats.push('↑ ' + p.ascent_m + ' м');
    if (p.duration_h) stats.push('⏱ ' + p.duration_h + ' ч');
    return '<div style="font:13px/1.45 system-ui,sans-serif;color:#fff;min-width:160px">'
      + '<div style="font-weight:600;margin-bottom:4px">' + esc(p.name) + '</div>'
      + (stats.length ? '<div style="color:#9ca3af;font-size:11px">' + stats.join('  ') + '</div>' : '')
      + (p.mountain ? '<div style="color:#9ca3af;font-size:11px;margin-top:2px">' + esc(p.mountain) + '</div>' : '')
      + '<div style="margin-top:6px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#52c1f4">PSS маршрут</div>'
      + '</div>';
  }

  function show(slug) {
    var map = window.map;
    if (!map) return;
    ensureData().then(function () {
      var f = bySlug[slug];
      if (!f) return;
      var run = function () {
        ensureLayers(map);
        map.getSource('pss-selected').setData(f);
        var flat = flatten(f.geometry);
        if (!flat.length) return;
        map.fitBounds(boundsOf(flat), {
          padding: { top: 90, bottom: 130, left: 60, right: 60 },
          duration: 1200, maxZoom: 14
        });
        var mid = flat[Math.floor(flat.length / 2)];
        if (popup) popup.remove();
        popup = new mapboxgl.Popup({ offset: 12, closeButton: true, className: 'custom-hover-popup' })
          .setLngLat(mid).setHTML(popupHTML(f.properties || {})).addTo(map);
      };
      if (map.isStyleLoaded()) run(); else map.once('load', run);
    });
  }

  // Hide the PSS overlay (e.g. when a curated route is opened)
  function clear() {
    var map = window.map;
    if (popup) { popup.remove(); popup = null; }
    if (map && map.getSource('pss-selected')) {
      map.getSource('pss-selected').setData({ type: 'FeatureCollection', features: [] });
    }
  }

  window.showPSSRoute = show;
  window.clearPSSRoute = clear;
})();
