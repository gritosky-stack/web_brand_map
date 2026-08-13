# Hiking Map iOS — Design Brief for Claude Design

## 1. App Overview

**Name:** Hiking Map (рабочее название)  
**Platform:** iOS 17+, SwiftUI  
**Purpose:** Personal hiking journal + route planner for Serbia. Shows completed and planned hiking routes on an interactive 3D satellite map. Designed to eventually surpass AllTrails and Wikiloc in UX quality.  
**Current state:** Working MVP — map with route markers, route detail panel, elevation chart, photo gallery.

---

## 2. Design System — "Obsidian Peak"

### Colors

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#0A0A0A` | App background, darkest layer |
| `surface` | `#141414` | Cards, panels, bottom sheets |
| `surfaceRaised` | `#1C1C1C` | Elevated elements (popovers) |
| `accent` | `#FF5722` | Primary CTA, active states, chart lines |
| `completed` | `#FF4D4D` | Completed route dots and badges |
| `planned` | `#FFD700` | Planned route dots and badges |
| `textPrimary` | `#FFFFFF` | Headings, values |
| `textSecondary` | `rgba(255,255,255,0.55)` | Labels, metadata |
| `textTertiary` | `rgba(255,255,255,0.35)` | Hints, disabled |
| `border` | `rgba(255,255,255,0.08)` | Card borders, dividers |
| `borderFocus` | `rgba(255,255,255,0.18)` | Active/hovered borders |
| `glass` | `rgba(255,255,255,0.05)` | Glassmorphism fill |
| `diffEasy` | `#4CAF50` | Difficulty badge |
| `diffMedium` | `#FF9800` | Difficulty badge |
| `diffHard` | `#F44336` | Difficulty badge |
| `diffExpert` | `#9C27B0` | Difficulty badge |

### Pin Colors (map markers)
| Type | Color | Label |
|---|---|---|
| Start | `#2ECC71` (green) | S |
| Finish | `#E74C3C` (red) | F |
| Loop | `#FF5722` (orange) | L |
| Peak | `#FFC107` (gold) | ▲ |

### Typography

| Role | Font | Size | Weight |
|---|---|---|---|
| Route name (detail panel) | SF Pro | 20 | Bold |
| Section header | SF Pro | 13 | Semibold |
| Stat value | SF Pro | 14 | Bold |
| Stat label | SF Pro | 10 | Regular |
| Badge text | SF Pro | 9–10 | Bold |
| Body / description | SF Pro | 15 | Regular |
| Caption / hint | SF Pro | 11 | Regular |
| Monospaced number | SF Pro Mono | 12 | Semibold |

### Corner Radii
- Small: 10pt (stat cells, tags)
- Medium: 16pt (cards, chart container)
- Large: 22pt (bottom sheet, detail panel)
- Pill: 999pt (filter bar, badges)

### Elevation / Shadows
All dark — no white shadows. Use `rgba(0,0,0,0.4–0.6)` for map pins and floating elements.

---

## 3. App Architecture (Screens)

### Screen 1 — Map (Home)
The full-screen map is always visible underneath everything.

**Top bar** (floating, blurred glass pill):
- Left: Filter segmented control — "Все" / "Пройденные" / "Планы"
- Right: Total distance badge — `🥾 847 км`

**Map layer:**
- Mapbox Satellite Streets style
- 3D terrain (1.1× exaggeration)
- Dark overlay mask on non-Serbia countries
- Route markers: pulsing dots (red = completed, gold = planned)
- When route selected: colored route line + Start (S) / Finish (F) / Peak (▲) pins

**Bottom — no route selected:**
- Horizontal carousel of route cards (scrolls left/right)
- Blurred dark background strip

**Bottom — route selected:**
- Route Detail Panel slides up from bottom (max 65% screen height)
- Swipe down to close

---

### Screen 2 — Route Detail Panel (bottom sheet)

**Header:**
- Drag handle (pill) at top
- Route type badge (ПРОЙДЕН / ПЛАН) + date
- Route name (large bold)
- X close button (circle)

**Tab bar:**
- "Инфо" / "Фото" — underline indicator in accent orange

**Info tab content (scrollable):**
1. Stats grid (2×3):
   - Distance, Ascent ↑, Descent ↓
   - Max elevation, Min elevation, Duration
2. Difficulty bar (linear progress, colored by difficulty)
3. Elevation profile chart (interactive — drag finger → cursor moves + map marker follows)
4. Description (collapsible after 5 lines)
5. Instagram link button (gradient purple→pink)

**Photos tab content:**
- 3-column image grid
- Tap → fullscreen viewer

---

### Screen 3 — Fullscreen Photo Viewer

- Pure black background
- Full-screen image (pinch to zoom, swipe left/right between photos)
- Swipe down to dismiss
- Top: `X` close button + photo counter (`2 / 8`)
- Bottom (if photo has GPS): "На карте" button — flies map to photo location

---

### Screen 4 — Route Card (carousel item)

