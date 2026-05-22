import sharp from 'sharp';
import type { ClothingBBox } from '@starter-template/types';

export interface CropResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export function isUsableBBox(bbox: ClothingBBox | undefined, minConfidence = 0.55): bbox is ClothingBBox {
  if (!bbox) return false;
  if (typeof bbox.confidence === 'number' && bbox.confidence < minConfidence) return false;
  return bbox.width > 0 && bbox.height > 0;
}

export async function cropImageByBBox(imageBuffer: Buffer, bbox: ClothingBBox): Promise<CropResult> {
  const image = sharp(imageBuffer, { failOn: 'none' });
  const metadata = await image.metadata();
  const imageWidth = metadata.width;
  const imageHeight = metadata.height;

  if (!imageWidth || !imageHeight) {
    throw new Error('image metadata is unavailable');
  }

  const normalized =
    bbox.coordinateType === 'normalized' ||
    (bbox.coordinateType !== 'pixel' &&
      bbox.x >= 0 &&
      bbox.y >= 0 &&
      bbox.width > 0 &&
      bbox.height > 0 &&
      bbox.x <= 1 &&
      bbox.y <= 1 &&
      bbox.width <= 1 &&
      bbox.height <= 1);

  const rawLeft = normalized ? bbox.x * imageWidth : bbox.x;
  const rawTop = normalized ? bbox.y * imageHeight : bbox.y;
  const rawWidth = normalized ? bbox.width * imageWidth : bbox.width;
  const rawHeight = normalized ? bbox.height * imageHeight : bbox.height;

  const paddingRatio = 0.06;
  const padX = rawWidth * paddingRatio;
  const padY = rawHeight * paddingRatio;

  const left = clamp(Math.floor(rawLeft - padX), 0, imageWidth - 1);
  const top = clamp(Math.floor(rawTop - padY), 0, imageHeight - 1);
  const right = clamp(Math.ceil(rawLeft + rawWidth + padX), left + 1, imageWidth);
  const bottom = clamp(Math.ceil(rawTop + rawHeight + padY), top + 1, imageHeight);
  const width = right - left;
  const height = bottom - top;

  const buffer = await image
    .extract({ left, top, width, height })
    .rotate()
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  return { buffer, width, height };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
