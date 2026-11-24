import { convertIRToGE } from '@galacean/ge-ir';
import { convertLottieToIR } from '@galacean/lottie2ir';
import type { LottieJSON, LottieToIROptions } from '@galacean/lottie2ir';

export async function convertLottieToGE(source: LottieJSON, options?: LottieToIROptions) {
  const importResult = convertLottieToIR(source, options);
  const exportResult = convertIRToGE(importResult.scene);

  return {
    data: exportResult.scene,
    diagnostics: [...importResult.diagnostics, ...exportResult.diagnostics],
  };
}

export async function convertLottieTextToGE(source: string, options?: LottieToIROptions) {
  const importResult = convertLottieToIR(source, options);
  const exportResult = convertIRToGE(importResult.scene);

  return {
    data: exportResult.scene,
    diagnostics: [...importResult.diagnostics, ...exportResult.diagnostics],
  };
}
