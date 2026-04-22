import { getTasksByPlan } from './plan-service';
import { getDependencyEdges } from './database';
import type { ProjectionData } from '../../shared/types';

/**
 * Compute the projected graph state for a plan.
 * Shows what will change if all tasks are completed.
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

  return { ghostFiles, modifiedFiles, removedFiles, newEdges, removedEdges: removedEdgesArr };
}
