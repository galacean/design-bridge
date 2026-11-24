import { describe, expect, it } from 'vitest';
import siteConfig, {
  isLocale,
  locales,
  messages,
  sitePages,
} from '../site.config';
import docsConfig from '../docs.config.json';

describe('site runtime configuration', () => {
  it('registers the localized home and business pages from docs config', () => {
    expect(sitePages.map(page => page.slug)).toEqual([null]);
  });

  it('keeps locale labels, default locale, and product message dictionaries aligned', () => {
    expect(siteConfig.homeHref).toBe(docsConfig.homeHref);
    expect([...locales]).toContain(siteConfig.defaultLocale);
    expect(Object.keys(siteConfig.localeLabels).sort()).toEqual([...locales].sort());
    expect(isLocale('zh-CN')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(Object.keys(messages('en')).sort()).toEqual(Object.keys(messages('zh-CN')).sort());
  });

  it('uses local data for the development site', () => {
    expect(siteConfig.dataBaseURL).toBe(import.meta.env.BASE_URL);
    expect(Object.keys(docsConfig.dataBaseUrls)).toEqual(['production']);
    expect(docsConfig.api.generation.scope).toBe('latest');
    expect(docsConfig.translationDirectory).toBe('tmp/docs-tools');
    expect('translationWorkDirectory' in docsConfig).toBe(false);
  });

  it('maps every configured API package to safe README paths for supported locales', () => {
    const packageKeys = docsConfig.api.packages.map(apiPackage => apiPackage.key).sort();
    const readmePackages = docsConfig.api.packages.filter(
      apiPackage => apiPackage.readme !== undefined,
    );

    expect(readmePackages.map(apiPackage => apiPackage.key).sort()).toEqual(packageKeys);
    for (const apiPackage of readmePackages) {
      const readme = apiPackage.readme;

      if (readme === undefined) {
        continue;
      }
      expect(Object.keys(readme.files).sort()).toEqual([...locales].sort());
      for (const filename of Object.values(readme.files)) {
        expect(filename.startsWith('/') || filename.includes('..')).toBe(false);
      }
      const runtimeReadmeFiles = siteConfig.api.packageReadmes[apiPackage.key];

      expect(runtimeReadmeFiles).toBeDefined();
      for (const [locale, filename] of Object.entries(readme.files)) {
        expect(runtimeReadmeFiles?.[locale]).toBe(
          `${apiPackage.directory}/${filename}`,
        );
      }
    }
  });

  it('provides all placeholders consumed by source, raw asset, and symbol count URL builders', () => {
    expect(siteConfig.api.sourceLinkTemplate).toContain('{commit}');
    expect(siteConfig.api.sourceLinkTemplate).toContain('{path}');
    expect(siteConfig.api.sourceLinkTemplate).toContain('{line}');
    expect(siteConfig.api.rawAssetURLTemplate).toContain('{path}');
    expect(siteConfig.api.rawAssetURLTemplate).toContain('{search}');
    for (const template of Object.values(siteConfig.api.symbolCountLabelTemplates)) {
      expect(template).toContain('{count}');
    }
  });
});
