import { createMessageCatalog } from '@galacean/docs-site';
import type { DocsDataBaseURLs, DocsSiteOptions, DocsSitePageDeclaration } from '@galacean/docs-site';
import englishMessages from './src/i18n/messages/en.json';
import chineseMessages from './src/i18n/messages/zh-CN.json';
import docsConfig from './docs.config.json';

const localizedMessages = { en: englishMessages, 'zh-CN': chineseMessages } as const;

export type SiteLocale = keyof typeof localizedMessages;

const dataBaseURLs: DocsDataBaseURLs = docsConfig.dataBaseUrls;
const messageCatalog = createMessageCatalog(docsConfig.locales, localizedMessages);

export const { locales, isLocale, messages } = messageCatalog;
export const sitePages: readonly DocsSitePageDeclaration<SiteLocale>[] = docsConfig.pages;

const packageReadmes: Record<string, Record<string, string>> = {};

for (const apiPackage of docsConfig.api.packages) {
  if (apiPackage.readme === undefined) {
    continue;
  }
  packageReadmes[apiPackage.key] = Object.fromEntries(
    Object.entries(apiPackage.readme.files).map(([locale, filename]) => [
      locale,
      `${apiPackage.directory}/${filename}`,
    ]),
  );
}

const siteOrigin = import.meta.env.VITE_SITE_ORIGIN;

const siteConfig = {
  baseURL: import.meta.env.BASE_URL,
  homeHref: docsConfig.homeHref,
  dataBaseURL: dataBaseURLs?.[import.meta.env.DEV ? 'development' : 'production']
    ?? import.meta.env.BASE_URL,
  locales,
  defaultLocale: 'zh-CN',
  brandLabel: docsConfig.siteName,
  brandMarkURLs: {
    light: `${import.meta.env.BASE_URL}brand-mark.svg`,
    dark: `${import.meta.env.BASE_URL}brand-mark-dark.svg`,
  },
  githubHref: 'https://github.com/galacean/design-bridge',
  localeLabels: { en: 'English', 'zh-CN': '简体中文' },
  messages,
  ...(siteOrigin === undefined ? {} : { siteOrigin }),
  manual: docsConfig.manual !== undefined,
  api: {
    sourceLinkTemplate: docsConfig.api.sourceLinkTemplate,
    rawAssetURLTemplate: 'https://raw.githubusercontent.com/galacean/design-bridge/main/{path}{search}',
    symbolCountLabelTemplates: { en: '{count} symbols', 'zh-CN': '{count} 个符号' },
    packageReadmes,
  },
} satisfies DocsSiteOptions<SiteLocale>;

export default siteConfig;
