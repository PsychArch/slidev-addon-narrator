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

2. Add your audio files to the `public` directory of your Slidev project.

3. Add the addon to your Slidev presentation by importing it in a `global-top.vue` file in your Slidev project:

```vue
<template>
    <Narrator />
</template>
```

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
| `autoplay` | Boolean | `true` | Whether to automatically play audio when slides change |
| `volume` | Number | `1.0` | Audio volume (between 0 and 1) |
| `preloadNext` | Boolean | `true` | Preload audio for the next slide |
| `debug` | Boolean | `true` | Show debug overlay for troubleshooting |

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
- `playCurrentSlideAudio()` - Play audio for the current slide
- `pauseAudio()` - Pause the currently playing audio
- `resumeAudio()` - Resume the paused audio

## Features

- Automatically plays audio files when slides are shown
- Supports multiple audio files per slide that play sequentially
- Automatically pauses audio when navigating to another slide
- Audio preloading for better performance
- Volume control
- No visible UI components (works silently in the background)
- Manual playback control through exposed methods

## License

MIT 