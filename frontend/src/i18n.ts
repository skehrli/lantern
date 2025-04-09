import i18n, { init } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import translationDE from './locales/de/translation.json';
import translationEN from './locales/en/translation.json';
import translationFR from './locales/fr/translation.json';
import translationIT from './locales/it/translation.json';

const resources = {
    de: {
        translation: translationDE,
    },
    en: {
        translation: translationEN,
    },
    fr: {
        translation: translationFR,
    },
    it: {
        translation: translationIT,
    },
};

i18n
    .use(initReactI18next)
    .use(LanguageDetector)
init({
    resources,
    lng: 'de',
    fallbackLng: 'de',
    debug: true,
    interpolation: {
        escapeValue: false, // React already does escaping
    },
});

export default i18n;