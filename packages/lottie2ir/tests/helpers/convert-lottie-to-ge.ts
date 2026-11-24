import { convertIRToGE } from '@galacean/ge-ir';
import { convertLottieToIR } from '@galacean/lottie2ir';
import type { LottieJSON, LottieToIROptions } from '@galacean/lottie2ir';

export async function convertLottieToGE(input: string | LottieJSON, options?: LottieToIROptions) {
  const importResult = convertLottieToIR(input, options);
  const exportResult = convertIRToGE(importResult.scene);

  return {
    scene: exportResult.scene,
    diagnostics: [...importResult.diagnostics, ...exportResult.diagnostics],
  };
}
