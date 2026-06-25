const OllamaMetadataAdapter = require('../../../server/providers/OllamaMetadataAdapter')
const { expect } = require('chai')

describe('OllamaMetadataAdapter', () => {
  let adapter

  beforeEach(() => {
    adapter = new OllamaMetadataAdapter()
  })

  describe('buildRequest', () => {
    it('builds a non-streaming chat request with the JSON schema format', () => {
      const body = adapter.buildRequest('llama3.1', { title: 'The Hobbit', narrators: ['Andy Serkis'] })
      expect(body.model).to.equal('llama3.1')
      expect(body.stream).to.equal(false)
      expect(body.format).to.be.an('object')
      expect(body.format.required).to.include('suggestions')
      expect(body.messages).to.have.lengthOf(2)
      expect(body.messages[0].role).to.equal('system')
      expect(body.messages[1].role).to.equal('user')
      expect(body.messages[1].content).to.include('The Hobbit')
    })

    it('coerces a single narrator string into an array in the prompt', () => {
      const body = adapter.buildRequest('m', { narrators: 'Solo Narrator' })
      expect(body.messages[1].content).to.include('Solo Narrator')
    })
  })

  describe('parseSuggestions', () => {
    it('throws on malformed JSON content', () => {
      expect(() => adapter.parseSuggestions('{not json', {})).to.throw('malformed JSON')
    })

    it('throws when the suggestions array is missing', () => {
      expect(() => adapter.parseSuggestions({ foo: 'bar' }, {})).to.throw('suggestions')
    })

    it('accepts a JSON string and returns normalized descriptors', () => {
      const content = JSON.stringify({
        suggestions: [{ field: 'title', value: 'The Hobbit', rationale: 'Removed stray suffix', confidence: 0.9 }]
      })
      const result = adapter.parseSuggestions(content, { title: 'The Hobbit [Unabridged]' })
      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.include({ fieldName: 'title', proposedValue: 'The Hobbit', source: 'ollama', confidence: 0.9 })
      expect(result[0].currentValue).to.equal('The Hobbit [Unabridged]')
      expect(result[0].rationale).to.be.a('string').and.to.include('stray')
    })

    it('ignores fields that are not in the allowed list', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'publisher', value: 'Penguin' }] }, {})
      expect(result).to.have.lengthOf(0)
    })

    it('skips no-op suggestions (proposed equals current, case/space-insensitive)', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'title', value: 'the hobbit  ' }] }, { title: 'The Hobbit' })
      expect(result).to.have.lengthOf(0)
    })

    it('compares against array-valued current fields (narrators)', () => {
      const noop = adapter.parseSuggestions({ suggestions: [{ field: 'narrators', value: 'Rob Inglis, Andy Serkis' }] }, { narrators: ['Rob Inglis', 'Andy Serkis'] })
      expect(noop).to.have.lengthOf(0)

      const changed = adapter.parseSuggestions({ suggestions: [{ field: 'narrators', value: 'Andy Serkis' }] }, { narrators: ['Rob Inglis'] })
      expect(changed).to.have.lengthOf(1)
      expect(changed[0].proposedValue).to.equal('Andy Serkis')
    })

    it('clamps confidence into the 0..1 range', () => {
      const high = adapter.parseSuggestions({ suggestions: [{ field: 'title', value: 'New', confidence: 1.5 }] }, { title: 'Old' })
      expect(high[0].confidence).to.equal(1)
      const low = adapter.parseSuggestions({ suggestions: [{ field: 'subtitle', value: 'New Sub', confidence: -3 }] }, { subtitle: 'Old Sub' })
      expect(low[0].confidence).to.equal(0)
    })

    it('drops a suggestion whose value is empty or non-coercible', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'title', value: '   ' }, { field: 'subtitle', value: {} }] }, { title: 'X', subtitle: 'Y' })
      expect(result).to.have.lengthOf(0)
    })

    it('dedupes repeated fields, keeping the first', () => {
      const result = adapter.parseSuggestions(
        { suggestions: [{ field: 'title', value: 'First' }, { field: 'title', value: 'Second' }] },
        { title: 'Original' }
      )
      expect(result).to.have.lengthOf(1)
      expect(result[0].proposedValue).to.equal('First')
    })

    it('uses null as the snapshot when the current field is undefined', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'subtitle', value: 'A Subtitle' }] }, {})
      expect(result).to.have.lengthOf(1)
      expect(result[0].currentValue).to.equal(null)
    })

    it('rejects fully-bracketed placeholder proposals (e.g. "[Renamed title]")', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'title', value: '[Renamed title]' }] }, { title: 'The Martian' })
      expect(result).to.have.lengthOf(0)
    })

    it('rejects denylisted placeholder phrases', () => {
      const result = adapter.parseSuggestions(
        { suggestions: [{ field: 'title', value: 'corrected title' }, { field: 'subtitle', value: '<title>' }] },
        { title: 'X', subtitle: 'Y' }
      )
      expect(result).to.have.lengthOf(0)
    })

    it('honors clear=true by proposing an empty value (and flags it)', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'subtitle', clear: true, rationale: 'duplicates the title' }] }, { title: 'The Martian', subtitle: 'The Martian' })
      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.include({ fieldName: 'subtitle', proposedValue: '', clear: true, source: 'ollama' })
      expect(result[0].currentValue).to.equal('The Martian')
    })

    it('skips a clear request when the field is already empty', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'subtitle', clear: true }] }, { title: 'The Martian', subtitle: '' })
      expect(result).to.have.lengthOf(0)
    })

    it('tags normal (non-clear) suggestions with clear:false', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'title', value: 'The Martian' }] }, { title: 'The Martian [Unabridged]' })
      expect(result).to.have.lengthOf(1)
      expect(result[0].clear).to.equal(false)
    })

    it('treats a removal word ("clear") as a clear for a non-title field', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'subtitle', value: 'clear' }] }, { title: 'The Martian', subtitle: 'The Martian' })
      expect(result).to.have.lengthOf(1)
      expect(result[0]).to.include({ fieldName: 'subtitle', proposedValue: '', clear: true })
    })

    it('treats "(remove)" / "Empty" as clear intent', () => {
      const r1 = adapter.parseSuggestions({ suggestions: [{ field: 'narrators', value: '(remove)' }] }, { narrators: ['Someone'] })
      expect(r1).to.have.lengthOf(1)
      expect(r1[0].clear).to.equal(true)
      const r2 = adapter.parseSuggestions({ suggestions: [{ field: 'subtitle', value: 'Empty' }] }, { subtitle: 'A duplicate' })
      expect(r2[0].clear).to.equal(true)
    })

    it('never clears a title even if the model says "clear"', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'title', value: 'clear' }] }, { title: 'The Martian' })
      expect(result).to.have.lengthOf(0)
    })

    it('drops a clear-intent value when the field is already empty', () => {
      const result = adapter.parseSuggestions({ suggestions: [{ field: 'subtitle', value: 'clear' }] }, { subtitle: '' })
      expect(result).to.have.lengthOf(0)
    })
  })
})
