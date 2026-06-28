import { describe, expect, it } from 'vitest'
import { resources } from '../i18n/index.ts'

const en = resources.en
const nl = resources.nl

function collectLeaves(obj, prefix = '') {
  const leaves = {}
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null) {
      Object.assign(leaves, collectLeaves(v, path))
    } else {
      leaves[path] = String(v)
    }
  }
  return leaves
}

// Extracts {{token}} and {{token, formatter}} variable names (including unescaped {{- token}}).
function interpolationTokens(str) {
  return new Set([...str.matchAll(/\{\{-?\s*([\w.]+)(?:\s*,[^}]*)?\}\}/g)].map(m => m[1]))
}

const namespaces = Object.keys(en)

describe('i18n', () => {
  for (const ns of namespaces) {
    const enLeaves = collectLeaves(en[ns])
    const nlLeaves = collectLeaves(nl[ns])

    describe(ns, () => {
      it('nl has no extra keys beyond en', () => {
        const extra = Object.keys(nlLeaves).filter(k => !(k in enLeaves))
        expect(extra, `Stray nl keys: ${extra.join(', ')}`).toEqual([])
      })

      it('nl interpolation tokens match en', () => {
        const mismatches = []
        for (const [path, enVal] of Object.entries(enLeaves)) {
          const nlVal = nlLeaves[path]
          if (nlVal === undefined) continue // missing keys are caught by tsc / DeepKeyShape
          const enTokens = interpolationTokens(enVal)
          const nlTokens = interpolationTokens(nlVal)
          const missing = [...enTokens].filter(t => !nlTokens.has(t))
          const extra = [...nlTokens].filter(t => !enTokens.has(t))
          if (missing.length || extra.length)
            mismatches.push({ path, enVal, nlVal, missing, extra })
        }
        expect(mismatches).toEqual([])
      })
    })
  }

  it.each(['en', 'nl'])('keeps reusable UI copy in shared keys for %s', (language) => {
    const resource = resources[language]

    expect(resource.common).toHaveProperty('confirmation.cannotUndo')
    expect(resource.common).toHaveProperty('aria.back')
    expect(resource.common).toHaveProperty('aria.close')
    expect(resource.common.csvImport).toEqual(expect.objectContaining({
      chooseFile: expect.any(String),
      notMapped: expect.any(String),
      showing: expect.any(String),
      willImport_one: expect.any(String),
      willImport_other: expect.any(String),
      importError: expect.any(String),
      importButton_one: expect.any(String),
      importButton_other: expect.any(String),
    }))
    expect(resource.gigs.shareEditor).toEqual(expect.objectContaining({
      accentColorAria: expect.any(String),
      darkLogo: expect.any(String),
      photoZoom: expect.any(String),
      photoPan: expect.any(String),
      markWidth: expect.any(String),
      markHeight: expect.any(String),
      uploadPhoto: expect.any(String),
      deletePhotoAria: expect.any(String),
      uploadFailed: expect.any(String),
      deleteFailed: expect.any(String),
    }))

    for (const namespace of ['contacts', 'songs', 'venues']) {
      expect(resource[namespace].import).not.toHaveProperty('chooseFile')
      expect(resource[namespace].import).not.toHaveProperty('notMapped')
      expect(resource[namespace].import).not.toHaveProperty('showing')
      expect(resource[namespace].import).not.toHaveProperty('willImport_one')
      expect(resource[namespace].import).not.toHaveProperty('importButton_one')
    }
    expect(resource.gigs.gigShare).not.toHaveProperty('accentColorAria')
    expect(resource.gigs.gigShare).not.toHaveProperty('uploadFailed')
    expect(resource.gigs.tourShare).not.toHaveProperty('accentColorAria')
    expect(resource.gigs.tourShare).not.toHaveProperty('uploadFailed')
  })
})
