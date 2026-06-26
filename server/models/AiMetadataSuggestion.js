const { DataTypes, Model } = require('sequelize')

/**
 * A single AI-proposed change to one metadata field of a library item.
 *
 * Review-first by design: a suggestion is never auto-applied. It is created in the
 * 'pending' state and only mutates the library item when a user explicitly accepts it
 * (via the existing PATCH /api/items/:id/media path). `currentValue` is the snapshot of
 * the field at generation time, which is what makes a one-click revert and stale-detection
 * possible.
 */
class AiMetadataSuggestion extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {string} */
    this.id
    /** @type {string} */
    this.mediaType
    /** @type {string} */
    this.fieldName
    /** @type {any} snapshot of the field value when the suggestion was generated */
    this.currentValue
    /** @type {any} */
    this.proposedValue
    /** @type {string} e.g. 'ollama' */
    this.source
    /** @type {string} provider model name, e.g. 'llama3.1' */
    this.model
    /** @type {number} 0..1 */
    this.confidence
    /** @type {string} */
    this.rationale
    /** @type {string} hash of source fields, for staleness detection */
    this.sourceHash
    /** @type {string} cleanup grouping key, e.g. 'duplicate-subtitle' */
    this.issueType
    /** @type {string} 'llm' | 'deterministic-rule' */
    this.origin
    /** @type {boolean} true when safe for confirmed bulk apply */
    this.canFastApply
    /** @type {string} 'pending' | 'accepted' | 'rejected' */
    this.status
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
    /** @type {string} */
    this.libraryItemId

    // Expanded properties

    /** @type {import('./LibraryItem').LibraryItem} */
    this.libraryItem
  }

  static STATUS = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected'
  }

  /**
   * Initialize model
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        mediaType: DataTypes.STRING,
        fieldName: {
          type: DataTypes.STRING,
          allowNull: false
        },
        currentValue: DataTypes.JSON,
        proposedValue: {
          type: DataTypes.JSON,
          allowNull: false
        },
        source: DataTypes.STRING,
        model: DataTypes.STRING,
        confidence: DataTypes.FLOAT,
        rationale: DataTypes.TEXT,
        sourceHash: DataTypes.STRING,
        issueType: DataTypes.STRING,
        origin: DataTypes.STRING,
        canFastApply: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'pending'
        }
      },
      {
        sequelize,
        modelName: 'aiMetadataSuggestion'
      }
    )

    const { libraryItem } = sequelize.models
    libraryItem.hasMany(AiMetadataSuggestion, {
      onDelete: 'CASCADE'
    })
    AiMetadataSuggestion.belongsTo(libraryItem)
  }
}

module.exports = AiMetadataSuggestion
