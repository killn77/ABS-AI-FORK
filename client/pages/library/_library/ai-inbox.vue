<template>
  <div class="page relative" :class="streamLibraryItem ? 'streaming' : ''">
    <app-book-shelf-toolbar page="library-ai-inbox" is-home />
    <div id="bookshelf" class="w-full h-full px-1 py-4 md:p-8 relative overflow-y-auto">
      <div class="w-full max-w-3xl mx-auto">
        <div class="flex items-center mb-6">
          <h1 class="text-2xl">{{ $strings.HeaderAiCurationInbox }}</h1>
          <div class="grow" />
          <ui-btn :loading="generating" @click="generateBatch">{{ $strings.ButtonGenerateAiSuggestions }}</ui-btn>
        </div>

        <div v-if="loading" class="py-10 text-center text-gray-300">...</div>

        <div v-else-if="!suggestions.length" class="py-10 text-center text-gray-400">
          {{ $strings.MessageNoAiSuggestions }}
        </div>

        <div v-else class="space-y-3">
          <div v-for="s in suggestions" :key="s.id" class="bg-primary/40 rounded p-3 border border-white/10">
            <div class="flex items-center mb-1 flex-wrap">
              <nuxt-link :to="`/item/${s.libraryItem.id}`" class="font-semibold hover:underline">{{ s.libraryItem.title }}</nuxt-link>
              <span class="mx-2 text-gray-500">·</span>
              <span class="capitalize text-gray-300">{{ s.fieldName }}</span>
              <span v-if="s.confidence != null" class="ml-2 text-xs text-gray-400">{{ Math.round(s.confidence * 100) }}%</span>
            </div>
            <div class="text-sm">
              <p class="text-gray-400"><span class="text-gray-500">{{ $strings.LabelAiSuggestionCurrent }}:</span> {{ displayValue(s.currentValue) }}</p>
              <p class="text-success"><span class="text-gray-500">{{ $strings.LabelAiSuggestionProposed }}:</span> {{ s.proposedValue || '(clear field)' }}</p>
            </div>
            <p v-if="s.rationale" class="text-xs text-gray-400 mt-1 italic">{{ s.rationale }}</p>
            <div class="flex justify-end mt-2 space-x-2">
              <ui-btn small :disabled="busyId === s.id" @click="reject(s)">{{ $strings.ButtonReject }}</ui-btn>
              <ui-btn small color="success" :loading="busyId === s.id" @click="accept(s)">{{ $strings.ButtonAccept }}</ui-btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  async asyncData({ redirect, store, params }) {
    if (!store.getters['user/getIsAdminOrUp']) {
      redirect('/')
      return
    }
    const libraryId = params.library
    const library = await store.dispatch('libraries/fetch', libraryId)
    if (!library) {
      return redirect(`/oops?message=Library "${libraryId}" not found`)
    }
    return {}
  },
  data() {
    return {
      suggestions: [],
      loading: false,
      generating: false,
      busyId: null
    }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    },
    currentLibraryId() {
      return this.$store.state.libraries.currentLibraryId
    }
  },
  watch: {
    currentLibraryId(newVal) {
      if (newVal) this.loadInbox()
    }
  },
  methods: {
    displayValue(value) {
      if (Array.isArray(value)) return value.join(', ')
      if (value === null || value === undefined || value === '') return '—'
      return value
    },
    async loadInbox() {
      if (!this.currentLibraryId) return
      this.loading = true
      const data = await this.$axios.$get(`/api/libraries/${this.currentLibraryId}/ai-suggestions`).catch((error) => {
        console.error('Failed to load AI inbox', error)
        return null
      })
      this.suggestions = data?.suggestions || []
      this.loading = false
    },
    async generateBatch() {
      if (!this.currentLibraryId) return
      this.generating = true
      const res = await this.$axios.$post(`/api/libraries/${this.currentLibraryId}/ai-suggestions/generate`, { limit: 5 }).catch((error) => {
        const msg = error.response?.data || this.$strings.ToastAiSuggestionsFailed
        this.$toast.error(msg)
        return null
      })
      if (res) {
        this.$toast.success(`Processed ${res.processed} item(s), ${res.suggestionsCreated} suggestion(s)`)
        await this.loadInbox()
      }
      this.generating = false
    },
    buildMediaPayload(s) {
      const metadata = {}
      if (s.fieldName === 'narrators') {
        metadata.narrators = String(s.proposedValue)
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
      } else {
        metadata[s.fieldName] = s.proposedValue
      }
      return { metadata }
    },
    async accept(s) {
      this.busyId = s.id
      const updateResult = await this.$axios.$patch(`/api/items/${s.libraryItem.id}/media`, this.buildMediaPayload(s)).catch((error) => {
        console.error('Failed to apply suggestion', error)
        this.$toast.error(this.$strings.ToastFailedToUpdate)
        return false
      })
      if (updateResult) {
        await this.recordDecision(s, 'accept')
        this.$toast.success(this.$strings.ToastItemDetailsUpdateSuccess)
      }
      this.busyId = null
    },
    async reject(s) {
      this.busyId = s.id
      await this.recordDecision(s, 'reject')
      this.busyId = null
    },
    async recordDecision(s, decision) {
      await this.$axios.$post(`/api/ai-suggestions/${s.id}/decision`, { decision }).catch((error) => {
        console.error('Failed to record decision', error)
      })
      // Remove the resolved suggestion from the inbox
      this.suggestions = this.suggestions.filter((x) => x.id !== s.id)
    }
  },
  mounted() {
    this.loadInbox()
  }
}
</script>
