"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowRight, Check, CheckCheck, Circle, CircleDashed, Folder, FolderKanban, LayoutList, ListTodo, Loader2, KeyRound, LogOut, Pencil, Play, Plus, RotateCcw, Search, Users } from "lucide-react";
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
import { AccountDialog } from "./account-dialog";
import { InlineTaskFields, TaskSignals } from "./inline-task";
import { TemplateLibrary } from "./templates";
import { NotificationPreferences } from "./notification-preferences";
import { InvitationsPanel } from "./invitations-panel";
import { WorkloadSummary } from "./workload-summary";
import { BulkActions } from "./bulk-actions";
import { SavedViews } from "./saved-views";
import { taskLink } from "@/lib/productivity";
import type { SavedFilters } from "@/lib/productivity";
import { TaskEditor } from "./task-editor";
import { NotificationInbox } from "./notification-inbox";
import { useTaskCreationTool } from "@/hooks/use-task-creation-tool";

type View = "my" | "board" | "projects" | "members";
type Metadata = { role: "admin" | "member"; projects: Project[]; members: Member[] };
type Page = { tasks: Task[]; hasMore: boolean; nextOffset: number };
const emptyPage: Page = { tasks: [], hasMore: false, nextOffset: 0 };
type TaskResult = { key: string; page: Page; error: string };
const headings: Record<View, string> = { my: "My Tasks", board: "Project board", projects: "Projects", members: "People" };

function SidebarMenuButton(props: ComponentProps<typeof BaseSidebarMenuButton>) {
  const { setOpenMobile } = useSidebar();
  return <BaseSidebarMenuButton {...props} onClick={event => { props.onClick?.(event); setOpenMobile(false); }} />;
}

