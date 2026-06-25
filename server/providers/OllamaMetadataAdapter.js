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
              rationale: { type: 'string' },
              confidence: { type: 'number' }
            },
            required: ['field', 'value']
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
      'You are a careful audiobook metadata librarian. You are given the current metadata for one audiobook. ' +
      'Propose corrected values ONLY for fields that are clearly wrong, malformed, or could be cleaned up ' +
      '(e.g. stray file-naming artifacts, inconsistent narrator separators, mojibake, duplicated words). ' +
      'Do NOT invent facts you cannot infer from the given data. If a field is already fine, do not include it. ' +
      'For "narrators", return a comma-separated list. Return only fields you would change.'

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

      const proposedValue = this.toStringOrUndefined(raw.value)
      if (proposedValue === undefined) continue

      const currentValue = sourceFields[fieldName]

      // Skip no-ops: the model "suggesting" the value that's already there.
      if (this.normalizeForCompare(currentValue) === this.normalizeForCompare(proposedValue)) continue

      let confidence
      if (typeof raw.confidence === 'number' && !isNaN(raw.confidence)) {
        confidence = Math.min(1, Math.max(0, raw.confidence))
      }

      const rationale = typeof raw.rationale === 'string' && raw.rationale.trim() ? htmlSanitizer.sanitize(raw.rationale) : undefined

      seenFields.add(fieldName)
      out.push({
        fieldName,
        currentValue: currentValue === undefined ? null : currentValue,
        proposedValue,
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
