import React, { useMemo, useRef, useState } from 'react';
import {
  AtSign,
  CornerDownRight,
  History,
  MessageSquare,
  Send,
  Trash2,
} from 'lucide-react';
import type { AppUser } from '../types/auth';
import type { TaskComment } from '../types/task';

interface TaskCommentsThreadProps {
  taskId: string;
  comments: TaskComment[];
  users: AppUser[];
  currentUser: AppUser;
  isAdmin: boolean;
  onAddComment: (
    taskId: string,
    payload: { body: string; parentId: string | null; mentions: string[] }
  ) => void;
  onDeleteComment: (taskId: string, commentId: string) => void;
}

type ThreadFilter = 'all' | 'comments' | 'updates';

function formatCommentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function extractMentions(text: string, validUsernames: Set<string>): string[] {
  const matches = text.match(/@([A-Za-z0-9_.-]+)/g) || [];
  const found = new Set<string>();
  for (const token of matches) {
    const uname = token.slice(1);
    if (validUsernames.has(uname.toLowerCase())) {
      found.add(uname);
    }
  }
  return Array.from(found);
}

interface MentionTextareaProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  users: AppUser[];
  placeholder: string;
  submitLabel: string;
  rows?: number;
  autoFocus?: boolean;
  onCancel?: () => void;
}

