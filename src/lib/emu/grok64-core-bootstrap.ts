/**
 * Install Grok64 VICE core loader guards before any EmulatorJS script runs.
 * Import this module from the app entry route (side effect only).
 */
import {
  patchFetchNoStoreForGrok64Core,
  patchIdbObjectStoreViceCoreBypass,
  patchIndexedDbForEmulatorJsCache,
  patchXhrNoStoreForGrok64Core,
} from "./grok64-ejs-core-cache";

patchIndexedDbForEmulatorJsCache();
patchIdbObjectStoreViceCoreBypass();
patchFetchNoStoreForGrok64Core();
patchXhrNoStoreForGrok64Core();
