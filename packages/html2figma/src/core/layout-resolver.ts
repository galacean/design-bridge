import type { SceneNode, AutoLayout } from '../types';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }

  return value;
}

function rangeOverlapRatio(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
  const minSpan = Math.max(0.0001, Math.min(aEnd - aStart, bEnd - bStart));

  return clamp01(overlap / minSpan);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }

  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeAxisFlowScore(ordered: SceneNode[], axis: 'VERTICAL' | 'HORIZONTAL'): number {
  if (ordered.length < 2) {
    return 0;
  }

  const minProgressStep = 1;

  let progressionCount = 0;
  let dominanceCount = 0;
  let crossOverlapSum = 0;

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];

    const prevStartX = prev.x || 0;
    const prevStartY = prev.y || 0;
    const currStartX = curr.x || 0;
    const currStartY = curr.y || 0;

    const dx = currStartX - prevStartX;
    const dy = currStartY - prevStartY;

    if (axis === 'VERTICAL') {
      if (dy >= minProgressStep) {
        progressionCount += 1;
      }
      if (Math.abs(dy) >= Math.abs(dx) * 1.05) {
        dominanceCount += 1;
      }
      crossOverlapSum += rangeOverlapRatio(
        prev.x || 0,
        (prev.x || 0) + (prev.width || 0),
        curr.x || 0,
        (curr.x || 0) + (curr.width || 0),
      );
    } else {
      if (dx >= minProgressStep) {
        progressionCount += 1;
      }
      if (Math.abs(dx) >= Math.abs(dy) * 1.05) {
        dominanceCount += 1;
      }
      crossOverlapSum += rangeOverlapRatio(
        prev.y || 0,
        (prev.y || 0) + (prev.height || 0),
        curr.y || 0,
        (curr.y || 0) + (curr.height || 0),
      );
    }
  }

  const edgeCount = ordered.length - 1;
  const progressionRatio = progressionCount / edgeCount;
  const dominanceRatio = dominanceCount / edgeCount;
  const overlapRatio = crossOverlapSum / edgeCount;

  return clamp01(progressionRatio * 0.2 + dominanceRatio * 0.5 + overlapRatio * 0.3);
}

function hasSeverePrimaryAxisOverlap(ordered: SceneNode[], axis: 'VERTICAL' | 'HORIZONTAL'): boolean {
  if (ordered.length < 2) {
    return false;
  }

  let severeCount = 0;
  let edgeCount = 0;

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];

    const prevSize = axis === 'VERTICAL' ? prev.height || 0 : prev.width || 0;
    const currSize = axis === 'VERTICAL' ? curr.height || 0 : curr.width || 0;

    const gap =
      axis === 'VERTICAL'
        ? (curr.y || 0) - ((prev.y || 0) + (prev.height || 0))
        : (curr.x || 0) - ((prev.x || 0) + (prev.width || 0));

    const severeThreshold = -Math.max(8, Math.min(prevSize, currSize) * 0.4);

    if (gap < severeThreshold) {
      severeCount += 1;
    }
    edgeCount += 1;
  }

  if (edgeCount === 0) {
    return false;
  }

  return severeCount / edgeCount >= 0.4;
}

