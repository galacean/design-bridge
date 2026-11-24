import type { IRImageAsset } from '@galacean/animation-ir';
import { createIRResourceSource, resolveIRResourceUrl } from '@galacean/animation-ir/adapter';
import { isIRId } from '@galacean/animation-ir/validator';
import type { LottieImageAsset } from '../common/conversion-types';

function resolveLottieAssetPath(asset: LottieImageAsset): string {
  const basePath = asset.u ?? '';
  const filePath = asset.p ?? '';

  return basePath !== '' && filePath.startsWith(basePath) ? filePath : `${basePath}${filePath}`;
}

/** Converts Lottie image assets with resource paths into the shared IR Asset registry. */
export function convertLottieImageAssets(
  assets: LottieImageAsset[],
  resolveResourceUrl: (url: string) => string = resolveIRResourceUrl,
): IRImageAsset[] {
  return assets.flatMap(asset => {
    if (!isIRId(asset.id) || typeof asset.p !== 'string' || asset.p === '') {
      return [];
    }

    return [{
      id: asset.id,
      type: 'image',
      source: createIRResourceSource(resolveResourceUrl(resolveLottieAssetPath(asset))),
    }];
  });
}
