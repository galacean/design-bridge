import { CopyButton, Icon, localePath, useTheme } from '@galacean/docs-site';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { messages } from '../../../site.config';
import type { SiteLocale } from '../../../site.config';
import { HeroArtwork } from './hero-artwork';
import { homeCapabilityGroups, homePackagePaths } from './home-conversion-map';
import './home-style.css';

type CapabilityKind = (typeof homeCapabilityGroups)[number]['key'];

function PathArtwork({ kind }: { kind: CapabilityKind }) {
  const artwork = `${import.meta.env.BASE_URL}path-artwork.svg#${kind}`;

  return (
    <div className={`path-flow path-flow-${kind}`} aria-hidden="true">
      <svg className="path-art" viewBox="0 0 220 160" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <use href={artwork} />
      </svg>
    </div>
  );
}

export default function HomePage({ locale }: { locale: SiteLocale }) {
  const t = messages(locale);
  const { resolved } = useTheme();
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const installCommand = 'pnpm add @galacean/lottie2ir @galacean/ge-ir';

  return (
    <main className="home-page">
      <section className="hero">
        <HeroArtwork playing={playing} label={t.heroArtworkLabel} theme={resolved} />
        <div className="hero-content">
          <p className="overline">
            <span className="overline-dot" />
            {t.heroEyebrow}
          </p>
          <h1>
            <span>Design</span>
            <span>Bridge.</span>
          </h1>
          <p className="hero-description">{t.heroDescription}</p>
          <div className="hero-actions">
            <Link className="action" to={localePath(locale, ['manual', 'getting-started'])}>
              {t.getStarted}
              <Icon name="arrow" />
            </Link>
            <Link className="plain-action" to={localePath(locale, ['api'])}>
              {t.exploreApi}
              <Icon name="arrow" />
            </Link>
          </div>
        </div>
        <div className="hero-caption">
          <span>TYPESCRIPT / BROWSER + NODE.JS / MIT</span>
          <div className="art-label">
            <span>
              {t.heroCaption}
              <br />
              DESIGN / ANIMATION / RUNTIME
            </span>
            <button
              className="motion-toggle icon-action"
              type="button"
              aria-label={playing ? t.pauseAnimation : t.playAnimation}
              title={playing ? t.pauseAnimation : t.playAnimation}
              aria-pressed={!playing}
              onClick={() => setPlaying(value => !value)}
            >
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
          </div>
        </div>
      </section>
      <div className="format-strip">
        <span className="format-label">{t.formatStripLabel}</span>
        <span className="format-path">
          Lottie / SVG → <strong>IR</strong> ↔ GE / DSL
        </span>
        <span className="format-path">
          HTML / CSS → <strong>Figma</strong> → GE
        </span>
        <span className="format-path">
          GLSL → <strong>GE</strong>
        </span>
      </div>
      <section className="section path-section">
        <div className="section-head">
          <div>
            <p className="overline">{t.pathSectionEyebrow}</p>
            <h2>{t.pathSectionTitle}</h2>
          </div>
          <p>{t.pathSectionDescription}</p>
        </div>
        <div className="path-grid">
          {homeCapabilityGroups.map((group, index) => {
            return (
              <section className={`path-item path-item-${group.key}`} key={group.key}>
                <div className="path-summary">
                  <span className="path-meta">
                    0{index + 1} / {group.key.toUpperCase()}
                  </span>
                  <h3>{t[group.title]}</h3>
                  <p>{t[group.description]}</p>
                </div>
                <PathArtwork kind={group.key} />
                <ul className="package-links">
                  {group.packages.map(key => (
                    <li key={key}>
                      <Link to={`${localePath(locale, ['api'])}?package=${key}`}>
                        <span className="package-link-heading">
                          <code>@galacean/{key}</code>
                          <span className="package-direction">{homePackagePaths[key]}</span>
                          <Icon name="arrow" />
                        </span>
                        <span className="package-description">{t[`packages.${key}.description`]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <Link className="plain-action conversion-guide-link" to={localePath(locale, ['manual', 'conversion'])}>
          {t.conversionGuide}
          <Icon name="arrow" />
        </Link>
      </section>
      <section className="start-band">
        <div>
          <p className="overline">{t.startBandEyebrow}</p>
          <h2>{t.startBandTitle}</h2>
          <Link className="plain-action" to={localePath(locale, ['manual', 'getting-started'])}>
            {t.getStarted}
            <Icon name="arrow" />
          </Link>
        </div>
        <div className="terminal">
          <div className="terminal-head">
            <span>{t.terminalLabel}</span>
            <CopyButton value={installCommand} label={t.copy} success={t.copied} failure={t.copyFailed} />
          </div>
          <pre>{installCommand}</pre>
        </div>
      </section>
    </main>
  );
}
