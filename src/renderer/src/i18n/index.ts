import { loggerService } from '@logger'
import { defaultLanguage } from '@shared/config/constant'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Original translation
import enUS from './locales/en-us.json'
import zhCN from './locales/zh-cn.json'
import zhTW from './locales/zh-tw.json'
// Machine translation
import elGR from './translate/el-gr.json'
import esES from './translate/es-es.json'
import frFR from './translate/fr-fr.json'
import jaJP from './translate/ja-jp.json'
import ptPT from './translate/pt-pt.json'
import ruRU from './translate/ru-ru.json'

const logger = loggerService.withContext('I18N')

const resources = Object.fromEntries(
  [
    ['en-US', enUS],
    ['ja-JP', jaJP],
    ['ru-RU', ruRU],
    ['zh-CN', zhCN],
    ['zh-TW', zhTW],
    ['el-GR', elGR],
    ['es-ES', esES],
    ['fr-FR', frFR],
    ['pt-PT', ptPT]
  ].map(([locale, translation]) => [locale, { translation }])
)

// Inject missing i18n keys to avoid runtime Missing key errors
// Only provide safe fallbacks (zh-CN and en-US). Other locales will fallback to defaultLanguage
try {
  const ensureNested = (obj: any, path: string[]) => {
    let cur = obj
    for (const key of path) {
      cur[key] = cur[key] ?? {}
      cur = cur[key]
    }
    return cur
  }

  // zh-CN
  if (resources['zh-CN']) {
    const zh = (resources['zh-CN'] as any).translation
    ensureNested(zh, ['common'])
    zh.common = { ...zh.common, undo: '上一步', redo: '下一步' }

    ensureNested(zh, ['settings', 'general'])
    zh.settings.general = { ...zh.settings.general, image_edit: '编辑图片' }

    ensureNested(zh, ['imageEditor'])
    zh.imageEditor = {
      title: '编辑图片',
      confirm: '确认编辑',
      helpText:
        '提示：按住空格键并拖动鼠标可平移图片，按住Ctrl/Cmd并滚动鼠标可缩放图片，鼠标左键裁剪，右键取消选中。',
      uploadHint: '点击上传图片',
      zoom: '缩放',
      zoomOut: '缩小',
      zoomIn: '放大',
      actions: '操作',
      reset: '重置',
      rotateFlip: '旋转与翻转',
      rotateLeft: '左转90°',
      rotateRight: '右转90°',
      flipHorizontal: '水平翻转',
      flipVertical: '垂直翻转',
      brightness: '亮度',
      contrast: '对比度',
      saturation: '饱和度'
    }
  }

  // en-US
  if (resources['en-US']) {
    const en = (resources['en-US'] as any).translation
    ensureNested(en, ['common'])
    en.common = { ...en.common, undo: 'Undo', redo: 'Redo' }

    ensureNested(en, ['settings', 'general'])
    en.settings.general = { ...en.settings.general, image_edit: 'Edit Image' }

    ensureNested(en, ['imageEditor'])
    en.imageEditor = {
      title: 'Edit Image',
      confirm: 'Apply',
      helpText:
        'Tip: Hold Space to pan; hold Ctrl/Cmd and scroll to zoom. Left click to crop, right click to clear selection.',
      uploadHint: 'Click to upload image',
      zoom: 'Zoom',
      zoomOut: 'Zoom Out',
      zoomIn: 'Zoom In',
      actions: 'Actions',
      reset: 'Reset',
      rotateFlip: 'Rotate & Flip',
      rotateLeft: 'Rotate Left 90°',
      rotateRight: 'Rotate Right 90°',
      flipHorizontal: 'Flip Horizontal',
      flipVertical: 'Flip Vertical',
      brightness: 'Brightness',
      contrast: 'Contrast',
      saturation: 'Saturation'
    }
  }
} catch (e) {
  logger.warn('Failed to inject fallback translation keys', e as Error)
}

export const getLanguage = () => {
  return localStorage.getItem('language') || navigator.language || defaultLanguage
}

export const getLanguageCode = () => {
  return getLanguage().split('-')[0]
}

i18n.use(initReactI18next).init({
  resources,
  lng: getLanguage(),
  fallbackLng: defaultLanguage,
  interpolation: {
    escapeValue: false
  },
  saveMissing: true,
  missingKeyHandler: (_1, _2, key) => {
    logger.error(`Missing key: ${key}`)
  }
})

export default i18n
