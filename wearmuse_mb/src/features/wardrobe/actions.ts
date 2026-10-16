import { repository } from '../../services/storage/database';
import { removeGarmentFiles } from '../../services/storage/files';

/** Delete the durable job first; in-flight responses then see no row to update. */
export async function deleteGarment(id: string): Promise<void> {
  await repository.remove(id);
  await removeGarmentFiles(id);
}
