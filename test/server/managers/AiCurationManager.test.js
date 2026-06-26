const AiCurationManager = require('../../../server/managers/AiCurationManager')
const { expect } = require('chai')

describe('AiCurationManager', () => {
  describe('clampBatchLimit', () => {
    it('defaults to 5 for non-numeric input', () => {
      expect(AiCurationManager.clampBatchLimit(undefined)).to.equal(5)
      expect(AiCurationManager.clampBatchLimit('abc')).to.equal(5)
      expect(AiCurationManager.clampBatchLimit(null)).to.equal(5)
    })

    it('clamps to a minimum of 1', () => {
      expect(AiCurationManager.clampBatchLimit(0)).to.equal(1)
      expect(AiCurationManager.clampBatchLimit(-10)).to.equal(1)
    })

    it('clamps to a maximum of 25', () => {
      expect(AiCurationManager.clampBatchLimit(100)).to.equal(25)
    })

    it('passes through valid values (incl. numeric strings)', () => {
      expect(AiCurationManager.clampBatchLimit(10)).to.equal(10)
      expect(AiCurationManager.clampBatchLimit('7')).to.equal(7)
    })
  })

  describe('hashFields', () => {
    it('is stable for equal field sets and differs for changed ones', () => {
      const a = AiCurationManager.hashFields({ title: 'X', subtitle: null, narrators: ['A'] })
      const b = AiCurationManager.hashFields({ title: 'X', subtitle: null, narrators: ['A'] })
      const c = AiCurationManager.hashFields({ title: 'Y', subtitle: null, narrators: ['A'] })
      expect(a).to.equal(b)
      expect(a).to.not.equal(c)
    })
  })

  describe('normalizeSuggestionFilters', () => {
    it('defaults to pending for missing or invalid statuses', () => {
      expect(AiCurationManager.normalizeSuggestionFilters({})).to.deep.equal({ status: 'pending', issueType: null, origin: null })
      expect(AiCurationManager.normalizeSuggestionFilters({ status: 'bad' })).to.deep.equal({ status: 'pending', issueType: null, origin: null })
    })

    it('allows known statuses and all', () => {
      expect(AiCurationManager.normalizeSuggestionFilters({ status: 'accepted' }).status).to.equal('accepted')
      expect(AiCurationManager.normalizeSuggestionFilters({ status: 'rejected' }).status).to.equal('rejected')
      expect(AiCurationManager.normalizeSuggestionFilters({ status: 'reverted' }).status).to.equal('reverted')
      expect(AiCurationManager.normalizeSuggestionFilters({ status: 'all' }).status).to.equal('all')
    })

    it('preserves non-empty issue type and origin filters', () => {
      expect(
        AiCurationManager.normalizeSuggestionFilters({
          status: 'all',
          issueType: 'duplicate-subtitle',
          origin: 'deterministic-rule'
        })
      ).to.deep.equal({
        status: 'all',
        issueType: 'duplicate-subtitle',
        origin: 'deterministic-rule'
      })
    })
  })

  describe('buildSuggestionWhere', () => {
    it('omits status when all is selected', () => {
      expect(AiCurationManager.buildSuggestionWhere({ status: 'all', issueType: null, origin: null })).to.deep.equal({})
    })

    it('includes active filters', () => {
      expect(
        AiCurationManager.buildSuggestionWhere({
          status: 'accepted',
          issueType: 'duplicate-subtitle',
          origin: 'deterministic-rule'
        })
      ).to.deep.equal({
        status: 'accepted',
        issueType: 'duplicate-subtitle',
        origin: 'deterministic-rule'
      })
    })
  })

  describe('buildSuggestionSummary', () => {
    it('groups rows by status, issue type, and origin', () => {
      const summary = AiCurationManager.buildSuggestionSummary([
        { status: 'accepted', issueType: 'duplicate-subtitle', origin: 'deterministic-rule' },
        { status: 'accepted', issueType: 'duplicate-subtitle', origin: 'deterministic-rule' },
        { status: 'rejected', issueType: null, origin: null },
        { status: 'reverted', issueType: 'duplicate-subtitle', origin: 'deterministic-rule' }
      ])

      expect(summary.total).to.equal(4)
      expect(summary.byStatus).to.deep.equal({ accepted: 2, rejected: 1, reverted: 1 })
      expect(summary.byIssueType).to.deep.equal({ 'duplicate-subtitle': 3, legacy: 1 })
      expect(summary.byOrigin).to.deep.equal({ 'deterministic-rule': 3, legacy: 1 })
      expect(summary.legacy).to.equal(1)
      expect(summary.deterministic).to.equal(3)
    })
  })
})
