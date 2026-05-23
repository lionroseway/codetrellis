import { listAllItems } from './plan-item-service';
import { getDependencyEdges } from './database';
import type { ProjectionData, PlanItem } from '../../shared/types';

/**
 * Compute the projected graph state for a plan.
 * Shows what will change if all plan items (Actions) are completed.
 * Used by the PLAN VS LIVE overlay in the graph.
 */
export function computeProjection(planUid: string): ProjectionData {
  const existingEdges = getDependencyEdges();
  const existingFiles = new Set(existingEdges.flatMap((e) => [e.sourceRelative, e.targetRelative]));

  const ghostFiles: ProjectionData['ghostFiles'] = [];
  const modifiedFiles: ProjectionData['modifiedFiles'] = [];
  const removedFiles: ProjectionData['removedFiles'] = [];
  const newEdges: ProjectionData['newEdges'] = [];
  const removedEdgesArr: ProjectionData['removedEdges'] = [];

  const seenFiles = new Set<string>();

  const items = listAllItems(planUid).filter((i: PlanItem) => i.kind === 'action');

  for (const item of items) {
    // fileSpecs carry the explicit CRUD verb: create/modify/delete/move
    for (const fs of item.fileSpecs ?? []) {
      if (seenFiles.has(fs.path)) continue;
      seenFiles.add(fs.path);

      if (fs.action === 'create') {
        ghostFiles.push({ path: fs.path, taskUid: item.uid, taskDescription: item.title });
      } else if (fs.action === 'delete') {
        removedFiles.push({ path: fs.path, taskUid: item.uid });
      } else if (fs.action === 'move') {
        removedFiles.push({ path: fs.path, taskUid: item.uid });
        if (fs.moveTo && !seenFiles.has(fs.moveTo)) {
          seenFiles.add(fs.moveTo);
          ghostFiles.push({ path: fs.moveTo, taskUid: item.uid, taskDescription: item.title });
        }
      } else {
        // 'modify' — file should already exist
        if (existingFiles.has(fs.path)) {
          modifiedFiles.push({ path: fs.path, taskUid: item.uid });
        } else {
          // File declared as modify but doesn't exist yet — treat as ghost
          // so it still shows in the overlay rather than vanishing
          ghostFiles.push({ path: fs.path, taskUid: item.uid, taskDescription: item.title });
        }
      }
    }

    for (const conn of item.newConnections ?? []) {
      newEdges.push({ from: conn.from, to: conn.to, taskUid: item.uid });
    }

    for (const conn of item.removedConnections ?? []) {
      removedEdgesArr.push({ from: conn.from, to: conn.to, taskUid: item.uid });
    }
  }

  return { ghostFiles, modifiedFiles, removedFiles, newEdges, removedEdges: removedEdgesArr };
}
