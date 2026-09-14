"use client";
import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { CircleDashed } from "lucide-react";

export function Choice({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label} className="stride-select"><SelectValue placeholder={label} /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>;
}
export function EmptyWork({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <Empty className="empty-work"><EmptyHeader><CircleDashed size={32} aria-hidden="true" /><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{children}</Empty>;
}
export function Avatar({ name }: { name: string }) {
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return <span className="person-avatar" aria-hidden="true">{initials || "?"}</span>;
}
