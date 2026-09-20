# Unified workspace design QA

Date: September 19, 2026.

- Source visual truth: `.tmp/unified-workspace/selected-target.png`, the third
  displayed Image Gen result selected by the user.
- Implementation: `http://127.0.0.1:8896/home/`, isolated return-workspace fixture.
- Implementation screenshot evidence: inline CUA browser captures in this task,
  browser tab 3, final comparison titled "Final reference-to-implementation
  comparison". The browser API returned images inline, not an on-disk PNG path.
- Viewport: 1440 × 1024 CSS pixels. Source: 1487 × 1058 pixels. Implementation:
  1440 × 1024 pixels. Compared at equivalent aspect ratio with the source viewed
  at approximately 96.8% scale; the sample banner occupies an additional 28px.
- State: open return briefing, saved expired reading goal, upcoming Calendar
  fixture, expanded dock, no conversation messages or draft. The event time is
  deliberately shifted later when the mockup's 3 PM event would already be over.

## Comparison history

1. Initial capture found a P1 cascade conflict: old full-Talk grid placed the
   dock header in a zero-width column. Scoped unified-Home selectors now override
   that layout and preserve the existing chat DOM.
2. The first compact pass found P2 composer overflow beyond the dock boundary.
   Intrinsic flex sizing now keeps it enclosed and reachable by normal scrolling.
3. The narrow pass found a P2 positioned toolbar overlapping the goal. Restoring
   the header's positioning context anchors controls to the workspace.
4. The final full-view input contained both the selected image and the rendered
   1440 × 1024 screenshot. Summary/dock hierarchy, readable controls, spacing,
   expanded conversation and warm dark material now match the intended structure.
   The content was large enough to inspect the goal, date, actions, input and
   dock affordances in the same input; separate focused crops were unnecessary.

## Intentional implementation differences

The real wordmark, live orb, source icon sprite, fonts, speech/context controls,
History, recording controls and saved-widget access are preserved. The briefing
uses actual task wording rather than the mockup's hard-coded reading sentence.
The collapse arrow points down in the expanded state. No raster mockup is used
as interactive UI. Existing management pages remain available for full editing.

## Interaction verification

- Goal completion and Undo persisted through the existing isolated service.
- Widget details open inline; Escape restores focus to their trigger.
- Collapsing/reloading preserves the draft and collapsed state.
- Sending reaches the fixture conversation pipeline; no model is invoked.
- History and Settings remain reachable. Reduced motion can be enabled and Home
  remains usable. Edit home opens the saved widget arrangement directly; Done restores the prior dock state.
- Inspected 1440 × 1024, 760 × 820 and 390 × 844; the main workspace now fits the window; longer conversation content scrolls inside the dock.
- Browser console: no errors or warnings in final capture.
- Native app reopened; conversation, tasks and messages matched pre-restart hashes.

## Viewport-fit correction

The user rejected page scrolling. The workspace now uses its actual parent
height (including the preview banner offset), smaller height-responsive spacing,
and a flexible dock with an internally scrolling conversation. At 1170 × 768,
workspace scrollHeight/clientHeight were both 740px and the composer ended at
689px. At 760 × 820, page overflow was zero and the composer ended at 727px.
Opening goal details retained zero page overflow and the same composer bound.
The native 1170 × 768 window was refreshed and visually verified with its existing
long goal, briefing, history and draft: controls and composer fit together.

## Widget control refinement

Removed the standalone Your widgets reveal button after user feedback. Existing
Add widgets and Edit home controls now own widget arrangement. Entering edit
mode pauses the dock presentation and exposes the saved board; Done or cancelling
placement restores the previous dock state. Verified Edit/Done and Add widgets →
Preview placement → Cancel, with no test widget committed. Normal Home has no
extra reveal button and retains its viewport fit.

## Follow-up polish and limits

P3: the production wordmark/orb and typography differ slightly from generated
lettering. This pass does not prove performance under long sessions or clinical
benefit. Automatic source-backed inference and new daytime triggers remain later
implementation stages; this UI opening is a local state projection.

