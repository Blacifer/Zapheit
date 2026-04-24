import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en';
import hi from './locales/hi';

const LANG_KEY = 'zapheit_language';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
    },
    // Respect user's saved choice first, then browser language, then English
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANG_KEY,
      caches: ['localStorage'],
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'hi'],
    interpolation: {
      // React already escapes values
      escapeValue: false,
    },
  });

export default i18n;
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi',   nativeLabel: 'हिंदी' },
] as const;
export type LangCode = typeof SUPPORTED_LANGUAGES[number]['code'];
