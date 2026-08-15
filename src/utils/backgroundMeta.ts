export interface BackgroundMeta {
  description: string
  credit: string
  creditUrl?: string
}

// One entry per file in /public/backgrounds, keyed by the bg_NN_<mode> id
// (filename without extension). This is the "background control": fill in
// description/credit here to have it appear as an overlay everywhere that
// background renders. Leave a field blank to omit that line — an entry with
// both fields blank renders no overlay at all.
export const BACKGROUND_META: Record<string, BackgroundMeta> = {
  bg_01_light: { description: 'Heideroosjes at PinkPop', credit: 'Erik Luyten' },
  bg_02_light: { description: '', credit: '' },
  bg_03_light: { description: '', credit: '' },
  bg_04_light: { description: 'The Killers at Rock Werchter', credit: '@robloud' },
  bg_05_light: { description: '', credit: '' },
  bg_01_dark: { description: '', credit: '' },
  bg_02_dark: { description: '', credit: '' },
  bg_03_dark: { description: '', credit: '' },
  bg_04_dark: { description: '', credit: '' },
  bg_05_dark: { description: '', credit: '' },
}

const EMPTY_META: BackgroundMeta = { description: '', credit: '' }

export function getBackgroundMeta(id: string): BackgroundMeta {
  return BACKGROUND_META[id] ?? EMPTY_META
}
