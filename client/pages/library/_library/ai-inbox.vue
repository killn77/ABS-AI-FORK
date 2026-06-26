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

        <div class="mb-4 flex flex-wrap gap-2">
          <span v-for="chip in summaryChips" :key="chip.label" class="text-xs px-2 py-1 rounded border border-white/10 bg-primary/40 text-gray-300">
            {{ chip.label }}: {{ chip.count }}
          </span>
        </div>

        <div class="mb-6 bg-primary/40 rounded p-4 border border-white/10">
          <div class="flex items-center flex-wrap gap-2">
            <h2 class="text-lg font-semibold">{{ $strings.HeaderAiCleanupHarvest }}</h2>
            <div class="grow" />
            <span v-if="duplicateSubtitleGroup" class="text-sm text-gray-300">
              {{ $strings.LabelAiCleanupDuplicateSubtitle }}: {{ duplicateSubtitleGroup.count }}
            </span>
          </div>

          <div v-if="cleanupSummary && cleanupSummary.stageStats" class="text-xs text-gray-300 mt-1">
            Deterministic resolved {{ cleanupSummary.stageStats.deterministicResolved }} /
            escalated {{ cleanupSummary.stageStats.escalated }} of
            {{ cleanupSummary.stageStats.evaluated }} evaluated
          </div>

          <div v-if="loadingCleanup" class="text-sm text-gray-400 mt-3">...</div>
          <div v-else-if="!duplicateSubtitleGroup" class="text-sm text-gray-400 mt-3">
            {{ $strings.MessageAiCleanupHarvestEmpty }}
          </div>
          <div v-else class="mt-3">
            <div class="space-y-1 mb-3">
              <p v-for="example in duplicateSubtitleGroup.examples.slice(0, 3)" :key="example.libraryItemId" class="text-xs text-gray-400 truncate">
                {{ example.title }} -> {{ displayValue(example.currentValue) }} -> {{ displayValue(example.proposedValue) }}
              </p>
            </div>
            <div class="flex justify-end gap-2">
              <ui-btn small :loading="creatingCleanupSuggestions" :disabled="applyingCleanup" @click="createCleanupSuggestions">{{ $strings.ButtonAiCleanupReviewFirst }}</ui-btn>
              <ui-btn small color="success" :loading="applyingCleanup" :disabled="creatingCleanupSuggestions" @click="applyCleanup">{{ $strings.ButtonAiCleanupApplyAll }}</ui-btn>
            </div>
          </div>
        </div>

        <div class="mb-4 flex flex-wrap gap-2">
          <button
            v-for="filter in statusFilters"
            :key="filter.value"
            class="rounded border px-3 py-1 text-sm"
            :class="statusFilter === filter.value ? 'bg-success border-success text-white' : 'bg-primary/40 border-white/10 text-gray-300 hover:text-white'"
            @click="setStatusFilter(filter.value)"
          >
            {{ filter.label }} ({{ filter.count }})
          </button>
        </div>

        <div v-if="loading" class="py-10 text-center text-gray-300">...</div>

        <div v-else-if="!suggestions.length" class="py-10 text-center text-gray-400">
          {{ emptyMessage }}
        </div>

        <div v-else class="space-y-3">
          <div v-for="s in suggestions" :key="s.id" class="bg-primary/40 rounded p-3 border border-white/10">
            <div class="flex items-center mb-1 flex-wrap">
              <nuxt-link :to="`/item/${s.libraryItem.id}`" class="font-semibold hover:underline">{{ s.libraryItem.title }}</nuxt-link>
              <span class="mx-2 text-gray-500">-</span>
              <span class="capitalize text-gray-300">{{ s.fieldName }}</span>
              <span v-if="s.confidence != null" class="ml-2 text-xs text-gray-400">{{ Math.round(s.confidence * 100) }}%</span>
            </div>
            <div class="mb-2 flex flex-wrap gap-1">
              <span class="text-xs px-2 py-0.5 rounded border border-white/10 text-gray-300">{{ statusLabel(s.status) }}</span>
              <span class="text-xs px-2 py-0.5 rounded border border-white/10 text-gray-300">{{ issueTypeLabel(s.issueType) }}</span>
              <span class="text-xs px-2 py-0.5 rounded border border-white/10 text-gray-300">{{ originLabel(s.origin) }}</span>
              <span v-if="!s.issueType && !s.origin" class="text-xs px-2 py-0.5 rounded border border-warning/40 text-warning">{{ $strings.LabelAiSuggestionLegacy }}</span>
              <span v-if="s.canFastApply" class="text-xs px-2 py-0.5 rounded border border-success/40 text-success">{{ $strings.LabelAiSuggestionFastApply }}</span>
            </div>
            <div class="text-sm">
              <p class="text-gray-400"><span class="text-gray-500">{{ $strings.LabelAiSuggestionCurrent }}:</span> {{ displayValue(s.currentValue) }}</p>
              <p class="text-success"><span class="text-gray-500">{{ $strings.LabelAiSuggestionProposed }}:</span> {{ s.proposedValue || '(clear field)' }}</p>
            </div>
            <p v-if="s.rationale" class="text-xs text-gray-400 mt-1 italic">{{ s.rationale }}</p>
            <div v-if="s.status === 'pending'" class="flex justify-end mt-2 space-x-2">
              <ui-btn small :disabled="busyId === s.id" @click="reject(s)">{{ $strings.ButtonReject }}</ui-btn>
              <ui-btn small color="success" :loading="busyId === s.id" @click="accept(s)">{{ $strings.ButtonAccept }}</ui-btn>
            </div>
            <div v-else-if="s.status === 'accepted'" class="flex justify-end mt-2 space-x-2">
              <ui-btn small :loading="revertingId === s.id" :disabled="busyId === s.id" @click="revert(s)">{{ $strings.ButtonRevert }}</ui-btn>
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
      suggestionSummary: null,
      cleanupSummary: null,
      statusFilter: 'pending',
      loading: false,
      loadingCleanup: false,
      generating: false,
      creatingCleanupSuggestions: false,
      applyingCleanup: false,
      revertingId: null,
      busyId: null
    }
  },
  computed: {
    streamLibraryItem() {
      return this.$store.state.streamLibraryItem
    },
    currentLibraryId() {
      return this.$store.state.libraries.currentLibraryId
    },
    duplicateSubtitleGroup() {
      return this.cleanupSummary?.groups?.find((g) => g.issueType === 'duplicate-subtitle') || null
    },
    statusFilters() {
      const counts = this.suggestionSummary?.byStatus || {}
      return [
        { value: 'pending', label: this.$strings.LabelAiSuggestionPending, count: counts.pending || 0 },
        { value: 'accepted', label: this.$strings.LabelAiSuggestionAccepted, count: counts.accepted || 0 },
        { value: 'rejected', label: this.$strings.LabelAiSuggestionRejected, count: counts.rejected || 0 },
        { value: 'reverted', label: this.$strings.LabelAiSuggestionReverted, count: counts.reverted || 0 },
        { value: 'all', label: this.$strings.LabelAiSuggestionAll, count: this.suggestionSummary?.total || 0 }
      ]
    },
    summaryChips() {
      const counts = this.suggestionSummary?.byStatus || {}
      return [
        { label: this.$strings.LabelAiSuggestionPending, count: counts.pending || 0 },
        { label: this.$strings.LabelAiSuggestionAccepted, count: counts.accepted || 0 },
        { label: this.$strings.LabelAiSuggestionRejected, count: counts.rejected || 0 },
        { label: this.$strings.LabelAiSuggestionReverted, count: counts.reverted || 0 },
        { label: this.$strings.LabelAiSuggestionDeterministic, count: this.suggestionSummary?.deterministic || 0 },
        { label: this.$strings.LabelAiSuggestionLegacy, count: this.suggestionSummary?.legacy || 0 }
      ]
    },
    emptyMessage() {
      if (this.statusFilter === 'pending') return this.$strings.MessageNoAiSuggestions
      return this.$strings.MessageNoAiSuggestionsForFilter
    }
  },
  watch: {
    currentLibraryId(newVal) {
      if (newVal) {
        this.loadSuggestionSummary()
        this.loadInbox()
        this.loadCleanupSummary()
      }
    }
  },
  methods: {
    displayValue(value) {
      if (Array.isArray(value)) return value.join(', ')
      if (value === null || value === undefined || value === '') return '-'
      return value
    },
    statusLabel(status) {
      const labels = {
        pending: this.$strings.LabelAiSuggestionPending,
        accepted: this.$strings.LabelAiSuggestionAccepted,
        rejected: this.$strings.LabelAiSuggestionRejected,
        reverted: this.$strings.LabelAiSuggestionReverted
      }
      return labels[status] || status || this.$strings.LabelAiSuggestionPending
    },
    issueTypeLabel(issueType) {
      if (issueType === 'duplicate-subtitle') return this.$strings.LabelAiCleanupDuplicateSubtitle
      if (issueType === 'subtitle-cruft') return this.$strings.LabelAiIssueSubtitleCruft
      return issueType || this.$strings.LabelAiSuggestionLegacy
    },
    originLabel(origin) {
      if (origin === 'deterministic-rule') return this.$strings.LabelAiSuggestionDeterministic
      if (origin === 'llm') return this.$strings.LabelAiSuggestionLlm
      if (origin === 'local-llm') return this.$strings.LabelAiOriginLocalLlm
      return origin || this.$strings.LabelAiSuggestionLegacy
    },
    async setStatusFilter(status) {
      if (this.statusFilter === status) return
      this.statusFilter = status
      await this.loadInbox()
    },
    async loadInbox() {
      if (!this.currentLibraryId) return
      this.loading = true
      const data = await this.$axios.$get(`/api/libraries/${this.currentLibraryId}/ai-suggestions`, { params: { status: this.statusFilter } }).catch((error) => {
        console.error('Failed to load AI inbox', error)
        return null
      })
      this.suggestions = data?.suggestions || []
      this.loading = false
    },
    async loadSuggestionSummary() {
      if (!this.currentLibraryId) return
      const data = await this.$axios.$get(`/api/libraries/${this.currentLibraryId}/ai-suggestions/summary`).catch((error) => {
        console.error('Failed to load AI suggestion summary', error)
        return null
      })
      this.suggestionSummary = data
    },
    async loadCleanupSummary() {
      if (!this.currentLibraryId) return
      this.loadingCleanup = true
      const data = await this.$axios.$get(`/api/libraries/${this.currentLibraryId}/ai-cleanup/summary`).catch((error) => {
        console.error('Failed to load cleanup summary', error)
        return null
      })
      this.cleanupSummary = data
      this.loadingCleanup = false
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
        const detCounts = res.deterministicResolved != null ? ` (deterministic ${res.deterministicResolved} / llm ${res.llmItemsCalled} of ${res.processed})` : ''
        this.$toast.success(`Processed ${res.processed} item(s), ${res.suggestionsCreated} suggestion(s)${detCounts}`)
        await this.refreshInboxData()
      }
      this.generating = false
    },
    async createCleanupSuggestions() {
      if (!this.currentLibraryId || !this.duplicateSubtitleGroup) return
      this.creatingCleanupSuggestions = true
      const res = await this.$axios
        .$post(`/api/libraries/${this.currentLibraryId}/ai-cleanup/suggestions`, {
          issueTypes: ['duplicate-subtitle']
        })
        .catch((error) => {
          const msg = error.response?.data || this.$strings.ToastAiSuggestionsFailed
          this.$toast.error(msg)
          return null
        })
      if (res) {
        this.$toast.success(`${this.$strings.ToastAiCleanupSuggestionsCreated}: ${res.suggestionsCreated}`)
        await this.refreshInboxData()
      }
      this.creatingCleanupSuggestions = false
    },
    async applyCleanup() {
      if (!this.currentLibraryId || !this.duplicateSubtitleGroup) return
      if (!confirm(this.$strings.ConfirmAiCleanupApplyAll)) return
      this.applyingCleanup = true
      const res = await this.$axios
        .$post(`/api/libraries/${this.currentLibraryId}/ai-cleanup/apply`, {
          issueTypes: ['duplicate-subtitle'],
          confirmApply: true
        })
        .catch((error) => {
          const msg = error.response?.data || this.$strings.ToastFailedToUpdate
          this.$toast.error(msg)
          return null
        })
      if (res) {
        this.$toast.success(`${this.$strings.ToastAiCleanupApplyComplete}: ${res.applied} applied, ${res.skipped} skipped, ${res.failed} failed`)
        await this.refreshInboxData()
      }
      this.applyingCleanup = false
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
    async revert(s) {
      this.revertingId = s.id
      const res = await this.$axios.$post(`/api/ai-suggestions/${s.id}/revert`).catch((error) => {
        const msg = error.response?.data || this.$strings.ToastFailedToUpdate
        this.$toast.error(msg)
        return null
      })
      if (res) {
        this.$toast.success(this.$strings.ToastAiSuggestionReverted)
        await this.refreshInboxData()
      }
      this.revertingId = null
    },
    async recordDecision(s, decision) {
      await this.$axios.$post(`/api/ai-suggestions/${s.id}/decision`, { decision }).catch((error) => {
        console.error('Failed to record decision', error)
      })
      await this.refreshInboxData()
    },
    async refreshInboxData() {
      await this.loadSuggestionSummary()
      await this.loadInbox()
      await this.loadCleanupSummary()
    }
  },
  mounted() {
    this.refreshInboxData()
  }
}
</script>
