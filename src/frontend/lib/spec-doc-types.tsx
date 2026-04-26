import {
  Sparkles, Network, Layers, FileCode, BookOpen, FlaskConical,
  Shield, Palette, Ruler, ClipboardCheck, Rocket, FileText,
  type LucideIcon,
} from 'lucide-react';
import type { PlanDocType } from '../../shared/types';

export interface SpecDocTypeMeta {
  type: PlanDocType;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the chip background + border + text */
  chipClass: string;
  /** Color hint for a single-color glow/icon */
  iconColor: string;
}

export const SPEC_DOC_TYPES: SpecDocTypeMeta[] = [
  {
    type: 'executive_summary',
    label: 'Executive Summary',
    description: 'High-level what + why. The 30-second pitch.',
    icon: Sparkles,
    chipClass: 'bg-blue-500/10 border-blue-400/20 text-blue-200',
    iconColor: 'text-blue-300',
  },
  {
    type: 'architecture',
    label: 'Architecture',
    description: 'System boundaries, modules, key flows.',
    icon: Network,
    chipClass: 'bg-violet-500/10 border-violet-400/20 text-violet-200',
    iconColor: 'text-violet-300',
  },
  {
    type: 'patterns',
    label: 'Patterns',
    description: 'Patterns to follow (or anti-patterns to avoid).',
    icon: Layers,
    chipClass: 'bg-cyan-500/10 border-cyan-400/20 text-cyan-200',
    iconColor: 'text-cyan-300',
  },
  {
    type: 'examples',
    label: 'Examples',
    description: 'Concrete code examples or templates.',
    icon: FileCode,
    chipClass: 'bg-teal-500/10 border-teal-400/20 text-teal-200',
    iconColor: 'text-teal-300',
  },
  {
    type: 'research',
    label: 'Research',
    description: 'Research notes, links, prior art.',
    icon: BookOpen,
    chipClass: 'bg-indigo-500/10 border-indigo-400/20 text-indigo-200',
    iconColor: 'text-indigo-300',
  },
  {
    type: 'testing',
    label: 'Testing',
    description: 'Test strategy, fixtures, coverage targets.',
    icon: FlaskConical,
    chipClass: 'bg-emerald-500/10 border-emerald-400/20 text-emerald-200',
    iconColor: 'text-emerald-300',
  },
  {
    type: 'security',
    label: 'Security',
    description: 'Threat model, sensitive paths, do-not-touch list.',
    icon: Shield,
    chipClass: 'bg-rose-500/10 border-rose-400/20 text-rose-200',
    iconColor: 'text-rose-300',
  },
  {
    type: 'ux_ui',
    label: 'UX / UI',
    description: 'Design intent, components, interaction notes.',
    icon: Palette,
    chipClass: 'bg-pink-500/10 border-pink-400/20 text-pink-200',
    iconColor: 'text-pink-300',
  },
  {
    type: 'constraints',
    label: 'Constraints',
    description: 'Non-functional requirements, deadlines, budgets.',
    icon: Ruler,
    chipClass: 'bg-amber-500/10 border-amber-400/20 text-amber-200',
    iconColor: 'text-amber-300',
  },
  {
    type: 'acceptance_criteria',
    label: 'Acceptance Criteria',
    description: 'Definition of done — measurable checks.',
    icon: ClipboardCheck,
    chipClass: 'bg-lime-500/10 border-lime-400/20 text-lime-200',
    iconColor: 'text-lime-300',
  },
  {
    type: 'rollout',
    label: 'Rollout',
    description: 'Deployment, migration, feature flag plan.',
    icon: Rocket,
    chipClass: 'bg-orange-500/10 border-orange-400/20 text-orange-200',
    iconColor: 'text-orange-300',
  },
  {
    type: 'custom',
    label: 'Custom',
    description: 'Any other context.',
    icon: FileText,
    chipClass: 'bg-zinc-500/10 border-zinc-400/20 text-zinc-200',
    iconColor: 'text-zinc-300',
  },
];

const TYPE_MAP: Map<string, SpecDocTypeMeta> = new Map(SPEC_DOC_TYPES.map((t) => [t.type, t]));
const CUSTOM_META = SPEC_DOC_TYPES[SPEC_DOC_TYPES.length - 1];

export function getSpecDocTypeMeta(type: string): SpecDocTypeMeta {
  return TYPE_MAP.get(type) ?? {
    ...CUSTOM_META,
    label: humanizeType(type),
  };
}

function humanizeType(type: string): string {
  return type
    .split(/[_\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
