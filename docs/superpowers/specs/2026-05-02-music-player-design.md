# Music Player Demo Design

## Goal

Build a single-file HTML/CSS/JavaScript demo of a Claudio FM-inspired music player card. The first version is a fake player: no real audio files, but the UI should behave convincingly through simulated playback, seek, transcript syncing, and track switching.

## Scope

This first version includes:

- One centered player card on a dark background
- Animated waveform area with playback status
- Track metadata display
- Clickable playback progress bar
- Play/pause, previous, next controls
- Shuffle and repeat toggles
- Clickable volume bar and mute toggle
- Scrollable transcript with active-line highlighting
- Three built-in sample tracks:
  - Blinding Lights
  - Save Your Tears
  - Starboy

This first version does not include:

- Real audio playback
- External APIs
- Persistence of settings
- Playlist management beyond previous/next/shuffle
- Responsive multi-panel layouts

## Recommended Approach

Use a hybrid demo shell:

- Render the experience as a polished fake player driven by in-memory track data.
- Separate the playback state controller from the DOM rendering code.
- Keep timing, progress, transcript syncing, and track transitions behind a small controller API.

This gives us a fast demo now and a clean upgrade path later when we replace simulated time with a real `<audio>` element.

## Architecture

### 1. Static Shell

Create a single `index.html` entry point that contains:

- The card layout markup
- Inline or linked CSS for the visual system
- Linked JavaScript for interactivity

The layout should be divided into three zones:

- Waveform header
- Player controls and metadata
- Transcript panel

### 2. Track Data Model

Represent each demo track as a JavaScript object with:

- `id`
- `title`
- `artist`
- `album`
- `duration`
- `waveform`
- `transcript`
- `accent`

`waveform` is an array of normalized heights for visual bars.

`transcript` is an array of line objects:

- `time`
- `text`

This allows seek, active-line lookup, and per-track rendering without touching the playback engine.

### 3. Playback Controller

Use a small stateful controller object responsible for:

- Current track index
- Current playback time
- Playing/paused state
- Shuffle on/off
- Repeat on/off
- Volume level
- Muted state

The controller should expose actions such as:

- `togglePlay()`
- `seekTo(seconds)`
- `setTrack(index)`
- `nextTrack()`
- `prevTrack()`
- `toggleShuffle()`
- `toggleRepeat()`
- `setVolume(value)`
- `toggleMute()`

Internally, simulated playback should advance based on elapsed time while the player is in the playing state.

### 4. Rendering Layer

The rendering code should:

- Paint waveform bars using current progress
- Update the status pill text and style
- Update progress bar fill and time labels
- Render transcript lines
- Highlight the current transcript line
- Auto-scroll the transcript so the active line remains visible
- Reflect toggle button states
- Reflect volume state and mute state

The rendering layer should read from state and avoid embedding business logic directly in click handlers where possible.

## Interaction Design

### Waveform and Progress

- Clicking the waveform header or progress bar seeks to the corresponding timestamp.
- Played bars should appear brighter or accented, while unplayed bars stay dim.
- The progress handle should move smoothly while playing.

### Play/Pause

- Clicking play starts the simulated clock.
- Clicking pause freezes progress exactly at the current timestamp.
- The status pill switches between `Paused` and `Playing`.

### Previous / Next

- Previous jumps to the prior track in normal order.
- Next advances to the next track in normal order.
- At the boundaries:
  - Without repeat, wrap to the opposite end for a smoother demo flow.
  - With repeat, continue to behave the same at track-switch level, while track-end repeat restarts the current song.

### Shuffle

- Shuffle toggles on/off visually.
- When enabled, `next` chooses a different random track than the current one.
- `prev` should still move backward through normal order in the first version to keep logic understandable.

### Repeat

- Repeat toggles on/off visually.
- If repeat is off and playback reaches the end, pause at the end state.
- If repeat is on and playback reaches the end, restart the current track and continue playing.

### Transcript

- Each transcript line is clickable and seeks to that timestamp.
- The active transcript line is highlighted with stronger contrast and a subtle background.
- The transcript panel auto-scrolls as playback advances so the current line remains in view.

### Volume

- Clicking the volume bar sets volume from `0` to `1`.
- Clicking the speaker icon toggles mute.
- Muting should preserve the previous volume value so unmute restores it.
- In the fake demo, volume affects UI state only, not sound output.

## Visual Design

The visual style should stay close to the provided reference without copying it mechanically:

- Deep navy/black background
- Large rounded card with soft border and subtle glow
- Dim lavender/gray body text
- Bright near-white title text
- Teal playback status dot
- Purple accent for selected toggles, progress, and active states

Styling details:

- Waveform area should feel slightly inset from the card body
- Controls should use rounded square buttons with thin borders
- Transcript rows should have clean separators and soft hover feedback
- Typography should feel modern and editorial rather than default browser UI

## File Structure

For the first version:

- `index.html`
- `styles.css`
- `script.js`

Keep the structure intentionally simple for easy local preview.

## Error Handling

Even in a demo, basic safeguards should be present:

- Clamp seek positions to `0..duration`
- Clamp volume to `0..1`
- Ignore invalid transcript or track indexes
- Handle empty transcript arrays gracefully
- Handle empty waveform arrays by rendering a fallback visual state

## Testing Strategy

Manual verification is sufficient for the first version.

Required checks:

- Play/pause updates time and status correctly
- Clicking waveform seeks correctly
- Clicking progress bar seeks correctly
- Clicking transcript lines jumps and highlights correctly
- Next/previous changes track content correctly
- Shuffle and repeat toggle correctly
- Track-end behavior works with repeat on and off
- Volume and mute state update correctly
- Transcript auto-scroll follows playback

## Upgrade Path

The next phase should replace the simulated clock with a real `<audio>` element while preserving:

- The same track data model
- The same controller action names
- The same render pipeline

That future step should only require swapping the time source and event wiring, not redesigning the UI structure.
