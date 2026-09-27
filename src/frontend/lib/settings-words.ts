/**
 * Settings wording shared by the modal (Phase 32 §0.5).
 */

/**
 * A refused setting, in the modal's words. The API names the key
 * ("mcp.port must be a port from 1024 to 65535"), which is right for an
 * agent and a script; a person sees the field's name (Phase 32 §0.5).
 */
const SETTING_NAMES: Record<string, string> = {
  'mcp.port': 'The MCP port',
  'device.mobileApiPort': 'The mobile API port',
  'identity.displayName': 'The display name',
  'identity.email': 'The email',
  'device.deviceName': 'The device name',
  'data.dataDirOverride': 'The data directory',
  'data.personalSyncPath': 'The sync directory',
  'webhooks.allowedHosts': 'The approved webhook hosts',
};
export function explainSaveError(message: string): string {
  const m = /^([a-zA-Z]+\.[a-zA-Z.]+) must be (.*)$/.exec(message);
  const name = m && SETTING_NAMES[m[1]];
  if (!m || !name) return message;
  return `${name} must be ${m[2].replace(/^a port from/, 'a number from')}`;
}
