if (typeof URL.createObjectURL !== 'function') {
  let counter = 0;

  URL.createObjectURL = (blob: Blob) => `blob:mock/${counter++}/${blob.type}`;
}
