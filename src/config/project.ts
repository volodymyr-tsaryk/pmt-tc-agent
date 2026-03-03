export interface ProjectConfig {
  name: string;
  techStack: string[];
  conventions: string[];
  reviewCriteria: {
    minDescriptionLength: number;
    requiredFields: string[];
  };
  // Phase 2: RAG — define the shape now, implement later
  knowledge?: {
    docsPath?: string;
    codebasePath?: string;
    enabled: boolean;
  };
}

export const defaultProjectConfig: ProjectConfig = {
  name: "MyApp",
  techStack: [
    "Next.js 14",
    "TypeScript",
    "PostgreSQL",
    "Prisma ORM",
    "Tailwind CSS",
    "Jest",
  ],
  conventions: [
    "Feature-based folder structure (src/features/<feature>/)",
    "Server components by default, client components only when needed",
    "Database access only via Prisma (no raw SQL)",
    "All API routes validated with Zod",
    "Unit tests required for business logic",
  ],
  reviewCriteria: {
    minDescriptionLength: 50,
    requiredFields: ["title", "description"],
  },
  knowledge: {
    enabled: false,
    // Phase 2: set docsPath and codebasePath when RAG is connected
  },
};
