const { DataTypes, Model } = require('sequelize')

/**
 * The human decision on an AiMetadataSuggestion. One row per accept/reject/edit action.
 * Keeps an audit trail of who resolved which suggestion and how.
 */
class AiMetadataReviewDecision extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {string} */
    this.id
    /** @type {string} 'accept' | 'reject' | 'edit' */
    this.decision
    /** @type {string} */
    this.comment
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
    /** @type {string} */
    this.suggestionId
    /** @type {string} */
    this.userId
  }

  static DECISION = {
    ACCEPT: 'accept',
    REJECT: 'reject',
    EDIT: 'edit',
    REVERT: 'revert'
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
        decision: {
          type: DataTypes.STRING,
          allowNull: false
        },
        comment: DataTypes.TEXT
      },
      {
        sequelize,
        modelName: 'aiMetadataReviewDecision'
      }
    )

    const { aiMetadataSuggestion, user } = sequelize.models
    aiMetadataSuggestion.hasMany(AiMetadataReviewDecision, {
      onDelete: 'CASCADE'
    })
    AiMetadataReviewDecision.belongsTo(aiMetadataSuggestion)

    user.hasMany(AiMetadataReviewDecision, {
      onDelete: 'SET NULL'
    })
    AiMetadataReviewDecision.belongsTo(user)
  }
}

module.exports = AiMetadataReviewDecision
