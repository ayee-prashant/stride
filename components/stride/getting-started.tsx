"use client";
import { ArrowRight, BookOpen, CheckCircle2, Monitor, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

type Destination = "my" | "projects" | "members" | "context" | "agents" | "delivery";
export function GettingStarted({ admin, projectCount, memberCount, onNavigate, onCreateProject, onCreateTask }: {
  admin: boolean; projectCount: number; memberCount: number;
  onNavigate: (destination: Destination) => void; onCreateProject: () => void; onCreateTask: () => void;
}) {
  return <section className="getting-started" aria-label="Getting started with Stride">
    <div className="brief-intro"><div className="brief-intro-icon"><BookOpen size={24} /></div><div><h2>One shared project. Clear human decisions.</h2><p>Use Stride for daily tasks, then add supervised agent work when your project needs it.</p></div></div>
    <div className="getting-started-grid">
      <article className="getting-started-card"><Users size={22} /><h2>Manage everyday work</h2><p>Use the workspace in your browser. Your team uses the same Stride address.</p>
        <ol><li><strong>Create a project</strong><span>{projectCount ? `${projectCount} active project${projectCount === 1 ? "" : "s"} in this workspace.` : "Give related tasks a home."}</span>{admin ? <Button variant="outline" onClick={onCreateProject}>Create project</Button> : <p className="muted">Ask a workspace admin to create a project.</p>}</li>
          <li><strong>Add your first useful task</strong><span>A title and project are enough. It is assigned to you by default; add a deadline only when you need one.</span><Button variant="outline" disabled={!projectCount} onClick={onCreateTask}>Create a task<ArrowRight size={14} /></Button></li>
          <li><strong>Bring in your team</strong><span>{memberCount} human member{memberCount === 1 ? "" : "s"}. Admins can create an invitation link in People.</span><Button variant="outline" onClick={() => onNavigate("members")}>Open People</Button></li></ol>
      </article>
      <article className="getting-started-card"><Monitor size={22} /><h2>Connect an IDE agent</h2><p>Humans approve scope and results. Agents investigate, implement and report evidence.</p>
        <ol><li><strong>Name the accountable humans</strong><span>Set the requirements, architecture, engineering, QA, UAT and release reviewers in Agent delivery.</span><Button variant="outline" disabled={!projectCount} onClick={() => onNavigate("delivery")}>Open Agent delivery</Button></li>
          <li><strong>Give each agent a profile and role</strong><span>Choose its human operator and permitted files. The operator reviews the role’s responsibilities and exclusions.</span><Button variant="outline" disabled={!projectCount} onClick={() => onNavigate("agents")}>Open Team and agents</Button></li>
          <li><strong>Enroll a connection, then approve a start</strong><span>Connections in Agent delivery shows your login command, MCP entry and terminal watcher. The operator authorizes the exact work packet, then asks the IDE agent to start.</span></li></ol>
      </article>
    </div>
    <article className="getting-started-card"><CheckCircle2 size={22} /><h2>Keep context shared and approvals explicit</h2><p>Start with a BA discovery task and human-approved requirements. An accepted architecture plan creates implementation tickets. Project brief holds the accepted scope and repository context; each agent receives its assigned packet and shared checkpoints.</p><div className="inline-actions"><Button variant="outline" disabled={!projectCount} onClick={() => onNavigate("context")}>Open Project brief</Button><Button variant="ghost" onClick={() => onNavigate("my")}>Return to My Tasks</Button></div></article>
    <div className="getting-started-faq"><h2>Choose the setup you actually need</h2>
      <details><summary>Do I need to run Stride on every agent’s machine?</summary><p>No. Humans and enrolled agents connect to one shared Stride server. Each coding agent needs its own working folder and branch. Enroll each tool or machine separately, and keep its credentials local. Extra machines are useful when builds compete for resources; they are optional.</p></details>
      <details><summary>How do agents on different machines share context?</summary><p>The approved project brief, repository observations, task packet and checkpoints travel through Stride. Local conversations stay local. A new machine needs a new enrollment and start authorization; copying another connection’s credentials does not transfer approval.</p></details>
      <details><summary>Does assigning a task automatically start an agent?</summary><p>No. Assignment, operator authorization, result acceptance and release approval are separate decisions. Keep the companion running for private terminal notices. After approving a start, ask your IDE agent to claim the task.</p></details>
      <details><summary>When do I need local server setup?</summary><p>Only when developing or self-hosting Stride itself. For local development, use Node 24 and Docker Compose on Linux, macOS or WSL, then run <code>npm run setup:local</code> in a reviewed checkout. For an IDE connection to the hosted workspace, use the instructions under Agent delivery → Connections.</p></details>
      <details><summary>Do I need an LLM API key?</summary><p>No additional model API is required for Stride’s coordination and context features. Your IDE agent uses its existing model access.</p></details>
    </div>
  </section>;
}
