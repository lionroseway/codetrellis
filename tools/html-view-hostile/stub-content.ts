/**
 * Stands in for artefact-content-service in the hostile-report test: one
 * report, at a path given by the test, served by the REAL serveReportFile
 * (confined-fs and the view's CSP). Everything else under test is the real
 * src/electron/html-view.ts.
 */
import { serveReportFile } from '../../src/backend/services/html-view-policy';

export const REPORT_UID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const report = () => ({ root: process.env.HOSTILE_ROOT!, rel: process.env.HOSTILE_REL!, contentType: 'text/plain', itemUid: 'item' });

export function isAttachmentUid(uid: unknown): uid is string {
  return typeof uid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(uid);
}
export async function resolveServable(uid: unknown) {
  return uid === REPORT_UID ? report() : null;
}
export async function serveReportAsset(uid: unknown, urlPath: string, scripts: boolean) {
  if (uid !== REPORT_UID) return { status: 404, headers: {}, stream: null, error: 'Not part of this report' };
  return serveReportFile(report(), urlPath, scripts);
}
