import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('csv', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(toCsv(['a', 'b'], [['x, y', 'say "hi"\nnow']])).toBe('a,b\r\n"x, y","say ""hi""\nnow"')
  })

  it('neutralises spreadsheet formula injection but keeps negative numbers', () => {
    expect(toCsv(['v'], [['=HYPERLINK("x")'], ['@SUM(A1)'], ['-45000.00'], ['+1']])).toBe(
      'v\r\n"\'=HYPERLINK(""x"")"\r\n\'@SUM(A1)\r\n-45000.00\r\n\'+1',
    )
  })

  it('renders null and undefined as empty', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,')
  })
})
