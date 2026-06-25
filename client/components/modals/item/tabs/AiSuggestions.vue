<template>
  <div class="w-full h-full overflow-hidden overflow-y-auto px-4 py-6">
    <div class="flex items-center mb-4">
      <p class="text-lg font-semibold">{{ $strings.HeaderAiSuggestions }}</p>
      <div class="flex-grow" />
      <ui-btn :loading="generating" small @click="generate">{{ $strings.ButtonGenerateAiSuggestions }}</ui-btn>
    </div>

    <div v-if="loading" class="py-8 text-center text-gray-300">...</div>

    <div v-else-if="!pendingSuggestions.length" class="py-8 text-center text-gray-400">
      {{ $strings.MessageNoAiSuggestions }}
    </div>

    <div v-else class="space-y-3">
      <div v-for="s in pendingSuggestions" :key="s.id" class="bg-primary bg-opacity-40 rounded p-3 border border-white border-opacity-10">
        <div class="flex items-center mb-1">
          <p class="font-semibold capitalize">{{ s.fieldName }}</p>
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
</template>

<script>
export default {
  props: {
    libraryItem: {
      type: Object,
      default: () => null
    },
    processing: Boolean
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
    libraryItemId() {
      return this.libraryItem?.id
    },
    pendingSuggestions() {
      return this.suggestions.filter((s) => s.status === 'pending')
    }
  },
  methods: {
    displayValue(value) {
      if (Array.isArray(value)) return value.join(', ')
      if (value === null || value === undefined || value === '') return '—'
      return value
    },
    async loadSuggestions() {
      if (!this.libraryItemId) return
      this.loading = true
      const data = await this.$axios.$get(`/api/items/${this.libraryItemId}/ai-suggestions`).catch((error) => {
        console.error('Failed to load AI suggestions', error)
        return null
      })
      this.suggestions = data?.suggestions || []
      this.loading = false
    },
    async generate() {
      if (!this.libraryItemId) return
      this.generating = true
      const data = await this.$axios.$post(`/api/items/${this.libraryItemId}/ai-suggestions`).catch((error) => {
        const msg = error.response?.data || this.$strings.ToastAiSuggestionsFailed
        this.$toast.error(msg)
        return null
      })
      if (data) {
        this.suggestions = data.suggestions || []
        if (!this.pendingSuggestions.length) this.$toast.info(this.$strings.MessageNoAiSuggestions)
      }
      this.generating = false
    },
    // Build the PATCH /media payload for a single accepted field, reusing the existing write path.
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
      const updateResult = await this.$axios.$patch(`/api/items/${this.libraryItemId}/media`, this.buildMediaPayload(s)).catch((error) => {
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
      const local = this.suggestions.find((x) => x.id === s.id)
      if (local) local.status = decision === 'reject' ? 'rejected' : 'accepted'
    }
  },
  mounted() {
    this.loadSuggestions()
  }
}
</script>
