import { mountRuntimeStorage } from '../utils/runtimeStorage';

// Mount the Redis cache + image storage from the environment at server start
// (#524, #528). Not test-guarded: the integration suite's booted server reads
// its per-worker REDIS_URL through this mount too.
export default defineNitroPlugin(() => {
  mountRuntimeStorage(useStorage());
});
