// Secure storage in the preview: memory only; nothing a screen stores outlives the page.
const store = new Map<string, string>();
export async function getItemAsync(key: string): Promise<string | null> { return store.get(key) ?? null; }
export async function setItemAsync(key: string, value: string): Promise<void> { store.set(key, value); }
export async function deleteItemAsync(key: string): Promise<void> { store.delete(key); }
