/**
 * Initialize libsodium before any crypto operations
 * This must be called before importing any modules that use libsodium
 */
export async function initLibsodium(): Promise<void> {
  try {
    // Try to initialize libsodium-wrappers-sumo
    const _sodium = await import('libsodium-wrappers-sumo');
    await _sodium.default.ready;
    console.log('libsodium initialized successfully');
  } catch (error) {
    console.warn('Failed to initialize libsodium:', error);
    // Continue anyway - some operations might still work
  }
}



