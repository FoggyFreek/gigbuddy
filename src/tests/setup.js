import '@testing-library/jest-dom'
import i18n from '../i18n/index.ts'

// Components that call useTranslation() need i18next initialized; importing the
// config side-effect here covers suites that render components directly (not via
// main.tsx). Pin the language to English so detection (localStorage / navigator)
// can't make assertions depend on prior tests or the host locale.
void i18n.changeLanguage('en')

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })
}
