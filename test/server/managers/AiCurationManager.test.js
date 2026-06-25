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
})
