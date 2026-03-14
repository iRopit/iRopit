import storage from '@react-native-firebase/storage';
import { NativeModules, Platform } from 'react-native';

const { FilePickerModule } = NativeModules;

/**
 * Get MIME type from file name extension
 */
const getMimeType = (fileName: string, fallbackType: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    // Media
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    // Archives
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    // Other
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    apk: 'application/vnd.android.package-archive',
  };

  if (ext && mimeMap[ext]) {
    return mimeMap[ext];
  }

  // If fallbackType is a valid MIME type (contains '/'), use it
  if (fallbackType && fallbackType.includes('/')) {
    return fallbackType;
  }

  // Map generic types
  if (fallbackType === 'image') {
    return 'image/jpeg';
  }

  return 'application/octet-stream';
};

export const uploadFile = async (
  uri: string,
  fileName: string,
  fileType: string,
  userId: string | undefined,
  onProgress?: (percent: number) => void,
): Promise<string> => {
  if (!userId) {
    throw new Error('User not authenticated');
  }

  const timestamp = Date.now();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `chat_files/${userId}/${timestamp}_${sanitizedName}`;
  const reference = storage().ref(storagePath);

  const contentType = getMimeType(fileName, fileType);
  const metadata = { contentType };

  console.log('[ChatUpload] Starting upload:', {
    uri: uri.substring(0, 80),
    storagePath,
    contentType,
    platform: Platform.OS,
  });

  // On Android, convert content:// URIs to file:// by copying to cache
  let fileUri = uri;
  if (
    Platform.OS === 'android' &&
    uri.startsWith('content://') &&
    FilePickerModule
  ) {
    try {
      console.log('[ChatUpload] Copying content:// to local cache...');
      fileUri = await FilePickerModule.copyToLocal(uri, sanitizedName);
      console.log('[ChatUpload] Copied to:', fileUri.substring(0, 80));
    } catch (copyError: any) {
      console.warn('[ChatUpload] copyToLocal failed:', copyError?.message);
      // Continue with original URI as fallback
    }
  }

  // Upload using putFile (works with file:// URIs)
  try {
    console.log('[ChatUpload] Uploading with putFile...');
    const task = reference.putFile(fileUri, metadata);

    if (onProgress) {
      task.on('state_changed', snapshot => {
        const percent = Math.round(
          (snapshot.bytesTransferred / snapshot.totalBytes) * 100,
        );
        onProgress(percent);
      });
    }

    await task;
    const downloadUrl = await reference.getDownloadURL();
    console.log('[ChatUpload] Upload succeeded');
    return downloadUrl;
  } catch (error: any) {
    console.error('[ChatUpload] Upload failed:', error?.code, error?.message);
    throw new Error(
      `Upload failed: ${error?.code || 'unknown'} - ${
        error?.message || 'Network request failed'
      }. Check Firebase Storage rules and ensure authenticated uploads are allowed.`,
    );
  }
};
