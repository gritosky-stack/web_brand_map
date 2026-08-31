# Hiking Map iOS — Design Brief for Claude Design

> Last synced with code: **31 August 2026**. Everything below is read out of the
> repository, not from memory. Companion document: `hikingmap-map-palette.md`
> (Russian) — the full inventory of map-layer colours with widths and opacities.

---

## 1. App Overview

**Name:** TOTSKII Wild / Hiking Map (working title)
**Platform:** iOS 17.2+, SwiftUI, Mapbox Maps SDK 11.9
**Purpose:** Personal hiking journal *and* route planner for Serbia — an
interactive 3D satellite map with completed and planned routes, official trail
data, offline maps, route drawing, live tracking and a cinematic camera.
**Current state:** Well past MVP. 27 routes with GPX (18 completed, 9 planned),
plus user-drawn routes, official PSS trails, OSM trails, caves, water, shelters
and railways. Dark UI floating over a full-screen map.

---

## 2. Design System — "Obsidian Peak"

### 2.1 Interface colours

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#0A0A0A` | App background, darkest layer |
| `surface` | `#141414` | Cards, panels, bottom sheets |
| `surfaceRaised` | `#1C1C1C` | Elevated elements, stat cells, popovers |
| `accent` | `#FF5722` | Primary CTA, active states, scrubber, search pin |
| `completed` | `#FF4D4D` | Completed routes — dots, badges, lines |
| `planned` | `#FFD700` | Planned routes — dots, badges, lines |
| `textPrimary` | `#FFFFFF` | Headings, values |
| `textSecondary` | `rgba(255,255,255,0.55)` | Labels, metadata |
| `textTertiary` | `rgba(255,255,255,0.35)` | Hints, disabled |
| `border` | `rgba(255,255,255,0.08)` | Card borders, dividers |
| `borderFocus` | `rgba(255,255,255,0.18)` | Active / hovered borders |
| `glass` | `rgba(255,255,255,0.05)` | Glassmorphism fill |
| `glassHover` | `rgba(255,255,255,0.09)` | Pressed glass fill |

### 2.2 Difficulty scale

| Token | Hex | Meaning |
|---|---|---|
| `diffEasy` | `#4CAF50` | ≤10 km, ≤500 m ascent |
| `diffMedium` | `#FF9800` | 10–20 km or ≤1300 m |
| `diffHard` | `#F44336` | 20–30 km or ≤2500 m |
| `diffExpert` | `#9C27B0` | 30+ km or 2500+ m |

### 2.3 Grade scale (route colouring by steepness)

**One calculation feeds two places**: the route line on the map *and* the
elevation chart. Deliberately a continuation of the difficulty scale into
descent, not a separate colour language.

| Grade | Hex | |
|---|---|---|
| −25 % steep descent | `#2196F3` | `gradeDescentSteep` |
| −10 % gentle descent | `#00BCD4` | `gradeDescentGentle` |
| ±2 % flat | `#4CAF50` | = `diffEasy` |
| +8 % ascent | `#FF9800` | = `diffMedium` |
| +16 % steep | `#F44336` | = `diffHard` |
| +28 % very steep | `#9C27B0` | = `diffExpert` |

⚠️ **This is the open design question — see §4.**

### 2.4 Map pin colours

| Type | Hex | Glyph |
|---|---|---|
| Start | `#2ECC71` | `S` |
| Finish | `#E74C3C` | `F` |
| Loop (start = finish) | `#FF5722` | `↻` |
| Peak (highest point) | `#FFC107` | `▲` |
| Photo on track | `#33AAFF` | camera |
| Searched point / dropped camera | `#FF5722` | crosshair |
| Water cluster | `#298CD9` @72 % | droplet |
| Shelter cluster | `#9E6629` @72 % | tent |
| Cave cluster | `#3870D9` @70 % | count |

### 2.5 Paper topo palette

The satellite style is repainted into a printed-map look when the topo slider
moves right. Continuous blend — every colour must survive the midpoint too.

`#F2EFE6` paper · `#C8DCB4` wood · `#DAE5C7` scrub · `#E0ECCE` grass ·
`#EFEAD6` field · `#E0DDD8` rock · `#F2ECD9` sand · `#A3CEE3` water ·
`#FFFCF6` roads · `#A39C90` road casing · `#8B5A2B` trails ·
`#34312B` labels · `#8B7A8B` admin · `#1F1C18` railway (`railInk`)

### 2.6 Typography

