import { getTasksByPlan } from './plan-service';
import { listAllItems } from './plan-item-service';
import { getDependencyEdges } from './database';
import type { ProjectionData, PlanItem } from '../../shared/types';

/**
 * Compute the projected graph state for a plan.
 * Shows what will change if all tasks are completed.
 *
 * Reads both V1 tasks (legacy) and V2 plan items (kind='action')
 * so the graph overlay works regardless of which authoring surface
 * created the work items.
 */
export function computeProjection(planUid: string): ProjectionData {
  const tasks = getTasksByPlan(planUid);
  const existingEdges = getDependencyEdges();
  const existingFiles = new Set(existingEdges.flatMap((e) => [e.sourceRelative, e.targetRelative]));

  const ghostFiles: ProjectionData['ghostFiles'] = [];
  const modifiedFiles: ProjectionData['modifiedFiles'] = [];
  const removedFiles: ProjectionData['removedFiles'] = [];
  const newEdges: ProjectionData['newEdges'] = [];
  const removedEdgesArr: ProjectionData['removedEdges'] = [];

  const seenFiles = new Set<string>();

  // ── V1 legacy tasks ────────────────────────────────────────────
  for (const task of tasks) {
    for (const file of task.affectedFiles) {
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);

      if (existingFiles.has(file)) {
        modifiedFiles.push({ path: file, taskUid: task.uid });
      } else {
        ghostFiles.push({ path: file, taskUid: task.uid, taskDescription: task.description });
      }
    }

    for (const conn of task.newConnections) {
      newEdges.push({ from: conn.from, to: conn.to, taskUid: task.uid });
    }

    for (const conn of task.removedConnections) {
      removedEdgesArr.push({ from: conn.from, to: conn.to, taskUid: task.uid });
    }
  }

  // ── V2 plan items (Actions) ────────────────────────────────────
  const v2Items = listAllItems(planUid).filter((i: PlanItem) => i.kind === 'action');

  for (const item of v2Items) {
    // fileSpecs carry the explicit CRUD verb: create/modify/delete/move
    for (const fs of item.fileSpecs ?? []) {
      if (seenFiles.has(fs.path)) continue;
      seenFiles.add(fs.path);

      if (fs.action === 'create') {
        // Ghost file — doesn't exist yet, plan says to create it
        ghostFiles.push({ path: fs.path, taskUid: item.uid, taskDescription: item.title });
      } else if (fs.action === 'delete') {
        removedFiles.push({ path: fs.path, taskUid: item.uid });
      } else if (fs.action === 'move') {
        // Move = remove from old path + ghost at new path
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
