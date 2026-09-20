export function preloadImages(urls: string[], onProgress?: (progress: number) => void): Promise<void> {
  return new Promise((resolve) => {
    if (urls.length === 0) {
      onProgress?.(100);
      resolve();
      return;
    }

    let loaded = 0;
    for (const url of urls) {
      const image = new Image();
      const done = () => {
        loaded += 1;
        onProgress?.(Math.round((loaded / urls.length) * 100));
        if (loaded >= urls.length) resolve();
      };
      image.onload = done;
      image.onerror = done;
      image.src = url;
    }
  });
}
