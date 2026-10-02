// Clipboard in the preview: kept on the page, so a test can read what was copied.
export async function setStringAsync(text: string): Promise<boolean> {
  (window as unknown as { __PHONE_CLIPBOARD__?: string }).__PHONE_CLIPBOARD__ = text;
  return true;
}
export async function getStringAsync(): Promise<string> {
  return (window as unknown as { __PHONE_CLIPBOARD__?: string }).__PHONE_CLIPBOARD__ ?? '';
}