| Role | Font | Size | Weight |
|---|---|---|---|
| Route name (detail panel) | SF Pro | 20 | Bold |
| Section header | SF Pro | 13 | Semibold |
| Stat value | SF Pro | 14–17 | Semibold / Bold |
| Stat label | SF Pro | 10 | Semibold, uppercase |
| Badge text | SF Pro | 9–11 | Bold |
| Body / description | SF Pro | 15 | Regular |
| Caption / hint | SF Pro | 11–12 | Regular |
| Numbers (coordinates, stats) | SF Pro, monospaced digits | 12–16 | Semibold |

### 2.7 Corner radii

`radiusS` 10 pt (stat cells, tags) · `radiusM` 16 pt (cards, chart container) ·
`radiusL` 22 pt (bottom sheets, panels) · pill 999 pt (buttons, badges)

### 2.8 Elevation

All shadows dark — `rgba(0,0,0,0.35–0.6)`. No white shadows anywhere.
Floating controls: `.ultraThinMaterial` over `rgba(10,10,10,0.55–0.75)`, 1 pt
border in `border`.

---

## 3. Map layers, bottom to top

The map is the product; everything else floats over it. Full colour, width and
opacity table: `hikingmap-map-palette.md`.

1. Base style (satellite or paper topo) · historical engraving · 3D terrain
2. Slope steepness raster → trail heatmap raster
3. **World mask** — black fill outside Serbia, 0.75 (0.96 with heatmap on)
4. Railways and station flags
5. OSM hiking trails
6. PSS official trails (casing → glow → line)
7. All-routes lines and user-drawn route lines
8. Route marker dots
9. **Open route** (casing → line → selected-segment highlight)
10. Live recorded track
11. Pins: start, finish, peak, photos
12. Elevation-profile scrubber dot

---

## 4. The problem to solve first

**With the heatmap, PSS trails, OSM trails and route dots switched on, you
cannot tell which line is the route the user just opened.**

Three causes, all documented with numbers in `hikingmap-map-palette.md`:

1. **The open route has no identifying colour.** It is painted with the grade
   scale, and every hue in that scale is already taken by something else on the
   same map — orange is PSS, green is OSM, red is completed, purple is
   user-drawn, blue is descent.
2. **There is rank by type, not by role.** The three roles — *the thing you
   opened*, *context you switched on*, *background* — all render at similar
   saturation and similar widths (2.2–4.5 pt). Colour carries the entire load;
   width, opacity, casing and halo barely differ. Today the *background* PSS
   layer has a glow and the open route does not.
3. **Fourteen hues in frame**, plus two rasters whose colours we do not control.

**The fork to decide:** keep the grade scale on the map line (and suppress
everything around it), or give the open route one identity colour and leave
grade colouring to the elevation chart, where it reads better because there is
an axis.

---

## 5. Screens and surfaces

### Map (home)
Full-screen map, always underneath everything.

- **Top row** — filter segmented control: "Все" / "Пройденные" / "Планы" /
  "Мои"; total distance badge.
- **Tools row** — base map switcher ("Карта"), layers panel ("Слои"),
  "Поиск" (coordinates), GPX import, "Нарисовать" (route constructor).
- **Bottom left** — "Zoom Out" / "Zoom In" (to route), orbit toggle, flyover
  speed multiplier.
- **Bottom centre** — historical-map opacity slider (optional, same row).
- **Bottom right** — my location, camera-drop handle.
- **Bottom** — route card carousel, or the route detail panel when one is open.
- Download progress strip sits above the bottom card while tile sets download.

### Layers panel ("Слои")
Toggles: OSM trails · PSS trails · caves · water · shelters · railways ·
trail heatmap · slope steepness · historical map (+ opacity slider) ·
topo base slider · all trails · offline maps · account.

### Route detail panel (bottom sheet)
Drag handle · type badge + date · route name · close · tabs "Инфо" / "Фото" ·
stats grid · difficulty bar · **elevation profile chart** · description ·
Instagram link. Swipe down to collapse — the panel stays alive when collapsed.

### Elevation profile chart
One shared component for all three route kinds. Drag to scrub (readout bar
appears, UI above fades, map follows), double-tap-and-drag to select a segment
(highlights the real route line on the map and flies the camera to it), pinch
to zoom the X axis. X axis is in kilometres by distance, not point index.

