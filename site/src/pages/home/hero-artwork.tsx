import { useEffect, useRef } from 'react';
import { homeConversionEdges, homeConversionNodes } from './home-conversion-map';

export function HeroArtwork({ playing, label, theme }: { playing: boolean; label: string; theme: 'light' | 'dark' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (canvas === null || canvas === undefined || context === null || context === undefined) {
      return;
    }
    let motion = 0;
    let frame = 0;
    let lastTime: number | undefined;
    const colors = getComputedStyle(canvas);
    const color = (name: string, fallback: string) => colors.getPropertyValue(name).trim() || fallback;
    const draw = (time = 0) => {
      const bounds = canvas.getBoundingClientRect();

      if (bounds.width === 0 || bounds.height === 0) {
        lastTime = undefined;

        return;
      }
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = bounds.width;
      const height = bounds.height;
      const pixelWidth = Math.round(width * pixelRatio);
      const pixelHeight = Math.round(height * pixelRatio);

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.fillStyle = color('--art-paper', '#fcfcfa');
      context.fillRect(0, 0, width, height);
      const mobile = width <= 1000;
      const scale = mobile ? Math.min((width * 0.9) / 350, 1) : Math.min((width * 0.47) / 670, 1);
      const originX = mobile ? (width - 350 * scale) / 2 : width * 0.48;
      const artworkTop = Math.min(...homeConversionNodes.map(node => node.desktop[1]));
      const artworkBottom = Math.max(...homeConversionNodes.map(node => node.desktop[1] + node.desktop[3]));
      const originY = mobile
        ? height - 500 * scale - 55
        : (height - (artworkBottom - artworkTop) * scale) / 2 - artworkTop * scale;
      const ink = color('--site-ink', '#202320');
      const muted = color('--site-muted', '#71766f');
      const paper = color('--art-paper', '#fcfcfa');
      const line = color('--art-line', '#ced5ca');
      const red = color('--site-accent', '#d94432');
      const green = color('--site-green', '#306455');

      context.fillStyle = color('--art-grid', '#d6dcd3');
      for (let gridX = originX; gridX < width * 0.97; gridX += 24) {
        for (let gridY = mobile ? originY - 16 : 36; gridY < height - 65; gridY += 24) {
          context.fillRect(gridX, gridY, 1, 1);
        }
      }
      context.save();
      context.translate(originX, originY);
      context.scale(scale, scale);
      const text = (value: string, left: number, top: number, size = 13, fill = muted, bold = false) => {
        context.fillStyle = fill;
        context.font = `${bold ? '600' : '400'} ${size}px "IBM Plex Mono", monospace`;
        context.fillText(value, left, top);
      };
      const diamond = (left: number, top: number, fill: string) => {
        context.fillStyle = fill;
        context.beginPath();
        context.moveTo(left, top - 4);
        context.lineTo(left + 4, top);
        context.lineTo(left, top + 4);
        context.lineTo(left - 4, top);
        context.closePath();
        context.fill();
      };
      const artwork = (left: number, top: number, artworkScale: number, animated = false) => {
        context.save();
        context.translate(left, top);
        context.scale(artworkScale, artworkScale);
        context.rotate(-0.22 + (animated ? Math.sin(motion * 3) * 0.2 : 0));
        context.fillStyle = red;
        context.beginPath();
        context.roundRect(-24, -24, 48, 48, 12);
        context.fill();
        context.fillStyle = green;
        context.beginPath();
        context.arc(23, -20, 14, 0, Math.PI * 2);
        context.fill();
        context.restore();
      };
      const port = (id: string, side: 'top' | 'bottom' | 'left' | 'right') => {
        const node = homeConversionNodes.find(candidate => candidate.id === id);

        if (node === undefined) {
          throw new Error(`Unknown conversion node: ${id}`);
        }
        const [left, top, nodeWidth, nodeHeight] = mobile ? node.mobile : node.desktop;

        return {
          left: side === 'left' ? left : side === 'right' ? left + nodeWidth : left + nodeWidth / 2,
          top: side === 'top' ? top : side === 'bottom' ? top + nodeHeight : top + nodeHeight / 2,
        };
      };
      const arrow = (left: number, top: number, angle: number) => {
        context.save();
        context.translate(left, top);
        context.rotate(angle);
        context.beginPath();
        context.moveTo(-6, -4);
        context.lineTo(0, 0);
        context.lineTo(-6, 4);
        context.stroke();
        context.restore();
      };

      for (const [index, edge] of homeConversionEdges.entries()) {
        const start = port(edge.from, edge.fromSide);
        const end = port(edge.to, edge.toSide);
        const vertical = edge.fromSide === 'top' || edge.fromSide === 'bottom';
        const first = {
          left: vertical ? start.left : (start.left + end.left) / 2,
          top: vertical ? (start.top + end.top) / 2 : start.top,
        };
        const second = { left: vertical ? end.left : first.left, top: vertical ? first.top : end.top };

        context.strokeStyle = edge.bidirectional ? green : line;
        context.lineWidth = edge.bidirectional ? 1.6 : 1.3;
        context.beginPath();
        context.moveTo(start.left, start.top);
        context.bezierCurveTo(first.left, first.top, second.left, second.top, end.left, end.top);
        context.stroke();
        context.strokeStyle = green;
        arrow(end.left, end.top, Math.atan2(end.top - second.top, end.left - second.left));
        if (edge.bidirectional) {
          arrow(start.left, start.top, Math.atan2(start.top - first.top, start.left - first.left));
        }
        const phase = (motion + index * 0.17) % 2;
        const progress = edge.bidirectional && phase > 1 ? 2 - phase : phase % 1;
        const inverse = 1 - progress;
        const pointX =
          inverse ** 3 * start.left +
          3 * inverse ** 2 * progress * first.left +
          3 * inverse * progress ** 2 * second.left +
          progress ** 3 * end.left;
        const pointY =
          inverse ** 3 * start.top +
          3 * inverse ** 2 * progress * first.top +
          3 * inverse * progress ** 2 * second.top +
          progress ** 3 * end.top;

        context.fillStyle = red;
        context.beginPath();
        context.arc(pointX, pointY, 2.8, 0, Math.PI * 2);
        context.fill();
      }
      for (const node of homeConversionNodes) {
        const [left, top, nodeWidth, nodeHeight] = mobile ? node.mobile : node.desktop;

        context.fillStyle = node.id === 'ir' ? color('--site-wash', '#f1f3ef') : paper;
        context.strokeStyle = node.id === 'ir' || node.id === 'ge' ? green : line;
        context.lineWidth = 1;
        context.beginPath();
        context.roundRect(left, top, nodeWidth, nodeHeight, 6);
        context.fill();
        context.stroke();
        if (node.id === 'ir' || node.id === 'ge') {
          text(node.id === 'ir' ? 'Animation' : 'Galacean', left + 10, top + 23, mobile ? 14 : 18, ink, true);
          text(node.id === 'ir' ? 'IR' : 'Effects', left + 10, top + 45, mobile ? 16 : 19, green, true);
        } else {
          text(node.label, left + 10, top + 22, mobile ? 12 : 14, ink, true);
        }
        text(node.detail, left + 10, top + nodeHeight - 12, mobile ? 9 : 11);
        if (node.id === 'lottie' || node.id === 'svg' || node.id === 'ge' || node.id === 'figma') {
          artwork(
            left + nodeWidth / 2 - 4,
            top + (node.id === 'ge' ? 88 : nodeHeight / 2 + 3),
            mobile ? 0.42 : 0.6,
            node.id === 'lottie' || node.id === 'ge',
          );
          if (node.id === 'svg' || node.id === 'figma') {
            context.strokeStyle = green;
            const previewTop = top + nodeHeight / 2 - 17;

            context.strokeRect(left + nodeWidth / 2 - 25, previewTop, 47, 39);
            for (const anchorX of [-25, 22]) {
              context.fillStyle = paper;
              context.fillRect(left + nodeWidth / 2 + anchorX - 2, previewTop - 2, 4, 4);
              context.strokeRect(left + nodeWidth / 2 + anchorX - 2, previewTop - 2, 4, 4);
            }
          }
        } else if (node.id === 'ir') {
          context.strokeStyle = line;
          for (const track of [0, 1, 2]) {
            const trackY = top + 70 + track * 17;

            context.beginPath();
            context.moveTo(left + 12, trackY);
            context.lineTo(left + nodeWidth - 12, trackY);
            context.stroke();
            diamond(left + 22, trackY, green);
            diamond(left + nodeWidth - 22, trackY, red);
          }
          context.fillStyle = red;
          context.fillRect(left + 15 + (nodeWidth - 30) * (motion % 1), top + 62, 1, 52);
        } else if (node.id === 'html') {
          context.fillStyle = red;
          context.fillRect(left + 12, top + 33, 14, 18);
          context.fillStyle = line;
          context.fillRect(left + 32, top + 33, nodeWidth - 44, 3);
          context.fillRect(left + 32, top + 41, nodeWidth - 50, 3);
        } else {
          text(
            node.id === 'shader' ? 'mainImage()' : '{ ... }',
            left + 10,
            top + 47,
            mobile ? 9 : 12,
            node.id === 'shader' ? red : green,
          );
        }
      }
      context.restore();
      if (playing && !document.hidden) {
        motion += lastTime === undefined ? 0.004 : Math.min((time - lastTime) / 1000, 0.05) * 0.3;
        lastTime = time;
        frame = window.requestAnimationFrame(draw);
      } else {
        lastTime = undefined;
      }
    };
    const restart = () => {
      window.cancelAnimationFrame(frame);
      lastTime = undefined;
      draw();
    };
    const resizeObserver = new ResizeObserver(restart);

    resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', restart);
    restart();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', restart);
    };
  }, [playing, theme]);

  return <canvas ref={canvasRef} className="hero-artwork" role="img" aria-label={label} />;
}