function inferCounterAlignItems(
  stackMode: 'VERTICAL' | 'HORIZONTAL',
  nodeX: number,
  nodeY: number,
  nodeWidth: number,
  nodeHeight: number,
  children: SceneNode[],
  finalLeftPadding: number,
  finalTopPadding: number,
  finalRightPadding: number,
  finalBottomPadding: number,
  options?: {
    conservativeForBlockFlow?: boolean;
  },
): 'MIN' | 'CENTER' | 'MAX' {
  if (children.length === 0) {
    return 'MIN';
  }

  const centerTolerance = 2;
  // Require high agreement: 70% of candidates must be centered
  const alignmentRatioThreshold = 0.7;

  if (stackMode === 'VERTICAL' && nodeWidth > 0) {
    const hasSymmetricPadding =
      finalLeftPadding > 1 && finalRightPadding > 1 && Math.abs(finalLeftPadding - finalRightPadding) <= 1;
    const contentLeft = hasSymmetricPadding ? nodeX + finalLeftPadding : nodeX;
    const contentRight = hasSymmetricPadding ? nodeX + nodeWidth - finalRightPadding : nodeX + nodeWidth;
    const contentWidth = Math.max(0.01, contentRight - contentLeft);

    const nonStretchChildren = children.filter(child => (child.width || 0) < contentWidth * 0.95);

    if (options?.conservativeForBlockFlow && nonStretchChildren.length === 0) {
      return 'MIN';
    }
    const candidates = nonStretchChildren.length > 0 ? nonStretchChildren : children;

    // Need at least 2 non-stretch candidates to reliably detect CENTER
    if (candidates.length < 2) {
      return 'MIN';
    }

    const centerX = contentLeft + contentWidth / 2;
    let centerCount = 0;
    let maxCount = 0;

    for (const child of candidates) {
      const childLeft = child.x || 0;
      const childRight = (child.x || 0) + (child.width || 0);
      const childCenterX = childLeft + (child.width || 0) / 2;
      const lead = childLeft - contentLeft;
      const trail = contentRight - childRight;

      // CENTER: child center is close to container center AND child has visible margins on both sides
      if (Math.abs(childCenterX - centerX) <= centerTolerance && lead > 2 && trail > 2) {
        centerCount += 1;
      }
      const maxTailAllowance = Math.max(12, contentWidth * 0.2);

      if (trail <= maxTailAllowance && lead >= trail + 6) {
        maxCount += 1;
      }
    }

    if (candidates.length > 0) {
      if (centerCount / candidates.length >= alignmentRatioThreshold) {
        return 'CENTER';
      }
      if (maxCount / candidates.length >= alignmentRatioThreshold) {
        return 'MAX';
      }
    }

    return 'MIN';
  }

  if (stackMode === 'HORIZONTAL' && nodeHeight > 0) {
    const hasSymmetricPadding =
      finalTopPadding > 1 && finalBottomPadding > 1 && Math.abs(finalTopPadding - finalBottomPadding) <= 1;
    const contentTop = hasSymmetricPadding ? nodeY + finalTopPadding : nodeY;
    const contentBottom = hasSymmetricPadding ? nodeY + nodeHeight - finalBottomPadding : nodeY + nodeHeight;
    const contentHeight = Math.max(0.01, contentBottom - contentTop);

    const nonStretchChildren = children.filter(child => (child.height || 0) < contentHeight * 0.95);

    if (options?.conservativeForBlockFlow && nonStretchChildren.length === 0) {
      return 'MIN';
    }
    const candidates = nonStretchChildren.length > 0 ? nonStretchChildren : children;

    if (candidates.length < 2) {
      return 'MIN';
    }

    const centerY = contentTop + contentHeight / 2;
    let centerCount = 0;
    let maxCount = 0;

    for (const child of candidates) {
      const childTop = child.y || 0;
      const childBottom = (child.y || 0) + (child.height || 0);
      const childCenterY = childTop + (child.height || 0) / 2;
      const lead = childTop - contentTop;
      const trail = contentBottom - childBottom;

      if (Math.abs(childCenterY - centerY) <= centerTolerance && lead > 2 && trail > 2) {
        centerCount += 1;
      }
      const maxTailAllowance = Math.max(12, contentHeight * 0.2);

      if (trail <= maxTailAllowance && lead >= trail + 6) {
        maxCount += 1;
      }
    }

    if (candidates.length > 0) {
      if (centerCount / candidates.length >= alignmentRatioThreshold) {
        return 'CENTER';
      }
      if (maxCount / candidates.length >= alignmentRatioThreshold) {
        return 'MAX';
      }
    }
  }

  return 'MIN';
}

