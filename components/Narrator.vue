<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useNav } from '@slidev/client'

// Define the audio manifest interface
interface AudioManifest {
    [slideNumber: number]: string[]
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
const { currentPage, total } = useNav()
const manifest = ref<AudioManifest>({})
const currentAudio = ref<HTMLAudioElement | null>(null)
const preloadedAudios = ref<Record<string, HTMLAudioElement>>({})
const isPlaying = ref(false)
const loadedManifest = ref(false)
const loadError = ref<string | null>(null)
const debugMessages = ref<string[]>([])
const audioEnabled = ref(false)

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

// Load the manifest file
const loadManifest = async () => {
    try {
        loadError.value = null
        log(`Loading manifest from ${props.manifestPath}`)
        
        const response = await fetch(props.manifestPath)
        
        if (!response.ok) {
            const errorMsg = `Failed to load audio manifest: ${response.statusText}`
            loadError.value = errorMsg
            log(errorMsg)
            return
        }
        
        manifest.value = await response.json()
        loadedManifest.value = true
        log(`Manifest loaded successfully: ${JSON.stringify(manifest.value)}`)
        
        // Preload first slide's audio if autoplay is enabled
        if (props.autoplay && manifest.value[currentPage.value]) {
            log(`Preloading audio for slide ${currentPage.value}`)
            preloadAudio(manifest.value[currentPage.value][0])
        }
        
        // Preload next slide's audio if enabled
        if (props.preloadNext && currentPage.value < total.value) {
            const nextPage = currentPage.value + 1
            if (manifest.value[nextPage] && manifest.value[nextPage].length > 0) {
                log(`Preloading audio for next slide ${nextPage}`)
                preloadAudio(manifest.value[nextPage][0])
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        loadError.value = `Error loading audio manifest: ${errorMessage}`
        log(loadError.value)
    }
}

// Preload audio file
const preloadAudio = (audioPath: string) => {
    if (!preloadedAudios.value[audioPath]) {
        log(`Creating new Audio object for ${audioPath}`)
        const audio = new Audio(audioPath)
        audio.volume = props.volume
        audio.preload = 'auto'
        preloadedAudios.value[audioPath] = audio
    }
    return preloadedAudios.value[audioPath]
}

// Enable audio after user interaction
const enableAudio = () => {
    audioEnabled.value = true;
    log('Audio enabled by user interaction');
    if (loadedManifest.value) {
        playSlideAudio(currentPage.value);
    }
}

// Play audio for a specific slide
const playSlideAudio = async (slideNumber: number) => {
    log(`Playing audio for slide ${slideNumber}`)
    
    // Check if audio is enabled by user interaction
    if (!audioEnabled.value) {
        log('Audio playback skipped - not enabled by user yet');
        return;
    }
    
    // Stop any currently playing audio
    if (currentAudio.value) {
        log('Stopping currently playing audio')
        currentAudio.value.pause()
        currentAudio.value.currentTime = 0
        currentAudio.value = null
        isPlaying.value = false
    }
    
    // Check if we have audio for this slide
    if (!manifest.value[slideNumber] || manifest.value[slideNumber].length === 0) {
        log(`No audio found for slide ${slideNumber}`)
        return
    }
    
    // Get the audio files for this slide
    const audioFiles = manifest.value[slideNumber]
    log(`Found ${audioFiles.length} audio files for slide ${slideNumber}`)
    
    // Create a function to play audio files sequentially
    const playAudioSequence = (index = 0) => {
        if (index >= audioFiles.length) {
            log(`Finished playing all audio files for slide ${slideNumber}`)
            return
        }
        
        const audioPath = audioFiles[index]
        log(`Playing audio file ${index + 1}/${audioFiles.length}: ${audioPath}`)
        
        let audio = preloadedAudios.value[audioPath]
        
        if (!audio) {
            log(`Creating new Audio object for ${audioPath}`)
            audio = new Audio(audioPath)
            audio.volume = props.volume
            preloadedAudios.value[audioPath] = audio
        }
        
        currentAudio.value = audio
        isPlaying.value = true
        
        // Preload next audio if available
        if (index + 1 < audioFiles.length) {
            log(`Preloading next audio file: ${audioFiles[index + 1]}`)
            preloadAudio(audioFiles[index + 1])
        } else if (props.preloadNext && slideNumber < total.value) {
            // Preload first audio of next slide
            const nextPage = slideNumber + 1
            if (manifest.value[nextPage] && manifest.value[nextPage].length > 0) {
                log(`Preloading first audio file for next slide ${nextPage}`)
                preloadAudio(manifest.value[nextPage][0])
            }
        }
        
        // Play the audio
        audio.play().catch(error => {
            log(`Error playing audio ${audioPath}: ${error}`);
            
            // Check for specific error types
            if (error.name === 'NotAllowedError') {
                log('Audio playback blocked by browser. User interaction required.');
            } else if (error.name === 'NotSupportedError' || error.message.includes('Range Not Satisfiable')) {
                log('Audio file is empty or invalid. Skipping to next file.');
            }
            
            // Try to play next audio if this one fails
            playAudioSequence(index + 1);
        })
        
        audio.onended = () => {
            log(`Audio file ${audioPath} finished playing`)
            isPlaying.value = false
            // Play the next audio file in the sequence
            playAudioSequence(index + 1)
        }
    }
    
    // Start playing the sequence
    if (props.autoplay) {
        playAudioSequence()
    }
}

// Watch for slide changes
watch(currentPage, (newPage) => {
    log(`Slide changed to ${newPage}`)
    if (loadedManifest.value) {
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

// Watch for volume changes
watch(() => props.volume, (newVolume) => {
    log(`Volume changed to ${newVolume}`)
    if (currentAudio.value) {
        currentAudio.value.volume = newVolume
    }
    
    // Update volume for all preloaded audios
    Object.values(preloadedAudios.value).forEach(audio => {
        if (audio instanceof HTMLAudioElement) {
            audio.volume = newVolume
        }
    })
})

// Manual play control (can be exposed as a method if needed)
const playCurrentSlideAudio = () => {
    log('Manual playback requested')
    if (loadedManifest.value) {
        playSlideAudio(currentPage.value)
    }
}

// Manual pause control
const pauseAudio = () => {
    if (currentAudio.value && isPlaying.value) {
        log('Pausing audio')
        currentAudio.value.pause()
        isPlaying.value = false
    }
}

// Manual resume control
const resumeAudio = () => {
    if (currentAudio.value && !isPlaying.value) {
        log('Resuming audio')
        currentAudio.value.play().catch(error => {
            log(`Error resuming audio: ${error}`)
        })
        isPlaying.value = true
    }
}

// Expose methods that could be used by parent components
defineExpose({
    playCurrentSlideAudio,
    pauseAudio,
    resumeAudio,
    enableAudio,
    isPlaying,
    audioEnabled,
    debugMessages
})

onMounted(() => {
    log('Narrator component mounted')
    loadManifest()
})

onBeforeUnmount(() => {
    log('Narrator component unmounting')
    // Stop audio and clean up when component is unmounted
    if (currentAudio.value) {
        currentAudio.value.pause()
        currentAudio.value = null
    }
    
    // Clean up all preloaded audios
    Object.values(preloadedAudios.value).forEach(audio => {
        if (audio instanceof HTMLAudioElement) {
            audio.pause()
            audio.src = ''
        }
    })
    preloadedAudios.value = {}
})
</script>

<template>
    <!-- This component doesn't render anything visible, it just controls audio playback -->
    <div v-if="loadError" class="narrator-error" style="display: none;">
        {{ loadError }}
    </div>
    
    <!-- User interaction button to enable audio -->
    <div v-if="!audioEnabled" class="fixed bottom-5 right-5 z-50">
        <button 
            @click="enableAudio" 
            class="px-4 py-2 bg-blue-500 text-white rounded shadow hover:bg-blue-600 transition-colors"
        >
            Enable Audio Narration
        </button>
    </div>
    
    <!-- Debug overlay shown only in debug mode -->
    <div v-if="debug" class="fixed top-2 right-2 p-2 bg-gray-800 text-xs text-white rounded opacity-70 z-50 w-80 max-h-60 overflow-y-auto">
        <div class="font-bold mb-1">Slidev Narrator Debug</div>
        <div v-for="(msg, i) in debugMessages" :key="i" class="text-xs mb-1">
            {{ msg }}
        </div>
    </div>
</template>

<style scoped>
.narrator-error {
    display: none;
}
</style> 