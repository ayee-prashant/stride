"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps, FormEvent } from "react";
import { Archive, ArrowRight, Check, CheckCheck, Circle, CircleDashed, Folder, FolderKanban, LayoutList, ListTodo, Loader2, LogOut, Pencil, Play, Plus, RotateCcw, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton as BaseSidebarMenuButton, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { api, workspacePath } from "@/lib/client-api";
import { authClient } from "@/lib/auth-client";
import { localToday, PRIORITIES, STATUSES, STATUS_LABEL, taskGroup } from "@/lib/domain";
import type { Identity, Member, Project, ProjectInput, Task, TaskPatch, Workspace } from "@/lib/domain";
import { Avatar, Choice, EmptyWork } from "./controls";
import { ProjectDialog } from "./project-dialog";
import { TaskEditor } from "./task-editor";
import { useTaskCreationTool } from "@/hooks/use-task-creation-tool";

type View = "my" | "board" | "projects" | "members";
type Metadata = { role: "admin" | "member"; projects: Project[]; members: Member[] };
type Page = { tasks: Task[]; hasMore: boolean; nextOffset: number };
const headings: Record<View, string> = { my: "My Work", board: "Project board", projects: "Projects", members: "People" };

function SidebarMenuButton(props: ComponentProps<typeof BaseSidebarMenuButton>) {
  const { setOpenMobile } = useSidebar();
  return <BaseSidebarMenuButton {...props} onClick={event => { props.onClick?.(event); setOpenMobile(false); }} />;
}

export function WorkspaceApp({ identity }: { identity: Identity }) {
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      window.location.assign("/sign-in");
    } catch { setSigningOut(false); toast.error("Could not sign out. Please try again."); }
  }
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]); const [workspaceId, setWorkspaceId] = useState("");
  const [metadata, setMetadata] = useState<Metadata | null>(null); const [bootError, setBootError] = useState(""); const [bootRetry, setBootRetry] = useState(0);
  const [view, setView] = useState<View>("my"); const [projectId, setProjectId] = useState("");
  const [page, setPage] = useState<Page>({ tasks: [], hasMore: false, nextOffset: 0 }); const [offset, setOffset] = useState(0);
  const [priority, setPriority] = useState("all"); const [assignee, setAssignee] = useState("all");
  const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [showDone, setShowDone] = useState(false); const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(false); const [listError, setListError] = useState(""); const [revision, setRevision] = useState(0); const [metadataRevision, setMetadataRevision] = useState(0);
  const [title, setTitle] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false); const composer = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Task | null>(null); const [projectDialog, setProjectDialog] = useState<Project | "new" | null>(null);
  const [memberEmail, setMemberEmail] = useState(""); const [memberRole, setMemberRole] = useState("member"); const [memberError, setMemberError] = useState("");
  const workspace = workspaces.find(w => w.id === workspaceId); const activeProjects = metadata?.projects.filter(p => !p.archived_at) ?? [];
  const project = metadata?.projects.find(p => p.id === projectId); const today = localToday();
  useTaskCreationTool(stagedTitle => {
    if (busy) throw new Error("Wait for the current change to finish.");
    if (title.trim()) throw new Error("Finish or clear the existing task draft first.");
    setView("my"); setArchived(false); setOffset(0); setTitle(stagedTitle);
    requestAnimationFrame(() => composer.current?.focus());
  }, !!metadata && !!activeProjects.length);

  useEffect(() => {
    const controller = new AbortController(); setBootError("");
    api<{ workspaces: Workspace[] }>("bootstrap", { method: "POST", body: {}, signal: controller.signal }).then(result => { setWorkspaces(result.workspaces); setWorkspaceId(current => current || result.workspaces[0]?.id || ""); }).catch(e => { if (!controller.signal.aborted) setBootError(e.message); });
    return () => controller.abort();
  }, [bootRetry]);
  useEffect(() => {
    if (!workspaceId) return; const controller = new AbortController(); setBootError("");
    api<Metadata>(workspacePath("workspace", workspaceId), { signal: controller.signal }).then(result => {
      setMetadata(result); setProjectId(current => result.projects.some(p => p.id === current && !p.archived_at) ? current : result.projects.find(p => !p.archived_at)?.id ?? "");
    }).catch(e => { if (!controller.signal.aborted) setBootError(e.message); });
    return () => controller.abort();
  }, [workspaceId, metadataRevision]);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setOffset(0); }, 250); return () => clearTimeout(timer); }, [search]);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => { const focus = () => { refresh(); setMetadataRevision(n => n + 1); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  useEffect(() => {
    if (!workspaceId || !metadata || !["my", "board"].includes(view)) return;
    if (view === "board" && !projectId) { setPage({ tasks: [], hasMore: false, nextOffset: 0 }); return; }
    const controller = new AbortController(); setLoading(true); setListError("");
    const params = new URLSearchParams({ workspace_id: workspaceId, include_done: String(view === "board" || showDone || archived), archived: String(archived), query, limit: "50", offset: String(offset) });
    if (view === "my") params.set("assignee_id", identity.userId);
    else { params.set("project_id", projectId); if (assignee !== "all") params.set("assignee_id", assignee); }
    if (priority !== "all") params.set("priority", priority);
    api<Page>(`tasks?${params}`, { signal: controller.signal }).then(setPage).catch(e => { if (!controller.signal.aborted) { setListError(e.message); setPage({ tasks: [], hasMore: false, nextOffset: 0 }); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, metadata, view, projectId, assignee, priority, query, showDone, archived, offset, revision, identity.userId]);

  function navigate(next: View) { setView(next); setOffset(0); setSelected(null); }
  function changeWorkspace(id: string) { setWorkspaceId(id); setMetadata(null); setProjectId(""); setPage({ tasks: [], hasMore: false, nextOffset: 0 }); setSelected(null); setOffset(0); setAssignee("all"); }
  async function mutation<T>(action: () => Promise<T>): Promise<T> {
    if (lock.current) throw new Error("Please wait for the current change to finish.");
    lock.current = true; setBusy(true);
    try { return await action(); } finally { lock.current = false; setBusy(false); }
  }
  async function updateTask(task: Task, patch: Omit<TaskPatch, "version">): Promise<Task> {
    const updated = await mutation(() => api<Task>(workspacePath(`tasks/${encodeURIComponent(task.id)}`, task.workspace_id), { method: "PATCH", body: { ...patch, version: task.version } }));
    setPage(current => ({ ...current, tasks: current.tasks.map(t => t.id === updated.id ? updated : t) })); refresh();
    return updated;
  }
  async function quickUpdate(task: Task, patch: Omit<TaskPatch, "version">) {
    try {
      const updated = await updateTask(task, patch);
      if (patch.status === "done" || patch.archived !== undefined) {
        toast.success(patch.status === "done" ? "Task completed" : patch.archived ? "Task archived" : "Task restored", { action: { label: "Undo", onClick: () => { void updateTask(updated, patch.archived !== undefined ? { archived: !patch.archived } : { status: task.status }).catch(e => toast.error(e.message)); } } });
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update the task."); }
  }
  async function createTask(event: FormEvent) {
    event.preventDefault(); if (!projectId || !title.trim() || busy) return;
    try { await mutation(() => api<Task>(workspacePath("tasks", workspaceId), { method: "POST", body: { title, project_id: projectId, assignee_id: view === "my" ? identity.userId : null } })); setTitle(""); setOffset(0); refresh(); toast.success("Task created"); composer.current?.focus(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not create the task. Your title is still here."); }
  }
  async function saveProject(input: ProjectInput, existing?: Project) {
    await mutation(() => api(workspacePath(existing ? `projects/${encodeURIComponent(existing.id)}` : "projects", workspaceId), { method: existing ? "PATCH" : "POST", body: existing ? { ...input, version: existing.version } : input }));
    setMetadataRevision(n => n + 1); toast.success(existing ? "Project updated" : "Project created");
  }
  async function archiveProject(item: Project) {
    try { await mutation(() => api(workspacePath(`projects/${encodeURIComponent(item.id)}`, workspaceId), { method: "PATCH", body: { version: item.version, archived: !item.archived_at } })); setMetadataRevision(n => n + 1); refresh(); toast.success(item.archived_at ? "Project restored" : "Project archived — its tasks are preserved"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not update the project."); }
  }
  function statusActions(task: Task) {
    if (task.archived_at) return <Button size="sm" variant="outline" disabled={busy} onClick={() => void quickUpdate(task, { archived: false })}><RotateCcw size={14} />Restore</Button>;
    return <div className="task-actions">{task.status === "todo" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void quickUpdate(task, { status: "in_progress" })}><Play size={14} />Start</Button>}<Button size="sm" variant={task.status === "done" ? "ghost" : "outline"} disabled={busy} aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`} onClick={() => void quickUpdate(task, { status: task.status === "done" ? "todo" : "done" })}>{task.status === "done" ? <RotateCcw size={14} /> : <Check size={14} />}{task.status === "done" ? "Reopen" : "Complete"}</Button></div>;
  }
  function due(task: Task) { return task.due_date ? <time dateTime={task.due_date} className={task.status !== "done" && task.due_date < today ? "overdue" : ""}>{task.due_date === today ? "Today" : new Date(`${task.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time> : <span className="muted">No due date</span>; }

  return <SidebarProvider><Sidebar className="stride-sidebar"><SidebarHeader><div className="brand"><span className="brand-mark"><CheckCheck size={23} /></span><span>stride<span className="brand-period">.</span></span></div>{workspaces.length > 1 ? <Choice label="Workspace" value={workspaceId} onChange={changeWorkspace} options={workspaces.map(w => ({ value: w.id, label: w.name }))} /> : <p className="workspace-label">{workspace?.name ?? "Your workspace"}</p>}</SidebarHeader>
    <SidebarContent><SidebarGroup><SidebarGroupLabel>WORKSPACE</SidebarGroupLabel><SidebarMenu>{([{ view: "my", label: "My Work", icon: ListTodo }, { view: "board", label: "Project board", icon: FolderKanban }, { view: "projects", label: "Projects", icon: Folder }, { view: "members", label: "People", icon: Users }] as const).map(item => <SidebarMenuItem key={item.view}><SidebarMenuButton isActive={view === item.view} onClick={() => navigate(item.view)} className="nav-item"><item.icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>
      <SidebarGroup><SidebarGroupLabel>PROJECTS</SidebarGroupLabel><SidebarMenu>{activeProjects.slice(0, 12).map(p => <SidebarMenuItem key={p.id}><SidebarMenuButton isActive={view === "board" && projectId === p.id} onClick={() => { setProjectId(p.id); navigate("board"); }}><span className="project-symbol"><Folder size={14} /></span><span>{p.name}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>{metadata?.role === "admin" && <Button variant="ghost" className="sidebar-add" onClick={() => setProjectDialog("new")}><Plus size={16} />New project</Button>}</SidebarGroup>
    </SidebarContent><SidebarFooter><div className="account"><Avatar name={identity.displayName} /><div><strong>{identity.displayName}</strong><span>{metadata?.role === "admin" ? "Workspace admin" : "Team member"}</span></div><button type="button" aria-label="Sign out" disabled={signingOut || busy} onClick={signOut}><LogOut size={17} /></button></div></SidebarFooter></Sidebar>
    <SidebarInset className="stride-main"><header className="topbar"><div><SidebarTrigger /><span className="breadcrumb">Workspace <span>/</span> {headings[view]}</span></div><span className="private-label">Private workspace</span></header>
      <main id="main-content" className="workspace-content"><div className="page-heading"><div><p className="eyebrow">{view === "my" ? "YOUR DAILY WORKSPACE" : view === "board" ? "WORK IN MOTION" : "WORKSPACE"}</p><h1>{headings[view]}</h1><p className="page-description">{view === "my" ? "A clear place to start. One task at a time." : view === "board" ? "See what’s next, what’s moving, and what’s done." : view === "projects" ? "Keep related work together." : "The people who share this workspace."}</p></div>{["my", "board"].includes(view) ? <Button onClick={() => composer.current?.focus()} disabled={!activeProjects.length || archived}><Plus size={17} />Add task</Button> : view === "projects" && metadata?.role === "admin" ? <Button onClick={() => setProjectDialog("new")}><Plus size={17} />New project</Button> : null}</div>
      {bootError ? <div className="error-box" role="alert"><p>{bootError}</p><div className="inline-actions"><Button variant="outline" onClick={() => { setBootRetry(n => n + 1); setMetadataRevision(n => n + 1); }}>Try again</Button><a href="/sign-in">Sign in again</a></div></div> : !metadata ? <div aria-label="Loading your workspace" className="loading-state"><Skeleton className="h-14 w-full" /><Skeleton className="h-36 w-full" /></div> : <>
        {["my", "board"].includes(view) && <>
          <div className="work-context"><div className="context-title">{view === "board" ? <FolderKanban size={18} /> : <LayoutList size={18} />}<span>{view === "board" ? "Project" : "Create in"}</span><Choice label={view === "board" ? "Project board" : "Project for new tasks"} value={projectId || "none"} onChange={value => { setProjectId(value); setOffset(0); }} options={activeProjects.length ? activeProjects.map(p => ({ value: p.id, label: p.name })) : [{ value: "none", label: "No active projects" }]} disabled={!activeProjects.length} /></div><span className="context-note">{view === "my" ? "Showing work assigned to you" : "Team view"}</span></div>
          {!archived && <form className="quick-create" onSubmit={createTask}><Plus size={20} aria-hidden="true" /><Input ref={composer} aria-label="New task title" placeholder="What needs to get done?" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} required disabled={busy || !activeProjects.length} /><Button type="submit" variant="ghost" disabled={busy || !title.trim() || !activeProjects.length}>{busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={18} />}<span className="sr-only">Create task</span></Button></form>}
          <div className="toolbar"><div className="search-control"><Search size={16} /><Input aria-label="Search task titles" placeholder="Search tasks" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} /></div><Choice label="Filter priority" value={priority} onChange={value => { setPriority(value); setOffset(0); }} options={[{ value: "all", label: "All priorities" }, ...PRIORITIES.map(value => ({ value, label: `${value[0].toUpperCase() + value.slice(1)} priority` }))]} />{view === "board" && <Choice label="Filter assignee" value={assignee} onChange={value => { setAssignee(value); setOffset(0); }} options={[{ value: "all", label: "All assignees" }, { value: "unassigned", label: "Unassigned" }, ...metadata.members.map(m => ({ value: m.user_id, label: m.name }))]} />}<div className="check-filter"><Checkbox id="show-archived" checked={archived} onCheckedChange={value => { setArchived(value === true); setOffset(0); }} /><Label htmlFor="show-archived">Archived</Label></div>{view === "my" && <div className="check-filter"><Checkbox id="show-completed" checked={showDone} onCheckedChange={value => { setShowDone(value === true); setOffset(0); }} /><Label htmlFor="show-completed">Completed</Label></div>}</div>
          {listError && <div className="error-box" role="alert">{listError}<Button variant="outline" onClick={refresh}>Retry</Button></div>}
          {loading ? <div className="loading-state" role="status" aria-label="Loading tasks"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : !listError && !page.tasks.length ? <EmptyWork title={!activeProjects.length ? "Create a project to begin" : archived ? "No archived tasks" : search || priority !== "all" || assignee !== "all" ? "No tasks match these filters" : "Ready for your next task"} description={!activeProjects.length ? "Projects give your tasks a home." : view === "my" ? "Create a task above or assign an existing task to yourself from the board." : "Add a task above to put your plan in motion."}>{!activeProjects.length && metadata.role === "admin" && <Button onClick={() => setProjectDialog("new")}>Create project</Button>}</EmptyWork> : !listError && view === "my" ? <div className="task-groups">{["Overdue", "Today", "Upcoming", "No due date", "Completed"].map(group => { const tasks = page.tasks.filter(t => taskGroup(t, today) === group); if (!tasks.length) return null; return <section className="task-group" key={group}><div className="group-heading"><h2 className={group === "Overdue" ? "overdue" : ""}>{group}</h2><span>{tasks.length}</span></div><Table><TableHeader className="sr-only"><TableRow><TableHead>Task</TableHead><TableHead>Priority</TableHead><TableHead>Due</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{tasks.map(task => <TableRow key={task.id} className="task-row"><TableCell><button className="task-open" onClick={() => setSelected(task)}><span className={`status-icon status-${task.status}`}>{task.status === "done" ? <Check size={17} /> : task.status === "in_progress" ? <Play size={15} /> : <Circle size={17} />}</span><span><strong className={task.status === "done" ? "completed-title" : ""}>{task.title}</strong><small>{task.project_name} · {STATUS_LABEL[task.status]}</small></span></button></TableCell><TableCell className="priority-cell"><span className={`priority priority-${task.priority}`}>{task.priority}</span></TableCell><TableCell className="due-cell">{due(task)}</TableCell><TableCell>{statusActions(task)}</TableCell></TableRow>)}</TableBody></Table></section>; })}</div> : !listError ? <div className="board" aria-label={`${project?.name ?? "Project"} task board`}>{STATUSES.map(status => <section className={`board-column column-${status}`} key={status} aria-label={STATUS_LABEL[status]} onDragOver={event => { if (!archived && !busy) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (archived || busy) return; const id = event.dataTransfer.getData("text/stride-task"); const task = page.tasks.find(t => t.id === id); if (task && task.status !== status) void quickUpdate(task, { status }); }}><div className="group-heading"><h2>{STATUS_LABEL[status]}</h2><span>{page.tasks.filter(t => t.status === status).length}</span></div>{page.tasks.filter(t => t.status === status).map(task => <Card key={task.id} className="board-card" draggable={!archived && !busy} onDragStart={event => { event.dataTransfer.setData("text/stride-task", task.id); event.dataTransfer.effectAllowed = "move"; }}><CardContent><button className="board-task-title" onClick={() => setSelected(task)}>{task.title}</button><div className="card-metadata"><span className={`priority priority-${task.priority}`}>{task.priority}</span>{due(task)}</div><div className="card-assignee">{task.assignee_name ? <><Avatar name={task.assignee_name} /><span>{task.assignee_name}</span></> : <span className="muted">Unassigned</span>}</div><div className="card-actions">{statusActions(task)}</div></CardContent></Card>)}{!page.tasks.some(t => t.status === status) && <p className="empty-column">No tasks on this page</p>}</section>)}</div> : null}
          {!loading && !listError && (page.tasks.length > 0 || offset > 0) && <div className="pagination-row"><p>{page.tasks.length ? `Showing ${offset + 1}–${offset + page.tasks.length}` : "No tasks on this page"}{page.hasMore ? " · more tasks available" : " · end of results"}</p><div><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button><Button variant="outline" size="sm" disabled={!page.hasMore} onClick={() => setOffset(page.nextOffset)}>Next</Button></div></div>}
        </>}
        {view === "projects" && <div className="project-grid">{metadata.projects.map(p => <Card className={`project-card ${p.archived_at ? "archived-project" : ""}`} key={p.id}><CardContent><div className="project-card-top"><span className="project-mark"><Folder size={23} /></span><span className="muted">{p.archived_at ? "Archived" : "Active"}</span></div><h2>{p.name}</h2><p>{p.description || "No description yet."}</p><div className="project-card-actions"><Button variant="outline" disabled={!!p.archived_at} onClick={() => { setProjectId(p.id); navigate("board"); }}>Open board<ArrowRight size={14} /></Button>{metadata.role === "admin" && <div><Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} disabled={busy} onClick={() => setProjectDialog(p)}><Pencil size={16} /></Button><Button variant="ghost" size="icon" aria-label={`${p.archived_at ? "Restore" : "Archive"} ${p.name}`} disabled={busy} onClick={() => void archiveProject(p)}>{p.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}</Button></div>}</div></CardContent></Card>)}</div>}
        {view === "members" && <section className="people-section">{metadata.role === "admin" && <form className="member-form" onSubmit={async event => { event.preventDefault(); setMemberError(""); try { await mutation(() => api(workspacePath("members", workspaceId), { method: "POST", body: { email: memberEmail, role: memberRole } })); setMemberEmail(""); setMetadataRevision(n => n + 1); toast.success("Membership saved"); } catch (e) { setMemberError(e instanceof Error ? e.message : "Could not save membership."); } }}><h2>Add an existing user</h2><p className="muted">They need access to this Site and must sign in once first. This does not send an invitation or change Site sharing.</p><div className="member-form-fields"><Input type="email" aria-label="Member email" required maxLength={254} placeholder="teammate@example.com" value={memberEmail} onChange={e => setMemberEmail(e.target.value)} disabled={busy} /><Choice label="Member role" value={memberRole} onChange={setMemberRole} options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]} disabled={busy} /><Button type="submit" disabled={busy || !memberEmail}>Save member</Button></div>{memberError && <p role="alert" className="error-box">{memberError}</p>}</form>}<div className="people-list">{metadata.members.map(m => <div className="person-row" key={m.user_id}><Avatar name={m.name} /><div><strong>{m.name}</strong><span>{m.email}</span></div><span className="person-role">{m.user_id === workspace?.owner_id ? "Owner" : m.role}</span></div>)}</div></section>}
      </>}
      <footer className="workspace-footer"><CircleDashed size={14} /><span>Keep the next step simple.</span></footer>
    </main></SidebarInset>
    {selected && <TaskEditor key={selected.id} task={selected} members={metadata?.members ?? []} onClose={() => setSelected(null)} onUpdate={updateTask} />}
    {projectDialog && <ProjectDialog key={projectDialog === "new" ? "new" : projectDialog.id} project={projectDialog === "new" ? undefined : projectDialog} onClose={() => setProjectDialog(null)} onSave={saveProject} />}
    <Toaster richColors closeButton position="bottom-right" />
  </SidebarProvider>;
}