export function inferFlowAutoLayout(node: SceneNode): AutoLayout | null {
  const children = (node.children || []).filter(child => !child.ir?.isAbsolute);

  if (children.length < 2) {
    return null;
  }

  const byY = [...children].sort((a, b) => a.y - b.y || a.x - b.x);
  const byX = [...children].sort((a, b) => a.x - b.x || a.y - b.y);

  const verticalScore = computeAxisFlowScore(byY, 'VERTICAL');
  const horizontalScore = computeAxisFlowScore(byX, 'HORIZONTAL');
  const scoreGap = Math.abs(verticalScore - horizontalScore);

  const strongScoreThreshold = 0.65;
  const weakScoreThreshold = 0.55;

  let stackMode: 'HORIZONTAL' | 'VERTICAL' | null = null;

  if (verticalScore >= strongScoreThreshold || horizontalScore >= strongScoreThreshold) {
    stackMode = verticalScore >= horizontalScore ? 'VERTICAL' : 'HORIZONTAL';
  } else if ((verticalScore >= weakScoreThreshold || horizontalScore >= weakScoreThreshold) && scoreGap >= 0.14) {
    stackMode = verticalScore >= horizontalScore ? 'VERTICAL' : 'HORIZONTAL';
  }

  if (!stackMode) {
    return null;
  }

  const display = (node.styles?.display || '').trim().toLowerCase();
  const hasIRAutoLayout = !!node.ir?.autoLayout;
  const isNonAutoLayoutBlock = !hasIRAutoLayout && (display === '' || display === 'block');

  if (isNonAutoLayoutBlock && stackMode === 'HORIZONTAL') {
    // Block elements should strongly prefer VERTICAL; only allow HORIZONTAL
    // when horizontal evidence is overwhelming.
    const horizontalLead = horizontalScore - verticalScore;

    if (horizontalLead < 0.35) {
      if (verticalScore >= weakScoreThreshold) {
        stackMode = 'VERTICAL';
      } else {
        return null;
      }
    }
  }

  const minX = Math.min(...children.map(c => c.x));
  const minY = Math.min(...children.map(c => c.y));
  const maxRight = Math.max(...children.map(c => c.x + c.width));
  const maxBottom = Math.max(...children.map(c => c.y + c.height));
  const spreadX = maxRight - minX;
  const spreadY = maxBottom - minY;

  if (Math.abs(verticalScore - horizontalScore) <= 0.06) {
    stackMode = spreadY >= spreadX ? 'VERTICAL' : 'HORIZONTAL';
  }

  const ordered = stackMode === 'VERTICAL' ? byY : byX;

  const axisDominanceRatio = stackMode === 'VERTICAL' ? spreadY / Math.max(spreadX, 1) : spreadX / Math.max(spreadY, 1);
  const axisScore = Math.max(verticalScore, horizontalScore);
  const weakAxisDominance = axisDominanceRatio < 1.08;
  const weakAxisEvidence = axisScore < 0.76;

  if (weakAxisDominance && weakAxisEvidence) {
    return null;
  }

  const primaryStarts = ordered.map(child => (stackMode === 'VERTICAL' ? child.y || 0 : child.x || 0));
  const primaryStartSpread = primaryStarts.length > 0 ? Math.max(...primaryStarts) - Math.min(...primaryStarts) : 0;
  const hasWeakPrimaryStartSpread = primaryStartSpread < 4;

  if (hasWeakPrimaryStartSpread && axisScore < 0.84) {
    return null;
  }

  if (hasSeverePrimaryAxisOverlap(ordered, stackMode)) {
    return null;
  }

  const gaps: number[] = [];

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    const gap = stackMode === 'VERTICAL' ? curr.y - (prev.y + prev.height) : curr.x - (prev.x + prev.width);

    gaps.push(gap);
  }
  let stackSpacing = gaps.length > 0 ? median(gaps) : 0;

  const negativeGaps = gaps.filter(gap => gap < 0);

  if (negativeGaps.length > 0) {
    const primarySizes = ordered
      .map(child => (stackMode === 'VERTICAL' ? child.height || 0 : child.width || 0))
      .filter(size => size > 0);
    const minPrimarySize = primarySizes.length > 0 ? Math.min(...primarySizes) : 0;
    const worstNegativeGap = Math.min(...negativeGaps);
    const negativeRatio = negativeGaps.length / Math.max(gaps.length, 1);
    const severeNegativeThreshold = -Math.max(12, minPrimarySize * 0.25);
    const hasSevereNegativeGap = worstNegativeGap < severeNegativeThreshold;

    const horizontalNegativeScoreThreshold = 0.8;
    const verticalNegativeScoreThreshold = 0.76;
    const axisNegativeThreshold =
      stackMode === 'HORIZONTAL' ? horizontalNegativeScoreThreshold : verticalNegativeScoreThreshold;

    if ((hasSevereNegativeGap || negativeRatio >= 0.5) && axisScore < axisNegativeThreshold) {
      return null;
    }
  }

  const nodeX = node.x || 0;
  const nodeY = node.y || 0;
  const nodeWidth = node.width || maxRight - minX;
  const nodeHeight = node.height || maxBottom - minY;

  const primarySize = stackMode === 'VERTICAL' ? nodeHeight : nodeWidth;
  const absSpacing = Math.abs(stackSpacing);
  const largePrimaryThreshold = Math.max(80, primarySize * 0.5);

  if (gaps.length > 0 && absSpacing > largePrimaryThreshold) {
    return null;
  }

  const nonNegativeGaps = gaps.filter(gap => gap >= 0);
  const maxNonNegativeGap = nonNegativeGaps.length > 0 ? Math.max(...nonNegativeGaps) : 0;
  const minNonNegativeGap = nonNegativeGaps.length > 0 ? Math.min(...nonNegativeGaps) : 0;

  if (nonNegativeGaps.length >= 2 && maxNonNegativeGap - minNonNegativeGap > Math.max(48, primarySize * 0.35)) {
    return null;
  }

  // Snap sub-pixel geometric padding (< 3px) to 0 — these are rendering noise
  // from text baselines, sub-pixel borders, and rounding artifacts.
  const snapSmall = (v: number) => (v < 3 ? 0 : v);
  const leftPadding = snapSmall(Math.max(minX - nodeX, 0));
  const topPadding = snapSmall(Math.max(minY - nodeY, 0));
  const rawRightPadding = snapSmall(Math.max(nodeX + nodeWidth - maxRight, 0));
  const rawBottomPadding = snapSmall(Math.max(nodeY + nodeHeight - maxBottom, 0));

  // For MIN-aligned layouts, geometric right/bottom padding is unreliable:
  // it measures empty space after children, not semantic padding.
  // Clamp trailing padding to be at most the leading padding (symmetric),
  // unless the trailing padding is close to the leading (genuinely symmetric content).
  const crossSize = stackMode === 'VERTICAL' ? nodeWidth : nodeHeight;

  // Cross-axis trailing: if children don't fill the cross-axis, the "padding"
  // is just empty space. Clamp to leading padding unless symmetric.
  let rightPadding = rawRightPadding;
  let bottomPadding = rawBottomPadding;

  if (stackMode === 'VERTICAL') {
    // Cross-axis = width: clamp right padding
    if (rawRightPadding > leftPadding + 3 && rawRightPadding > crossSize * 0.15) {
      rightPadding = leftPadding;
    }
    // Primary-axis = height: clamp bottom padding if excessive
    if (rawBottomPadding > topPadding + 3 && rawBottomPadding > nodeHeight * 0.15) {
      bottomPadding = topPadding;
    }
  } else {
    // Cross-axis = height: clamp bottom padding
    if (rawBottomPadding > topPadding + 3 && rawBottomPadding > crossSize * 0.15) {
      bottomPadding = topPadding;
    }
    // Primary-axis = width: clamp right padding if excessive
    if (rawRightPadding > leftPadding + 3 && rawRightPadding > nodeWidth * 0.15) {
      rightPadding = leftPadding;
    }
  }

  // For non-flex/grid elements, prefer CSS padding over geometric inference for all directions.
  // Geometric inference fails when children break out of padding (e.g. full-width scrollable section).
  // Only use CSS padding when geometric also shows children are inset on that edge —
  // when geometric padding ≈ 0, children reach the container edge despite CSS padding,
  // meaning CSS padding is not visually effective (e.g. scrollable overflow child).
  const styles = node.styles || {};
  const cssPadLeft = parseFloat(styles.paddingLeft || '0') || 0;
  const cssPadRight = parseFloat(styles.paddingRight || '0') || 0;
  const cssPadTop = parseFloat(styles.paddingTop || '0') || 0;
  const cssPadBottom = parseFloat(styles.paddingBottom || '0') || 0;
  const useCSSPadding = !hasIRAutoLayout && (cssPadLeft > 0 || cssPadRight > 0 || cssPadTop > 0 || cssPadBottom > 0);
  const finalLeftPadding = useCSSPadding && leftPadding >= 2 ? cssPadLeft : leftPadding;
  let finalTopPadding = useCSSPadding && topPadding >= 2 ? cssPadTop : topPadding;
  const finalRightPadding = useCSSPadding && rightPadding >= 2 ? cssPadRight : rightPadding;
  const finalBottomPadding = useCSSPadding && bottomPadding >= 2 ? cssPadBottom : bottomPadding;

  // For block-flow containers without IR auto-layout, infer base spacing from
  // child leading margins and fold negative first-child margin into top padding.
  if (isNonAutoLayoutBlock && stackMode === 'VERTICAL') {
    const marginTopOf = (child: SceneNode): number => parseFloat(child.styles?.marginTop || '0') || 0;
    const marginBottomOf = (child: SceneNode): number => parseFloat(child.styles?.marginBottom || '0') || 0;
    const positiveLeadingMargins = ordered
      .slice(1)
      .map(marginTopOf)
      .filter(v => v > 0.5);

    if (positiveLeadingMargins.length > 0) {
      const baseFlowGap = Math.min(...positiveLeadingMargins);

      if (Math.abs(stackSpacing - baseFlowGap) > 0.5) {
        stackSpacing = baseFlowGap;
      }
    }

    const firstLeadingMargin = marginTopOf(ordered[0]);

    if (useCSSPadding && firstLeadingMargin > 0.5) {
      // For block-flow containers with explicit CSS top padding, first-child
      // positive margin contributes additional inset inside the padded content box.
      finalTopPadding = Math.max(0, finalTopPadding + firstLeadingMargin);
    }
    if (firstLeadingMargin < -0.5) {
      finalTopPadding = Math.max(0, finalTopPadding + firstLeadingMargin);
    }

    // Section-like blocks often encode heading separation via first-child mb-*.
    // When spacing already matches that margin, preserve it as top padding too,
    // so the section keeps the baseline's inset rhythm.
    if (finalTopPadding < 1 && ordered.length >= 2) {
      const firstChild = ordered[0];
      const secondChild = ordered[1];
      const firstBottomMargin = marginBottomOf(firstChild);
      const secondTopMargin = marginTopOf(secondChild);
      const tag = (node.tagName || '').toUpperCase();
      const isSectionLike = tag === 'SECTION';

      if (
        isSectionLike &&
        firstBottomMargin >= 8 &&
        secondTopMargin <= 1 &&
        Math.abs((stackSpacing || 0) - firstBottomMargin) <= 1.5
      ) {
        finalTopPadding = firstBottomMargin;
      }
    }
  }

  let stackCounterAlignItems = inferCounterAlignItems(
    stackMode,
    nodeX,
    nodeY,
    nodeWidth,
    nodeHeight,
    children,
    finalLeftPadding,
    finalTopPadding,
    finalRightPadding,
    finalBottomPadding,
    {
      conservativeForBlockFlow: isNonAutoLayoutBlock,
    },
  );

  if (isNonAutoLayoutBlock && stackMode === 'VERTICAL' && stackCounterAlignItems === 'MIN') {
    const normalizedName = (node.name || '').trim().toLowerCase();
    const isSemanticRootFlow = normalizedName === 'main' || normalizedName === 'body';
    const nonStretchChildren = ordered.filter(child => (child.width || 0) < nodeWidth * 0.95);
    const hasFullWidthChild = ordered.some(child => (child.width || 0) >= nodeWidth * 0.95);

    if (isSemanticRootFlow && hasFullWidthChild && finalLeftPadding < 1 && finalRightPadding < 1) {
      // Root flow containers with zero horizontal inset typically center their
      // non-stretch children while allowing full-width children to stretch.
      stackCounterAlignItems = 'CENTER';
    }
    if (hasFullWidthChild && nonStretchChildren.length >= 2) {
      const widths = nonStretchChildren.map(child => child.width || 0).filter(w => w > 0);

      if (widths.length >= 2) {
        const maxW = Math.max(...widths);
        const minW = Math.min(...widths);
        const narrowEnough = maxW <= nodeWidth - 8;
        const uniformEnough = maxW - minW <= Math.max(4, nodeWidth * 0.03);
        const leftAnchored = nonStretchChildren.every(child => Math.abs((child.x || 0) - nodeX) <= 1.5);
        const centeredInsetChildren = nonStretchChildren.filter(child => {
          const lead = (child.x || 0) - nodeX;
          const trail = nodeX + nodeWidth - ((child.x || 0) + (child.width || 0));

          return lead > 2 && trail > 2 && Math.abs(lead - trail) <= 2;
        });
        const hasConsistentCenteredInset =
          centeredInsetChildren.length >= 2 &&
          (() => {
            const leads = centeredInsetChildren.map(child => (child.x || 0) - nodeX);

            return Math.max(...leads) - Math.min(...leads) <= 2;
          })();

        if (
          narrowEnough &&
          (uniformEnough ||
            (isSemanticRootFlow && leftAnchored && finalLeftPadding < 1 && finalRightPadding < 1) ||
            hasConsistentCenteredInset)
        ) {
          stackCounterAlignItems = 'CENTER';
        }
      }
    }
  }

  // --- stackPrimaryAlignItems detection ---
  // Detect SPACE_BETWEEN: children fill the container along the primary axis
  // with near-zero leading/trailing padding and uniform gaps
  // Detect CENTER: children are centered along the primary axis
  let stackPrimaryAlignItems: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' = 'MIN';
  const allowPrimaryAlignInference = !isNonAutoLayoutBlock;

  // Primary-align inference is conservative: only detect non-MIN alignment
  // when evidence is strong. SPACE_BETWEEN requires ≥3 children with truly
  // uniform spacing and near-zero leading/trailing margins. CENTER requires
  // significant symmetric leading/trailing space.
  if (allowPrimaryAlignInference && stackMode === 'VERTICAL' && ordered.length >= 3) {
    const totalChildrenHeight = ordered.reduce((sum, c) => sum + (c.height || 0), 0);
    const availableHeight = nodeHeight - finalTopPadding - finalBottomPadding;
    const extraSpace = availableHeight - totalChildrenHeight;

    if (extraSpace > 8 && gaps.length > 0) {
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const allGapsUniform = gaps.every(g => Math.abs(g - avgGap) <= 2);
      const firstChildTopOffset = (ordered[0].y || 0) - nodeY;
      const lastChildBottomOffset =
        nodeY + nodeHeight - ((ordered[ordered.length - 1].y || 0) + (ordered[ordered.length - 1].height || 0));

      if (allGapsUniform && Math.abs(firstChildTopOffset) <= 2 && Math.abs(lastChildBottomOffset) <= 2 && avgGap > 4) {
        stackPrimaryAlignItems = 'SPACE_BETWEEN';
      }
    }
  }

  if (allowPrimaryAlignInference && stackMode === 'HORIZONTAL' && ordered.length >= 3) {
    const totalChildrenWidth = ordered.reduce((sum, c) => sum + (c.width || 0), 0);
    const availableWidth = nodeWidth - finalLeftPadding - finalRightPadding;
    const extraSpace = availableWidth - totalChildrenWidth;

    if (extraSpace > 8 && gaps.length > 0) {
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const allGapsUniform = gaps.every(g => Math.abs(g - avgGap) <= 2);
      const firstChildLeftOffset = (ordered[0].x || 0) - nodeX;
      const lastChildRightOffset =
        nodeX + nodeWidth - ((ordered[ordered.length - 1].x || 0) + (ordered[ordered.length - 1].width || 0));

      if (allGapsUniform && Math.abs(firstChildLeftOffset) <= 2 && Math.abs(lastChildRightOffset) <= 2 && avgGap > 4) {
        stackPrimaryAlignItems = 'SPACE_BETWEEN';
      }
    }
  }

  return {
    stackMode,
    stackSpacing,
    stackVerticalPadding: finalTopPadding,
    stackHorizontalPadding: finalLeftPadding,
    stackPaddingRight: finalRightPadding,
    stackPaddingBottom: finalBottomPadding,
    stackPrimaryAlignItems,
    stackCounterAlignItems,
    // Sizing for inferred layouts: use IR sizing signals when available
    // Don't emit stackPrimarySizing for inferred layouts — let Figma use defaults
    stackCounterSizing: (() => {
      const sizing = node.ir?.sizing;

      if (stackMode === 'HORIZONTAL') {
        // Counter axis is height: FIXED only when explicit height constraint
        return sizing && sizing.heightMode === 'FIXED' ? 'FIXED' : 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
      }
      // VERTICAL: counter axis is width — FIXED when element has a defined width (FIXED or FILL)
      if (sizing && (sizing.widthMode === 'FIXED' || sizing.widthMode === 'FILL')) {
        return 'FIXED';
      }

      return 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
    })(),
    stackReverseZIndex: false,
    _inferredAxisScore: Math.max(verticalScore, horizontalScore),
    _inferredChildCount: children.length,
    _inferredGapCount: gaps.length,
  };
}

