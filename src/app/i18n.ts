import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './locales/de.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import { load, save } from './storage';
import type { Lang } from '../core/issues';

export const LANGS: Lang[] = ['ru', 'en', 'de'];

const saved = load<Lang>('ui-lang', 'ru');

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en }, de: { translation: de } },
  lng: LANGS.includes(saved) ? saved : 'ru',
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  save('ui-lang', lng);
  document.documentElement.lang = lng;
});

export default i18n;
