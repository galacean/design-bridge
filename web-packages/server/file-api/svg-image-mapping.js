#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';

export const REMOTE_IMAGE_URL_RE = /https:\/\/[^\s"'<>)]+/g;

export function hashImageUrl(url) {
  const clean = url.split(/[?#]/)[0];

  return crypto.createHash('sha1').update(clean).digest('hex').slice(0, 16);
}

export function extOfContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();

  if (ct.includes('png')) { return 'png'; }
  if (ct.includes('jpeg') || ct.includes('jpg')) { return 'jpg'; }
  if (ct.includes('webp')) { return 'webp'; }
  if (ct.includes('avif')) { return 'avif'; }
  if (ct.includes('gif')) { return 'gif'; }
  return 'png';
}

export function localFileNameFor(url, testImagesDir, fs_ = fs) {
  const base = hashImageUrl(url);

  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif']) {
    const candidate = `${base}.${ext}`;

    if (fs_.existsSync(`${testImagesDir}/${candidate}`)) {
      return candidate;
    }
  }

  return null;
}

export function mapSvgImageUrls(svgString, testImagesDir, servePath = '/test-images') {
  return svgString.replace(REMOTE_IMAGE_URL_RE, (url) => {
    const local = localFileNameFor(url, testImagesDir);

    return local ? `${servePath}/${local}` : url;
  });
}

export function extractRemoteImageUrls(svgString) {
  const seen = new Set();
  const out = [];

  for (const m of svgString.matchAll(REMOTE_IMAGE_URL_RE)) {
    const url = m[0];

    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }

  return out;
}
