import { expect } from 'vitest';

type SceneImageLike = { url: string };
type IssueLike = { type: string };

export function expectBlobOnlyImageUrls(images: SceneImageLike[]): void {
  const imageUrls = images.map(img => img.url);
  const blobUrls = imageUrls.filter(url => url.startsWith('blob:'));
  const figmaUrls = imageUrls.filter(url => url.startsWith('figma://'));

  expect(blobUrls.length).toBeGreaterThan(0);
  expect(figmaUrls.length).toBe(0);
}

export function expectAllImageUrlsBlob(images: SceneImageLike[]): void {
  for (const img of images) {
    expect(img.url.startsWith('blob:')).toBe(true);
  }
}

export function expectNoErrorIssues(issues: IssueLike[]): void {
  const errors = issues.filter(issue => issue.type === 'error');

  expect(errors).toEqual([]);
}