final result: passed

### Summary panel refinement

Removed the oversized note/calendar icon tiles, tinted card fills, raised outlines, and status pill following user feedback. Goal and event summaries now use aligned text, subtle top dividers, and a small disclosure chevron. Browser screenshots checked at 1207×1044 and 760×820; detail open/close restores focus, composer remains visible, and no console errors. Formatting, ESLint, and six briefing tests pass.

### Correction after user review

The user rejected the thin-divider summary treatment. Removed the rules and restored rounded surfaces using the conversation dock’s exact background, border, radius, and shadow values. Oversized icon tiles remain removed.

### Settings simplification

Settings remains a dedicated page. Replaced its secondary sidebar with a horizontal section switcher, grouped General into Appearance, Conversation, Sound, and Personal & shortcuts, and unified switches, fields, buttons, and disclosure controls with the rounded workspace materials. Wide and compact screenshots inspected; General, Permissions, Memory, and Account navigation checked. Reduce motion persisted through reload in the isolated preview and was restored. Profile disclosure opens. Account authentication was not exercised; the fixture reports account status unavailable. Full repository checks pass.

### Original glass material restored

Registered summary widgets, inline details, briefing actions, Settings tabs, and Settings buttons with the existing glass renderer. Loaded the shared material after layout styles, removed conflicting material overrides, and restored the composer’s glass pseudo-elements. The widget disclosure now has its own span so it does not overwrite the glass edge. Restored original switch styling. Browser verification covers Home, expanded composer, goal detail open/close with focus restoration, and Settings at wide and compact sizes; no console errors. Full checks passed, followed by formatting/lint checks for final selector cleanup.

### Glass coverage correction

The preceding pass missed large surfaces and native form controls. Settings body and conversation dock now share the original glass layers without tilting the containing page. Select/text/search controls use a glass face around the existing native element; switch and range styling uses matching depth and highlights while preserving native input behavior. Verified wide and compact Settings, expanded Home dock, microphone mode selection and reduced-motion toggle (both restored in the fixture). No browser errors; full repository checks pass.

### Interaction parity correction

Registered the formerly static large surfaces with the original glass pointer controller and allowed child controls inside these registered surfaces. Shared motion now explicitly includes settling, press displacement, focus feedback, selected-tab contrast, and reduced-motion suppression. Live browser pointer interaction produced 2.27deg panel tilt with a moving light position; Reduce motion yielded 0deg and no hover state. Preview had Reduce motion enabled; it is now off for animation review and was verified after reload. Keyboard ArrowRight navigation changes section and focuses the selected tab. Full checks pass.

### Home navigation regression

Removed the unified Home rule that unconditionally hid the navigation rail and its reveal area. Home now retains the existing pinned/collapsed behavior; desktop content reserves space for the open rail, and compact Home reserves room for the bottom navigation. Verified Settings → Home with Keep sidebar open enabled, plus an expanded conversation at 650×820 with visible navigation and composer. No browser errors; CSS formatting and diff checks pass.

### Finished Home navigation consolidation

User explicitly confirmed removing the sidebar and consolidating Goals/Activity into Home widgets and detail panels. Settings remains separate with Back to Home. Removed the obsolete sidebar preference. Reused existing goal management and activity controls in a native modal detail panel with keyboard dismissal. Checked goal expansion/editor/cancel, activity filtering, Escape and focus restoration, old goal deep link reload, Settings return, and preservation of an expanded dock plus unsent draft. Home fits at 760×820. Full checks passed. No live source connections or personal goals were modified during verification.

### Collapsed Home density

Collapsed conversation now reveals the existing saved widget area and its page controls, using the available height above a bottom-anchored compact dock. Settings return preserves the Home conversation open state. Verified at 1170×768 and the normal wide viewport; checked expanded conversation → Settings → Home, saved widget paging, and Edit home → Done. Existing widget data/layout was retained. Full checks pass.
