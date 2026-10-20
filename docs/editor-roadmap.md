# Markcraft editor roadmap

Start with **screenshot editing and the editor's appearance**. The goal is a familiar, polished Windows workflow that can grow toward Snagit's useful editing capabilities while retaining Markcraft's name, visual identity and existing capture engine.

This plan now records the first implemented editor milestone and the work that should follow it.

## Verified baseline

On October 19, 2026, dependencies were installed with the lockfile using Node.js 24.22.0. Type checking, all seven unit tests and the production build passed. The real Electron editor smoke test also passed after correcting its test harness: it now waits for the image, draws at actual-size zoom to avoid synthetic pointer rounding, checks both saved document dimensions, and returns a failing exit status when an assertion fails.

The smoke test verified drawing, undo/redo, a 1050 by 600 pixel crop and saved redactions. Its screenshot is available locally at `out/baseline-editor.png`; the ignored `out/` directory can be regenerated. This is a baseline for comparison, not complete Windows capture or accessibility testing.

The dependency installer reported eight moderate vulnerability advisories. Review those as a separate maintenance task before distributing a release; dependencies have not been upgraded as part of the editor plan.

## Starting point

Markcraft already supports selection, arrows, lines, rectangles, ellipses, text, numbered steps, highlighting, pen drawing, pixelation, solid redaction and cropping. It also has undo/redo, zoom, text recognition, clipboard copying, PNG/JPEG export and editable `.markcraft` files.

The editor currently puts tools and styling controls in one row of small icons. Color, width and text size share one set of defaults. Captures open in separate windows, and auto-save can retain original screenshots in `Pictures/Markcraft`; there is no browsable capture library yet.

## First milestone: a clearer editor

Implemented on the `enhancements` branch: labeled tools at comfortable window widths, separated document actions, a persistent Tool Properties sidebar, selection-aware supported controls, six built-in Quick Styles, Windows shortcut labels, and Grab Text sharing the sidebar. Unsupported controls stay hidden; for example, selected arrows and step numbers do not claim to support resizing after drawing.

Selection editing now uses high-contrast circular resize and rotation handles, reports the selected bounds, and provides Duplicate, Delete, To Front and To Back actions. Ctrl+A selects every annotation, Ctrl+D duplicates the selection, arrow keys move it by one pixel, and Shift+arrow moves it by ten pixels. These operations participate in undo/redo.

The Select tool also shows eight handles around the captured canvas. Dragging an edge or corner trims that side or adds transparent canvas space; resizing from the top or left keeps the capture and annotations aligned. Canvas resizing is undoable and is preserved in exported images and editable documents.

Markcraft now opens with a dedicated capture window, and the tray icon restores it. Auto-saved captures in `Pictures/Markcraft` form a persistent Library with search, dates and thumbnails. Editors include a collapsible recent-captures strip with shortcuts back to Capture and Library; selecting a recent thumbnail reopens that saved capture.

Validation for this milestone passed on October 19, 2026: TypeScript checking, all seven unit tests, the production build, the native Electron editor smoke test, and screenshot generation. The smoke test covered drawing, undo/redo, exact crop dimensions, editable document saving, and burned-in redactions. Updated editor, OCR and selection screenshots are stored in `docs/screenshots/`.

Deliver one complete editing workflow: **open a screenshot, choose a tool, draw an annotation, adjust its appearance, undo a change, then copy or save the result**.

- Give common tools visible labels and a clear selected state. Keep every tool reachable when the window is narrow.
- Separate editing tools from actions such as Undo, Redo, Copy and Save. Show Windows shortcut names on Windows.
- Add a right-hand Tool Properties panel. Show the active tool or selection, and only controls that actually work for it.
- Read properties from selected annotations. Refresh after selection changes and undo/redo; show an honest mixed state for selections with different values. Changing controls must edit the selection when supported and set defaults for new annotations when there is no selection.
- Put Grab Text and Tool Properties in the same sidebar using clear panel switching. Keep enough room for the image and refit it when the available space changes.
- Add a few built-in Quick Styles, combining existing supported appearance settings. Applying a style must preserve the selection and be undoable. Saved custom styles and remembered per-tool defaults can follow after the basic interaction works.

Do not add blank controls, inactive feature buttons or a fake recent-capture strip. For example, selected arrows currently support color changes but their thickness is built into the path geometry. Expose a selected-arrow thickness control only after it works correctly.

The first milestone primarily touches `src/renderer/editor.html` and the files in `src/renderer/editor/`. Keep capture behavior, file formats and the safe handling of saved redactions intact.

## Following milestones

1. **Callouts and stronger text formatting:** add a useful callout shape, then font choices, text emphasis and alignment. Keep text editable when saving a `.markcraft` file.
2. **Arrow and shape options:** add reliable arrow thickness and head options, shape fill and outline controls, and selected-object property editing. Each option needs a visible result and working undo/redo.
3. **Screenshot effects:** add a small, tested set such as borders, shadows and image resizing. Check image dimensions and export results before expanding the list.
4. **Real recent captures:** add thumbnails that reopen actual captures, with clear saved/edited states. This needs storage and document lifecycle work, including a decision about preserving annotations and unsaved edits when switching captures. Build the underlying behavior before presenting a library UI.

Keep screen recording and other capture improvements outside these editor milestones unless an editing change depends on them.

## Acceptance checks

For the first milestone:

- Compare before-and-after screenshots of the same image and annotations. Check both light and dark appearance, a normal window and the minimum supported size.
- Draw and edit an arrow, rectangle, text annotation and highlight. Verify that applicable controls and Quick Styles update the intended object and that properties follow the selection.
- Undo and redo drawing and style changes. Check that the panel shows the restored state.
- Use tool shortcuts, edit text and use the keyboard to reach controls. Shortcuts must not interrupt text entry.
- Open and close Grab Text. Check sidebar switching, image fit, scrolling and zoom.
- Copy the image, export PNG/JPEG, and save and reopen an editable `.markcraft` file. Check that output dimensions and annotations are correct, and that crop/redaction behavior is preserved.
- Run `npm.cmd run typecheck`, `npm.cmd test` and `npm.cmd run build`. Record what passed and any remaining problems. These commands complement hands-on Windows checks; they do not prove the editor looks or behaves correctly.

## Work in small steps

Use the current `enhancements` branch. A branch keeps this work separate from `main`; a commit records a reviewable checkpoint locally, and a push uploads those commits to the fork.

1. Record baseline screenshots and a short list of the current behavior to preserve.
2. Change the layout and labeled tools; check the existing drawing workflow, then make a small commit.
3. Add the properties panel and selection synchronization; check edits and undo/redo, then commit.
4. Add shared OCR panel switching and built-in Quick Styles; check narrow windows and keyboard use, then commit.
5. Complete the acceptance checks, compare before/after, and record the outcome before uploading the branch to the fork.

Choose commit messages that describe the result, such as `Add labeled editor tools` or `Sync tool properties with selected annotations`. Avoid mixing unrelated recording, capture or packaging changes into these commits.

## Product references

Use these official Snagit pages to discuss the specific style and tool-property interactions they describe. They are product references, not proof that every Snagit feature is included in this plan:

- [Quick Styles and Favorites](https://www.techsmith.com/learn/tutorials/snagit/quick-styles-and-favorites/)
- [Set and Save Default Tool Properties](https://support.techsmith.com/hc/en-us/articles/45790530141069-How-to-Set-and-Save-Default-Tool-Properties-in-Snagit)
