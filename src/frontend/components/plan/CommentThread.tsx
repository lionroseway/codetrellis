import { useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import type { Comment } from '../../../shared/types';

function CommentItem({ comment }: { comment: Comment }) {
  const typeColors: Record<string, string> = {
    suggestion: 'text-amber-400 border-amber-500/20',
    approval: 'text-green-400 border-green-500/20',
    concern: 'text-red-400 border-red-500/20',
    status_update: 'text-blue-400 border-blue-500/20',
    comment: 'text-foreground-muted border-white/[0.06]',
  };
  const style = typeColors[comment.commentType] || typeColors.comment;

  return (
    <div className={`px-2.5 py-2 rounded-lg border ${style.split(' ')[1]} bg-white/[0.02]`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-medium text-foreground">{comment.author}</span>
        <span className="text-[9px] text-foreground-subtle">({comment.authorType})</span>
        {comment.commentType !== 'comment' && (
          <span className={`text-[8px] font-semibold px-1 rounded ${style.split(' ')[0]}`}>
            {comment.commentType}
          </span>
        )}
        <span className="text-[9px] text-foreground-subtle ml-auto">
          {new Date(comment.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <p className="text-[11px] text-foreground-muted leading-relaxed">{comment.body}</p>
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-3 mt-2 space-y-1.5 border-l border-white/[0.06] pl-2">
          {comment.replies.map((reply) => (
            <CommentItem key={reply.uid} comment={reply} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CommentThread() {
  const comments = usePlanStore((s) => s.comments);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const fetchComments = usePlanStore((s) => s.fetchComments);
  const [newComment, setNewComment] = useState('');

  const handleSubmit = async () => {
    if (!newComment.trim() || !activePlanUid) return;
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: 'plan',
        targetUid: activePlanUid,
        body: newComment.trim(),
        commentType: 'comment',
      }),
    });
    setNewComment('');
    fetchComments(activePlanUid);
  };

  return (
    <div className="space-y-2">
      {comments.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-4 text-foreground-subtle text-[11px]">
          <MessageSquare size={16} />
          <span>No comments yet</span>
        </div>
      )}

      {comments.map((c) => (
        <CommentItem key={c.uid} comment={c} />
      ))}

      {activePlanUid && (
        <div className="flex gap-1.5 mt-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Add a comment..."
            className="flex-1 px-2.5 py-1.5 text-[11px] bg-surface border border-border rounded-lg text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 transition-colors"
          />
          <button
            onClick={handleSubmit}
            disabled={!newComment.trim()}
            className="px-2 py-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-30"
          >
            <Send size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