export function WorkspaceApp({ identity, initialLink = { workspaceId: "", taskId: "" } }: { identity: Identity; initialLink?: { workspaceId: string; taskId: string } }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [accountDialog, setAccountDialog] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      router.replace("/sign-in"); router.refresh();
    } catch { setSigningOut(false); toast.error("Could not sign out. Please try again."); }
  }
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]); const [workspaceId, setWorkspaceId] = useState("");
  const [metadata, setMetadata] = useState<Metadata | null>(null); const [bootError, setBootError] = useState(""); const [bootRetry, setBootRetry] = useState(0);
  const [view, setView] = useState<View>("my"); const [projectId, setProjectId] = useState("");
  const [taskResult, setTaskResult] = useState<TaskResult>({ key: "", page: emptyPage, error: "" }); const [offset, setOffset] = useState(0);
  const [priority, setPriority] = useState("all"); const [assignee, setAssignee] = useState("all");
  const [status, setStatus] = useState("all"); const [dueFilter, setDueFilter] = useState("all"); const [sort, setSort] = useState("due_date");
  const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [showDone, setShowDone] = useState(false); const [archived, setArchived] = useState(false);
  const [revision, setRevision] = useState(0); const [metadataRevision, setMetadataRevision] = useState(0);
  const [title, setTitle] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false); const composer = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [selection, setSelection] = useState<{ key: string; tasks: Task[] }>({ key: "", tasks: [] });
  const searchInput = useRef<HTMLInputElement>(null);
  const openedInitialLink = useRef(false);
  function selectTask(task: Task | null) {
    setSelected(task);
    window.history.replaceState(window.history.state, "", task ? taskLink(task.workspace_id, task.id) : "/");
  }
 const [projectDialog, setProjectDialog] = useState<Project | "new" | null>(null);
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
    const controller = new AbortController();
    api<{ workspaces: Workspace[] }>("bootstrap", { method: "POST", body: {}, signal: controller.signal }).then(result => { if (controller.signal.aborted) return; setBootError(""); setWorkspaces(result.workspaces); setWorkspaceId(current => current || (result.workspaces.some(w => w.id === initialLink.workspaceId) ? initialLink.workspaceId : result.workspaces[0]?.id) || ""); if (initialLink.workspaceId && !result.workspaces.some(w => w.id === initialLink.workspaceId)) toast.error("This task link is unavailable or you do not have access."); }).catch(e => { if (!controller.signal.aborted) setBootError(e.message); });
    return () => controller.abort();
  }, [bootRetry, initialLink.workspaceId]);
  useEffect(() => {
    if (!workspaceId) return; const controller = new AbortController();
    api<Metadata>(workspacePath("workspace", workspaceId), { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setBootError(""); setMetadata(result); setProjectId(current => result.projects.some(p => p.id === current && !p.archived_at) ? current : result.projects.find(p => !p.archived_at)?.id ?? "");
    }).catch(e => { if (!controller.signal.aborted) setBootError(e.message); });
    return () => controller.abort();
  }, [workspaceId, metadataRevision]);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setOffset(0); }, 250); return () => clearTimeout(timer); }, [search]);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => { const focus = () => { refresh(); setMetadataRevision(n => n + 1); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
  const params = new URLSearchParams({ workspace_id: workspaceId, include_done: String(view === "board" || showDone || archived || status === "done"), archived: String(archived), query, limit: "50", offset: String(offset) });
  if (view === "my") params.set("assignee_id", identity.userId);
  else { params.set("project_id", projectId); if (assignee !== "all") params.set("assignee_id", assignee); }
  if (priority !== "all") params.set("priority", priority);
  if (status !== "all") params.set("status", status);
  params.set("due", dueFilter); params.set("sort", sort); params.set("tz_offset", String(new Date().getTimezoneOffset()));
  const taskUrl = workspaceId && metadata && ["my", "board"].includes(view) && (view !== "board" || projectId) ? `tasks?${params}` : "";
  const taskKey = taskUrl ? `${revision}:${taskUrl}` : "";
  const currentResult = Boolean(taskUrl) && taskResult.key === taskKey;
  const page = currentResult ? taskResult.page : emptyPage;
  const loading = Boolean(taskUrl) && !currentResult;
  const listError = currentResult ? taskResult.error : "";
  useEffect(() => {
    if (!taskUrl) return;
    const controller = new AbortController();
    api<Page>(taskUrl, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setTaskResult({ key: taskKey, page: result, error: "" });
    }).catch(e => {
      if (!controller.signal.aborted) setTaskResult({ key: taskKey, page: emptyPage, error: e.message });
    });
    return () => controller.abort();
  }, [taskUrl, taskKey]);

  const selectedTasks = selection.key === taskKey ? selection.tasks : [];
  function toggleTask(task: Task, checked: boolean) { setSelection({ key: taskKey, tasks: checked ? [...selectedTasks.filter(t => t.id !== task.id), task] : selectedTasks.filter(t => t.id !== task.id) }); }
  const savedFilters: SavedFilters = Object.fromEntries([...params.entries()].filter(([key]) => !["workspace_id", "limit", "offset", "tz_offset"].includes(key)));
  function applySavedFilters(filters: SavedFilters) {
    setView(filters.project_id ? "board" : "my"); if (filters.project_id) setProjectId(filters.project_id);
    setAssignee(filters.assignee_id ?? "all"); setPriority(filters.priority ?? "all"); setStatus(filters.status ?? "all");
    setDueFilter(filters.due ?? "all"); setSort(filters.sort ?? "due_date"); setSearch(filters.query ?? ""); setQuery(filters.query ?? "");
    setArchived(filters.archived === "true"); setShowDone(filters.include_done === "true"); setOffset(0);
  }
  useEffect(() => {
    if (!metadata || workspaceId !== initialLink.workspaceId || !initialLink.taskId || openedInitialLink.current) return;
    const controller = new AbortController();
    api<Task>(workspacePath(`tasks/${encodeURIComponent(initialLink.taskId)}`, workspaceId), { signal: controller.signal }).then(task => {
      if (!controller.signal.aborted) { openedInitialLink.current = true; setSelected(task); }
    }).catch(e => { if (!controller.signal.aborted) { openedInitialLink.current = true; toast.error(e.message); } });
    return () => controller.abort();
  }, [metadata, workspaceId, initialLink.workspaceId, initialLink.taskId]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || target.isContentEditable || target.closest("input,textarea,select,[role=dialog],[role=combobox]")) return;
      if (event.key === "c" || event.key === "C") { event.preventDefault(); if (metadata && activeProjects.length) { setView("my"); setArchived(false); requestAnimationFrame(() => composer.current?.focus()); } }
      if (event.key === "/") { event.preventDefault(); if (!["my", "board"].includes(view)) setView("my"); requestAnimationFrame(() => searchInput.current?.focus()); }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [metadata, activeProjects.length, view]);
  function myOpenTasks() {
    setView("my"); setOffset(0); setSearch(""); setQuery(""); setPriority("all"); setAssignee("all"); setStatus("all"); setDueFilter("all"); setSort("due_date"); setArchived(false); setShowDone(false);
  }
  function addTask() {
    if (!activeProjects.length) { if (metadata?.role === "admin") setProjectDialog("new"); return; }
    if (view !== "board") setView("my");
    setArchived(false); setOffset(0);
    requestAnimationFrame(() => composer.current?.focus());
  }
  async function openNotificationTask(id: string) {
    const task = await api<Task>(workspacePath(`tasks/${encodeURIComponent(id)}`, workspaceId));
    selectTask(task);
  }
  function navigate(next: View) { setView(next); setOffset(0); selectTask(null); }
  function changeWorkspace(id: string) { if (title.trim()) { toast.info("Finish or clear your task draft before switching workspaces."); return; } setWorkspaceId(id); setMetadata(null); setProjectId(""); setTaskResult({ key: "", page: emptyPage, error: "" }); setBootError(""); selectTask(null); setOffset(0); setAssignee("all"); }
  async function mutation<T>(action: () => Promise<T>): Promise<T> {
    if (lock.current) throw new Error("Please wait for the current change to finish.");
    lock.current = true; setBusy(true);
    try { return await action(); } finally { lock.current = false; setBusy(false); }
  }
  async function updateTask(task: Task, patch: Omit<TaskPatch, "version">): Promise<Task> {
    const updated = await mutation(() => api<Task>(workspacePath(`tasks/${encodeURIComponent(task.id)}`, task.workspace_id), { method: "PATCH", body: { ...patch, version: task.version } }));
    setTaskResult(current => current.key === taskKey ? { ...current, page: { ...current.page, tasks: current.page.tasks.map(t => t.id === updated.id ? updated : t) } } : current); refresh();
    return updated;
  }
  async function quickUpdate(task: Task, patch: Omit<TaskPatch, "version">) {
    try {
      const updated = await updateTask(task, patch);
      if (patch.status === "done" || patch.archived !== undefined) {
        toast.success(patch.status === "done" ? "Task completed" : patch.archived ? "Task moved to trash" : "Task restored", { action: { label: "Undo", onClick: () => { void updateTask(updated, patch.archived !== undefined ? { archived: !patch.archived } : { status: task.status }).catch(e => toast.error(e.message)); } } });
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not update the task."); }
  }
  async function createTask(event: FormEvent) {
    event.preventDefault(); if (!projectId || !title.trim() || busy) return;
    try { const created = await mutation(() => api<Task>(workspacePath("tasks", workspaceId), { method: "POST", body: { title, project_id: projectId } })); setTitle(""); setOffset(0); refresh(); toast.success("Task created and assigned to you", { action: { label: "Open", onClick: () => selectTask(created) } }); composer.current?.focus(); }
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
  async function applyBulk(changes: Omit<TaskPatch, "version">) {
    await mutation(() => api(workspacePath("tasks/bulk", workspaceId), { method: "POST", body: { tasks: selectedTasks.map(t => ({ id: t.id, version: t.version })), changes } }));
    setSelection({ key: "", tasks: [] }); refresh(); toast.success("Selected tasks updated");
  }
  function statusActions(task: Task) {
    if (task.archived_at) return <Button size="sm" variant="outline" disabled={busy} onClick={() => void quickUpdate(task, { archived: false })}><RotateCcw size={14} />Restore</Button>;
    return <div className="task-actions">{task.status === "todo" && <Button size="sm" disabled={busy} aria-label={`Start ${task.title}`} onClick={() => void quickUpdate(task, { status: "in_progress" })}><Play size={14} />Start</Button>}<Button size="sm" variant={task.status === "in_progress" ? "default" : "ghost"} disabled={busy} aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`} onClick={() => void quickUpdate(task, { status: task.status === "done" ? "todo" : "done" })}>{task.status === "done" ? <RotateCcw size={14} /> : <Check size={14} />}{task.status === "done" ? "Reopen" : "Complete"}</Button></div>;
  }
  function due(task: Task) { return task.due_date ? <time dateTime={task.due_date} className={task.status !== "done" && task.due_date < today ? "overdue" : ""}>{task.due_date === today ? "Today" : new Date(`${task.due_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time> : <span className="muted">No due date</span>; }

  return <SidebarProvider><Sidebar className="stride-sidebar"><SidebarHeader><div className="brand"><span className="brand-mark"><CheckCheck size={23} /></span><span>stride<span className="brand-period">.</span></span></div>{workspaces.length > 1 ? <Choice label="Workspace" value={workspaceId} onChange={changeWorkspace} options={workspaces.map(w => ({ value: w.id, label: w.name }))} /> : <p className="workspace-label">{workspace?.name ?? "Your workspace"}</p>}</SidebarHeader>
    <SidebarContent><SidebarGroup><SidebarGroupLabel>WORKSPACE</SidebarGroupLabel><SidebarMenu>{([{ view: "my", label: "My Tasks", icon: ListTodo }, { view: "board", label: "Project board", icon: FolderKanban }, { view: "projects", label: "Projects", icon: Folder }, { view: "members", label: "People", icon: Users }] as const).map(item => <SidebarMenuItem key={item.view}><SidebarMenuButton isActive={view === item.view} onClick={() => navigate(item.view)} className="nav-item"><item.icon /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>
      <SidebarGroup><SidebarGroupLabel>PROJECTS</SidebarGroupLabel><SidebarMenu>{activeProjects.slice(0, 12).map(p => <SidebarMenuItem key={p.id}><SidebarMenuButton isActive={view === "board" && projectId === p.id} onClick={() => { setProjectId(p.id); navigate("board"); }}><span className="project-symbol"><Folder size={14} /></span><span>{p.name}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>{metadata?.role === "admin" && <Button variant="ghost" className="sidebar-add" onClick={() => setProjectDialog("new")}><Plus size={16} />New project</Button>}</SidebarGroup>
    </SidebarContent><SidebarFooter><div className="account"><Avatar name={identity.displayName} /><div><strong>{identity.displayName}</strong><span>{metadata?.role === "admin" ? "Workspace admin" : "Team member"}</span></div><button type="button" aria-label="Change password" disabled={busy} onClick={() => setAccountDialog(true)}><KeyRound size={17} /></button><button type="button" aria-label="Sign out" disabled={signingOut || busy} onClick={signOut}><LogOut size={17} /></button></div></SidebarFooter></Sidebar>
    <SidebarInset className="stride-main"><header className="topbar"><div><SidebarTrigger /><span className="breadcrumb">Workspace <span>/</span> {headings[view]}</span></div><div><span className="private-label">Private workspace</span>{metadata && workspaceId && <><NotificationPreferences key={`prefs-${workspaceId}`} workspaceId={workspaceId} onChanged={refresh} /><NotificationInbox key={workspaceId} workspaceId={workspaceId} revision={revision} onOpenTask={openNotificationTask} /></>}</div></header>
      <main id="main-content" className="workspace-content"><div className="page-heading"><div><p className="eyebrow">{view === "my" ? "YOUR DAILY WORKSPACE" : view === "board" ? "WORK IN MOTION" : "WORKSPACE"}</p><h1>{headings[view]}</h1><p className="page-description">{view === "my" ? "A clear place to start. One task at a time." : view === "board" ? "See what’s next, what’s moving, and what’s done." : view === "projects" ? "Keep related work together." : "The people who share this workspace."}</p></div><div className="heading-actions">{view === "projects" && metadata?.role === "admin" && <Button variant="outline" onClick={() => setProjectDialog("new")}>New project</Button>}<Button onClick={addTask} disabled={!metadata || busy || (!activeProjects.length && metadata.role !== "admin")}><Plus size={17} />Add task</Button></div></div>
      {bootError ? <div className="error-box" role="alert"><p>{bootError}</p><div className="inline-actions"><Button variant="outline" onClick={() => { setBootError(""); setBootRetry(n => n + 1); setMetadataRevision(n => n + 1); }}>Try again</Button><a href="/sign-in">Sign in again</a></div></div> : !metadata ? <div aria-label="Loading your workspace" className="loading-state"><Skeleton className="h-14 w-full" /><Skeleton className="h-36 w-full" /></div> : <>
        {["my", "board"].includes(view) && <>
          <div className="work-context"><div className="context-title">{view === "board" ? <FolderKanban size={18} /> : <LayoutList size={18} />}<span>{view === "board" ? "Project" : "Create in"}</span><Choice label={view === "board" ? "Project board" : "Project for new tasks"} value={projectId || "none"} onChange={value => { setProjectId(value); setOffset(0); }} options={activeProjects.length ? activeProjects.map(p => ({ value: p.id, label: p.name })) : [{ value: "none", label: "No active projects" }]} disabled={!activeProjects.length} /></div><span className="context-note">{view === "my" ? "You own these tasks" : "Team view"}</span></div>
          {!archived && <form className="quick-create" onSubmit={createTask}><Plus size={20} aria-hidden="true" /><Input ref={composer} aria-label="New task title" placeholder="What needs to get done?" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} required disabled={busy || !activeProjects.length} /><Button type="submit" variant="ghost" disabled={busy || !title.trim() || !activeProjects.length}>{busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={18} />}<span className="sr-only">Create task</span></Button></form>}
          <div className="saved-view-row"><Button variant="ghost" size="sm" onClick={myOpenTasks}><ListTodo size={15} />My open tasks</Button><span className="muted text-sm">{archived ? "Trash · restore tasks any time" : "Return to open tasks you own"}</span></div>
          <div className="view-tools"><TemplateLibrary key={`templates-${workspaceId}`} workspaceId={workspaceId} projectId={projectId} userId={identity.userId} admin={metadata.role === "admin"} members={metadata.members} onCreated={task => { refresh(); selectTask(task); }} /><SavedViews key={workspaceId} workspaceId={workspaceId} filters={savedFilters} onApply={applySavedFilters} /></div>
          <div className="toolbar"><div className="search-control"><Search size={16} /><Input ref={searchInput} aria-label="Search task titles" placeholder="Search tasks" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} /></div><Choice label="Filter priority" value={priority} onChange={value => { setPriority(value); setOffset(0); }} options={[{ value: "all", label: "All priorities" }, ...PRIORITIES.map(value => ({ value, label: `${value[0].toUpperCase() + value.slice(1)} priority` }))]} />{view === "board" && <Choice label="Filter assignee" value={assignee} onChange={value => { setAssignee(value); setOffset(0); }} options={[{ value: "all", label: "All assignees" }, { value: "unassigned", label: "Creator by default" }, ...metadata.members.map(m => ({ value: m.user_id, label: m.name }))]} />}<Choice label="Filter status" value={status} onChange={value => { setStatus(value); setOffset(0); }} options={[{ value: "all", label: "All statuses" }, ...STATUSES.map(value => ({ value, label: STATUS_LABEL[value] }))]} /><Choice label="Filter due date" value={dueFilter} onChange={value => { setDueFilter(value); setOffset(0); }} options={[{ value: "all", label: "Any due date" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "upcoming", label: "Upcoming" }, { value: "none", label: "No due date" }]} /><Choice label="Sort tasks" value={sort} onChange={value => { setSort(value); setOffset(0); }} options={[{ value: "due_date", label: "Sort: due date" }, { value: "priority", label: "Sort: priority" }]} /><div className="check-filter"><Checkbox id="show-archived" checked={archived} onCheckedChange={value => { setArchived(value === true); setOffset(0); }} /><Label htmlFor="show-archived">Trash</Label></div>{view === "my" && <div className="check-filter"><Checkbox id="show-completed" checked={showDone || status === "done"} disabled={status === "done"} onCheckedChange={value => { setShowDone(value === true); setOffset(0); }} /><Label htmlFor="show-completed">Completed</Label></div>}</div>
          {!archived && !!page.tasks.length && <div className="bulk-select-all"><Checkbox id="select-page" checked={selectedTasks.length === page.tasks.length} onCheckedChange={value => setSelection({ key: taskKey, tasks: value === true ? [...page.tasks] : [] })} disabled={busy} /><Label htmlFor="select-page">Select this page</Label><span className="muted text-sm">Up to 50 tasks</span></div>}
          {!!selectedTasks.length && <BulkActions tasks={selectedTasks} members={metadata.members} disabled={busy} onApply={applyBulk} onClear={() => setSelection({ key: "", tasks: [] })} />}
          {listError && <div className="error-box" role="alert">{listError}<Button variant="outline" onClick={refresh}>Retry</Button></div>}
          {loading ? <div className="loading-state" role="status" aria-label="Loading tasks"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : !listError && !page.tasks.length ? <EmptyWork title={!activeProjects.length ? "Create a project to begin" : archived ? "Trash is empty" : search || priority !== "all" || assignee !== "all" || status !== "all" || dueFilter !== "all" ? "No tasks match these filters" : "Ready for your next task"} description={!activeProjects.length ? "Projects give your tasks a home." : view === "my" ? "Create a task above or assign an existing task to yourself from the board." : "Add a task above to put your plan in motion."}>{!activeProjects.length && metadata.role === "admin" && <Button onClick={() => setProjectDialog("new")}>Create project</Button>}</EmptyWork> : !listError && view === "my" ? <div className="task-groups">{(sort === "priority" ? ["By priority"] : ["Overdue", "Today", "Upcoming", "No due date", "Completed"]).map(group => { const tasks = group === "By priority" ? page.tasks : page.tasks.filter(t => taskGroup(t, today) === group); if (!tasks.length) return null; return <section className="task-group" key={group}><div className="group-heading"><h2 className={group === "Overdue" ? "overdue" : ""}>{group}</h2><span>{tasks.length}</span></div><Table><TableHeader className="sr-only"><TableRow><TableHead>Select</TableHead><TableHead>Task</TableHead><TableHead>Quick edit</TableHead><TableHead>Due</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{tasks.map(task => <TableRow key={task.id} className="task-row"><TableCell className="task-select-cell">{!archived && <Checkbox aria-label={`Select ${task.title}`} checked={selectedTasks.some(t => t.id === task.id)} disabled={busy} onCheckedChange={value => toggleTask(task, value === true)} />}</TableCell><TableCell><button className="task-open" onClick={() => selectTask(task)}><span className={`status-icon status-${task.status}`}>{task.status === "done" ? <Check size={17} /> : task.status === "in_progress" ? <Play size={15} /> : <Circle size={17} />}</span><span><strong className={task.status === "done" ? "completed-title" : ""}>{task.title}</strong><small>{task.project_name} · {STATUS_LABEL[task.status]}</small><TaskSignals task={task} /></span></button></TableCell><TableCell className="priority-cell"><InlineTaskFields task={task} members={metadata.members} disabled={busy} onUpdate={updateTask} /></TableCell><TableCell className="due-cell">{due(task)}</TableCell><TableCell>{statusActions(task)}</TableCell></TableRow>)}</TableBody></Table></section>; })}</div> : !listError ? <div className="board" aria-label={`${project?.name ?? "Project"} task board`}>{STATUSES.map(status => <section className={`board-column column-${status}`} key={status} aria-label={STATUS_LABEL[status]} onDragOver={event => { if (!archived && !busy) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (archived || busy) return; const id = event.dataTransfer.getData("text/stride-task"); const task = page.tasks.find(t => t.id === id); if (task && task.status !== status) void quickUpdate(task, { status }); }}><div className="group-heading"><h2>{STATUS_LABEL[status]}</h2><span>{page.tasks.filter(t => t.status === status).length}</span></div>{page.tasks.filter(t => t.status === status).map(task => <Card key={task.id} className="board-card" draggable={!archived && !busy} onDragStart={event => { event.dataTransfer.setData("text/stride-task", task.id); event.dataTransfer.effectAllowed = "move"; }}><CardContent><div className="board-card-heading">{!archived && <Checkbox aria-label={`Select ${task.title}`} checked={selectedTasks.some(t => t.id === task.id)} disabled={busy} onCheckedChange={value => toggleTask(task, value === true)} />}<button className="board-task-title" onClick={() => selectTask(task)}>{task.title}</button></div><TaskSignals task={task} /><div className="card-metadata"><InlineTaskFields task={task} members={metadata.members} disabled={busy} onUpdate={updateTask} />{due(task)}</div><div className="card-assignee"><Avatar name={task.responsible_name ?? task.assignee_name ?? "Task creator"} /><span>{task.responsible_name ?? task.assignee_name ?? "Task creator"}</span></div><div className="card-actions">{statusActions(task)}</div></CardContent></Card>)}{!page.tasks.some(t => t.status === status) && <p className="empty-column">No tasks on this page</p>}</section>)}</div> : null}
          {!loading && !listError && (page.tasks.length > 0 || offset > 0) && <div className="pagination-row"><p>{page.tasks.length ? `Showing ${offset + 1}–${offset + page.tasks.length}` : "No tasks on this page"}{page.hasMore ? " · more tasks available" : " · end of results"}</p><div><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button><Button variant="outline" size="sm" disabled={!page.hasMore} onClick={() => setOffset(page.nextOffset)}>Next</Button></div></div>}
        </>}
        {view === "projects" && <div className="project-grid">{metadata.projects.map(p => <Card className={`project-card ${p.archived_at ? "archived-project" : ""}`} key={p.id}><CardContent><div className="project-card-top"><span className="project-mark"><Folder size={23} /></span><span className="muted">{p.archived_at ? "Archived" : "Active"}</span></div><h2>{p.name}</h2><p>{p.description || "No description yet."}</p><div className="project-card-actions"><Button variant="outline" disabled={!!p.archived_at} onClick={() => { setProjectId(p.id); navigate("board"); }}>Open board<ArrowRight size={14} /></Button>{metadata.role === "admin" && <div><Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} disabled={busy} onClick={() => setProjectDialog(p)}><Pencil size={16} /></Button><Button variant="ghost" size="icon" aria-label={`${p.archived_at ? "Restore" : "Archive"} ${p.name}`} disabled={busy} onClick={() => void archiveProject(p)}>{p.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}</Button></div>}</div></CardContent></Card>)}</div>}
        {view === "members" && <section className="people-section"><WorkloadSummary key={workspaceId} workspaceId={workspaceId} revision={revision} />{metadata.role === "admin" && <InvitationsPanel key={`invites-${workspaceId}`} workspaceId={workspaceId} />}{metadata.role === "admin" && <form className="member-form" onSubmit={async event => { event.preventDefault(); setMemberError(""); try { await mutation(() => api(workspacePath("members", workspaceId), { method: "POST", body: { email: memberEmail, role: memberRole } })); setMemberEmail(""); setMetadataRevision(n => n + 1); toast.success("Membership saved"); } catch (e) { setMemberError(e instanceof Error ? e.message : "Could not save membership."); } }}><h2>Add an existing user</h2><p className="muted">They need approved access and must sign in once before being added. Adding a member does not send an invitation.</p><div className="member-form-fields"><Input type="email" aria-label="Member email" required maxLength={254} placeholder="teammate@example.com" value={memberEmail} onChange={e => setMemberEmail(e.target.value)} disabled={busy} /><Choice label="Member role" value={memberRole} onChange={setMemberRole} options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]} disabled={busy} /><Button type="submit" disabled={busy || !memberEmail}>Save member</Button></div>{memberError && <p role="alert" className="error-box">{memberError}</p>}</form>}<div className="people-list">{metadata.members.map(m => <div className="person-row" key={m.user_id}><Avatar name={m.name} /><div><strong>{m.name}</strong><span>{m.email}</span></div><span className="person-role">{m.user_id === workspace?.owner_id ? "Owner" : m.role}</span></div>)}</div></section>}
      </>}
      <footer className="workspace-footer"><CircleDashed size={14} /><span>Keep the next step simple. <kbd>C</kbd> create · <kbd>/</kbd> search</span></footer>
    </main></SidebarInset>
    {selected && <TaskEditor key={selected.id} task={selected} userId={identity.userId} admin={metadata?.role === "admin"} members={metadata?.members ?? []} onClose={() => selectTask(null)} onUpdate={updateTask} onChanged={refresh} />}
    {projectDialog && <ProjectDialog key={projectDialog === "new" ? "new" : projectDialog.id} project={projectDialog === "new" ? undefined : projectDialog} onClose={() => setProjectDialog(null)} onSave={saveProject} />}
    {accountDialog && <AccountDialog onClose={() => setAccountDialog(false)} />}
    <Toaster richColors closeButton position="bottom-right" />
  </SidebarProvider>;
}
