import { describe, expect, it } from 'vitest'
import { extractReleaseNotesFromHtml } from '../../../../src/features/changelog/parsers/github-release-html-parser'

const wrap = (inner: string) =>
  `<html><div data-test-selector="body-content"><div class="markdown-body">${inner}</div></div></html>`

describe('extractReleaseNotesFromHtml', () => {
  it('returns null when the release body markers are missing', () => {
    expect(extractReleaseNotesFromHtml('<html><body>nothing here</body></html>')).toBeNull()
    expect(
      extractReleaseNotesFromHtml('<div data-test-selector="body-content">no markdown</div>')
    ).toBeNull()
  })

  it('returns null when the markdown container never closes', () => {
    expect(
      extractReleaseNotesFromHtml(
        '<div data-test-selector="body-content"><div class="markdown-body"><p>unclosed'
      )
    ).toBeNull()
  })

  it('returns null when the markdown container tag never opens', () => {
    expect(
      extractReleaseNotesFromHtml(
        '<div data-test-selector="body-content"><div class="markdown-body'
      )
    ).toBeNull()
  })

  it('returns null when nested divs leave the container unbalanced', () => {
    // The inner <div> closes, but the markdown-body itself never does — the
    // scan runs off the end of the document with depth still positive.
    expect(
      extractReleaseNotesFromHtml(
        '<div data-test-selector="body-content"><div class="markdown-body"><div>x</div>'
      )
    ).toBeNull()
  })

  it('returns null when the release body is empty after cleanup', () => {
    expect(extractReleaseNotesFromHtml(wrap('   <p>   </p>  '))).toBeNull()
  })

  it('extracts plain paragraphs', () => {
    expect(extractReleaseNotesFromHtml(wrap('<p>Hello release</p>'))).toBe('Hello release')
  })

  it('survives nested divs inside the body', () => {
    expect(extractReleaseNotesFromHtml(wrap('<div><p>Nested</p></div><p>Tail</p>'))).toBe(
      'Nested\n\nTail'
    )
  })

  it('converts headings, lists, and inline markup to markdown', () => {
    const html = wrap(
      '<h2>Features</h2><ul><li>added <strong>bold</strong> thing</li><li>uses <code>api</code></li></ul>'
    )

    expect(extractReleaseNotesFromHtml(html)).toBe(
      '## Features\n\n- added **bold** thing\n- uses `api`'
    )
  })

  it('strips SVG icons and unknown tags', () => {
    const html = wrap('<p><svg><path d="M0 0"/></svg>clean<span> text</span></p>')

    expect(extractReleaseNotesFromHtml(html)).toBe('clean text')
  })

  it('decodes HTML entities', () => {
    expect(
      extractReleaseNotesFromHtml(wrap('<p>&lt;a&gt; &amp; &quot;b&quot; &#39;c&#39;&nbsp;!</p>'))
    ).toBe('<a> & "b" \'c\' !')
  })

  it('converts line breaks and collapses excess blank lines', () => {
    expect(extractReleaseNotesFromHtml(wrap('<p>one</p><p>two<br/>three</p>'))).toBe(
      'one\n\ntwo\nthree'
    )
  })

  it('drops carriage returns from CRLF-formatted release page HTML', () => {
    const html = wrap('<p>alpha</p>\r\n<p>beta</p>\r\n')

    const notes = extractReleaseNotesFromHtml(html)

    expect(notes).toBe('alpha\n\nbeta')
    expect(notes!.includes('\r')).toBe(false)
  })
})
