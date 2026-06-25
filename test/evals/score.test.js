const { scoreCase, aggregate, norm } = require('../../evals/score')
const { expect } = require('chai')

describe('eval score', () => {
  describe('scoreCase', () => {
    it('passes a "none" rule when no suggestion is made for the field', () => {
      const cs = scoreCase([{ field: 'title', rule: 'none' }], [])
      expect(cs.verdict).to.equal('PASS')
      expect(cs.results[0].pass).to.equal(true)
    })

    it('fails a "none" rule (false positive) when a suggestion is made', () => {
      const cs = scoreCase([{ field: 'title', rule: 'none' }], [{ fieldName: 'title', proposedValue: 'X' }])
      expect(cs.verdict).to.equal('FAIL')
      expect(cs.results[0].detail).to.match(/false positive/)
    })

    it('passes a "clear" rule for an empty/clear proposal', () => {
      const cs = scoreCase([{ field: 'subtitle', rule: 'clear' }], [{ fieldName: 'subtitle', proposedValue: '', clear: true }])
      expect(cs.results[0].pass).to.equal(true)
    })

    it('fails a "clear" rule when nothing was proposed (missed)', () => {
      const cs = scoreCase([{ field: 'subtitle', rule: 'clear' }], [])
      expect(cs.results[0].pass).to.equal(false)
      expect(cs.results[0].detail).to.match(/missed/)
    })

    it('scores a "clean" rule by shouldContain / mustNotContain', () => {
      const good = scoreCase(
        [{ field: 'title', rule: 'clean', shouldContain: ['Dune'], mustNotContain: ['128kbps'] }],
        [{ fieldName: 'title', proposedValue: 'Dune' }]
      )
      expect(good.results[0].pass).to.equal(true)

      const bad = scoreCase(
        [{ field: 'title', rule: 'clean', shouldContain: ['Dune'], mustNotContain: ['128kbps'] }],
        [{ fieldName: 'title', proposedValue: 'Dune 128kbps' }]
      )
      expect(bad.results[0].pass).to.equal(false)
    })

    it('scores an "equals" rule case-insensitively', () => {
      const cs = scoreCase([{ field: 'narrators', rule: 'set', equals: 'Wil Wheaton' }], [{ fieldName: 'narrators', proposedValue: 'wil wheaton' }])
      expect(cs.results[0].pass).to.equal(true)
    })

    it('marks a mixed result as PARTIAL', () => {
      const cs = scoreCase(
        [
          { field: 'title', rule: 'none' },
          { field: 'subtitle', rule: 'clear' }
        ],
        [{ fieldName: 'title', proposedValue: 'oops' }, { fieldName: 'subtitle', proposedValue: '', clear: true }]
      )
      expect(cs.verdict).to.equal('PARTIAL')
      expect(cs.passed).to.equal(1)
    })
  })

  describe('aggregate', () => {
    it('computes accuracy, false-positive and miss rates', () => {
      const scores = [
        scoreCase([{ field: 'title', rule: 'none' }], []), // pass (none)
        scoreCase([{ field: 'title', rule: 'none' }], [{ fieldName: 'title', proposedValue: 'x' }]), // false positive
        scoreCase([{ field: 'title', rule: 'clean', shouldContain: ['Dune'] }], []) // miss
      ]
      const agg = aggregate(scores)
      expect(agg.cases).to.equal(3)
      expect(agg.casesPass).to.equal(1)
      expect(agg.casesFail).to.equal(2)
      expect(agg.falsePositiveRate).to.equal(0.5) // 1 of 2 none-rules failed
      expect(agg.missRate).to.equal(1) // 1 of 1 change-rule missed
    })
  })

  describe('norm', () => {
    it('joins arrays and trims', () => {
      expect(norm(['A ', ' B'])).to.equal('A, B')
      expect(norm(null)).to.equal('')
      expect(norm('  x ')).to.equal('x')
    })
  })
})
