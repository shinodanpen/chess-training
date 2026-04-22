# Test Checklist

Use this checklist to verify Scenario / Review Mode and nearby regressions.

## Setup

- [ ] Start backend and frontend.
- [ ] Confirm the normal setup overlay still appears.
- [ ] Confirm `Scenario / Review` is visible and clickable.
- [ ] Confirm the standard color-start buttons still work.

## Standard Mode Regression

- [ ] Start a normal game as White.
- [ ] Make 2-3 normal moves.
- [ ] Confirm coach analysis appears after each full turn.
- [ ] Confirm `Hint` still works.
- [ ] Confirm coach chat still works.
- [ ] Confirm `Undo` still removes a full turn.
- [ ] Confirm `New Game` returns to setup.
- [ ] Confirm `Resign` returns to setup.
- [ ] Start a normal game as Black.
- [ ] Confirm the engine still opens first.
- [ ] Confirm board orientation is correct for Black.

## Scenario Entry

- [ ] Open `Scenario / Review`.
- [ ] Confirm the game container opens and the board is visible.
- [ ] Confirm the board is not draggable in editor mode.
- [ ] Confirm chat is hidden or disabled before validation.
- [ ] Confirm the scenario panel shows the piece palette.
- [ ] Confirm the scenario panel shows the erase tool.
- [ ] Confirm the scenario panel shows side-to-move controls.
- [ ] Confirm the scenario panel shows player-color controls.
- [ ] Confirm the scenario panel shows opponent ELO input.
- [ ] Confirm the scenario panel shows `Clear Board`.
- [ ] Confirm the scenario panel shows `Reset to Start`.
- [ ] Confirm the scenario panel shows `Validate Scenario`.
- [ ] Confirm the scenario panel shows `Back`.

## Editor Interactions

- [ ] Click a piece in the palette, then click squares on the board.
- [ ] Confirm pieces are placed on clicked squares.
- [ ] Place a piece on an occupied square.
- [ ] Confirm it replaces the old piece cleanly.
- [ ] Select `Erase`, then click occupied squares.
- [ ] Confirm pieces are removed.
- [ ] Click empty squares with `Erase`.
- [ ] Confirm nothing breaks.
- [ ] Use `Clear Board`.
- [ ] Confirm the board empties.
- [ ] Use `Reset to Start`.
- [ ] Confirm the standard initial position returns.
- [ ] Change player color in editor.
- [ ] Confirm board orientation flips immediately.
- [ ] Change piece set while in editor.
- [ ] Confirm the editor position is preserved.
- [ ] Change board theme while in editor.
- [ ] Confirm the editor position is preserved.

## Client-Side Validation Errors

- [ ] Remove the White king and validate.
- [ ] Confirm a clear error appears.
- [ ] Remove the Black king and validate.
- [ ] Confirm a clear error appears.
- [ ] Put a pawn on rank 1 or rank 8 and validate.
- [ ] Confirm a clear error appears.
- [ ] Set opponent ELO below `800` and validate.
- [ ] Confirm a clear error appears.
- [ ] Set opponent ELO above `2200` and validate.
- [ ] Confirm a clear error appears.
- [ ] Try empty or non-numeric ELO input.
- [ ] Confirm a clear error appears.

## Backend Validation / Legal-State Checks

- [ ] Build a position with both kings but illegal structure, then validate.
- [ ] Confirm backend validation rejects it.
- [ ] Build a legal but already finished position such as stalemate or checkmate.
- [ ] Confirm validation succeeds if the position is legal.
- [ ] Confirm the UI behaves sensibly after validation on a game-over position.

## Scenario Ready State

- [ ] Validate a legal scenario.
- [ ] Confirm editor mode exits into `scenario_ready`.
- [ ] Confirm the board remains on the validated position.
- [ ] Confirm chat becomes available immediately.
- [ ] Confirm the analysis area shows the scenario-ready placeholder.
- [ ] Confirm `Edit Scenario` is visible.
- [ ] Confirm `Analyze Position` is visible.
- [ ] Confirm `Play From Here` is visible.
- [ ] Confirm hint and undo gameplay buttons are hidden or disabled here.

