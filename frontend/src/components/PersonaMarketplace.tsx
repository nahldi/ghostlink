/**
 * Agent Persona Marketplace — browse and apply pre-built agent personalities.
 * Each persona defines: name, role, instructions, skills, default prompt style.
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { toast } from './Toast';

interface Persona {
  id: string;
  name: string;
  role: string;
  description: string;
  icon: string;
  color: string;
  instructions: string;
  skills: string[];
  category:
    | 'developer'
    | 'reviewer'
    | 'architect'
    | 'writer'
    | 'researcher'
    | 'devops'
    | 'security'
    | 'analyst'
    | 'manager'
    | 'designer'
    | 'educator'
    | 'custom';
  author: string;
  installs: number;
  rating?: number;
}

const CATEGORIES = [
  { value: 'all', label: 'All', icon: 'apps' },
  { value: 'developer', label: 'Developer', icon: 'code' },
  { value: 'reviewer', label: 'Reviewer', icon: 'rate_review' },
  { value: 'architect', label: 'Architect', icon: 'architecture' },
  { value: 'writer', label: 'Writer', icon: 'edit_note' },
  { value: 'researcher', label: 'Researcher', icon: 'search' },
  { value: 'devops', label: 'DevOps', icon: 'cloud' },
  { value: 'security', label: 'Security', icon: 'security' },
  { value: 'analyst', label: 'Analyst', icon: 'analytics' },
  { value: 'manager', label: 'Manager', icon: 'assignment' },
  { value: 'designer', label: 'Designer', icon: 'palette' },
  { value: 'educator', label: 'Educator', icon: 'school' },
];

// Built-in personas
const BUILTIN_PERSONAS: Persona[] = [
  {
    id: 'code-reviewer', name: 'Code Reviewer', role: 'reviewer',
    description: 'Thorough code reviewer focused on bugs, security, and best practices. Reviews PRs, suggests improvements, catches edge cases.',
    icon: 'rate_review', color: '#f59e0b', instructions: 'You are a senior code reviewer. Focus on: bugs, security vulnerabilities, performance issues, code style, and maintainability. Be thorough but constructive.',
    skills: ['code_review', 'security_audit', 'debugging'], category: 'reviewer', author: 'GhostLink', installs: 0,
  },
  {
    id: 'architect', name: 'System Architect', role: 'architect',
    description: 'Designs system architecture, evaluates trade-offs, creates technical specs. Thinks in terms of scalability, reliability, and maintainability.',
    icon: 'architecture', color: '#8b5cf6', instructions: 'You are a system architect. Focus on: architecture decisions, trade-off analysis, scalability patterns, API design, and technical specifications.',
    skills: ['architecture', 'api_design', 'documentation'], category: 'architect', author: 'GhostLink', installs: 0,
  },
  {
    id: 'test-engineer', name: 'Test Engineer', role: 'developer',
    description: 'Writes comprehensive tests — unit, integration, e2e. Finds edge cases and ensures coverage. Never ships untested code.',
    icon: 'bug_report', color: '#22c55e', instructions: 'You are a test engineer. Write thorough tests for every feature. Focus on: edge cases, error paths, integration tests, and coverage gaps.',
    skills: ['testing', 'debugging', 'code_review'], category: 'developer', author: 'GhostLink', installs: 0,
  },
  {
    id: 'security-auditor', name: 'Security Auditor', role: 'security',
    description: 'Finds vulnerabilities, reviews auth flows, checks for OWASP top 10. Thinks like an attacker to protect like a defender.',
    icon: 'security', color: '#ef4444', instructions: 'You are a security auditor. Focus on: injection attacks, auth bypasses, SSRF, XSS, CSRF, secrets management, and OWASP top 10.',
    skills: ['security_audit', 'code_review', 'debugging'], category: 'security', author: 'GhostLink', installs: 0,
  },
  {
    id: 'tech-writer', name: 'Technical Writer', role: 'writer',
    description: 'Creates clear documentation, READMEs, API docs, and guides. Makes complex concepts accessible.',
    icon: 'edit_note', color: '#06b6d4', instructions: 'You are a technical writer. Create clear, well-structured documentation. Focus on: accuracy, readability, code examples, and keeping docs in sync with code.',
    skills: ['documentation', 'api_design'], category: 'writer', author: 'GhostLink', installs: 0,
  },
  {
    id: 'devops-engineer', name: 'DevOps Engineer', role: 'devops',
    description: 'Manages CI/CD, Docker, Kubernetes, cloud infra. Automates deployments and monitors production.',
    icon: 'cloud', color: '#3b82f6', instructions: 'You are a DevOps engineer. Focus on: CI/CD pipelines, containerization, cloud infrastructure, monitoring, and deployment automation.',
    skills: ['devops', 'monitoring', 'automation'], category: 'devops', author: 'GhostLink', installs: 0,
  },
  {
    id: 'researcher', name: 'Research Assistant', role: 'researcher',
    description: 'Deep research on any topic. Finds sources, summarizes findings, compares options, and provides actionable recommendations.',
    icon: 'search', color: '#a855f7', instructions: 'You are a research assistant. Provide thorough, well-sourced research. Focus on: accuracy, multiple perspectives, actionable recommendations.',
    skills: ['web_search', 'documentation'], category: 'researcher', author: 'GhostLink', installs: 0,
  },
  {
    id: 'pair-programmer', name: 'Pair Programmer', role: 'developer',
    description: 'Collaborative coding partner. Thinks out loud, suggests approaches, catches mistakes in real-time. Like having a senior dev next to you.',
    icon: 'group', color: '#10b981', instructions: 'You are a pair programmer. Think out loud, suggest approaches, explain your reasoning. Be collaborative, not prescriptive.',
    skills: ['code_review', 'debugging', 'testing'], category: 'developer', author: 'GhostLink', installs: 0,
  },
  {
    id: 'data-analyst', name: 'Data Analyst', role: 'analyst',
    description: 'Analyzes data, creates queries, interprets results. Turns raw data into actionable insights with clear visualizations.',
    icon: 'analytics', color: '#f97316', instructions: 'You are a data analyst. Focus on: SQL queries, data interpretation, statistical analysis, trend identification, and presenting findings clearly with charts/tables.',
    skills: ['data_analysis', 'documentation'], category: 'analyst', author: 'GhostLink', installs: 0,
  },
  {
    id: 'project-manager', name: 'Project Manager', role: 'manager',
    description: 'Breaks down projects into tasks, tracks progress, identifies blockers. Keeps teams organized and on schedule.',
    icon: 'assignment', color: '#ec4899', instructions: 'You are a project manager. Focus on: task breakdown, timeline estimation, dependency tracking, risk identification, and clear status communication. Keep things organized and actionable.',
    skills: ['documentation', 'architecture'], category: 'manager', author: 'GhostLink', installs: 0,
  },
  {
    id: 'ui-designer', name: 'UI/UX Designer', role: 'designer',
    description: 'Designs user interfaces, reviews layouts, suggests UX improvements. Thinks in terms of user flows and accessibility.',
    icon: 'palette', color: '#d946ef', instructions: 'You are a UI/UX designer. Focus on: layout, color theory, typography, accessibility (WCAG), user flows, responsive design, and micro-interactions. Suggest concrete improvements.',
    skills: ['architecture', 'code_review'], category: 'designer', author: 'GhostLink', installs: 0,
  },
  {
    id: 'performance-engineer', name: 'Performance Engineer', role: 'developer',
    description: 'Optimizes code for speed and efficiency. Profiles bottlenecks, reduces memory usage, improves response times.',
    icon: 'speed', color: '#eab308', instructions: 'You are a performance engineer. Focus on: profiling, bottleneck identification, algorithmic optimization, caching strategies, lazy loading, bundle size reduction, and database query optimization.',
    skills: ['debugging', 'code_review', 'testing'], category: 'developer', author: 'GhostLink', installs: 0,
  },
  {
    id: 'mentor', name: 'Coding Mentor', role: 'educator',
    description: 'Patient teacher who explains concepts clearly. Adapts to your skill level, uses analogies, and builds understanding step by step.',
    icon: 'school', color: '#14b8a6', instructions: 'You are a coding mentor. Explain concepts at the appropriate level. Use analogies, examples, and step-by-step breakdowns. Be patient and encouraging. Ask clarifying questions before diving in.',
    skills: ['documentation'], category: 'educator', author: 'GhostLink', installs: 0,
  },
  {
    id: 'api-designer', name: 'API Designer', role: 'architect',
    description: 'Designs clean REST and GraphQL APIs. Focuses on consistency, versioning, error handling, and developer experience.',
    icon: 'api', color: '#6366f1', instructions: 'You are an API designer. Focus on: RESTful principles, consistent naming, proper HTTP methods, error responses, pagination, versioning, authentication patterns, and OpenAPI/Swagger documentation.',
    skills: ['api_design', 'documentation', 'architecture'], category: 'architect', author: 'GhostLink', installs: 0,
  },
];

export function PersonaMarketplace() {
  const agents = useChatStore((s) => s.agents);
  const [personas, setPersonas] = useState<Persona[]>(BUILTIN_PERSONAS);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [applyingTo, setApplyingTo] = useState('');

  useEffect(() => {
    fetch('/api/personas').then(r => r.ok ? r.json() : { personas: [] })
      .then(d => { if (d.personas?.length) setPersonas([...BUILTIN_PERSONAS, ...d.personas]); })
      .catch(() => {});
  }, []);

  const filtered = personas.filter(p => {
    if (category !== 'all' && p.category !== category) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const applyPersona = async (persona: Persona, agentName: string) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/soul`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soul: persona.instructions }),
      });
      if (res.ok) {
        toast(`${persona.name} applied to ${agentName}`, 'success');
        setSelectedPersona(null);
      } else {
        toast('Failed to apply persona', 'error');
      }
    } catch {
      toast('Failed to apply persona', 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-outline-variant/10 shrink-0">
        <h2 className="text-sm font-semibold text-on-surface/80">Agent Personas</h2>
        <p className="text-[10px] text-on-surface-variant/30 mt-0.5">Pre-built agent personalities and roles</p>
      </div>

      {/* Search + filter */}
      <div className="px-4 py-2 border-b border-outline-variant/5 space-y-2 shrink-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-container-high/30">
          <span className="material-symbols-outlined text-[14px] text-on-surface-variant/30">search</span>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search personas..."
            className="flex-1 bg-transparent text-[10px] text-on-surface/70 outline-none placeholder:text-on-surface-variant/20"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setCategory(c.value)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-medium whitespace-nowrap transition-colors ${
                category === c.value ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/40 hover:bg-surface-container-high/30'
              }`}>
              <span className="material-symbols-outlined text-[12px]">{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Persona grid */}
      <div className="flex-1 overflow-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <span className="material-symbols-outlined text-2xl text-on-surface-variant/20">person_search</span>
            <p className="text-xs text-on-surface-variant/40">No personas found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {filtered.map(p => (
              <motion.button
                key={p.id}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setSelectedPersona(p)}
                className="w-full text-left p-3 rounded-xl border border-outline-variant/10 hover:border-outline-variant/20 hover:bg-surface-container-high/20 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${p.color}15` }}>
                    <span className="material-symbols-outlined text-lg" style={{ color: p.color }}>{p.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-on-surface/80">{p.name}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant/30 uppercase">{p.category}</span>
                    </div>
                    <p className="text-[10px] text-on-surface-variant/50 mt-0.5 line-clamp-2">{p.description}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[8px] text-on-surface-variant/25">{p.author}</span>
                      {p.skills.slice(0, 3).map(s => (
                        <span key={s} className="text-[8px] px-1 py-0.5 rounded bg-surface-container-highest/30 text-on-surface-variant/25">{s}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* Persona detail + apply modal */}
      {selectedPersona && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={() => setSelectedPersona(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            className="relative w-[420px] max-w-[92vw] rounded-2xl border border-outline-variant/15 p-4 space-y-3"
            style={{ background: 'rgba(10, 10, 18, 0.98)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${selectedPersona.color}15` }}>
                <span className="material-symbols-outlined text-2xl" style={{ color: selectedPersona.color }}>{selectedPersona.icon}</span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-on-surface/80">{selectedPersona.name}</h3>
                <p className="text-[10px] text-on-surface-variant/40">{selectedPersona.category} · {selectedPersona.author}</p>
              </div>
            </div>
            <p className="text-[11px] text-on-surface/60 leading-relaxed">{selectedPersona.description}</p>
            <div className="px-3 py-2 rounded-lg bg-surface-container-high/20 border border-outline-variant/5">
              <p className="text-[9px] text-on-surface-variant/40 mb-1">Instructions:</p>
              <p className="text-[10px] text-on-surface/50 font-mono leading-relaxed">{selectedPersona.instructions}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedPersona.skills.map(s => (
                <span key={s} className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/60">{s}</span>
              ))}
            </div>
            <div>
              <label className="text-[9px] font-semibold text-on-surface-variant/40 uppercase tracking-wider block mb-1.5">Apply to agent</label>
              <select value={applyingTo} onChange={e => setApplyingTo(e.target.value)}
                className="w-full bg-surface-container rounded-lg px-3 py-1.5 text-[10px] text-on-surface outline-none border border-outline-variant/10">
                <option value="">Select agent...</option>
                {agents.map(a => <option key={a.name} value={a.name}>{a.label || a.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelectedPersona(null)}
                className="flex-1 px-3 py-2 rounded-lg text-[11px] font-medium text-on-surface-variant/50 hover:bg-surface-container-high transition-colors">Cancel</button>
              <button onClick={() => applyingTo && applyPersona(selectedPersona, applyingTo)}
                disabled={!applyingTo}
                className="flex-1 px-3 py-2 rounded-lg text-[11px] font-medium bg-primary text-on-primary hover:brightness-110 transition-all disabled:opacity-50">
                Apply Persona
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
