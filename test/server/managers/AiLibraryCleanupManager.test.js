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
})
