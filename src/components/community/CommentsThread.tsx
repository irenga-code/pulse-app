import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Flag, Trash2, Loader2, Pencil } from 'lucide-react';
import Avatar from '@/components/Avatar';
import RoleBadge from '@/components/RoleBadge';
import ReportModal from '@/components/community/ReportModal';
import EmojiButton from '@/components/emoji/EmojiPicker';
import { insertAtCaret } from '@/components/emoji/emojiData';
import { EmojiText } from '@/components/emoji/EmojiImg';
import { ErrorNote, inputClass, mutedText, bodyText } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { friendlyError } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useSocial } from '@/context/SocialContext';
import type { Comment, PublicProfile } from '@/lib/types';
import { readCache, writeCache } from '@/lib/cache';
import { LinesSkeleton } from '@/components/Skeleton';

let channelCounter = 0;

export default function CommentsThread({ postId, onCountChange }: { postId: string; onCountChange?: (delta: number) => void }) {
  const { user, canWrite, profile, requireAuth, openAuth, refreshProfile, isAdmin } = useAuth();
  const { show } = useToast();
  const { openProfile } = useSocial();
  // reopening a thread shows the comments from a moment ago at once (memory only, not stored on the device)
  const cached = readCache<{ comments: Comment[]; people: Record<string, PublicProfile> }>(`comments:${postId}`);
  const [comments, setComments] = useState<Comment[]>(cached?.comments ?? []);
  const [people, setPeople] = useState<Record<string, PublicProfile>>(cached?.people ?? {});
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.listComments(postId);
      const who = await api.profilesByIds(rows.map((c) => c.user_id));
      setComments(rows);
      setPeople(who);
      writeCache(`comments:${postId}`, { comments: rows, people: who }, false);
      setError(null);
    } catch (e) {
      if (!readCache(`comments:${postId}`)) setError(friendlyError(e));
    }
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`comments-${postId}-${++channelCounter}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (!requireAuth('Sign in to join the conversation.')) return;
    setSending(true);
    try {
      const created = await api.addComment(postId, body);
      setComments((c) => [...c, created]);
      onCountChange?.(1);
      if (profile) setPeople((p) => ({ ...p, [profile.id]: profile }));
      setText('');
    } catch (err) {
      show(friendlyError(err), 'error');
      refreshProfile();
    }
    setSending(false);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const body = editing.text.trim();
    if (!body) return;
    setSavingEdit(true);
    try {
      await api.updateComment(editing.id, body);
      setComments((list) => list.map((x) => (x.id === editing.id ? { ...x, body } : x)));
      setEditing(null);
    } catch (err) {
      show(friendlyError(err), 'error');
    }
    setSavingEdit(false);
  };

  const remove = async (c: Comment) => {
    try {
      if (c.user_id === user?.id) await api.deleteComment(c.id);
      else await api.adminSetContentStatus('comment', c.id, 'removed', 'Removed by a moderator.');
      setComments((list) => list.filter((x) => x.id !== c.id));
      onCountChange?.(-1);
    } catch (err) {
      show(friendlyError(err), 'error');
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-wa-lightBorder dark:border-wa-darkBorder">
      {loading ? (
        <LinesSkeleton label="Loading comments" />
      ) : error ? (
        <ErrorNote message={error} />
      ) : comments.length === 0 ? (
        <p className={`text-xs py-1 ${mutedText}`}>No comments yet. Start the conversation.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const p = people[c.user_id];
            const own = c.user_id === user?.id;
            return (
              <li key={c.id} className="flex gap-2.5">
                <button type="button" onClick={() => openProfile(c.user_id)} aria-label={`View ${c.user_name}'s profile`} className="flex-shrink-0 self-start">
                  <Avatar name={c.user_name} url={p?.avatar_url} size={28} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-semibold ${bodyText}`}>{c.user_name}</span>
                    <RoleBadge accountType={p?.account_type} verified={p?.is_verified} />
                    <span className={`text-[11px] ${mutedText}`}>· {timeAgo(c.created_at)}</span>
                  </div>
                  {editing?.id === c.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); saveEdit(); }} className="mt-1 flex items-center gap-1.5">
                      <input value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value.slice(0, 500) })} aria-label="Edit comment"
                        autoFocus className={`${inputClass} !py-1.5 text-sm`} />
                      <button type="submit" disabled={savingEdit || !editing.text.trim()} className="text-xs font-semibold text-wa-green px-1.5 disabled:opacity-50">
                        {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={`text-xs px-1 ${mutedText}`}>Cancel</button>
                    </form>
                  ) : (
                    <p className={`text-sm mt-0.5 leading-snug break-words ${bodyText}`}><EmojiText text={c.body} /></p>
                  )}
                </div>
                <div className="flex items-start gap-1 flex-shrink-0">
                  {own && editing?.id !== c.id && (
                    <button onClick={() => setEditing({ id: c.id, text: c.body })} aria-label="Edit comment" className={`p-1 hover:text-wa-green ${mutedText}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {(own || isAdmin) && (
                    <button onClick={() => remove(c)} aria-label={own ? 'Delete comment' : 'Remove comment'} className={`p-1 hover:text-wa-live ${mutedText}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!own && (
                    <button
                      onClick={() => (requireAuth('Sign in to report content.') ? setReporting(c.id) : undefined)}
                      aria-label="Report comment"
                      className={`p-1 hover:text-wa-live ${mutedText}`}
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {user && !canWrite ? (
        <p className={`text-xs mt-3 ${mutedText}`}>Your account is suspended, so you can read but not comment.</p>
      ) : (
        <form onSubmit={send} className="flex items-center gap-2 mt-3">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => { if (!user) openAuth('signin', 'Sign in to join the conversation.'); }}
            maxLength={500}
            placeholder={user ? 'Write a comment…' : 'Sign in to comment'}
            className={`${inputClass} py-2`}
            aria-label="Write a comment"
          />
          <EmojiButton
            label="Add emoji to comment"
            onPick={(e) => {
              const { value, caret } = insertAtCaret(inputRef.current, text, e, 500);
              setText(value);
              requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(caret, caret); });
            }}
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label="Send comment"
            className="p-2.5 rounded-xl bg-wa-green text-white disabled:opacity-40 hover:bg-wa-greenDark transition-colors"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      )}

      {reporting && <ReportModal targetType="comment" targetId={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
}
