<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useNav } from '@slidev/client'

// Define the audio manifest interface (JSON object keys are always strings)
interface AudioManifest {
    [slideNumber: string]: string[]
}

// Define component props
const props = defineProps({
    manifestPath: {
        type: String,
        default: '/manifest.json'
    },
    autoplay: {
        type: Boolean,
        default: true
    },
    volume: {
        type: Number,
        default: 1.0
    },
    preloadNext: {
        type: Boolean,
        default: true
    },
    debug: {
        type: Boolean,
        default: false
    }
})

// State variables
const nav = useNav()
const { currentPage, total } = nav
const manifest = ref<AudioManifest>({})
const preloadedAudios = new Map<string, HTMLAudioElement>()
let currentAudio: HTMLAudioElement | null = null
// Incremented whenever playback is stopped, so callbacks from an older sequence are ignored
let sequenceId = 0
const isPlaying = ref(false)
const loadedManifest = ref(false)
const loadError = ref<string | null>(null)
const debugMessages = ref<string[]>([])
const audioEnabled = ref(false)

// Shared across all Narrator instances so only one of them plays audio,
// even if the component is mounted more than once (e.g. in global-top.vue and in a slide)
const OWNER_KEY = '__slidevNarratorActiveOwner'
const globalState = globalThis as typeof globalThis & { [OWNER_KEY]?: symbol | null }

// Only narrate in the main play view: not in presenter view, notes view, print/export or embedded previews
const ownerToken = Symbol('slidev-narrator')
const isOwner = ref(false)
const isPlayView = computed(() =>
    (nav.isPlaying?.value ?? true)
    && !(nav.isPrintMode?.value ?? false)
    && !(nav.isEmbedded?.value ?? false)
)
const isActive = computed(() => isOwner.value && isPlayView.value)

// Add debug logger
const log = (message: string) => {
    if (props.debug) {
        console.log(`[Slidev Narrator] ${message}`)
        debugMessages.value.push(message)
        // Keep only last 10 messages
        if (debugMessages.value.length > 10) {
            debugMessages.value.shift()
        }
    }
}

// Prefix root-relative paths with the deck's base URL so decks deployed under a sub-path work
const resolvePath = (path: string) => {
    if (!path.startsWith('/') || path.startsWith('//')) {
        return path
    }
    const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')
    if (!base || path === base || path.startsWith(`${base}/`)) {
        return path
    }
    return `${base}${path}`
}

const getSlideAudio = (slideNumber: number) => manifest.value[String(slideNumber)] ?? []

// Load the manifest file
const loadManifest = async () => {
    try {
        loadError.value = null
        const url = resolvePath(props.manifestPath)
        log(`Loading manifest from ${url}`)

        const response = await fetch(url)

        if (!response.ok) {
            const errorMsg = `Failed to load audio manifest: ${response.status} ${response.statusText}`
            loadError.value = errorMsg
            log(errorMsg)
            return
        }

        manifest.value = await response.json()
        loadedManifest.value = true
        log(`Manifest loaded successfully: ${JSON.stringify(manifest.value)}`)

        // Preload first slide's audio if autoplay is enabled
        const currentFiles = getSlideAudio(currentPage.value)
        if (props.autoplay && currentFiles.length > 0) {
            log(`Preloading audio for slide ${currentPage.value}`)
            preloadAudio(currentFiles[0])
        }

        // Preload next slide's audio if enabled
        preloadNextSlide(currentPage.value)
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        loadError.value = `Error loading audio manifest: ${errorMessage}`
        log(loadError.value)
    }
}

// Preload audio file
const preloadAudio = (audioPath: string) => {
    let audio = preloadedAudios.get(audioPath)
    if (!audio) {
        log(`Creating new Audio object for ${audioPath}`)
        audio = new Audio(resolvePath(audioPath))
        audio.volume = props.volume
        audio.preload = 'auto'
        preloadedAudios.set(audioPath, audio)
    }
    return audio
}

const preloadNextSlide = (slideNumber: number) => {
    if (!props.preloadNext || slideNumber >= total.value) {
        return
    }
    const nextFiles = getSlideAudio(slideNumber + 1)
    if (nextFiles.length > 0) {
        log(`Preloading first audio file for next slide ${slideNumber + 1}`)
        preloadAudio(nextFiles[0])
    }
}

// Stop the current sequence and invalidate any pending callbacks from it
const stopAudio = () => {
    sequenceId++
    if (currentAudio) {
        log('Stopping currently playing audio')
        currentAudio.onended = null
        currentAudio.pause()
        currentAudio.currentTime = 0
        currentAudio = null
    }
    isPlaying.value = false
}

// Enable audio after user interaction
const enableAudio = () => {
    audioEnabled.value = true
    log('Audio enabled by user interaction')
    if (loadedManifest.value && props.autoplay) {
        playSlideAudio(currentPage.value)
    }
}

