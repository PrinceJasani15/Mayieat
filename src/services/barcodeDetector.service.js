const sharp = require('sharp');
const {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} = require('@zxing/library');

/**
 * Validates and cleans a barcode string
 * Keeps only numeric digits and checks for standard formats (EAN-13, UPC-A, UPC-E, EAN-8)
 */
function sanitizeAndValidateBarcode(rawText) {
  if (!rawText) return null;
  const digitsOnly = String(rawText).trim().replace(/\D/g, '');
  
  // Valid lengths: EAN-13 (13), UPC-A (12), EAN-8 (8), UPC-E (6 or 8), EAN-14 (14)
  if ([6, 8, 12, 13, 14].includes(digitsOnly.length)) {
    return digitsOnly;
  }
  return null;
}

/**
 * Decodes a barcode from a raw RGBA pixel buffer
 */
function decodeFromRgbaBuffer(pixelBuffer, width, height) {
  try {
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39
    ]);

    const len = width * height;
    const luminanceBuffer = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i++) {
      const r = pixelBuffer[i * 4];
      const g = pixelBuffer[i * 4 + 1];
      const b = pixelBuffer[i * 4 + 2];
      luminanceBuffer[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    const luminanceSource = new RGBLuminanceSource(luminanceBuffer, width, height);
    const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
    const reader = new MultiFormatReader();
    reader.setHints(hints);

    const result = reader.decode(binaryBitmap);
    if (result) {
      const text = result.getText();
      const formatStr = result.getBarcodeFormat() ? result.getBarcodeFormat().toString() : 'UNKNOWN';
      const cleanCode = sanitizeAndValidateBarcode(text);
      if (cleanCode) {
        return {
          rawText: text,
          cleanBarcode: cleanCode,
          format: formatStr
        };
      }
    }
  } catch (err) {
    // Decoding attempt failed for this pass - ignore and retry next preprocessing pass
  }
  return null;
}

/**
 * Multi-pass barcode detection from image path or buffer
 */
async function detectBarcodeFromImage(inputImage) {
  try {
    console.log('Backend Barcode Detection Started');
    const imagePipeline = sharp(inputImage).rotate(); // Auto-rotate via EXIF

    const metadata = await imagePipeline.metadata();
    console.log(`Image Size: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

    // Define multi-pass preprocessing pipelines
    const passes = [
      // Pass 1: Standard auto-rotated & resized
      imagePipeline.clone().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }),
      
      // Pass 2: High contrast & grayscale
      imagePipeline.clone().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).grayscale().linear(1.4, -20),

      // Pass 3: Sharpened
      imagePipeline.clone().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).grayscale().sharpen(),

      // Pass 4: Center crop (80% area)
      imagePipeline.clone().extract({
        left: Math.floor(metadata.width * 0.1),
        top: Math.floor(metadata.height * 0.1),
        width: Math.floor(metadata.width * 0.8),
        height: Math.floor(metadata.height * 0.8)
      }).resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
    ];

    for (let passIndex = 0; passIndex < passes.length; passIndex++) {
      try {
        const { data, info } = await passes[passIndex].raw().toBuffer({ resolveWithObject: true });
        const decoded = decodeFromRgbaBuffer(data, info.width, info.height);
        if (decoded && decoded.cleanBarcode) {
          console.log(`Backend Barcode Detected on Pass ${passIndex + 1}: ${decoded.cleanBarcode} (${decoded.format})`);
          return {
            found: true,
            barcode: decoded.cleanBarcode,
            format: decoded.format,
            rawText: decoded.rawText
          };
        }
      } catch (passErr) {
        // Continue to next pass
      }
    }

    console.log('Backend Barcode Detection: No valid barcode found after retries.');
    return { found: false };
  } catch (error) {
    console.error('Backend Barcode Detection Error:', error.message);
    return { found: false, error: error.message };
  }
}

module.exports = {
  detectBarcodeFromImage,
  sanitizeAndValidateBarcode
};
