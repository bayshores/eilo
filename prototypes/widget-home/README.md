# eïlo widget Home

A standalone, sample-data prototype. The agent application is separate until the next integration milestone.

## Run

Requires Node 20 or newer, with no package installation.

```sh
npm start
```

Open <http://127.0.0.1:41973/>. The server binds only to loopback and serves an allowlist of prototype files. `EILO_PROTO_PORT` selects another local port. Stop with Ctrl+C.

## Interactions

- Approach the left edge or activate its handle to reveal navigation. Home reclaims the space when it closes. Settings can pin it or reduce motion.
- Press and hold a non-interactive area of a widget to rearrange it. Then drag its body or grip. Edit home remains a discoverable keyboard alternative.
- Drag the bottom-right grip to resize directly, even outside edit mode. Arrow keys work when that grip is focused. No size menu is required.
- Add widgets with a sensible initial footprint. Remove circles appear inside the cards while editing. Removing a view keeps its contents; Undo restores the preceding layout.
- Home stays within its window. Extra views remain in More widgets, where Show on Home brings one forward.
- Layout, optional note and profile preferences use separate browser storage. Custom dimensions and responsive arrangements survive reloads.

## Boundaries

Agenda, goal, progress and conversation content are fixtures. Chat is a visual preview, not connected inference. The profile is browser-local, not authentication. No accounts, sensors or activity sources are connected. Clock uses local time; Notes is an optional scratchpad shared by its instances. Desktop window controls, menu bar and Dock are presentation elements.

## Verification

`npm test` passes 15 model/gesture tests covering collisions, bounded layouts, malformed/empty state, persistence, responsive dimensions, hold activation and cancellation.

Browser checks cover the collapsing sidebar, direct corner resizing outside edit mode, Undo, persisted dimensions, the overflow drawer, page bounds and fully visible remove controls. Earlier checks covered add/search, keyboard movement, content retention, empty Home, preferences and responsive rendering.

The browser controller cannot hold a mouse button down for a chosen duration. A short stationary press was checked in the browser; sustained activation and cancellation were tested in the timing model. Physical long-press behavior still needs hands-on review. These checks do not establish comprehensive accessibility, touch-device, cross-browser or agent behavior.

`layout.js` owns layout metadata, `hold.js` the hold recognizer, and `fixtures.js` frozen content. `app.js` connects interactions and storage. `index.html`/`styles.css` define the interface. The generated coastline in `assets/wallpaper.png` is the only raster asset.