// Play audio for a specific slide
const playSlideAudio = (slideNumber: number) => {
    if (!isActive.value) {
        return
    }
    log(`Playing audio for slide ${slideNumber}`)

    // Check if audio is enabled by user interaction
    if (!audioEnabled.value) {
        log('Audio playback skipped - not enabled by user yet')
        return
    }

    // Stop any currently playing audio
    stopAudio()
    const id = sequenceId

    // Get the audio files for this slide
    const audioFiles = getSlideAudio(slideNumber)
    if (audioFiles.length === 0) {
        log(`No audio found for slide ${slideNumber}`)
        return
    }
    log(`Found ${audioFiles.length} audio files for slide ${slideNumber}`)

    // Play audio files sequentially
    const playAudioSequence = (index = 0) => {
        // A newer sequence has started (slide changed, stopped, or replayed)
        if (id !== sequenceId) {
            return
        }

        if (index >= audioFiles.length) {
            log(`Finished playing all audio files for slide ${slideNumber}`)
            currentAudio = null
            isPlaying.value = false
            return
        }

        const audioPath = audioFiles[index]
        log(`Playing audio file ${index + 1}/${audioFiles.length}: ${audioPath}`)

        const audio = preloadAudio(audioPath)
        audio.currentTime = 0
        currentAudio = audio
        isPlaying.value = true

        // Preload next audio if available, otherwise the first audio of the next slide
        if (index + 1 < audioFiles.length) {
            log(`Preloading next audio file: ${audioFiles[index + 1]}`)
            preloadAudio(audioFiles[index + 1])
        } else {
            preloadNextSlide(slideNumber)
        }

        audio.onended = () => {
            if (id !== sequenceId) {
                return
            }
            log(`Audio file ${audioPath} finished playing`)
            // Play the next audio file in the sequence
            playAudioSequence(index + 1)
        }

        // Play the audio
        audio.play().catch(error => {
            if (id !== sequenceId) {
                return
            }
            // Interrupted by a pause() call; the sequence is still current, so resume can continue it
            if (error?.name === 'AbortError') {
                return
            }
            log(`Error playing audio ${audioPath}: ${error}`)

            if (error?.name === 'NotAllowedError') {
                log('Audio playback blocked by browser. User interaction required.')
                isPlaying.value = false
                return
            }

            log('Audio file is empty or invalid. Skipping to next file.')
            // Try to play next audio if this one fails
            playAudioSequence(index + 1)
        })
    }

    playAudioSequence()
}

// Watch for slide changes
watch(currentPage, (newPage) => {
    if (!isActive.value) {
        return
    }
    log(`Slide changed to ${newPage}`)
    // Always stop the previous slide's narration, even when autoplay is off
    stopAudio()
    if (loadedManifest.value && props.autoplay) {
        playSlideAudio(newPage)
    }
})

// Watch for manifest loading
watch(loadedManifest, (loaded) => {
    log(`Manifest loaded: ${loaded}`)
    if (loaded && props.autoplay) {
        playSlideAudio(currentPage.value)
    }
})

// Stop narration if this instance leaves the play view (e.g. switched to print mode)
watch(isActive, (active) => {
    if (!active) {
        stopAudio()
    }
})

// Watch for volume changes
watch(() => props.volume, (newVolume) => {
    log(`Volume changed to ${newVolume}`)
    // Update volume for all audios, including the current one
    preloadedAudios.forEach(audio => {
        audio.volume = newVolume
    })
})

// Manual play control; also works when autoplay is disabled
const playCurrentSlideAudio = () => {
    log('Manual playback requested')
    // A manual request comes from the user, so treat it as enabling audio
    audioEnabled.value = true
    if (loadedManifest.value) {
        playSlideAudio(currentPage.value)
    }
}

// Manual pause control
const pauseAudio = () => {
    if (currentAudio && isPlaying.value) {
        log('Pausing audio')
        currentAudio.pause()
        isPlaying.value = false
    }
}

// Manual resume control
const resumeAudio = () => {
    if (currentAudio && !isPlaying.value) {
        log('Resuming audio')
        const id = sequenceId
        currentAudio.play().catch(error => {
            if (id === sequenceId && error?.name !== 'AbortError') {
                log(`Error resuming audio: ${error}`)
                isPlaying.value = false
            }
        })
        isPlaying.value = true
    }
}

// Expose methods that could be used by parent components
defineExpose({
    playCurrentSlideAudio,
    pauseAudio,
    resumeAudio,
    stopAudio,
    enableAudio,
    isPlaying,
    audioEnabled,
    debugMessages
})

onMounted(() => {
    if (globalState[OWNER_KEY]) {
        log('Another Narrator instance is already active; this one will stay idle')
        return
    }
    globalState[OWNER_KEY] = ownerToken
    isOwner.value = true
    log('Narrator component mounted')
    if (isPlayView.value) {
        loadManifest()
    } else {
        // Load lazily if the view later switches to play mode
        const stop = watch(isPlayView, (playView) => {
            if (playView) {
                stop()
                loadManifest()
            }
        })
    }
})

onBeforeUnmount(() => {
    log('Narrator component unmounting')
    if (globalState[OWNER_KEY] === ownerToken) {
        globalState[OWNER_KEY] = null
    }
    // Stop audio and clean up when component is unmounted
    stopAudio()

    // Clean up all preloaded audios
    preloadedAudios.forEach(audio => {
        audio.onended = null
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
    })
    preloadedAudios.clear()
})
</script>

<template>
    <!-- User interaction button to enable audio (browsers block autoplay until the user interacts) -->
    <div v-if="isActive && !audioEnabled" class="fixed bottom-5 right-5 z-50">
        <button
            @click="enableAudio"
            class="px-4 py-2 bg-blue-500 text-white rounded shadow hover:bg-blue-600 transition-colors"
        >
            Enable Audio Narration
        </button>
    </div>

    <!-- Debug overlay shown only in debug mode -->
    <div v-if="debug && isActive" class="fixed top-2 right-2 p-2 bg-gray-800 text-xs text-white rounded opacity-70 z-50 w-80 max-h-60 overflow-y-auto">
        <div class="font-bold mb-1">Slidev Narrator Debug</div>
        <div v-if="loadError" class="text-xs mb-1 text-red-300">{{ loadError }}</div>
        <div v-for="(msg, i) in debugMessages" :key="i" class="text-xs mb-1">
            {{ msg }}
        </div>
    </div>
</template>
