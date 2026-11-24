import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { extractSceneDocument } from '@galacean/html2figma';
import type { SceneNode } from '@galacean/html2figma';

const HTML = '<html><body><div id="box" style="width:40px;height:20px;background:red"></div>' +
  '<script>document.getElementById("box").style.width="80px";</script></body></html>';

function findBox(node: SceneNode): SceneNode | undefined {
  if (node.width === 40 || node.width === 80) {return node;}

  return node.children.map(findBox).find(child => child !== undefined);
}

describe('Node HTML extraction policies', () => {
  it('executes scripts only when enabled and keeps extraction available with scripts disabled', async () => {
    const disabled = await extractSceneDocument(HTML, true, { scriptPolicy: 'disabled', networkPolicy: 'offline' });
    const trusted = await extractSceneDocument(HTML, true, { scriptPolicy: 'trusted', networkPolicy: 'offline' });

    expect(findBox(disabled.root)?.width).toBe(40);
    expect(findBox(trusted.root)?.width).toBe(80);
  });

  it('blocks external resource requests in offline mode', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.end('resource');
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    if (address === null || typeof address === 'string') {throw new Error('No local test server address.');}
    try {
      const html = `<html><body><img src="http://127.0.0.1:${address.port}/image.png"></body></html>`;

      await extractSceneDocument(html, true, { networkPolicy: 'offline', scriptPolicy: 'disabled' });
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error == null ? resolve() : reject(error)));
    }
  });

  it('rejects oversized input before starting extraction', async () => {
    await expect(extractSceneDocument(HTML, true, { maxInputBytes: 16 })).rejects.toThrow('input exceeds');
  });
});
