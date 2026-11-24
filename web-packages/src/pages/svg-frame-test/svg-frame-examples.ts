const sources = import.meta.glob<string>('../../../examples/svg/*.svg', {
  eager: true, query: '?raw', import: 'default',
});

export const svgFrameExamples = Object.entries(sources)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, source]) => {
    const id = (path.split('/').at(-1) ?? path).replace(/\.svg$/i, '');

    return { id, label: id, source };
  });
