const { expect } = require('chai')
const { auditBookRows, summarizeSuggestionRows, formatAuditReport } = require('../../evals/audit/fork-db-cruft')

describe('fork DB cruft audit', () => {
  it('counts obvious metadata issues from book rows', () => {
    const result = auditBookRows([
      { title: 'Clean Book', subtitle: '', narrators: '["A Narrator"]', relPath: 'Clean Book' },
      { title: 'Dup Subtitle', subtitle: 'Dup Subtitle', narrators: '["A Narrator"]', relPath: 'Dup Subtitle' },
      { title: 'Tagged (Unabridged)', subtitle: '', narrators: '["A Narrator"]', relPath: 'Tagged' },
      { title: 'Subtitle Cruft', subtitle: 'Unabridged', narrators: '["A Narrator"]', relPath: 'Subtitle Cruft' },
      { title: 'Bad Narrators', subtitle: '', narrators: '["A, B","A, B"]', relPath: 'Bad Narrators' },
      { title: 'Liarâ€™s Oath', subtitle: '', narrators: '[]', relPath: 'Mojibake' }
    ])

    expect(result.counted).to.equal(6)
    expect(result.booksWithAny).to.equal(5)
    expect(result.counts).to.deep.equal({
      titleCruft: 1,
      subtitleDupTitle: 1,
      subtitleCruft: 1,
      narratorIssue: 1,
      mojibake: 1
    })
  })

  it('summarizes suggestion rows by status, issue type, and origin', () => {
    const result = summarizeSuggestionRows([
      { status: 'accepted', issueType: 'duplicate-subtitle', origin: 'deterministic-rule', count: 3 },
      { status: 'pending', issueType: 'title-cruft', origin: 'llm', count: 2 }
    ])

    expect(result.total).to.equal(5)
    expect(result.rows).to.deep.equal([
      { status: 'accepted', issueType: 'duplicate-subtitle', origin: 'deterministic-rule', count: 3 },
      { status: 'pending', issueType: 'title-cruft', origin: 'llm', count: 2 }
    ])
  })

  it('formats a report with DB path, counts, and suggestion summary', () => {
    const audit = auditBookRows([{ title: 'Dup Subtitle', subtitle: 'Dup Subtitle', narrators: '[]', relPath: 'Dup Subtitle' }])
    const report = formatAuditReport('db.sqlite', audit, { total: 1, rows: [{ status: 'accepted', issueType: 'duplicate-subtitle', origin: 'deterministic-rule', count: 1 }] })

    expect(report).to.contain('db: db.sqlite')
    expect(report).to.contain('books scanned: 1')
    expect(report).to.contain('### subtitleDupTitle')
    expect(report).to.contain('accepted | duplicate-subtitle | deterministic-rule | 1')
  })
})
