const axios = require('axios').default
const Logger = require('../Logger')
const htmlSanitizer = require('../utils/htmlSanitizer')

/**
 * Local-first AI metadata adapter backed by Ollama's OpenAI-compatible structured-output API.
 *
 * Uses axios (already a dependency, same as every other provider in this folder) against
 * Ollama's native /api/chat endpoint with a JSON schema `format`, so swapping to an
 * OpenAI-compatible cloud endpoint later is a base-URL change, not a rewrite.
 *
 * The network call (`getSuggestions`) is deliberately thin; all validation/normalization
 * lives in the pure `parseSuggestions` method so it can be unit tested without a server.
 */
class OllamaMetadataAdapter {
  #responseTimeout = 60000

  // Fields the M0 tracer bullet is allowed to suggest changes for.
  static ALLOWED_FIELDS = ['title', 'subtitle', 'narrators']

  constructor() {}

  /**
   * The JSON schema we ask Ollama to conform its output to.
   * @returns {Object}
   */
  responseSchema() {
    return {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: OllamaMetadataAdapter.ALLOWED_FIELDS },
              value: { type: 'string' },
              clear: { type: 'boolean' },
              rationale: { type: 'string' },
              confidence: { type: 'number' }
            },
            required: ['field']
          }
        }
      },
      required: ['suggestions']
    }
  }

  /**
   * Build the Ollama /api/chat request body for a single library item's fields.
   * Pure (no network) so it can be inspected/tested.
   * @param {string} model
   * @param {{ title?: string, subtitle?: string, narrators?: string[] }} fields
   * @returns {Object}
   */
  buildRequest(model, fields) {
    const current = {
      title: fields.title ?? null,
      subtitle: fields.subtitle ?? null,
      narrators: Array.isArray(fields.narrators) ? fields.narrators : fields.narrators ? [fields.narrators] : []
    }

    const system =
      'You are a careful audiobook metadata librarian. You are given the current metadata for ONE audiobook ' +
      '(title, subtitle, narrators). Suggest a cleanup for a field ONLY when it is clearly wrong or polluted. ' +
      'Bias strongly toward leaving fields unchanged — a wrong change is worse than a missed one. ' +
      'If a field is already fine, omit it entirely.\n' +
      'TITLE / SUBTITLE: remove file-naming and source cruft — bitrate ("128kbps", "320", "64k"), format/container ' +
      'tags ("MP3", "M4B", "[Unabridged]", "(Dramatized)", "[audiobook]"), track/part-of numbers ("Track 12 of 45"), ' +
      'and standalone years that appear only as a bracketed or parenthesized tag ("{2017}", "(2021)"). Put the real ' +
      'title in "value". BUT KEEP numbers, years and punctuation that are genuinely part of the work\'s title — e.g. ' +
      '"1984", "11/22/63", "Fahrenheit 451", "2001: A Space Odyssey" — do not strip these.\n' +
      'SUBTITLE clearing: set "clear": true (and omit "value") for a subtitle ONLY when it is essentially identical ' +
      'to the title (same words, ignoring case/punctuation and a trailing format tag like "Unabridged"). NEVER clear ' +
      'a subtitle that adds real information: a descriptive subtitle ("A Novel", "A Memoir") or a series/volume name ' +
      '("Book One of The Stormlight Archive"). If unsure, leave the subtitle unchanged.\n' +
      'NARRATORS: ONLY normalize the names already provided — fix whitespace and capitalization, split combined ' +
      'entries on separators ("&", " and ", ";", "/"), drop "feat."/"with", fix mojibake, and remove duplicates. ' +
      'Return a comma-separated list in "value". NEVER add, invent, guess, or look up a narrator that is not in the ' +
      'provided list. If the provided narrators are already clean, omit the field.\n' +
      '"value" must be the ACTUAL corrected text — never a placeholder like "[Renamed title]", "corrected", or the ' +
      'field name. If you cannot produce a real corrected value, omit the field. Return only the fields you would change.'

    const user = `Current metadata:\n${JSON.stringify(current, null, 2)}`

    return {
      model,
      stream: false,
      format: this.responseSchema(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }
  }

  /**
   * Coerce a model-returned value to a trimmed string, or undefined if not usable.
   * @param {any} value
   * @returns {string|undefined}
   */
  toStringOrUndefined(value) {
    if (typeof value === 'string') return value.trim() || undefined
    if (typeof value === 'number') return String(value)
    if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      const joined = value.join(', ').trim()
      return joined || undefined
    }
    return undefined
  }

  /**
   * Normalize a field value to a comparable string for no-op detection.
   * @param {any} value
   * @returns {string}
   */
  normalizeForCompare(value) {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).join(', ').toLowerCase()
    if (value === null || value === undefined) return ''
    return String(value).trim().toLowerCase()
  }

  /**
   * Reject obvious placeholder / garbage proposals a weak model may emit instead of a real value
   * (e.g. "[Renamed title]", "corrected title", "<title>", or the field name itself).
   * @param {string} value
   * @returns {boolean}
   */
  isPlaceholder(value) {
    const v = String(value).trim()
    if (!v) return true
    if (/^\[.*\]$/.test(v)) return true // fully bracketed, e.g. [Renamed title]
    if (/^<.*>$/.test(v)) return true // angle-bracketed, e.g. <title>
    if (/\b(renamed|corrected|cleaned|placeholder)\b.*\b(title|subtitle|value|here|text)\b/i.test(v)) return true
    const lower = v.toLowerCase()
    const denylist = ['renamed title', 'corrected title', 'corrected', 'placeholder', 'n/a', 'na', 'none', 'null', 'unknown', 'tbd', 'todo', 'title', 'subtitle', 'narrator', 'narrators', 'your title here', 'cleaned title']
    return denylist.includes(lower)
  }

  /**
   * Validate + normalize the model's structured output into suggestion descriptors.
   * Pure: no network, no DB. Returns one descriptor per genuinely-changed allowed field.
   *
   * @param {string|Object} content - the model's message content (JSON string or parsed object)
   * @param {{ title?: any, subtitle?: any, narrators?: any }} sourceFields - current item values (for snapshot + no-op check)
   * @returns {Array<{ fieldName: string, currentValue: any, proposedValue: string, rationale: (string|undefined), confidence: (number|undefined), source: string }>}
   */
  parseSuggestions(content, sourceFields = {}) {
    let parsed = content
    if (typeof content === 'string') {
      try {
        parsed = JSON.parse(content)
      } catch (e) {
        throw new Error('Ollama returned malformed JSON content')
      }
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.suggestions)) {
      throw new Error('Ollama response missing a "suggestions" array')
    }

    const seenFields = new Set()
    const out = []

    for (const raw of parsed.suggestions) {
      if (!raw || typeof raw !== 'object') continue

      const fieldName = raw.field
      if (!OllamaMetadataAdapter.ALLOWED_FIELDS.includes(fieldName)) continue
      if (seenFields.has(fieldName)) continue

      const currentValue = sourceFields[fieldName]
      const currentNorm = this.normalizeForCompare(currentValue)

      let confidence
      if (typeof raw.confidence === 'number' && !isNaN(raw.confidence)) {
        confidence = Math.min(1, Math.max(0, raw.confidence))
      }
      const rationale = typeof raw.rationale === 'string' && raw.rationale.trim() ? htmlSanitizer.sanitize(raw.rationale) : undefined

      // Clear request: empty the field. Skip if it is already empty (no-op).
      if (raw.clear === true) {
        if (currentNorm === '') continue
        seenFields.add(fieldName)
        out.push({
          fieldName,
          currentValue: currentValue === undefined ? null : currentValue,
          proposedValue: '',
          clear: true,
          rationale,
          confidence,
          source: 'ollama'
        })
        continue
      }

      const proposedValue = this.toStringOrUndefined(raw.value)
      if (proposedValue === undefined) continue
      // Reject placeholder / garbage proposals a weak model may emit instead of a real value.
      if (this.isPlaceholder(proposedValue)) continue
      // Skip no-ops: the model "suggesting" the value that is already there.
      if (currentNorm === this.normalizeForCompare(proposedValue)) continue

      seenFields.add(fieldName)
      out.push({
        fieldName,
        currentValue: currentValue === undefined ? null : currentValue,
        proposedValue,
        clear: false,
        rationale,
        confidence,
        source: 'ollama'
      })
    }

    return out
  }

  /**
   * Request metadata suggestions from Ollama for one library item's fields.
   * @param {Object} opts
   * @param {string} opts.baseUrl - e.g. 'http://127.0.0.1:11434'
   * @param {string} opts.model - e.g. 'llama3.1'
   * @param {{ title?: any, subtitle?: any, narrators?: any }} opts.fields - current item values
   * @param {number} [timeout] - response timeout in ms
   * @returns {Promise<Array>} normalized suggestion descriptors
   */
  async getSuggestions({ baseUrl, model, fields }, timeout = this.#responseTimeout) {
    if (!timeout || isNaN(timeout)) timeout = this.#responseTimeout

    const url = `${baseUrl.replace(/\/$/, '')}/api/chat`
    const body = this.buildRequest(model, fields)

    Logger.debug(`[OllamaMetadataAdapter] Requesting suggestions from ${url} (model: ${model})`)

    const content = await axios
      .post(url, body, { timeout })
      .then((res) => res?.data?.message?.content)
      .catch((error) => {
        Logger.error('[OllamaMetadataAdapter] Request error', error.message)
        throw new Error(`Ollama request failed: ${error.message}`)
      })

    if (!content) {
      throw new Error('Ollama returned an empty response')
    }

    return this.parseSuggestions(content, fields)
  }
}

module.exports = OllamaMetadataAdapter
