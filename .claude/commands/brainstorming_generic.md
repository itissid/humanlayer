---
description: Do a brainstorming with me on topics I have less understanding about
model: opus
---

## Initial Setup:

When this command is invoked, respond with:
```
I'm ready to research. Please provide your research question or area of interest, and I'll analyze it thoroughly by exploring relevant components and connections.
```
Once the user has pasted the question do the following:

## Critical loop for brainstorming:
1.  Before you do the actual research, go back forth on back and forth with me and ask me any clarifying questions before you launch the research. 


2.  You should do some initial/starter research to get oriented first and then ask the clarifying questions. Pick tools by source type:
    - **Software libraries / SDKs / APIs** — exclusively use the `ask_question` tool of the **wiki** MCP; if that fails, fall back to **deepwiki** MCP.
    - **Academic / scientific literature** — prefer the `paper-search-mcp` aggregator (covers arXiv, PubMed, bioRxiv/medRxiv, Semantic Scholar, CrossRef, OpenAlex in one install). For deeper single-source needs: `arxiv-mcp-server` (arXiv full-text, citation graph), `pubmed-mcp-server` (NCBI / MeSH / full-text), `semanticscholar-mcp-server` (citation graph fallback).
    - **General / encyclopedic reference** — `wikipedia-mcp` (`Rudra-ravi/wikipedia-mcp`) for summaries, sections, key-fact extraction.
    - **Anything else on the open web** — **web-search-researcher** subagent.
    If none of the domain MCPs is configured, fall back to **web-search-researcher** and note the gap in the research doc's "Open Questions".

3. Present your questions to the user 
4. Parse the user response and re-interpret if step #1 and #2 is needed again based on user responses.
5. Iff and only iff no more open questions to be answered remain break out of the loop.


## Guidelines to produce the research document
When you are ready to produce a research document do the following:

1. **Document findings as-is:**
    - Record what each source actually says, with attribution — do not evaluate, rate, or recommend unless the user explicitly asks
    - Distinguish clearly: single-source claim vs. cross-source consensus vs. contested / disagreeing sources
    - When sources disagree, note the disagreement and cite each side rather than picking one
    - The output is a faithful map of the current state of knowledge on the topic, not a position paper

2. **Analyze and decompose the research question:**
    - Break down the user's query into composable research areas
    - Take time to ultrathink about the underlying patterns, connections and the implications of what the user might be seeking.
    - Identify specific components, patterns, or concepts to investigate
    - Create a research plan using TodoWrite to track all subtasks
    - Consider which directories, files, or architectural patterns are relevant

3. **Gather metadata for the research document:**
   - Run the `hack/spec_metadata.sh` script to generate all relevant metadata
   - Filename: `thoughts/shared/research/YYYY-MM-DD-description.md`
     - Format: `YYYY-MM-DD-description.md` where:
       - YYYY-MM-DD is today's date
       - description is a brief kebab-case description of the research topic
     - Examples:
       -  `2025-01-08-IFeval-metrics.md`
       -  `2026-04-24-attention-mechanism-comparisons.md`

4. **Generate research document:**
   - Use the metadata gathered in step 3
   - Structure the document with YAML frontmatter followed by content:
     ```markdown
     ---
     date: [Current date and time with timezone in ISO format]
     researcher: [Researcher name from thoughts status]
     git_commit: [Current commit hash]
     branch: [Current branch name]
     repository: [Repository name]
     topic: "[User's Question/Topic]"
     tags: [research, domain-area, subdomain, relevant-component-names]
     status: complete
     last_updated: [Current date in YYYY-MM-DD format]
     last_updated_by: [Researcher name]
     ---

     # Research: [User's Question/Topic]

     **Date**: [Current date and time with timezone from step 3]
     **Researcher**: [Researcher name from thoughts status]
     **Git Commit**: [Current commit hash from step 3]
     **Branch**: [Current branch name from step 3]
     **Repository**: [Repository name]

     ## Research Question
     [Original user query]

     ## Summary
     [High-level documentation of what was found, answering the user's question by describing what the sources say and where they agree or diverge]

     ## Detailed Findings

     ### [Topic / Component / Area 1]
     - What the source(s) report, with attribution ([file.ext:line](link) or [Source](url))
     - How it connects to other findings or components
     - Implementation details or source-reported facts (without evaluation)
     - **If sources disagree on this area**, note the disagreement explicitly and cite each side rather than picking one

     ### [Topic / Component / Area 2]
     ...

     ## Code References *(include only if the research touches a codebase)*
     - `path/to/file.py:123` - Description of what's there
     - `another/file.ts:45-67` - Description of the code block

     ## Citations

     ### Academic Papers
     - Author(s) (Year). *Title*. Venue. DOI: `10.xxxx/xxxxx` — obtained via `paper-search-mcp` / `arxiv-mcp-server` / `pubmed-mcp-server`
     - ...

     ### Web Sources
     - [Page title](https://url) — retrieved YYYY-MM-DD
     - ...

     ### Software / Documentation
     - `<library>` v`<version>` — [docs link](https://url) (found via `wiki` or `deepwiki` MCP)
     - ...

     ## Architecture Documentation *(include only if the research produced architectural or implementation findings)*
     [Current patterns, conventions, and design implementations found in the codebase]

     ## Historical Context (from thoughts/)
     [Relevant insights from thoughts/ directory with references]
     - `thoughts/shared/something.md` - Historical decision about X
     - `thoughts/local/notes.md` - Past exploration of Y
     Note: Paths exclude "searchable/" even if found there

     ## Related Research
     [Links to other research documents in thoughts/shared/research/]

     ## Open Questions
     [Any areas that need further investigation, including sources you couldn't access or MCPs that weren't configured]
     ```


5. **Handle follow-up questions:**
   - If the user has follow-up questions, append to the same research document
   - Update the frontmatter fields `last_updated` and `last_updated_by` to reflect the update
   - Add `last_updated_note: "Added follow-up research for [brief description]"` to frontmatter
   - Add a new section: `## Follow-up Research [timestamp]`
   - Spawn new sub-agents as needed for additional investigation
   - Continue updating the document and syncing