## Scenario Chat Before Play

- [ ] In `scenario_ready`, ask the coach a question.
- [ ] Confirm the chat reply works using the validated FEN.
- [ ] Ask a second follow-up.
- [ ] Confirm conversation history is preserved.
- [ ] Confirm this does not start the game automatically.

## Analyze Position

- [ ] Click `Analyze Position`.
- [ ] Confirm a short intro review appears in the analysis pane.
- [ ] Click `Analyze Position` again.
- [ ] Confirm it refreshes cleanly without corrupting state.
- [ ] Ask the coach a question after analysis.
- [ ] Confirm chat still works and uses the intro analysis as context.

## Play From Here: Player To Move

- [ ] Validate a scenario where the chosen player is to move.
- [ ] Click `Play From Here`.
- [ ] Confirm normal play starts immediately.
- [ ] Make a move.
- [ ] Confirm backend `/move` still works from the custom FEN.
- [ ] Confirm turn analysis appears normally.
- [ ] Confirm `Hint` works.
- [ ] Confirm chat works.
- [ ] Confirm `Undo` removes a full turn.

## Play From Here: Opponent To Move

- [ ] Validate a scenario where the opponent is to move.
- [ ] Click `Play From Here`.
- [ ] Confirm `Let Opponent Move` appears.
- [ ] Confirm the player cannot move before clicking it.
- [ ] Click `Let Opponent Move`.
- [ ] Confirm exactly one engine move is applied.
- [ ] Confirm last-move highlights appear.
- [ ] Confirm the intro analysis is cleared as stale.
- [ ] Confirm chat remains usable afterward.
- [ ] Make a player move next.
- [ ] Confirm normal scenario play continues.

## Scenario Undo Edge Case

- [ ] In an opponent-to-move scenario, click `Let Opponent Move`.
- [ ] Before making any player move, click `Undo`.
- [ ] Confirm the app returns to the validated `scenario_ready` state.
- [ ] Confirm the board resets to the original validated FEN.
- [ ] Confirm `Analyze Position` and `Play From Here` are available again.

## Game-Over Scenario Cases

- [ ] Validate a scenario that is already stalemate or checkmate.
- [ ] Confirm `Analyze Position` still works.
- [ ] Confirm chat still works.
- [ ] Confirm `Play From Here` is disabled or effectively blocked.
- [ ] If not, record it as a bug.

## Navigation / Reset

- [ ] From editor mode, click `Back`.
- [ ] Confirm return to the setup overlay.
- [ ] From `scenario_ready`, click `New Game`.
- [ ] Confirm full reset to setup.
- [ ] From live scenario play, click `New Game`.
- [ ] Confirm full reset to setup.
- [ ] From live scenario play, click `Resign`.
- [ ] Confirm full reset to setup.
- [ ] Start a standard game after using scenario mode.
- [ ] Confirm no scenario state leaks into standard mode.

## Likely Bug Hunts

- [ ] Check for wrong board orientation after switching between editor, ready, and play states.
- [ ] Check whether piece-set or theme changes unexpectedly reset scenario state.
- [ ] Check whether chat is enabled too early in editor mode.
- [ ] Check whether undo is enabled when it should not be.
- [ ] Check whether hint is enabled during `scenario_ready` or opponent-wait state.
- [ ] Check whether the analysis pane shows stale intro analysis after the board changes.
- [ ] Check whether `Play From Here` is allowed on already game-over positions.
- [ ] Check whether invalid scenarios are accepted because frontend and backend validation disagree.
- [ ] Check whether scenario-ready chat uses the wrong FEN after edits or revalidation.
- [ ] Check whether opponent-first engine move fails on terminal or edge-case positions.

## Findings Template

- [ ] Starting mode:
- [ ] FEN used:
- [ ] Player color:
- [ ] Side to move:
- [ ] Opponent ELO:
- [ ] Exact steps:
- [ ] Expected result:
- [ ] Actual result:
- [ ] Console or network error:
