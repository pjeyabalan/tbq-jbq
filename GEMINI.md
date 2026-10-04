# Workspace Rules: Simple Scoring Layout & Core Requirements

This document contains binding architectural and functional rules for Google Antigravity (AGY).
**Before making any code edits or design changes, you MUST consult and adhere strictly to these rules.**

---

## Core Rule: Simple, Focused Scoring Screen

1. **Student Tiles (The Primary Focus)**:
   - For both teams, display individual, tap-friendly student tiles.
   - Each student tile must display:
     - **Student Name** (bold and prominent).
     - **Live Score** (e.g. `20 pts`).
     - **Live Answer Record**: `✅ correct/5` and `❌ errors/3`.
     - Milestone alerts if reached: `⚠️ 1 more to QO`, `⚠️ 1 error to EO`, `⭐ PERFECT QO (+20)`, `❌ ERRORED OUT (3/3)`.
   - Tapping a tile immediately selects that student.
   - An active student must always be pre-selected on load.

2. **Pointer Value Selection**:
   - Prominent, easy-to-tap selector for question point values:
     - `10 Pts`
     - `20 Pts`
     - `30 Pts`

3. **Interruption Selection**:
   - Simple toggle / button: `⚡ Interruption?` (Yes / No).

4. **Answer Submission**:
   - Clear, immediate scoring options:
     - `✅ CORRECT (+Pts)`
     - `❌ INCORRECT (Err)`
   - Record and update live totals instantly.

5. **Simplicity Over Clutter**:
   - Keep the match screen clean, focused, and uncluttered.
   - Do NOT clutter the match screen with unnecessary complex tables, dummy seats, or unwanted room configurations.
   - Everything needed for scoring is on screen: student name, pointer value, interruption toggle, and result.

6. **Interruption Re-Read & Rebound Scoring (2 Quizzers on the Same Question)**:
   - When a question is interrupted and the quizzer answers incorrectly (`❌ Error` with half-point penalty):
     - The question is re-read for the **opposite team**.
     - The scorer remains on the **same Question #** (does NOT auto-advance to the next question).
     - The system prompts that the opposite team can now answer (rebound mode) with the opposite team pre-selected.
     - The coach can score a 2nd quizzer for the same question:
       - **Both can be negative** (e.g. first quizzer interrupted error penalty `-half`, second quizzer error penalty `-half` or `0`).
       - **Or one negative and one positive** (first quizzer interrupted error penalty `-half`, second quizzer correct `+points`).
     - If the opposite team does not buzz in, provide an immediate `⏭️ Skip Rebound / Next Question` action.
     - Both quizzer scores, points, and errors are recorded for that question in the match log and scoresheet.

---

## Pre-Completion Verification
1. Verify JavaScript & Node syntax:
   ```bash
   node -c server.js
   node -c public/app.js
   ```
2. Restart server daemon if server code changed and verify with curl.
