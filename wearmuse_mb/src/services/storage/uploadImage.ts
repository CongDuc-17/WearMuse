import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat, type ImageManipulatorContext, type ImageRef } from 'expo-image-manipulator';

import type { Garment } from '../../types/garment';
import { ApiError } from '../api/client';
import { assertGarmentFilesActive, getGarmentStorageDirectory } from './files';

const longestEdge = 1600;
let preparationSequence = 0;

function invalidImage(cause?: unknown) {
  return new ApiError('Không thể đọc định dạng ảnh này. Hãy chọn ảnh JPEG, PNG hoặc chụp lại.', 'invalid_image', false, null, cause);
}

function remove(file: File | null) {
  if (file?.exists) file.delete();
}

/** Validate both real JPEG bytes and unscaled native dimensions before reusing/promoting a derivative. */
async function isValidUpload(file: File): Promise<boolean> {
  if (!file.exists || file.size <= 0 || file.size > 10 * 1024 * 1024) return false;
  const bytes = await file.bytes();
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;
  try {
    const decoded = await Image.loadAsync(file.uri);
    try {
      return decoded.width > 0 && decoded.height > 0
        && decoded.width <= longestEdge && decoded.height <= longestEdge;
    } finally { decoded.release(); }
  } catch { return false; }
}

/** Build only the upload descriptor; the original garment row and original photo remain untouched. */
export async function prepareUploadImage(garment: Garment, signal?: AbortSignal): Promise<Garment> {
  const active = () => assertGarmentFilesActive(garment.localId, signal);
  active();
  const directory = getGarmentStorageDirectory(garment.localId);
  const destination = new File(directory, 'upload.jpg');
  const descriptor = () => ({
    ...garment, originalLocalUri: destination.uri, mimeType: 'image/jpeg', fileName: 'upload.jpg',
  });
  if (await isValidUpload(destination)) { active(); return descriptor(); }
  active();
  remove(destination);
  const original = new File(garment.originalLocalUri);
  if (!original.exists || original.size <= 0) throw invalidImage();
  const partial = new File(directory, `pending-upload-${Date.now()}-${preparationSequence++}.jpg`);
  let context: ImageManipulatorContext | null = null;
  let rendered: ImageRef | null = null;
  let generated: File | null = null;
  let promoted = false;
  try {
    try {
      context = ImageManipulator.manipulate(garment.originalLocalUri);
      rendered = await context.renderAsync();
      active();
      const { width, height } = rendered;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw invalidImage();
      if (Math.max(width, height) > longestEdge) {
        // Setting one edge preserves the aspect ratio; smaller originals are never enlarged.
        context.resize(width >= height ? { width: longestEdge, height: null } : { width: null, height: longestEdge });
        rendered.release();
        rendered = null;
        rendered = await context.renderAsync();
        active();
      }
    } catch (error) {
      active();
      if (error instanceof ApiError) throw error;
      throw invalidImage(error);
    }
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    generated = new File(saved.uri);
    active();
    await generated.copy(partial);
    active();
    if (!(await isValidUpload(partial))) throw invalidImage();
    active();
    await partial.move(destination);
    promoted = true;
    active();
    return descriptor();
  } catch (error) {
    remove(partial);
    if (promoted) remove(destination);
    throw error;
  } finally {
    rendered?.release();
    context?.release();
    remove(generated);
  }
}
