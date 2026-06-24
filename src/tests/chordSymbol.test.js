import { describe, it, expect } from 'vitest'
import { splitChordSymbol } from '../utils/chordSymbol.ts'

describe('splitChordSymbol', () => {
  it('superscripts the quality, keeping the root + accidental on the baseline', () => {
    expect(splitChordSymbol('Bb7(b9)')).toEqual({ base: 'Bb', sup: '7(b9)', bass: null })
    expect(splitChordSymbol('C7')).toEqual({ base: 'C', sup: '7', bass: null })
    expect(splitChordSymbol('F#maj7')).toEqual({ base: 'F#', sup: 'maj7', bass: null })
  })

  it('keeps a minor m on the baseline but not the m in maj', () => {
    expect(splitChordSymbol('Cm7')).toEqual({ base: 'Cm', sup: '7', bass: null })
    expect(splitChordSymbol('F#m7b5')).toEqual({ base: 'F#m', sup: '7b5', bass: null })
    expect(splitChordSymbol('Bbm(maj7)')).toEqual({ base: 'Bbm', sup: '(maj7)', bass: null })
    expect(splitChordSymbol('Cmaj9')).toEqual({ base: 'C', sup: 'maj9', bass: null })
  })

  it('puts a slash bass back on the baseline', () => {
    expect(splitChordSymbol('C7/G')).toEqual({ base: 'C', sup: '7', bass: 'G' })
    expect(splitChordSymbol('Cm7/Bb')).toEqual({ base: 'Cm', sup: '7', bass: 'Bb' })
    expect(splitChordSymbol('D/F#')).toEqual({ base: 'D', sup: '', bass: 'F#' })
  })

  it('does not mistake the slash in 6/9 for a bass note', () => {
    expect(splitChordSymbol('C6/9')).toEqual({ base: 'C', sup: '6/9', bass: null })
    expect(splitChordSymbol('Cm6/9')).toEqual({ base: 'Cm', sup: '6/9', bass: null })
    expect(splitChordSymbol('C6/9/E')).toEqual({ base: 'C', sup: '6/9', bass: 'E' })
  })

  it('leaves a bare root or non-chord text with an empty superscript', () => {
    expect(splitChordSymbol('C')).toEqual({ base: 'C', sup: '', bass: null })
    expect(splitChordSymbol('Cm')).toEqual({ base: 'Cm', sup: '', bass: null })
    expect(splitChordSymbol('N.C.')).toEqual({ base: 'N.C.', sup: '', bass: null })
    expect(splitChordSymbol('')).toEqual({ base: '', sup: '', bass: null })
  })
})
