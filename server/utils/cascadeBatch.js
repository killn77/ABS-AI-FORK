function toSet(resolvedFieldNames) {
  return resolvedFieldNames instanceof Set ? resolvedFieldNames : new Set(resolvedFieldNames || [])
}

/**
 * Return allFields with every resolved field key removed entirely.
 * @param {{title?: any, subtitle?: any, narrators?: any}} allFields
 * @param {Set|string[]} resolvedFieldNames
 */
function planLlmFields(allFields, resolvedFieldNames) {
  const resolved = toSet(resolvedFieldNames)
  const out = {}
  for (const key of Object.keys(allFields || {})) {
    if (!resolved.has(key)) out[key] = allFields[key]
  }
  return out
}

/**
 * Filter out falsy descriptors and any descriptor for an already-resolved field.
 * @param {Array} descriptors
 * @param {Set|string[]} resolvedFieldNames
 */
function dropResolvedDescriptors(descriptors, resolvedFieldNames) {
  const resolved = toSet(resolvedFieldNames)
  return (descriptors || []).filter((d) => d && !resolved.has(d.fieldName))
}

/**
 * True if there is at least one non-empty curatable field worth an LLM call.
 * @param {{title?: any, subtitle?: any, narrators?: any}} fields
 */
function hasCuratableField(fields) {
  if (!fields) return false
  if (typeof fields.title === 'string' && fields.title.trim()) return true
  if (typeof fields.subtitle === 'string' && fields.subtitle.trim()) return true
  if (Array.isArray(fields.narrators) && fields.narrators.length) return true
  return false
}

/**
 * Map a parsed Ollama descriptor to the persistable local-llm suggestion row attrs.
 * @param {{fieldName, currentValue?, proposedValue, confidence?}} descriptor
 * @param {string} model
 */
function tagLlmDescriptor(descriptor, model) {
  return {
    fieldName: descriptor.fieldName,
    currentValue: descriptor.currentValue ?? null,
    proposedValue: descriptor.proposedValue,
    source: 'ollama',
    model,
    confidence: descriptor.confidence ?? null,
    issueType: 'llm-metadata',
    origin: 'local-llm',
    canFastApply: false
  }
}

module.exports = { planLlmFields, dropResolvedDescriptors, hasCuratableField, tagLlmDescriptor }
