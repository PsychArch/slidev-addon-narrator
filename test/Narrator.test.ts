import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, VueWrapper } from '@vue/test-utils'
import { ref, computed, nextTick } from 'vue'

// Controllable Slidev navigation state
const nav = {
    currentPage: ref(1),
    total: ref(3),
    routeName: ref('play'),
    query: ref(''),
}

vi.mock('@slidev/client', () => ({
    useNav: () => ({
        currentPage: nav.currentPage,
        total: nav.total,
        isPlaying: computed(() => nav.routeName.value === 'play'),
        isPresenter: computed(() => nav.routeName.value === 'presenter'),
        isPrintMode: computed(() => nav.query.value === 'print'),
        isEmbedded: computed(() => nav.query.value === 'embedded'),
    }),
}))

import Narrator from '../components/Narrator.vue'

// Minimal HTMLAudioElement stand-in whose play() promise the test resolves or rejects
class FakeAudio {
    static instances: FakeAudio[] = []
    src: string
    volume = 1
    preload = ''
    currentTime = 0
    paused = true
    onended: (() => void) | null = null
    playCalls = 0
    pending: { resolve: () => void, reject: (e: unknown) => void } | null = null

    constructor(src: string) {
        this.src = src
        FakeAudio.instances.push(this)
    }

    play() {
        this.playCalls++
        this.paused = false
        return new Promise<void>((resolve, reject) => {
            this.pending = { resolve, reject }
        })
    }

    pause() {
        this.paused = true
        // Like browsers: pausing while play() is pending rejects it with AbortError
        if (this.pending) {
            const err = new Error('The play() request was interrupted by a call to pause()')
            err.name = 'AbortError'
            this.pending.reject(err)
            this.pending = null
        }
    }

    started() {
        this.pending?.resolve()
        this.pending = null
    }

    end() {
        this.paused = true
        this.onended?.()
    }

    removeAttribute() {}
    load() {}
}

const audio = (src: string) => {
    const found = FakeAudio.instances.find(a => a.src === src)
    if (!found) throw new Error(`No audio created for ${src}`)
    return found
}

const playing = () => FakeAudio.instances.filter(a => !a.paused).map(a => a.src)

const manifest = {
    '1': ['/audio/one.mp3'],
    '2': ['/audio/two-a.mp3', '/audio/two-b.mp3'],
    '3': ['/audio/three.mp3'],
}

let fetchMock: ReturnType<typeof vi.fn>
const wrappers: VueWrapper[] = []

const mountNarrator = async (props: Record<string, unknown> = {}) => {
    const wrapper = mount(Narrator, { props })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
}

const enable = async (wrapper: VueWrapper) => {
    await wrapper.find('button').trigger('click')
    await flushPromises()
}

const goTo = async (page: number) => {
    nav.currentPage.value = page
    await nextTick()
    await flushPromises()
}

beforeEach(() => {
    FakeAudio.instances = []
    nav.currentPage.value = 1
    nav.total.value = 3
    nav.routeName.value = 'play'
    nav.query.value = ''
    vi.stubGlobal('Audio', FakeAudio)
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => manifest }))
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    wrappers.splice(0).forEach(w => w.unmount())
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

