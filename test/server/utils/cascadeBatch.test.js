const { expect } = require('chai')
const { planLlmFields, dropResolvedDescriptors, hasCuratableField, tagLlmDescriptor } = require('../../../server/utils/cascadeBatch')

describe('cascadeBatch', () => {
  describe('planLlmFields', () => {
    it('drops resolved field keys and keeps the rest', () => {
      const out = planLlmFields({ title: 'T', subtitle: 'S', narrators: ['N'] }, new Set(['subtitle']))
      expect(out).to.deep.equal({ title: 'T', narrators: ['N'] })
      expect(out).to.not.have.property('subtitle')
    })

    it('accepts an array of resolved names and returns all fields when none resolved', () => {
      expect(planLlmFields({ title: 'T', subtitle: 'S' }, [])).to.deep.equal({ title: 'T', subtitle: 'S' })
      expect(planLlmFields({ title: 'T', subtitle: 'S' }, ['title'])).to.deep.equal({ subtitle: 'S' })
    })
  })

  describe('dropResolvedDescriptors', () => {
    it('removes descriptors for resolved fields and drops falsy entries', () => {
      const descriptors = [{ fieldName: 'subtitle', proposedValue: '' }, { fieldName: 'title', proposedValue: 'T' }, null]
      expect(dropResolvedDescriptors(descriptors, new Set(['subtitle']))).to.deep.equal([{ fieldName: 'title', proposedValue: 'T' }])
    })

    it('returns all descriptors when nothing is resolved', () => {
      const descriptors = [{ fieldName: 'title', proposedValue: 'T' }]
      expect(dropResolvedDescriptors(descriptors, [])).to.deep.equal(descriptors)
    })
  })

  describe('hasCuratableField', () => {
    it('is true when any curatable field is present and non-empty', () => {
      expect(hasCuratableField({ title: 'T' })).to.equal(true)
      expect(hasCuratableField({ narrators: ['N'] })).to.equal(true)
    })

    it('is false for empty / missing fields', () => {
      expect(hasCuratableField({ title: '', subtitle: '   ', narrators: [] })).to.equal(false)
      expect(hasCuratableField({})).to.equal(false)
      expect(hasCuratableField(null)).to.equal(false)
    })
  })

  describe('tagLlmDescriptor', () => {
    it('maps a descriptor to the persistable local-llm row attrs', () => {
      const attrs = tagLlmDescriptor({ fieldName: 'title', currentValue: 'Old', proposedValue: 'New', confidence: 0.8 }, 'qwen3:30b-a3b')
      expect(attrs).to.deep.equal({
        fieldName: 'title',
        currentValue: 'Old',
        proposedValue: 'New',
        source: 'ollama',
        model: 'qwen3:30b-a3b',
        confidence: 0.8,
        issueType: 'llm-metadata',
        origin: 'local-llm',
        canFastApply: false
      })
    })

    it('defaults missing currentValue/confidence to null', () => {
      const attrs = tagLlmDescriptor({ fieldName: 'narrators', proposedValue: 'A, B' }, 'm')
      expect(attrs.currentValue).to.equal(null)
      expect(attrs.confidence).to.equal(null)
      expect(attrs).to.include({ origin: 'local-llm', issueType: 'llm-metadata', canFastApply: false })
    })
  })
})
