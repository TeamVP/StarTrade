export function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Math.round((base64.length * 3) / 4);
}

export function compressCanvasToJpegDataUrl(options: {
  canvas: HTMLCanvasElement;
  maxFileSizeBytes: number;
  initialQuality?: number;
  minQuality?: number;
  step?: number;
}): { dataUrl: string; quality: number; estimatedBytes: number } {
  const {
    canvas,
    maxFileSizeBytes,
    initialQuality = 0.9,
    minQuality = 0.1,
    step = 0.1,
  } = options;

  let quality = Math.min(1, Math.max(0, initialQuality));
  const minimumQuality = Math.min(1, Math.max(0, minQuality));
  const qualityStep = Math.max(0.01, Math.min(0.5, step));

  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  let estimatedBytes = estimateDataUrlBytes(dataUrl);

  while (estimatedBytes > maxFileSizeBytes && quality - qualityStep >= minimumQuality) {
    quality = Math.max(minimumQuality, quality - qualityStep);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    estimatedBytes = estimateDataUrlBytes(dataUrl);
  }

  return { dataUrl, quality, estimatedBytes };
}