const MentionComposer: React.FC<MentionTextareaProps> = ({
  value,
  onChange,
  onSubmit,
  users,
  placeholder,
  submitLabel,
  rows = 3,
  autoFocus = false,
  onCancel,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [showPickerManual, setShowPickerManual] = useState(false);

  const activeUsers = useMemo(() => users.filter((u) => u.isActive), [users]);

  const filteredSuggestions = useMemo(() => {
    const q = (mentionQuery ?? '').toLowerCase();
    return activeUsers.filter(
      (u) =>
        !q ||
        u.username.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q)
    );
  }, [activeUsers, mentionQuery]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    const caret = e.target.selectionStart ?? nextVal.length;
    onChange(nextVal);
    setShowPickerManual(false);

    // Detect active @mention token immediately before the caret
    const beforeCaret = nextVal.slice(0, caret);
    const match = beforeCaret.match(/(^|\s)@([A-Za-z0-9_.-]*)$/);
    if (match) {
      const startIdx = caret - match[2].length - 1;
      setMentionStartIndex(startIdx);
      setMentionQuery(match[2]);
    } else {
      setMentionQuery(null);
      setMentionStartIndex(-1);
    }
  };

  const insertMention = (username: string) => {
    const el = textareaRef.current;
    if (mentionStartIndex >= 0 && el) {
      const caret = el.selectionStart ?? value.length;
      const before = value.slice(0, mentionStartIndex);
      const after = value.slice(caret);
      const inserted = `@${username} `;
      const next = `${before}${inserted}${after}`;
      onChange(next);
      setMentionQuery(null);
      setMentionStartIndex(-1);
      setShowPickerManual(false);
      requestAnimationFrame(() => {
        el.focus();
        const pos = before.length + inserted.length;
        el.setSelectionRange(pos, pos);
      });
      return;
    }

    const needsSpace = value.length > 0 && !/\s$/.test(value);
    const next = `${value}${needsSpace ? ' ' : ''}@${username} `;
    onChange(next);
    setShowPickerManual(false);
    requestAnimationFrame(() => {
      el?.focus();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (mentionQuery !== null || showPickerManual) &&
      filteredSuggestions.length > 0 &&
      (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && mentionQuery !== null))
    ) {
      e.preventDefault();
      insertMention(filteredSuggestions[0].username);
      return;
    }
    if (e.key === 'Escape') {
      setMentionQuery(null);
      setShowPickerManual(false);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  const isMenuOpen =
    (mentionQuery !== null || showPickerManual) && activeUsers.length > 0;

  return (
    <div className="relative space-y-2">
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#1A365D] focus:outline-none focus:ring-1 focus:ring-[#1A365D]"
      />

      {isMenuOpen && (
        <div className="absolute left-0 right-0 z-20 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-500">
            Tag a teammate
          </div>
          {filteredSuggestions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">
              No matching teammates found.
            </div>
          ) : (
            filteredSuggestions.map((u) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u.username);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-[#E6F0FA]/70"
              >
                <span className="font-mono font-semibold text-[#1A365D]">
                  @{u.username}
                </span>
                <span className="truncate text-slate-600">{u.fullName}</span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowPickerManual((prev) => !prev)}
          disabled={activeUsers.length === 0}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#1A365D] disabled:opacity-50 whitespace-nowrap"
        >
          <AtSign className="h-3.5 w-3.5" />
          Tag teammate
        </button>

        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!value.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1A365D] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#132948] disabled:opacity-50 whitespace-nowrap"
          >
            <Send className="h-3 w-3" />
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const TaskCommentsThread: React.FC<TaskCommentsThreadProps> = ({
  taskId,
  comments,
  users,
  currentUser,
  isAdmin,
  onAddComment,
  onDeleteComment,
}) => {
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const [newCommentBody, setNewCommentBody] = useState('');
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');

  const validUsernames = useMemo(
    () => new Set(users.map((u) => u.username.toLowerCase())),
    [users]
  );

  const renderBodyWithMentions = (text: string) => {
    const parts = text.split(/(@[A-Za-z0-9_.-]+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('@') && validUsernames.has(part.slice(1).toLowerCase())) {
        return (
          <span
            key={idx}
            className="font-mono font-semibold text-[#1A365D]"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const { topLevelItems, repliesByParent, commentCount, updateCount } = useMemo(() => {
    const repliesMap = new Map<string, TaskComment[]>();
    const roots: TaskComment[] = [];
    let cCount = 0;
    let uCount = 0;

    for (const item of comments) {
      if (item.kind === 'activity') {
        uCount += 1;
      } else {
        cCount += 1;
      }

      if (item.parentId) {
        const list = repliesMap.get(item.parentId) ?? [];
        list.push(item);
        repliesMap.set(item.parentId, list);
      } else {
        roots.push(item);
      }
    }

    const filteredRoots = roots.filter((item) => {
      if (filter === 'comments') return item.kind !== 'activity';
      if (filter === 'updates') return item.kind === 'activity';
      return true;
    });

    return {
      topLevelItems: filteredRoots,
      repliesByParent: repliesMap,
      commentCount: cCount,
      updateCount: uCount,
    };
  }, [comments, filter]);

  const handlePostTopLevel = () => {
    const trimmed = newCommentBody.trim();
    if (!trimmed) return;
    onAddComment(taskId, {
      body: trimmed,
      parentId: null,
      mentions: extractMentions(trimmed, validUsernames),
    });
    setNewCommentBody('');
  };

  const handlePostReply = (parentId: string) => {
    const trimmed = replyBody.trim();
    if (!trimmed) return;
    onAddComment(taskId, {
      body: trimmed,
      parentId,
      mentions: extractMentions(trimmed, validUsernames),
    });
    setReplyBody('');
    setReplyingToId(null);
  };

  return (
    <div className="space-y-5">
      {/* Filter Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md bg-slate-100 p-0.5">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
              filter === 'all'
                ? 'bg-white text-[#1A365D] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({comments.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('comments')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
              filter === 'comments'
                ? 'bg-white text-[#1A365D] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Comments ({commentCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('updates')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
              filter === 'updates'
                ? 'bg-white text-[#1A365D] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Updates ({updateCount})
          </button>
        </div>
      </div>

      {/* New Comment Composer */}
      <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5">
        <p className="mb-2 text-xs text-slate-600">
          Commenting as{' '}
          <span className="font-mono font-semibold text-slate-900">
            @{currentUser.username}
          </span>{' '}
          · Type <span className="font-mono">@</span> to tag a teammate
        </p>
        <MentionComposer
          value={newCommentBody}
          onChange={setNewCommentBody}
          onSubmit={handlePostTopLevel}
          users={users}
          placeholder="Leave a note, follow-up instruction, or tag a teammate with @username..."
          submitLabel="Post Note"
          rows={3}
        />
      </div>

      {/* Thread Feed */}
      {topLevelItems.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-white px-5 py-10 text-center">
          <MessageSquare
            className="mx-auto h-6 w-6 text-slate-300"
            aria-hidden="true"
          />
          <p className="mt-2.5 text-sm font-medium text-slate-700">
            {filter === 'updates'
              ? 'No tracked updates yet'
              : 'No comments on this task yet'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Post a note above or tag a teammate with @username to start a thread.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {topLevelItems.map((item) => {
            const isActivity = item.kind === 'activity';
            const replies = repliesByParent.get(item.id) ?? [];
            const canDelete =
              isAdmin ||
              item.authorUsername.toLowerCase() ===
                currentUser.username.toLowerCase();

            if (isActivity) {
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 bg-slate-50/50 px-4 py-2.5 text-xs text-slate-600"
                >
                  <History
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-medium text-slate-800">
                      @{item.authorUsername}
                    </span>{' '}
                    <span>{renderBodyWithMentions(item.body)}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-400 tabular-nums">
                      {formatCommentTime(item.createdAt)}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div key={item.id} className="px-4 py-3.5 space-y-2.5">
                {/* Comment Header */}
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex min-w-0 items-center gap-1.5 text-slate-500">
                    <span className="font-semibold text-slate-900 truncate">
                      {item.authorName}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      @{item.authorUsername}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px] tabular-nums whitespace-nowrap">
                      {formatCommentTime(item.createdAt)}
                    </span>
                  </div>

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDeleteComment(taskId, item.id)}
                      aria-label="Delete comment"
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Comment Body */}
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {renderBodyWithMentions(item.body)}
                </p>

                {/* Thread Actions */}
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingToId(replyingToId === item.id ? null : item.id);
                      setReplyBody('');
                    }}
                    className="inline-flex items-center gap-1 font-medium text-[#1A365D] hover:underline"
                  >
                    <CornerDownRight className="h-3 w-3" />
                    Reply
                  </button>
                  {replies.length > 0 && (
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                    </span>
                  )}
                </div>

                {/* Nested Replies */}
                {replies.length > 0 && (
                  <div className="mt-2 space-y-3 border-l border-slate-200 pl-3.5">
                    {replies.map((reply) => {
                      const canDeleteReply =
                        isAdmin ||
                        reply.authorUsername.toLowerCase() ===
                          currentUser.username.toLowerCase();
                      return (
                        <div key={reply.id} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex min-w-0 items-center gap-1.5 text-slate-500">
                              <span className="font-semibold text-slate-900 truncate">
                                {reply.authorName}
                              </span>
                              <span className="font-mono text-[11px]">
                                @{reply.authorUsername}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-[11px] tabular-nums whitespace-nowrap">
                                {formatCommentTime(reply.createdAt)}
                              </span>
                            </div>
                            {canDeleteReply && (
                              <button
                                type="button"
                                onClick={() => onDeleteComment(taskId, reply.id)}
                                aria-label="Delete reply"
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
                            {renderBodyWithMentions(reply.body)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Inline Reply Composer */}
                {replyingToId === item.id && (
                  <div className="mt-2 border-l border-slate-200 pl-3.5 pt-1">
                    <MentionComposer
                      value={replyBody}
                      onChange={setReplyBody}
                      onSubmit={() => handlePostReply(item.id)}
                      onCancel={() => {
                        setReplyingToId(null);
                        setReplyBody('');
                      }}
                      users={users}
                      placeholder={`Reply to @${item.authorUsername}...`}
                      submitLabel="Reply"
                      rows={2}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