Width: 185pt. Content:
- Type badge + date (top row)
- Route name (2-line max)
- Divider
- Stats: distance / ascent / duration (vertical layout, icon → value → unit)
- Difficulty dot + label (bottom)

Border color matches route type (red for completed, gold for planned, 22% opacity).

---

## 4. Component Inventory

### Map Pins
1. **Route marker dot** — pulsing soft glow circle (red/gold), 44pt tap target, white ring
2. **Start pin** — green circle with white "S", drop shadow, pin tail pointing down
3. **Finish pin** — red circle with white "F", same treatment
4. **Loop pin** — orange circle with "L" (for circular routes where start=finish)
5. **Peak pin** — gold circle with "▲", for highest elevation point
6. **Photo pin** — white/grey camera icon circle (future — marks photos with GPS)
7. **Scrubber dot** — orange dot that moves along route when dragging elevation chart

### UI Components
1. **Filter pill** — segmented glass control, active segment = white fill + black text
2. **Stat badge** — total km counter, glass pill with orange hiker icon
3. **Stat cell** — dark glass card with icon / value / label (3×2 grid)
4. **Difficulty bar** — capsule track + colored fill + label
5. **Elevation chart** — Swift Charts area+line, interactive drag scrubber
6. **Route card** — 185pt wide dark glass card, colored border
7. **Tab bar** — plain text tabs, orange underline indicator
8. **Type badge** — pill with colored border and text (ПРОЙДЕН/ПЛАН)
9. **Instagram button** — purple→pink gradient, rounded 16pt
10. **Photo grid cell** — square thumbnail with fill, 3-column
11. **Photo fullscreen** — paged TabView, drag-to-dismiss
12. **Close button** — circle, glass fill, white X icon

---

## 5. Navigation Flow

```
App Launch
    └── Map Screen (always visible underneath)
            ├── Carousel visible (no route selected)
            │       └── Tap card → Route Detail Panel opens
            ├── Tap map marker → Route Detail Panel opens
            └── Route Detail Panel
                    ├── Info tab
                    │       └── Drag elevation chart → scrubber moves on map
                    ├── Photos tab
                    │       └── Tap photo → Fullscreen Viewer
                    │               └── "На карте" button (if GPS) → fly map to photo
                    └── Swipe down / X → close panel, return to carousel
```

---

## 6. Full Feature Set

### Currently Working
- Interactive 3D satellite map (Mapbox, Serbia bounds locked)
- 10 completed + 8 planned routes with GPX data
- Route markers on map (pulsing red/gold dots)
- Filter: All / Completed / Planned (affects both carousel AND map markers)
- Tap marker OR carousel card → opens route detail
- Camera flies to route with proper padding above bottom panel
- Route line drawn on map (colored per type)
- Start / Finish / Peak pins on map
- Stats grid (distance, ascent, descent, elevation min/max, duration)
- Difficulty calculation and bar
- Interactive elevation chart with drag scrubber → moves marker on map
- Photo gallery (3-column grid)
- Fullscreen photo viewer (swipe between photos, drag down to dismiss)
- Dark theme, Obsidian Peak design system

### Planned / In Progress
- **Photo GPS markers** — extract EXIF coordinates from photos in bundle, show camera-icon pins on route, "На карте" button in fullscreen viewer
- **Reviews (Firebase)** — star rating + text reviews per route, stored in Firestore
- **Offline mode** — cache tiles and GPX for offline use (Mapbox offline packs)
- **Live Activities** — during active hike, show distance + elevation on Dynamic Island
- **Haptic feedback** — impact on route select, success on goal reached
- **Share route** — share screenshot with route stats overlay
- **Route comparison** — side-by-side stats for two routes
- **Personal best** — track personal records per route

---

## 7. What to Design in Claude Design

### Priority 1 — Core Screens (needed now)
1. **Map screen** — full layout with top bar + carousel strip at bottom
2. **Route detail panel** — info tab with all sections
3. **Route card** — carousel item
4. **Fullscreen photo viewer** — with controls

### Priority 2 — Components
5. **Map pins** — all 5 types (start, finish, loop, peak, photo)
6. **Route marker dot** — the pulsing circle on map
7. **Filter + km badge** — top bar elements
8. **Elevation chart** — with scrubber cursor

### Priority 3 — Empty / Loading States
9. **Loading state** — card skeleton / spinner
10. **Empty filter** — no routes match filter
11. **No photos** — empty photos tab

---

## 8. Design Principles

1. **Map first** — UI never competes with the map. All overlays are glass/dark with low opacity.
2. **Data density** — stats are compact but readable. No wasted whitespace in cards.
3. **Motion** — spring animations everywhere. Camera animations are cinematic (1.4s ease).
4. **Colour discipline** — accent orange (#FF5722) is used sparingly. Red = completed, gold = planned. Never mix these roles.
5. **Night-friendly** — pure black background (#0A0A0A), no bright whites outside active elements. The app should look beautiful at night in the mountains.
6. **Touch targets** — minimum 44pt for all interactive elements on the map.
