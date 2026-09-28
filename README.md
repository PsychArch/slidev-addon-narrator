# slidev-addon-narrator

[![NPM version](https://img.shields.io/npm/v/slidev-addon-narrator?color=3AB9D4&label=)](https://www.npmjs.com/package/slidev-addon-narrator)

A [Slidev](https://github.com/slidevjs/slidev) addon that automatically plays audio files associated with slides.

## Installation

```bash
npm install slidev-addon-narrator
```

## Configuration

Define this package into your slidev addons.

In your slides metadata (using frontmatter):
```
---
addons:
  - slidev-addon-narrator
---
```

Or in your `package.json`:
```json
{
  "slidev": {
    "addons": [
      "slidev-addon-narrator"
    ]
  }
}
```

## Usage

1. Create a `manifest.json` file in the public directory of your Slidev project with the following structure:

```json
{
    "1": ["/audio/slide1-intro.mp3"],
    "2": ["/audio/slide2-part1.mp3", "/audio/slide2-part2.mp3"],
    "3": ["/audio/slide3.mp3"]
}
```

The keys are slide numbers (1-based), and the values are arrays of audio file paths that will be played sequentially when the slide is shown.

Paths starting with `/` are resolved against your deck's `base`, so decks deployed under a sub-path (e.g. `slidev build --base /my-deck/` for GitHub Pages) work without changing the manifest. Relative paths and full URLs are used as-is.

2. Add your audio files to the `public` directory of your Slidev project.

3. Add the addon to your Slidev presentation by importing it in a `global-top.vue` file in your Slidev project:

```vue
<template>
    <Narrator />
</template>
```

Mount `<Narrator />` once, in `global-top.vue`, rather than inside individual slides. If it is mounted more than once, only the first instance plays audio.

4. Browsers block audio until the user interacts with the page, so an **Enable Audio Narration** button is shown in the bottom-right corner. Click it once to start narration.

Narration only plays in the main presentation view. It stays silent (and shows no button) in presenter view, the notes view, print/export mode and embedded previews, so opening the presenter window alongside the audience window does not play audio twice.

## Components

### Narrator

Component that automatically plays audio files for slides:

```vue
<Narrator 
    manifestPath="/custom-path/audio-manifest.json" 
    :autoplay="true" 
    :volume="0.8"
    :preloadNext="true"
    :debug="true"
/>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `manifestPath` | String | `/manifest.json` | Path to the audio manifest file |
| `autoplay` | Boolean | `true` | Whether to automatically play audio when slides change. When `false`, use `playCurrentSlideAudio()` to start narration manually |
| `volume` | Number | `1.0` | Audio volume (between 0 and 1) |
| `preloadNext` | Boolean | `true` | Preload audio for the next slide |
| `debug` | Boolean | `false` | Show debug overlay (including manifest load errors) for troubleshooting |

## Advanced Usage

You can access the Narrator component's methods using a template ref:

```vue
<template>
    <Narrator ref="narrator" />
    
    <button @click="narrator.pauseAudio()">Pause</button>
    <button @click="narrator.resumeAudio()">Resume</button>
</template>

<script setup>
import { ref } from 'vue'

const narrator = ref(null)
</script>
```

Available methods:
- `playCurrentSlideAudio()` - Play audio for the current slide from the beginning (also enables audio, and works when `autoplay` is `false`)
- `pauseAudio()` - Pause the currently playing audio
- `resumeAudio()` - Resume the paused audio
- `stopAudio()` - Stop narration for the current slide
- `enableAudio()` - Enable audio playback (same as clicking the button)

Exposed state: `isPlaying`, `audioEnabled`, `debugMessages`.

## Features

- Automatically plays audio files when slides are shown
- Supports multiple audio files per slide that play sequentially
- Automatically pauses audio when navigating to another slide
- Audio preloading for better performance
- Volume control
- Minimal UI: a one-time button to enable audio, plus an optional debug overlay
- Plays only in the main presentation view (not presenter, notes, or export)
- Respects the deck's base path
- Manual playback control through exposed methods

## License

MIT 