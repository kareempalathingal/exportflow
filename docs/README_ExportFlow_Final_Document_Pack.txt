EXPORTFLOW — FINAL DOCUMENT PACK v1.9
Prepared: 19 October 2026

CONTENTS
1. ExportFlow_Complete_Requirements_Bilingual_v1_9.docx
   Malayalam-first business requirements and functional design; primary user review reference.
   Section 78 = confirmed v1.9 decisions (governs over earlier sections).

2. ExportFlow_Requirements_English_v1_9.docx
   English implementation edition of the requirements. Section 31 mirrors Section 78.

3. ExportFlow_Technical_Architecture_Development_Plan_v1_3.docx
   Malayalam technical architecture. Section 16 = the only phase plan.

4. ExportFlow_Technical_Architecture_Development_Plan_English_v1_3.docx
   English technical architecture. Section 16 = the only phase plan.

5. CLAUDE.md
   Stable project instructions for Claude Code (updated file names and v1.9 decisions).

6. ExportFlow_Claude_Code_Kickoff_Prompt.md
   Initial read-only review prompt.

WHAT CHANGED SINCE v1.8 / v1.2
- All version references now point to Requirements v1.9 and Technical Plan v1.3.
- One unified phase plan replaces the three earlier phase lists.
- Decisions added: approvals are recorded (not granted) by the app with on-time/late tracking;
  Job-Order-wise manual stock confirmation, no automatic safety stock; 10% buffer always rounded up;
  skeleton-first build; new GitHub repo + GitHub Pages + new Firebase project on the free plan.
- Stray non-Malayalam text removed (Sections 8, 14, 26, 29.2, 62); "Failed" sync status added in
  Sections 43/45; numbered lists restart at 1; footer version corrected.

IMPORTANT
- Coding has not started. These are requirements and planning documents, not proof of implementation.
- If English and Malayalam documents conflict or are ambiguous, report the discrepancy and request
  clarification; do not silently choose.
- Do not invent company-specific data such as BOMs, capacity, benchmarks, lead times, workflow stages,
  or authority limits.
- Older versions are intentionally excluded to reduce confusion.