### Other surfaces
Fullscreen photo viewer (paged horizontal scroll, swipe down to dismiss,
"На трек" when the photo has GPS) · point card (searched or long-pressed
coordinate: elevation, slope, aspect, nearest settlement / water / shelter /
route) · coordinate search sheet (formats + last 5 queries) · route constructor
(aim reticle, step button, undo/redo, snap toggle) · live-track HUD · offline
maps · account sheet · AI assistant · cave and POI cards.

### First-person view ("обзор с точки")
Drag the camera handle onto the map — the camera lands on the terrain at
eye height. Almost all UI hides; only the scale bar, compass, "Карта"/"Слои",
the camera handle, a swipe/gyroscope control toggle and "Выйти из обзора"
remain. Swipes or phone rotation turn the view.

### Cinematic camera
"Облёт" flies along the trail with a marker running under the camera; orbit
circles the route keeping it framed. Speed multiplier ×0.5…×3.

---

## 6. Component inventory

**Map graphics** — route marker dot · start / finish / loop / peak pins ·
photo pin · searched-point pin · dropped-camera pin · scrubber dot ·
POI clusters (water, shelter, cave) · station flags · constructor waypoints
and aim reticle.

**Controls** — filter segmented pill · distance badge · glass icon button ·
labelled capsule button · toggle row · opacity slider · speed multiplier chip ·
close button · drag handle.

**Data display** — stat cell · stats grid · difficulty bar · elevation chart ·
scrubber readout bar · route card (carousel) · route list row · point card
tiles · nearby list · download progress strip.

---

## 7. Feature set

### Shipped
Interactive 3D satellite map (Serbia bounds, terrain always on) · 27 GPX routes ·
four-way filter · route detail panel · stats and difficulty · interactive
elevation chart with scrub, segment selection and pinch zoom · grade colouring
of line and chart · photo gallery + fullscreen viewer + GPS photo pins ·
PSS official trails · OSM trails from vector tiles · caves, water, shelters ·
railways and station flags · trail heatmap · slope steepness raster ·
historical Austro-Hungarian map with opacity slider · paper topo base ·
offline maps and tile-set downloads · route constructor with trail snapping and
offline routing · track recording · accounts and cloud sync (Supabase) ·
AI assistant · coordinate search and point card · long-press point card ·
first-person terrain view with swipe and gyroscope control · flyover and orbit
camera · my location with follow / heading modes.

### Next
Route colour system (this brief's §4) · search by name and object ·
reviews · Live Activities · share route card · route comparison.

---

## 8. What to design now

### Priority 1 — the route colour system (§4)
1. **Legend sheet** — every line in scale, on both bases (dark satellite and
   paper), with the proposed widths, opacities, casings and halos.
2. **Before / after** — one map frame with an open route, heatmap, PSS and OSM
   all switched on. This is the frame the whole exercise exists for.
3. **Token table** ready to paste into `DesignTokens.swift`: entity · role tier
   · hex on satellite · hex on paper · width pt · opacity · casing · halo.
4. **Dim rule** — what fades and by how much when a route is open.
5. **Pins** — twelve circle types today; how many are needed, which differ by
   colour and which by shape or glyph.
6. **Colour-blind check** — red and green currently carry two different
   meanings each (completed vs OSM trails, and the difficulty scale).

### Priority 2
Layers panel information design (thirteen toggles in one list) ·
first-person mode chrome · point card ·
cinematic-mode controls (they currently crowd the bottom row).

### Priority 3
Loading and empty states · onboarding for the camera-drop gesture.

---

## 9. Design principles

1. **Map first.** UI never competes with the map. Overlays are dark glass at low
   opacity, and they get out of the way during scrub, flyover and first-person.
2. **Rank by role, not by type.** What the user opened outranks what they
   switched on, which outranks the background. This is the principle §4 exists
   to enforce.
3. **Colour discipline.** Fewer hues used decisively beats more hues used
   politely. Red = completed, gold = planned, orange accent used sparingly —
   never mix these roles.
4. **Redundant encoding.** Where colour carries meaning, back it with shape,
   glyph or width. Half of the map is looked at in sunlight on a phone.
5. **Data density.** Stats are compact but readable; no wasted whitespace.
6. **Motion with a reason.** Spring animations for UI, cinematic easing for the
   camera (1.2–1.6 s). Nothing animates just to animate.
7. **Night-friendly.** Pure black ground, no bright whites outside active
   elements. The app should be usable at night in the mountains.
8. **Touch targets.** Minimum 44 pt for anything interactive over the map.
