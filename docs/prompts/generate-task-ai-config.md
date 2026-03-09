Analyze this codebase and generate a `.github/task-ai.md` file for an AI task analyzer agent.

The file has two parts:

## Part 1: YAML Frontmatter (structured config)

Derive each field by reading the codebase:

- `name`: the product/project name (check package.json, README, or app title)
- `techStack`: every significant technology in use — framework, language, database, ORM, auth library, CSS, testing framework, deployment platform, etc. Be specific (e.g. "Next.js 14" not "Next.js", "PostgreSQL 16" not "SQL")
- `conventions`: coding patterns actually enforced in this codebase — folder structure, naming conventions, where business logic lives, how API routes are structured, how state is managed, how errors are handled, etc. Read actual source files to discover these, don't guess from tech stack alone.
- `triggerLabel`: use `ai-review` (default, keep as-is)
- `mention`: use `@task-ai` (default, keep as-is)
- `reviewCriteria.minDescriptionLength`: 50 (keep as default)
- `reviewCriteria.requiredFields`: `[title, description]` (keep as default)

## Part 2: Markdown Body (project documentation for AI context)

Write the following sections based on what you find in the codebase, README, docs, and any existing issues or PRs:

### Business Overview
What does this product do? Who are the users? What problem does it solve? What is the business model (SaaS, marketplace, internal tool, etc.)? Include key metrics or goals if mentioned anywhere in the codebase or docs.

### Core Domain Concepts
Define the key entities and terms a developer needs to understand before touching this codebase. E.g. if there are Workspaces, Projects, Members, Plans — explain what each is and how they relate. An AI analyzing a GitHub issue should understand these terms to write a correct dev plan.

### Architecture
How is the system structured? What are the main layers (frontend, backend, workers, cron jobs, external services)? How do requests flow through the system? What are the boundaries between parts?

### Key Business Rules
List business rules that are not obvious from the code. E.g. "A user can belong to multiple workspaces but each workspace has one owner", "Free plan is limited to 3 projects", "Deleting a workspace soft-deletes all its data for 30 days". These are the rules an AI must respect when writing implementation plans.

### Development Conventions
Patterns specific to this codebase that go beyond the tech stack. E.g. where to put new features, how to add a new API route, how to add a new database table, how tests are organized.

### Common Pitfalls
Things that are easy to get wrong. E.g. "Never query the DB from a React Server Component directly — use server actions", "Always invalidate the cache after mutations", "The legacy `UserV1` type is deprecated — always use `User`".

### External Integrations
List any third-party services the app integrates with (Stripe, SendGrid, S3, etc.) and any important notes about how they're used.

---

## Instructions

1. Read the codebase thoroughly before writing — check src/, app/, lib/, docs/, README, package.json, schema files, migration files, and any existing architecture docs.
2. Be specific and concrete. Vague entries like "uses React" are useless. "Next.js 14 App Router with React Server Components, client components use `'use client'` directive" is useful.
3. Write conventions you actually observed in the code, not ones you'd recommend.
4. Keep the business rules section honest — only include rules you can verify from the code or docs.
5. The markdown body will be used as a RAG knowledge base by an AI agent analyzing GitHub issues — write it as reference documentation, not prose.

Output the complete `.github/task-ai.md` file ready to commit.