export function inferSingleChildContainerLayout(node: SceneNode): AutoLayout | null {
  const children = node.children || [];
  const nonAbsoluteChildren = children.filter(child => !child.ir?.isAbsolute);

  if (nonAbsoluteChildren.length !== 1) {
    return null;
  }

  // Skip when IR autoLayout is available — single-child inference is a fallback
  if (node.ir?.autoLayout) {
    return null;
  }

  // Accept any block-level container or semantic container
  const normalizedName = (node.name || '').trim().toLowerCase();
  const semanticTokens = ['main', 'section', 'header', 'footer', 'nav', 'container', 'body'];
  const isSemanticContainer = semanticTokens.some(
    token => normalizedName === token || normalizedName.includes(token),
  );
  const isBlockLevel = node.ir?.sizing?.isBlockLevel ?? false;
  const display = (node.styles?.display || '').trim().toLowerCase();
  const isBlockDisplay = display === '' || display === 'block' || display === 'list-item' || display === 'flow-root';

  if (!isSemanticContainer && !isBlockLevel && !isBlockDisplay) {
    return null;
  }

  const child = nonAbsoluteChildren[0];
  const nodeX = node.x || 0;
  const nodeY = node.y || 0;
  const nodeWidth = node.width || 0;
  const nodeHeight = node.height || 0;

  const snapSmallPad = (v: number) => (v < 3 ? 0 : v);
  const leftPadding = snapSmallPad(Math.max((child.x || 0) - nodeX, 0));
  const topPadding = snapSmallPad(Math.max((child.y || 0) - nodeY, 0));
  const rightPadding = snapSmallPad(Math.max(nodeX + nodeWidth - ((child.x || 0) + (child.width || 0)), 0));
  const bottomPadding = snapSmallPad(Math.max(nodeY + nodeHeight - ((child.y || 0) + (child.height || 0)), 0));

  // Detect primary axis centering: child is vertically centered within container
  let stackPrimaryAlignItems: 'MIN' | 'CENTER' = 'MIN';

  if (topPadding > 2 && Math.abs(topPadding - bottomPadding) <= 3) {
    stackPrimaryAlignItems = 'CENTER';
  }

  // Detect cross-axis (horizontal) centering for single child
  let stackCounterAlignItems: 'MIN' | 'CENTER' | 'MAX' = 'MIN';

  if (leftPadding > 2 && rightPadding > 2 && Math.abs(leftPadding - rightPadding) <= 3) {
    // Child is horizontally centered — symmetric left/right padding
    const childWidth = child.width || 0;

    if (childWidth < nodeWidth * 0.95) {
      stackCounterAlignItems = 'CENTER';
    }
  }

  return {
    stackMode: 'VERTICAL',
    stackSpacing: 0,
    stackVerticalPadding: topPadding,
    stackHorizontalPadding: leftPadding,
    stackPaddingRight: rightPadding,
    stackPaddingBottom: bottomPadding,
    stackPrimaryAlignItems,
    stackCounterAlignItems,
    stackCounterSizing: 'FIXED',
    stackReverseZIndex: false,
  };
}