describe('Narrator', () => {
    it('plays the current slide after audio is enabled and sequences files', async () => {
        const wrapper = await mountNarrator()
        expect(playing()).toEqual([])

        await enable(wrapper)
        expect(playing()).toEqual(['/audio/one.mp3'])

        await goTo(2)
        expect(playing()).toEqual(['/audio/two-a.mp3'])

        audio('/audio/two-a.mp3').started()
        audio('/audio/two-a.mp3').end()
        await flushPromises()
        expect(playing()).toEqual(['/audio/two-b.mp3'])
    })

    it('does not leak the previous slide\'s sequence into the next slide', async () => {
        const wrapper = await mountNarrator()
        await goTo(2)
        await enable(wrapper)
        expect(playing()).toEqual(['/audio/two-a.mp3'])

        // Navigate while two-a's play() is still pending: pause() rejects it with AbortError
        await goTo(3)
        await flushPromises()

        expect(playing()).toEqual(['/audio/three.mp3'])
        expect(FakeAudio.instances.find(a => a.src === '/audio/two-b.mp3')?.playCalls ?? 0).toBe(0)

        // A stale ended event from the old slide must not advance anything either
        audio('/audio/two-a.mp3').onended?.()
        await flushPromises()
        expect(playing()).toEqual(['/audio/three.mp3'])
    })

    it('with autoplay off, does not play on navigation but manual play works', async () => {
        const wrapper = await mountNarrator({ autoplay: false })
        await enable(wrapper)
        expect(playing()).toEqual([])

        await goTo(2)
        expect(playing()).toEqual([])

        ;(wrapper.vm as any).playCurrentSlideAudio()
        await flushPromises()
        expect(playing()).toEqual(['/audio/two-a.mp3'])

        // Navigating away still stops the old slide's narration
        await goTo(3)
        expect(playing()).toEqual([])
    })

    it('manual play enables audio without clicking the button', async () => {
        const wrapper = await mountNarrator()
        ;(wrapper.vm as any).playCurrentSlideAudio()
        await flushPromises()
        expect(playing()).toEqual(['/audio/one.mp3'])
        expect(wrapper.find('button').exists()).toBe(false)
    })

    it('skips a file that fails to load and continues the sequence', async () => {
        const wrapper = await mountNarrator()
        await goTo(2)
        await enable(wrapper)
        const err = new Error('bad file')
        err.name = 'NotSupportedError'
        audio('/audio/two-a.mp3').pending!.reject(err)
        await flushPromises()
        expect(playing()).toContain('/audio/two-b.mp3')
    })

    it('pause and resume continue the same file; resume after the sequence ends does nothing', async () => {
        const wrapper = await mountNarrator()
        await enable(wrapper)
        const one = audio('/audio/one.mp3')
        one.started()
        await flushPromises()

        ;(wrapper.vm as any).pauseAudio()
        expect(playing()).toEqual([])
        ;(wrapper.vm as any).resumeAudio()
        expect(playing()).toEqual(['/audio/one.mp3'])
        expect(one.playCalls).toBe(2)

        one.started()
        one.end()
        await flushPromises()
        expect((wrapper.vm as any).isPlaying).toBe(false)

        ;(wrapper.vm as any).resumeAudio()
        expect(one.playCalls).toBe(2)
        expect(playing()).toEqual([])
    })

    it('only one instance plays when mounted twice', async () => {
        const first = await mountNarrator()
        const second = await mountNarrator()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(second.find('button').exists()).toBe(false)

        await enable(first)
        await goTo(2)
        expect(FakeAudio.instances.filter(a => a.src === '/audio/two-a.mp3')).toHaveLength(1)
        expect(audio('/audio/two-a.mp3').playCalls).toBe(1)
    })

    it.each([
        ['presenter view', () => { nav.routeName.value = 'presenter' }],
        ['notes view', () => { nav.routeName.value = 'notes' }],
        ['print/export mode', () => { nav.query.value = 'print' }],
        ['embedded preview', () => { nav.query.value = 'embedded' }],
    ])('stays silent and hides its UI in %s', async (_name, setup) => {
        setup()
        const wrapper = await mountNarrator({ debug: true })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(wrapper.find('button').exists()).toBe(false)
        expect(wrapper.text()).not.toContain('Slidev Narrator Debug')
        ;(wrapper.vm as any).playCurrentSlideAudio()
        await goTo(2)
        expect(playing()).toEqual([])
    })

    it('stops playing when switching out of the play view', async () => {
        const wrapper = await mountNarrator()
        await enable(wrapper)
        expect(playing()).toEqual(['/audio/one.mp3'])
        nav.query.value = 'print'
        await nextTick()
        expect(playing()).toEqual([])
    })

    it('prefixes root-relative paths with the deck base URL', async () => {
        vi.stubEnv('BASE_URL', '/my-deck/')
        const wrapper = await mountNarrator()
        expect(fetchMock).toHaveBeenCalledWith('/my-deck/manifest.json')
        await enable(wrapper)
        expect(playing()).toEqual(['/my-deck/audio/one.mp3'])
    })

    it('leaves already-prefixed, relative and absolute URLs alone', async () => {
        vi.stubEnv('BASE_URL', '/my-deck/')
        fetchMock.mockImplementation(async () => ({
            ok: true, status: 200, statusText: 'OK',
            json: async () => ({ '1': ['/my-deck/a.mp3', 'b.mp3', 'https://cdn.example.com/c.mp3'] }),
        }))
        const wrapper = await mountNarrator({ manifestPath: 'https://cdn.example.com/manifest.json' })
        expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.com/manifest.json')
        await enable(wrapper)
        const srcs = FakeAudio.instances.map(a => a.src)
        expect(srcs).toEqual(expect.arrayContaining(['/my-deck/a.mp3', 'b.mp3']))
        audio('/my-deck/a.mp3').started()
        audio('/my-deck/a.mp3').end()
        audio('b.mp3').started()
        audio('b.mp3').end()
        await flushPromises()
        expect(playing()).toEqual(['https://cdn.example.com/c.mp3'])
    })

    it('applies volume changes to loaded audio', async () => {
        const wrapper = await mountNarrator({ volume: 0.5 })
        await enable(wrapper)
        expect(audio('/audio/one.mp3').volume).toBe(0.5)
        await wrapper.setProps({ volume: 0.2 })
        expect(FakeAudio.instances.every(a => a.volume === 0.2)).toBe(true)
    })
})
