const { expect } = require('chai')
const { normalizeTextForCleanup, buildSourceHash, getDuplicateSubtitleCandidate, getSubtitleCruftCandidate, stripCruftTokens, SUBTITLE_CRUFT_REGEX } = require('../../../server/utils/aiCleanupRules')

describe('aiCleanupRules', () => {
  describe('normalizeTextForCleanup', () => {
    it('normalizes case, punctuation spacing, and smart quotes for comparison', () => {
      expect(normalizeTextForCleanup('  The \u201cName\u201d: A Novel  ')).to.equal('the name a novel')
      expect(normalizeTextForCleanup('The Name - A Novel')).to.equal('the name a novel')
    })

    it('returns an empty string for non-string values', () => {
      expect(normalizeTextForCleanup(null)).to.equal('')
      expect(normalizeTextForCleanup(undefined)).to.equal('')
      expect(normalizeTextForCleanup(42)).to.equal('')
    })
  })

  describe('buildSourceHash', () => {
    it('is stable for equivalent JSON-compatible values', () => {
      const a = buildSourceHash({ title: 'Dune', subtitle: 'Dune' })
      const b = buildSourceHash({ title: 'Dune', subtitle: 'Dune' })
      const c = buildSourceHash({ title: 'Dune', subtitle: 'Different' })

      expect(a).to.equal(b)
      expect(a).to.not.equal(c)
    })
  })

  describe('getDuplicateSubtitleCandidate', () => {
    it('returns a fast-applicable candidate when subtitle equals title', () => {
      const candidate = getDuplicateSubtitleCandidate({
        libraryItemId: 'item-1',
        mediaType: 'book',
        title: 'Project Hail Mary',
        subtitle: 'Project Hail Mary'
      })

      expect(candidate).to.deep.include({
        libraryItemId: 'item-1',
        mediaType: 'book',
        issueType: 'duplicate-subtitle',
        origin: 'deterministic-rule',
        fieldName: 'subtitle',
        currentValue: 'Project Hail Mary',
        proposedValue: '',
        confidence: 1,
        canFastApply: true
      })
      expect(candidate.rationale).to.equal('Subtitle duplicates the title and can be cleared.')
      expect(candidate.sourceHash).to.be.a('string').with.length(40)
    })

    it('detects duplicates after normalization', () => {
      const candidate = getDuplicateSubtitleCandidate({
        libraryItemId: 'item-1',
        mediaType: 'book',
        title: 'The Name: A Novel',
        subtitle: 'the name - a novel'
      })

      expect(candidate).to.not.equal(null)
      expect(candidate.proposedValue).to.equal('')
    })

    it('returns null when subtitle is empty or informative', () => {
      expect(getDuplicateSubtitleCandidate({ title: 'Dune', subtitle: '' })).to.equal(null)
      expect(getDuplicateSubtitleCandidate({ title: 'Dune', subtitle: 'Book One' })).to.equal(null)
      expect(getDuplicateSubtitleCandidate({ title: '', subtitle: 'Dune' })).to.equal(null)
    })
  })

  describe('stripCruftTokens', () => {
    it('removes cruft tokens, brackets, and collapses whitespace', () => {
      expect(stripCruftTokens('Unabridged')).to.equal('')
      expect(stripCruftTokens('MP3 128kbps')).to.equal('')
      expect(stripCruftTokens('[Dramatized]')).to.equal('')
      expect(stripCruftTokens('A Novel [Unabridged]')).to.equal('A Novel')
    })

    it('returns an empty string for non-string values', () => {
      expect(stripCruftTokens(null)).to.equal('')
      expect(stripCruftTokens(42)).to.equal('')
    })
  })

  describe('getSubtitleCruftCandidate', () => {
    it('fires a fast-applicable clear for whole-cruft subtitles', () => {
      const candidate = getSubtitleCruftCandidate({
        libraryItemId: 'item-1',
        mediaType: 'book',
        title: 'Project Hail Mary',
        subtitle: 'Unabridged'
      })

      expect(candidate).to.deep.include({
        libraryItemId: 'item-1',
        mediaType: 'book',
        issueType: 'subtitle-cruft',
        origin: 'deterministic-rule',
        fieldName: 'subtitle',
        currentValue: 'Unabridged',
        proposedValue: '',
        confidence: 1,
        canFastApply: true
      })
      expect(candidate.rationale).to.equal('Subtitle contains only format or quality cruft and can be cleared.')
      expect(candidate.sourceHash).to.be.a('string').with.length(40)
    })

    it('fires for bitrate and bracketed format cruft', () => {
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: 'MP3 128kbps' })).to.not.equal(null)
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: '[Dramatized]' })).to.not.equal(null)
    })

    it('skips partial-cruft subtitles that retain real information', () => {
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: 'A Novel [Unabridged]' })).to.equal(null)
    })

    it('defers to duplicate-subtitle when the subtitle duplicates the title', () => {
      expect(getSubtitleCruftCandidate({ title: 'Unabridged', subtitle: 'Unabridged' })).to.equal(null)
    })

    it('skips clean, empty, and non-cruft subtitles', () => {
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: 'Book One' })).to.equal(null)
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: '' })).to.equal(null)
      expect(getSubtitleCruftCandidate({ title: 'Dune', subtitle: '   ' })).to.equal(null)
    })
  })
})
