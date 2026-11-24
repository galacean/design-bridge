import * as spec from '@galacean/effects-specification';

const QUAD_POSITIONS = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
const QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
const UV_OFFSET = QUAD_POSITIONS.byteLength;
const INDEX_OFFSET = QUAD_POSITIONS.byteLength + QUAD_UVS.byteLength;

function encodeQuadBuffer(): string {
  const totalBytes = QUAD_POSITIONS.byteLength + QUAD_UVS.byteLength + QUAD_INDICES.byteLength;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new Uint8Array(buffer);

  view.set(new Uint8Array(QUAD_POSITIONS.buffer), 0);
  view.set(new Uint8Array(QUAD_UVS.buffer), UV_OFFSET);
  view.set(new Uint8Array(QUAD_INDICES.buffer), INDEX_OFFSET);

  const binaryString = Array.from(view, byte => String.fromCharCode(byte)).join('');

  return btoa(binaryString);
}

export function buildQuadGeometry(geometryId: string): spec.GeometryData {
  return {
    id: geometryId,
    name: 'FullscreenQuad',
    dataType: spec.DataType.Geometry,
    vertexData: {
      vertexCount: 4,
      channels: [
        {
          semantic: 'POSITION',
          offset: 0,
          format: spec.VertexFormatType.Float32,
          dimension: 3,
        },
        {
          semantic: 'TEXCOORD0',
          offset: UV_OFFSET,
          format: spec.VertexFormatType.Float32,
          dimension: 2,
        },
      ],
    },
    indexFormat: spec.IndexFormatType.UInt16,
    indexOffset: INDEX_OFFSET,
    subMeshes: [{ offset: 0, indexCount: 6, vertexCount: 4 }],
    mode: spec.GeometryType.TRIANGLES,
    buffer: encodeQuadBuffer(),
  };
}
