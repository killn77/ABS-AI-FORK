const { expect } = require('chai')
const AiLibraryCleanupManager = require('../../../server/managers/AiLibraryCleanupManager')

describe('AiLibraryCleanupManager', () => {
  describe('clampLimit', () => {
    it('defaults and clamps to a safe range', () => {
      expect(AiLibraryCleanupManager.clampLimit(undefined, 100)).to.equal(100)
      expect(AiLibraryCleanupManager.clampLimit('abc', 100)).to.equal(100)
      expect(AiLibraryCleanupManager.clampLimit(0, 100)).to.equal(1)
      expect(AiLibraryCleanupManager.clampLimit(5000, 100)).to.equal(1000)
      expect(AiLibraryCleanupManager.clampLimit('25', 100)).to.equal(25)
    })
  })

  describe('buildSummary', () => {
    it('groups duplicate-subtitle candidates with count and examples', () => {
      const summary = AiLibraryCleanupManager.buildSummary([
        { libraryItemId: '1', title: 'A', issueType: 'duplicate-subtitle', fieldName: 'subtitle', currentValue: 'A', proposedValue: '', canFastApply: true },
        { libraryItemId: '2', title: 'B', issueType: 'duplicate-subtitle', fieldName: 'subtitle', currentValue: 'B', proposedValue: '', canFastApply: true }
      ])

      expect(summary.total).to.equal(2)
      expect(summary.groups).to.have.length(1)
      expect(summary.groups[0]).to.deep.include({
        issueType: 'duplicate-subtitle',
        count: 2,
        canFastApply: true
      })
      expect(summary.groups[0].examples).to.have.length(2)
    })
  })

  describe('valuesMatch', () => {
    it('treats empty string, null, and undefined as equivalent clears', () => {
      expect(AiLibraryCleanupManager.valuesMatch('', null)).to.equal(true)
      expect(AiLibraryCleanupManager.valuesMatch(null, undefined)).to.equal(true)
      expect(AiLibraryCleanupManager.valuesMatch(undefined, '')).to.equal(true)
    })

    it('does not treat different populated strings as matching', () => {
      expect(AiLibraryCleanupManager.valuesMatch('A', 'B')).to.equal(false)
      expect(AiLibraryCleanupManager.valuesMatch('A', 'A')).to.equal(true)
    })
  })

  describe('runSubtitleStage', () => {
    it('returns a subtitle-cruft accept for a whole-cruft subtitle book item', () => {
      const result = AiLibraryCleanupManager.runSubtitleStage({ id: '1', mediaType: 'book', isBook: true, media: { title: 'Dune', subtitle: 'Unabridged' } })
      expect(result.verdict).to.equal('accept')
      expect(result.candidate.issueType).to.equal('subtitle-cruft')
    })

    it('escalates a partial-cruft subtitle book item', () => {
      const result = AiLibraryCleanupManager.runSubtitleStage({ id: '1', mediaType: 'book', isBook: true, media: { title: 'Dune', subtitle: 'A Novel [Unabridged]' } })
      expect(result.verdict).to.equal('escalate')
    })

    it('returns null for non-book items', () => {
      expect(AiLibraryCleanupManager.runSubtitleStage({ id: '1', mediaType: 'podcast', media: {} })).to.equal(null)
    })
  })

  describe('buildSummary with stageStats', () => {
    it('merges stage stats onto the summary when provided', () => {
      const summary = AiLibraryCleanupManager.buildSummary([], { evaluated: 8, deterministicResolved: 2, escalated: 6 })
      expect(summary.stageStats).to.deep.equal({ evaluated: 8, deterministicResolved: 2, escalated: 6 })
    })
  })
})
