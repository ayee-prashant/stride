"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, workspacePath } from "@/lib/client-api";
import type { CommentDraft, CommentPage, Member, Task } from "@/lib/domain";

type Props = {
  task: Task;
  members: Member[];
  draft: CommentDraft;
  onDraftChange: (draft: CommentDraft) => void;
  onBusyChange: (busy: boolean) => void;
  onPosted: () => void;
};

export function TaskDiscussion({ task, members, draft, onDraftChange, onBusyChange, onPosted }: Props) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; page?: CommentPage; error?: string }>({ key: "" });
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [mentionPicker, setMentionPicker] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);
  const path = `${workspacePath(`tasks/${encodeURIComponent(task.id)}/comments`, task.workspace_id)}&limit=30&offset=${offset}`;
  const key = `${path}:${revision}`;
  const page = result.key === key ? result.page : undefined;
  const error = result.key === key ? result.error : undefined;
  const typedMention = draft.body.match(/(?:^|\s)@([^\s@]*)$/u);
  const filter = (mentionPicker ? mentionSearch : typedMention?.[1] ?? "").toLocaleLowerCase();
  const suggestions = members.filter(member => !draft.mentioned_user_ids.includes(member.user_id) && member.name.toLocaleLowerCase().includes(filter)).slice(0, 8);

  useEffect(() => {
    const controller = new AbortController();
    api<CommentPage>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ key, page: data });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error.message });
    });
    return () => controller.abort();
  }, [path, key]);

  function mention(member: Member) {
    if (draft.mentioned_user_ids.length >= 10) return;
    const body = typedMention
      ? draft.body.slice(0, draft.body.lastIndexOf("@")) + `@${member.name} `
      : `${draft.body}${draft.body && !draft.body.endsWith(" ") ? " " : ""}@${member.name} `;
    if (body.length > 4000) { setPostError("Make room in your comment before adding a mention."); return; }
    onDraftChange({ body, mentioned_user_ids: [...draft.mentioned_user_ids, member.user_id] });
    setMentionPicker(false); setMentionSearch("");
    textarea.current?.focus();
  }

  async function post() {
    if (lock.current || !draft.body.trim()) return;
    lock.current = true; setPosting(true); onBusyChange(true); setPostError("");
    try {
      await api(workspacePath(`tasks/${encodeURIComponent(task.id)}/comments`, task.workspace_id), { method: "POST", body: draft });
      onDraftChange({ body: "", mentioned_user_ids: [] });
      setMentionPicker(false); setOffset(0); setRevision(value => value + 1); onPosted();
    } catch (error) {
      setPostError(error instanceof Error ? error.message : "Your comment could not be saved. Your draft is still here.");
    } finally { lock.current = false; setPosting(false); onBusyChange(false); }
  }

  return <section className="discussion-section" aria-labelledby="discussion-title">
    <h3 id="discussion-title">Comments</h3>
    {task.archived_at ? <p className="muted text-sm">Restore this task to continue the discussion.</p> : <form onSubmit={event => { event.preventDefault(); void post(); }}>
      <Label htmlFor="task-comment" className="sr-only">Add a comment</Label>
      <Textarea ref={textarea} id="task-comment" placeholder="Add an update or ask a question…" rows={3} maxLength={4000} required disabled={posting} value={draft.body} aria-describedby="mention-help" onChange={event => onDraftChange({ ...draft, body: event.target.value })} />
      <p id="mention-help" className="muted text-sm">Type @ and choose a teammate to notify them. Use Tab to reach the suggestions.</p>
      {draft.mentioned_user_ids.length > 0 && <ul className="mention-chips" aria-label="Teammates to notify">{draft.mentioned_user_ids.map(id => <li key={id}><span>@{members.find(member => member.user_id === id)?.name ?? "Former member"}</span><Button type="button" size="icon" variant="ghost" disabled={posting} aria-label={`Remove mention of ${members.find(member => member.user_id === id)?.name ?? "former member"}`} onClick={() => onDraftChange({ ...draft, mentioned_user_ids: draft.mentioned_user_ids.filter(value => value !== id) })}><X size={13} /></Button></li>)}</ul>}
      {(mentionPicker || typedMention) && draft.mentioned_user_ids.length < 10 && <div className="mention-picker">
        {mentionPicker && <Input aria-label="Find a teammate to mention" placeholder="Find teammate" maxLength={100} value={mentionSearch} onChange={event => setMentionSearch(event.target.value)} disabled={posting} />}
        {suggestions.length ? <ul aria-label="Mention suggestions">{suggestions.map(member => <li key={member.user_id}><Button type="button" variant="ghost" disabled={posting} onClick={() => mention(member)}>{member.name}<span className="muted">{member.email}</span></Button></li>)}</ul> : <p className="muted text-sm">No matching teammates.</p>}
      </div>}
      <div className="comment-actions"><Button type="button" size="sm" variant="ghost" aria-expanded={mentionPicker} disabled={posting || draft.mentioned_user_ids.length >= 10} onClick={() => setMentionPicker(value => !value)}><AtSign size={15} />Mention</Button><Button type="submit" size="sm" disabled={posting || !draft.body.trim()}><Send size={14} />{posting ? "Posting…" : "Post comment"}</Button></div>
      {postError && <div role="alert" className="error-box"><p>{postError}</p><Button type="button" variant="outline" disabled={posting} onClick={() => { setOffset(0); setRevision(value => value + 1); }}>Refresh comments before retrying</Button></div>}
    </form>}
    {error ? <div role="alert" className="error-box">{error}<Button variant="outline" onClick={() => setRevision(value => value + 1)}>Retry loading comments</Button></div> : !page ? <p className="muted" role="status">Loading comments…</p> : <>
      {page.comments.length ? <ol className="comment-list">{page.comments.map(comment => <li key={comment.id}><div className="comment-heading"><strong>{comment.author_name}</strong><time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString()}</time></div><p className="comment-body">{comment.body}</p></li>)}</ol> : <p className="muted text-sm">{offset ? "No more comments on this page." : "No comments yet. Keep the next step here."}</p>}
      {(offset > 0 || page.hasMore) && <div className="comment-pagination"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Newer comments</Button><Button size="sm" variant="outline" disabled={!page.hasMore} onClick={() => setOffset(page.nextOffset)}>Older comments</Button></div>}
    </>}
  </section>;
}
