export type GarmentStatus =
  | 'local_saved'
  | 'upload_queued'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'needs_review'
  | 'failed';

/** The local ID and capture date remain stable throughout synchronization. */
export interface Garment {
  localId: string;
  remoteId: string | null;
  originalLocalUri: string;
  cutoutLocalUri: string | null;
  thumbnailLocalUri: string | null;
  originalRemoteUrl: string | null;
  cutoutRemoteUrl: string | null;
  thumbnailRemoteUrl: string | null;
  mimeType: string;
  fileName: string;
  status: GarmentStatus;
  uploadAttempts: number;
  nextAttemptAt: number;
  pollAttempts: number;
  nextPollAt: number;
  retryRequested: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
