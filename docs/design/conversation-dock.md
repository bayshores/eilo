# Conversation on Home

Selected September 9, 2026. **Later refinement:** an expanded Home conversation now keeps a compact context strip and yields the duplicate saved-widget board space to the actual message history. A lightweight in-app eïlo overlay can surface a fresh reply only while the dock is closed; it never takes focus or opens a modal. The user rejects a miniature chat preview that opens a large blocking conversation modal and explicitly selected a bottom bar with inline replies.

## Reference decisions

Mobbin MCP was used to inspect real web screen images, rather than infer an interface from metadata. [Fibery's document and assistant screen](https://mobbin.com/screens/e1f475cd-9340-4b6d-98c3-9ad852993175) shows work and conversation coexisting. [Sana AI's conversation screen](https://mobbin.com/screens/9098947d-d197-4f05-a54d-de310aa638be) supplied a reference for a compact persistent composer. These are specific interaction references, not a decision to adopt their full layouts or appearance.

For eïlo, retain charcoal/peach, IBM Plex, rounded controls and the accepted widget workspace. Use a permanently available text/microphone bar centered at the bottom. Replies and history expand upward into a bounded section joined to that bar, with no backdrop or focus trap. Conversation history scrolls inside that section; Home does not become a scrolling chat page. The expanded section covers some lower workspace area, especially in compact windows, and can be collapsed with Hide replies or Escape.

## Implementation contract

- Keep one client, draft, composer, native history log and speech controller. Sending/recovery semantics and task authority stay unchanged.
- Remove the duplicate live Conversation widget and top-level Talk button. Every conversation action focuses the same bottom input. Other detail views can remain dialogs.
- Preserve custom positions and footprints of the other widgets. Only the untouched default layout expands Progress into the retired Conversation slot; no task/history data is removed. Standalone mockups retain their sample layout.
- A history toggle is optional; typing/speaking does not require opening another view. Send opens the inline reply section. Live check-ins arrive above the same bar; Reply focuses the composer.
- Preserve actual streaming and local transcription. Condense the speech mode choice into a visible arrow beside Speak/Hold to talk, keeping the native keyboard-operable select and accessible label.
- New text must not take focus. Escape collapses replies while retaining the draft. When the dock is closed, a fresh assistant reply may appear in the in-app eïlo overlay with Open and Dismiss; the overlay waits while a dialog or conversation is active. Microphone cancellation takes precedence; opening another modal also cancels capture so the microphone control cannot be hidden while recording.
- Bound scrolling to the message history; honor reduced motion and visible keyboard focus. A narrow window may use the existing More widgets drawer.

## Verification

59 frontend regressions passed, including the new layout conversion and preservation cases. Browser fixtures verified immediate acceptance, actual-shaped text streaming, one composer/log, no open conversation dialog, draft persistence through details and reload, selected speech mode persistence, Escape collapse and check-in Reply routing. The real Home loaded its existing saved state without a test message or new model call.

Rendered checks covered 1280×720, 1182×1044 and a compact 820×640 viewport. No document overflow was found; the compact view retained the More widgets behavior. The temporary viewport override was reset. Hardware microphone capture and screen-reader operation were not exercised in this design pass. This is a reviewed implementation baseline; visual satisfaction still belongs to the user.
