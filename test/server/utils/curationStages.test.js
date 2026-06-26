const { expect } = require('chai')
const { deterministicSubtitleStage, ollamaDescriptorToCleanResult } = require('../../../server/utils/curationStages')

describe('curationStages', () => {
  describe('deterministicSubtitleStage', () => {
    it('accepts a duplicate-subtitle hit and carries the candidate', () => {
      const result = deterministicSubtitleStage({ libraryItemId: '1', mediaType: 'book', title: 'Dune', subtitle: 'Dune' })
      expect(result.verdict).to.equal('accept')
      expect(result.stage).to.equal('deterministic')
      expect(result.candidate.issueType).to.equal('duplicate-subtitle')
      expect(result.proposedValue).to.equal('')
    })

    it('accepts a subtitle-cruft hit when not a duplicate', () => {
      const result = deterministicSubtitleStage({ libraryItemId: '1', mediaType: 'book', title: 'Dune', subtitle: 'Unabridged' })
      expect(result.verdict).to.equal('accept')
      expect(result.candidate.issueType).to.equal('subtitle-cruft')
    })

    it('escalates when no deterministic rule matches', () => {
      const result = deterministicSubtitleStage({ libraryItemId: '1', mediaType: 'book', title: 'Dune', subtitle: 'A Novel [Unabridged]' })
      expect(result.verdict).to.equal('escalate')
      expect(result.candidate).to.equal(null)
    })
  })

  describe('ollamaDescriptorToCleanResult', () => {
    it('maps a confident clear descriptor into an accept CleanResult', () => {
      const result = ollamaDescriptorToCleanResult({ fieldName: 'subtitle', proposedValue: '', currentValue: 'Unabridged', confidence: 0.95, clear: true, rationale: 'cruft' })
      expect(result).to.deep.include({ field: 'subtitle', verdict: 'accept', proposedValue: '', stage: 'ollama', model: 'ollama' })
      expect(result.evidence).to.deep.equal(['cruft'])
    })

    it('escalates a low-confidence descriptor and defaults missing confidence to escalate', () => {
      expect(ollamaDescriptorToCleanResult({ fieldName: 'subtitle', proposedValue: 'A Novel', currentValue: 'x' }).verdict).to.equal('escalate')
      expect(ollamaDescriptorToCleanResult({ fieldName: 'subtitle', proposedValue: 'A Novel', currentValue: 'x', confidence: 0.55 }).verdict).to.equal('escalate')
    })
  })
})