function mergeInferredIntoLayout(al: AutoLayout, inferred: AutoLayout | null): void {
  if (!inferred || inferred.stackMode !== al.stackMode) {
    return;
  }

  // Merge spacing: adopt inferred gap when IR has zero spacing.
  // CSS gap: 0 is common but children may have margins that create visual spacing;
  // Figma has no child-margin concept, so this translation is necessary.
  const isNearZero = (v: number | undefined) => Math.abs(v || 0) < 0.5;
  const inferredChildCount = inferred._inferredChildCount || 0;
  const inferredGapCount = inferred._inferredGapCount || 0;
  const inferredAxisScore = inferred._inferredAxisScore || 0;
  const hasSpacingEvidence = inferredChildCount >= 2 && inferredGapCount >= 1 && inferredAxisScore >= 0.58;

  if (hasSpacingEvidence && isNearZero(al.stackSpacing) && !isNearZero(inferred.stackSpacing)) {
    al.stackSpacing = inferred.stackSpacing;
  }

  // CSS padding and alignment are authoritative — do not override with geometric inference.
}

export function resolveAutoLayout(node: SceneNode): AutoLayout | null {
  const inferred = inferFlowAutoLayout(node);

  // Prefer IR autoLayout when available — it was computed from CSS in the browser context.
  // CSS flex-direction/grid is authoritative; geometric inference never overrides it.
  const irAL = node.ir?.autoLayout;

  if (irAL) {
    const al: AutoLayout = {
      stackMode: irAL.stackMode,
      stackSpacing: irAL.stackSpacing,
      stackCounterSpacing: irAL.stackCounterSpacing,
      stackVerticalPadding: irAL.stackVerticalPadding,
      stackHorizontalPadding: irAL.stackHorizontalPadding,
      stackPaddingRight: irAL.stackPaddingRight,
      stackPaddingBottom: irAL.stackPaddingBottom,
      stackPrimaryAlignItems: irAL.stackPrimaryAlignItems,
      stackCounterAlignItems: irAL.stackCounterAlignItems,
      stackWrap: irAL.stackWrap,
      stackPrimarySizing: irAL.stackPrimarySizing,
      stackCounterSizing: irAL.stackCounterSizing,
      stackReverseZIndex: false,
    };

    if (irAL.gridColumns) {
      al._gridColumns = irAL.gridColumns;
    }
    if (irAL.gridRows) {
      al._gridRows = irAL.gridRows;
    }
    if (irAL.gridRowGap !== undefined) {
      al.gridRowGap = irAL.gridRowGap;
    }
    if (irAL.gridColumnGap !== undefined) {
      al.gridColumnGap = irAL.gridColumnGap;
    }

    const nonAbsoluteChildren = (node.children || []).filter(child => !child.ir?.isAbsolute);

    if (nonAbsoluteChildren.length <= 1) {
      if (al.stackPrimaryAlignItems === 'SPACE_BETWEEN' || al.stackPrimaryAlignItems === 'SPACE_EVENLY') {
        al.stackPrimaryAlignItems = 'MIN';
      }
      if ((al.stackSpacing || 0) !== 0) {
        al.stackSpacing = 0;
      }
    }

    // Convert SPACE_EVENLY to MIN + explicit spacing + inclusive padding.
    // Figma has no CSS `space-around` equivalent; SPACE_EVENLY distributes
    // differently (equal gaps everywhere vs half-gap at edges).  Converting
    // to MIN with geometry-derived values produces pixel-perfect static output.
    if (al.stackPrimaryAlignItems === 'SPACE_EVENLY' && nonAbsoluteChildren.length >= 2) {
      const isH = al.stackMode === 'HORIZONTAL';
      const sorted = [...nonAbsoluteChildren].sort((a, b) => (isH ? (a.x || 0) - (b.x || 0) : (a.y || 0) - (b.y || 0)));
      const nodeStart = isH ? node.x || 0 : node.y || 0;
      const nodeSize = isH ? node.width || 0 : node.height || 0;

      // Between-item gaps
      const gaps: number[] = [];

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const prevEnd = (isH ? prev.x || 0 : prev.y || 0) - nodeStart + (isH ? prev.width || 0 : prev.height || 0);
        const currStart = (isH ? curr.x || 0 : curr.y || 0) - nodeStart;

        gaps.push(currStart - prevEnd);
      }
      const betweenGap = gaps.length > 0 ? median(gaps) : 0;

      if (betweenGap > 0.5) {
        const firstRel = (isH ? sorted[0].x || 0 : sorted[0].y || 0) - nodeStart;
        const lastChild = sorted[sorted.length - 1];
        const lastEnd =
          (isH ? lastChild.x || 0 : lastChild.y || 0) -
          nodeStart +
          (isH ? lastChild.width || 0 : lastChild.height || 0);
        const endEdge = nodeSize - lastEnd;

        al.stackPrimaryAlignItems = 'MIN';
        al.stackSpacing = Math.round(betweenGap * 100) / 100;
        if (isH) {
          al.stackHorizontalPadding = Math.round(firstRel * 100) / 100;
          al.stackPaddingRight = Math.round(endEdge * 100) / 100;
        } else {
          al.stackVerticalPadding = Math.round(firstRel * 100) / 100;
          al.stackPaddingBottom = Math.round(endEdge * 100) / 100;
        }
      }
    }

    mergeInferredIntoLayout(al, inferred);

    return al;
  }

  // No IR autoLayout — fall back to geometric inference only
  return inferred || inferSingleChildContainerLayout(node);
}
