import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressCanvasToJpegDataUrl } from "@/features/usr/utils/imageProcessing";

type ImageCropUploadProps = {
  initialImage?: string;
  onUpload: (dataUrl: string) => Promise<void>;
  maxFileSize?: number;
  maxSize?: number;
  label?: string;
  disabled?: boolean;
};

export function ImageCropUpload({
  initialImage,
  onUpload,
  maxSize = 1000,
  maxFileSize = 200 * 1024,
  label = "Change Photo",
  disabled = false,
}: ImageCropUploadProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(initialImage ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setImageSrc(initialImage ?? null);
  }, [initialImage]);

  const processImage = useCallback(
    (originalImage: HTMLImageElement): string => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (context === null) {
        throw new Error("Failed to prepare the selected image.");
      }

      const scale = maxSize / Math.min(originalImage.width, originalImage.height);
      const scaledWidth = originalImage.width * scale;
      const scaledHeight = originalImage.height * scale;
      const cropX = (scaledWidth - maxSize) / 2;
      const cropY = (scaledHeight - maxSize) / 2;

      canvas.width = maxSize;
      canvas.height = maxSize;
      context.drawImage(
        originalImage,
        0,
        0,
        originalImage.width,
        originalImage.height,
        -cropX,
        -cropY,
        scaledWidth,
        scaledHeight,
      );

      return compressCanvasToJpegDataUrl({
        canvas,
        maxFileSizeBytes: maxFileSize,
        initialQuality: 0.9,
        minQuality: 0.1,
        step: 0.1,
      }).dataUrl;
    },
    [maxFileSize, maxSize],
  );

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }

    setIsProcessing(true);
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        try {
          setPreviewUrl(processImage(image));
        } catch (error) {
          setUploadError(error instanceof Error ? error.message : "Unable to process that image.");
        } finally {
          setIsProcessing(false);
          if (fileInputRef.current !== null) {
            fileInputRef.current.value = "";
          }
        }
      };
      image.onerror = () => {
        setIsProcessing(false);
        setUploadError("Unable to load that image.");
      };
      image.src = String(reader.result ?? "");
    };
    reader.onerror = () => {
      setIsProcessing(false);
      setUploadError("Unable to read that image file.");
    };
    reader.readAsDataURL(file);
  }

  function handleCancelPreview() {
    setPreviewUrl(null);
    setUploadError(null);
  }

  async function handleConfirmUpload() {
    if (previewUrl === null) {
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    try {
      await onUpload(previewUrl);
      setImageSrc(previewUrl);
      setPreviewUrl(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        {imageSrc !== null ? (
          <div className="relative h-32 w-32 overflow-hidden rounded-lg border-2 border-st-border bg-st-panel">
            <img
              src={imageSrc}
              alt="Profile avatar"
              className={"h-full w-full object-cover " + (isProcessing ? "opacity-50" : "")}
            />
            {isProcessing ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-white" />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-lg border-2 border-dashed border-st-border bg-st-panel text-st-muted">
            {isProcessing ? (
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-st-accent" />
            ) : (
              <Camera className="h-12 w-12" />
            )}
          </div>
        )}
      </div>

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
          disabled={disabled || isProcessing || isUploading}
        />
        <Button
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          className="w-full sm:w-auto"
          disabled={disabled || isProcessing || isUploading}
        >
          <Camera className="mr-2 h-4 w-4" />
          {label}
        </Button>
      </div>

      {previewUrl !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm space-y-6 rounded-2xl border border-st-border bg-st-panel p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 text-center">
                <h3 className="text-xl font-bold text-st-fg">Update Profile Picture</h3>
                <p className="mt-2 text-sm text-st-muted">
                  This image will be used as your StarStrat profile avatar.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCancelPreview}
                disabled={isUploading}
                className="rounded-lg p-2 text-st-muted transition-colors hover:bg-st-bg hover:text-st-fg disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex justify-center">
              <div className="h-48 w-48 overflow-hidden rounded-full border-4 border-st-border shadow-lg">
                <img src={previewUrl} alt="Avatar preview" className="h-full w-full object-cover" />
              </div>
            </div>

            {uploadError !== null ? (
              <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                {uploadError}
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <Button
                onClick={handleConfirmUpload}
                disabled={isUploading}
                className="w-full justify-center py-3 text-base"
              >
                {isUploading ? (
                  <>
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-slate-950" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-5 w-5" />
                    Upload Photo
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={handleCancelPreview}
                disabled={isUploading}
                className="w-full justify-center"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}