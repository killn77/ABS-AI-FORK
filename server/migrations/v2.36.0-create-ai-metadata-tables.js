/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface - a sequelize QueryInterface object.
 * @property {import('../Logger')} logger - a Logger object.
 *
 * @typedef MigrationOptions
 * @property {MigrationContext} context - an object containing the migration context.
 */

const migrationVersion = '2.36.0'
const migrationName = `${migrationVersion}-create-ai-metadata-tables`
const loggerPrefix = `[${migrationVersion} migration]`

/**
 * This upward migration creates the aiMetadataSuggestions and aiMetadataReviewDecisions tables
 * used by the review-first AI metadata curation feature (fork M0 tracer bullet).
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  const DataTypes = queryInterface.sequelize.Sequelize.DataTypes

  if (await queryInterface.tableExists('aiMetadataSuggestions')) {
    logger.info(`${loggerPrefix} table "aiMetadataSuggestions" already exists`)
  } else {
    logger.info(`${loggerPrefix} creating table "aiMetadataSuggestions"`)
    await queryInterface.createTable('aiMetadataSuggestions', {
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
      // Snapshot of the field value at the moment the suggestion was generated.
      // Load-bearing: enables safe revert and stale-suggestion detection.
      currentValue: DataTypes.JSON,
      proposedValue: {
        type: DataTypes.JSON,
        allowNull: false
      },
      source: DataTypes.STRING,
      model: DataTypes.STRING,
      confidence: DataTypes.FLOAT,
      rationale: DataTypes.TEXT,
      // Hash of the source fields the suggestion was based on; if the item later
      // changes, the suggestion can be detected as stale.
      sourceHash: DataTypes.STRING,
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'pending'
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      libraryItemId: {
        type: DataTypes.UUID,
        references: {
          model: {
            tableName: 'libraryItems'
          },
          key: 'id'
        },
        allowNull: false,
        onDelete: 'CASCADE'
      }
    })
    logger.info(`${loggerPrefix} created table "aiMetadataSuggestions"`)
  }

  if (await queryInterface.tableExists('aiMetadataReviewDecisions')) {
    logger.info(`${loggerPrefix} table "aiMetadataReviewDecisions" already exists`)
  } else {
    logger.info(`${loggerPrefix} creating table "aiMetadataReviewDecisions"`)
    await queryInterface.createTable('aiMetadataReviewDecisions', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      decision: {
        type: DataTypes.STRING,
        allowNull: false
      },
      comment: DataTypes.TEXT,
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      suggestionId: {
        type: DataTypes.UUID,
        references: {
          model: {
            tableName: 'aiMetadataSuggestions'
          },
          key: 'id'
        },
        allowNull: false,
        onDelete: 'CASCADE'
      },
      userId: {
        type: DataTypes.UUID,
        references: {
          model: {
            tableName: 'users'
          },
          key: 'id'
        },
        onDelete: 'SET NULL'
      }
    })
    logger.info(`${loggerPrefix} created table "aiMetadataReviewDecisions"`)
  }

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

/**
 * This downward migration removes the aiMetadataReviewDecisions and aiMetadataSuggestions tables.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  // Drop child table first (FK dependency)
  if (await queryInterface.tableExists('aiMetadataReviewDecisions')) {
    logger.info(`${loggerPrefix} dropping table "aiMetadataReviewDecisions"`)
    await queryInterface.dropTable('aiMetadataReviewDecisions')
    logger.info(`${loggerPrefix} dropped table "aiMetadataReviewDecisions"`)
  } else {
    logger.info(`${loggerPrefix} table "aiMetadataReviewDecisions" does not exist`)
  }

  if (await queryInterface.tableExists('aiMetadataSuggestions')) {
    logger.info(`${loggerPrefix} dropping table "aiMetadataSuggestions"`)
    await queryInterface.dropTable('aiMetadataSuggestions')
    logger.info(`${loggerPrefix} dropped table "aiMetadataSuggestions"`)
  } else {
    logger.info(`${loggerPrefix} table "aiMetadataSuggestions" does not exist`)
  }

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
