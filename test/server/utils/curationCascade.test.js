const { expect } = require('chai')
const { gate, runCascade, DEFAULT_DELTA } = require('../../../server/utils/curationCascade')

describe('curationCascade', () => {
  describe('gate', () => {
    it('routes confidence into accept/reject/escalate around the 0.5 +/- delta band', () => {
      expect(gate(0.9)).to.equal('accept')
      expect(gate(0.1)).to.equal('reject')
      expect(gate(0.5)).to.equal('escalate')
      expect(gate(0.5 + DEFAULT_DELTA)).to.equal('accept')
      expect(gate(0.5 - DEFAULT_DELTA)).to.equal('reject')
    })

    it('honors a custom delta', () => {
      expect(gate(0.6, 0.05)).to.equal('accept')
      expect(gate(0.6, 0.2)).to.equal('escalate')
    })
  })

  describe('runCascade', () => {
    const accept = (field) => ({ field, verdict: 'accept', action: 'rewrite', proposedValue: 'x', confidence: 1, evidence: [], stage: 'a', model: null })
    const escalate = (field) => ({ field, verdict: 'escalate', action: 'flag', proposedValue: '', confidence: 0.5, evidence: [], stage: 'b', model: null })

    it('stops at the first non-escalate verdict', async () => {
      const calls = []
      const result = await runCascade({ field: 'subtitle' }, [
        (ctx) => { calls.push('s1'); return accept(ctx.field) },
        (ctx) => { calls.push('s2'); return accept(ctx.field) }
      ])
      expect(calls).to.deep.equal(['s1'])
      expect(result.verdict).to.equal('accept')
    })

    it('falls through escalate stages and returns the last result', async () => {
      const result = await runCascade({ field: 'subtitle' }, [
        (ctx) => escalate(ctx.field),
        (ctx) => escalate(ctx.field)
      ])
      expect(result.verdict).to.equal('escalate')
      expect(result.stage).to.equal('b')
    })

    it('skips stages that return null and returns null when no stage produces a result', async () => {
      const result = await runCascade({ field: 'subtitle' }, [() => null, () => null])
      expect(result).to.equal(null)
    })

    it('awaits async stages', async () => {
      const result = await runCascade({ field: 'subtitle' }, [async (ctx) => accept(ctx.field)])
      expect(result.verdict).to.equal('accept')
    })
  })
})
