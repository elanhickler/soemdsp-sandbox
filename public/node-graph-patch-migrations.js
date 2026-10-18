// Patch migrations are one-shot (APP_POLICY §1).
// Convert every stored patch, then delete the migrator in the same change.
// migrateNodeGraphPatchToCurrent stays as an empty hook so the load path
// does not grow a second copy. A future migrator must be run over all patches
// and removed before the next commit that keeps it.

function migrateNodeGraphPatchToCurrent(patch) {
  return patch;
}
